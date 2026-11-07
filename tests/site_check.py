"""Automated site check for the portfolio.

Serves the repo over HTTP, opens every page in the installed Google Chrome
(via Playwright) at several widths and both themes, runs the interactive
scenarios and writes everything it finds to .site-test/:

  .site-test/results.json   machine-readable findings (read by the site-tester agent)
  .site-test/shots/*.png    screenshots of every page / viewport / theme

Run:  .venv/bin/python tests/site_check.py [--headed]
Exit code: 0 = no errors found, 1 = errors found, 2 = the check itself crashed.
"""

import functools
import http.server
import json
import shutil
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".site-test"
SHOTS = OUT / "shots"

PAGES = ["index.html", "about.html", "vox.html", "contacts.html"]
VIEWPORTS = {
    "mobile": {"width": 375, "height": 740, "is_mobile": True, "has_touch": True},
    "tablet": {"width": 820, "height": 1180, "is_mobile": True, "has_touch": True},
    "desktop": {"width": 1440, "height": 900, "is_mobile": False, "has_touch": False},
}
THEMES = ["light", "dark"]

findings = []


def add(severity, page, viewport, theme, check, message, **extra):
    findings.append({
        "severity": severity,          # error | warning
        "page": page,
        "viewport": viewport,
        "theme": theme,
        "check": check,
        "message": message,
        **extra,
    })


# ---------------------------------------------------------------- local server

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


# ---------------------------------------------------------------- static checks run in the page

PAGE_PROBE = """
() => {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const out = { overflowX: doc.scrollWidth - vw, wideElements: [], brokenImages: [],
                missingAlt: [], unlabeledButtons: [], smallTapTargets: [], title: document.title,
                lang: doc.lang, theme: doc.dataset.theme };
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].join('.');
    return s;
  };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
    if (el.closest('[inert], .carousel, .albums')) continue;   // carousel scrolls horizontally on purpose
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 1 || r.left < -1)) out.wideElements.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right), vw });
  }
  out.wideElements = out.wideElements.slice(0, 10);
  for (const img of document.images) {
    if (img.complete && img.naturalWidth === 0) out.brokenImages.push(img.getAttribute('src'));
    if (!img.hasAttribute('alt')) out.missingAlt.push(img.getAttribute('src'));
  }
  for (const b of document.querySelectorAll('button, a[href]')) {
    if (b.closest('[inert]')) continue;
    const name = (b.getAttribute('aria-label') || b.textContent || '').trim() || b.querySelector('img[alt]')?.alt;
    if (!name) out.unlabeledButtons.push(describe(b));
    const r = b.getBoundingClientRect();
    if (r.width && r.height && (r.width < 24 || r.height < 24) && getComputedStyle(b).display !== 'inline')
      out.smallTapTargets.push({ el: describe(b), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
}
"""


def static_checks(page, name, vp, theme):
    p = page.evaluate(PAGE_PROBE)
    if p["overflowX"] > 1:
        add("error", name, vp, theme, "horizontal-overflow",
            f"Page scrolls sideways by {p['overflowX']}px", culprits=p["wideElements"])
    if p["theme"] != theme:
        add("error", name, vp, theme, "theme", f"Expected data-theme={theme}, got {p['theme']}")
    for src in p["brokenImages"]:
        add("error", name, vp, theme, "broken-image", f"Image failed to load: {src}")
    if vp == "desktop" and theme == "light":   # page-level, report once
        if not p["title"]:
            add("warning", name, vp, theme, "a11y", "Empty <title>")
        if not p["lang"]:
            add("warning", name, vp, theme, "a11y", "<html> has no lang")
        for src in p["missingAlt"]:
            add("warning", name, vp, theme, "a11y", f"<img> without alt: {src}")
        for el in p["unlabeledButtons"]:
            add("warning", name, vp, theme, "a11y", f"Interactive element without accessible name: {el}")
    if vp == "mobile" and theme == "light":
        for t in p["smallTapTargets"]:
            add("warning", name, vp, theme, "tap-target",
                f"Tap target smaller than 24px: {t['el']} ({t['w']}x{t['h']})")


# ---------------------------------------------------------------- interactive scenarios

def reveal_theme_toggle(page):
    """Home page on phones: the theme toggle only shows while the menu is open."""
    if not page.locator(".theme-toggle").is_visible():
        page.click(".menu-toggle")
        page.wait_for_timeout(500)


def scenario_theme_toggle(page, name, vp):
    before = page.evaluate("document.documentElement.dataset.theme")
    reveal_theme_toggle(page)
    page.click(".theme-toggle")
    page.wait_for_timeout(400)
    after = page.evaluate("document.documentElement.dataset.theme")
    stored = page.evaluate("localStorage.getItem('theme')")
    if after == before:
        add("error", name, vp, "-", "theme-toggle", f"Clicking .theme-toggle did not change theme (stays {before})")
    elif stored != after:
        add("error", name, vp, "-", "theme-toggle", f"Theme not saved: data-theme={after}, localStorage={stored}")
    else:
        page.reload(wait_until="networkidle")
        if page.evaluate("document.documentElement.dataset.theme") != after:
            add("error", name, vp, "-", "theme-toggle", "Chosen theme is lost after reload")
    reveal_theme_toggle(page)
    page.click(".theme-toggle")   # restore
    page.wait_for_timeout(300)


def scenario_menu(page, name, vp):
    btn = page.locator(".menu-toggle")
    if btn.count() == 0:
        add("error", name, vp, "-", "menu", "No .menu-toggle button")
        return
    btn.click()
    page.wait_for_timeout(600)
    state = page.evaluate("""() => ({
      open: document.documentElement.classList.contains('menu-open'),
      expanded: document.querySelector('.menu-toggle').getAttribute('aria-expanded'),
      inert: document.querySelector('#site-menu').inert,
      linksVisible: [...document.querySelectorAll('.menu-links a')].every(a => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.left < innerWidth && r.right > 0;
      }),
    })""")
    if not state["open"] or state["expanded"] != "true" or state["inert"]:
        add("error", name, vp, "-", "menu", f"Menu did not open properly: {state}")
    elif not state["linksVisible"]:
        add("error", name, vp, "-", "menu", "Menu is open but its links are off-screen or zero-size")
    page.screenshot(path=str(SHOTS / f"{name[:-5]}-{vp}-menu-open.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    if page.evaluate("document.documentElement.classList.contains('menu-open')"):
        add("error", name, vp, "-", "menu", "Escape does not close the menu")

    # every menu link must lead to a page that loads
    for href in page.eval_on_selector_all(".menu-links a", "els => els.map(a => a.getAttribute('href'))"):
        if not (ROOT / href).exists():
            add("error", name, vp, "-", "menu", f"Menu link points to a missing file: {href}")


def scenario_player(page, name, vp):
    covers = page.locator(".album-cover")
    if covers.count() == 0:
        return
    srcs = page.eval_on_selector_all(".album-cover", "els => els.map(e => e.dataset.src)")
    for s in srcs:
        if not (ROOT / s).exists():
            add("error", name, vp, "-", "player", f"Audio file missing: {s}")
    first = covers.first
    first.scroll_into_view_if_needed()
    first.click()
    page.wait_for_timeout(1500)
    st = page.evaluate("""() => {
      const a = [...document.querySelectorAll('audio')][0] || window.__lavAudio;
      const c = document.querySelector('.album-cover');
      return { cls: c.className, article: c.closest('.album').className,
               audio: a ? { paused: a.paused, src: a.currentSrc, error: a.error && a.error.code } : null };
    }""")
    if st["audio"] and st["audio"]["error"]:
        add("error", name, vp, "-", "player", f"Audio element error code {st['audio']['error']}", state=st)
    page.screenshot(path=str(SHOTS / f"{name[:-5]}-{vp}-playing.png"))
    first.click()   # pause again
    page.wait_for_timeout(300)


def scenario_game(page, name, vp):
    # the home page on phones hides the footer credits (no "PROJECT .LAV" to tap there)
    if page.locator(".footer-project").count() == 0 or not page.locator(".footer-project").is_visible():
        return
    loc = page.locator(".footer-project")
    loc.scroll_into_view_if_needed()
    for _ in range(3):
        loc.click()
        page.wait_for_timeout(80)
    page.wait_for_timeout(600)
    is_open = "!!document.querySelector('.game.is-open')"
    if not page.evaluate(is_open):
        add("error", name, vp, "-", "game", "Triple-click on .footer-project did not open the game")
        return
    score_before = page.locator(".game-score").text_content()
    page.keyboard.press("Space")          # the game's own hint says: "space to start"
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOTS / f"{name[:-5]}-{vp}-game.png"))
    if not page.evaluate(is_open):
        add("error", name, vp, "-", "game",
            "Pressing Space right after opening closes the game instead of starting it")
        return
    if page.locator(".game-score").text_content() == score_before:
        add("error", name, vp, "-", "game", "Space did not start the game (score not running)")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    if page.evaluate(is_open):
        add("error", name, vp, "-", "game", "Escape does not close the game")


def check_links(page, name, base):
    hrefs = page.eval_on_selector_all("a[href]", "els => els.map(a => a.getAttribute('href'))")
    for h in hrefs:
        if h.startswith(("http", "mailto:", "tel:", "#")):
            continue
        target = (ROOT / h.split("#")[0]).resolve()
        if not target.exists():
            add("error", name, "-", "-", "broken-link", f"Link to missing local file: {h}")


# ---------------------------------------------------------------- runner

def attach_listeners(page, name, vp, theme, base):
    def on_console(msg):
        if msg.type == "error":
            add("error", name, vp, theme, "console", msg.text, location=msg.location)
        elif msg.type == "warning":
            add("warning", name, vp, theme, "console", msg.text, location=msg.location)

    def on_response(resp):
        if resp.url.startswith(base) and resp.status >= 400:
            add("error", name, vp, theme, "http", f"{resp.status} {resp.url.replace(base, '')}")

    def on_failed(req):
        if req.url.startswith(base) and "net::ERR_ABORTED" not in (req.failure or ""):
            add("error", name, vp, theme, "http", f"Request failed: {req.url.replace(base, '')} ({req.failure})")

    page.on("console", on_console)
    page.on("pageerror", lambda e: add("error", name, vp, theme, "js-exception", str(e)))
    page.on("response", on_response)
    page.on("requestfailed", on_failed)


def run(headed=False):
    if OUT.exists():
        shutil.rmtree(OUT)
    SHOTS.mkdir(parents=True)
    httpd, base = start_server()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome", headless=not headed,
                                         args=["--autoplay-policy=no-user-gesture-required"])
            for vp, size in VIEWPORTS.items():
                for theme in THEMES:
                    ctx = browser.new_context(
                        viewport={"width": size["width"], "height": size["height"]},
                        is_mobile=size["is_mobile"], has_touch=size["has_touch"],
                        color_scheme=theme)
                    for name in PAGES:
                        page = ctx.new_page()
                        attach_listeners(page, name, vp, theme, base)
                        page.goto(f"{base}/{name}", wait_until="networkidle")
                        page.wait_for_timeout(700)
                        static_checks(page, name, vp, theme)
                        page.screenshot(path=str(SHOTS / f"{name[:-5]}-{vp}-{theme}.png"), full_page=True)
                        if theme == "light":
                            for scen in (scenario_menu, scenario_theme_toggle, scenario_player, scenario_game):
                                try:
                                    scen(page, name, vp)
                                except Exception as e:   # a scenario crashing is itself a finding
                                    add("error", name, vp, "-", scen.__name__, f"Scenario crashed: {e}".split("\n")[0])
                        if vp == "desktop" and theme == "light":
                            check_links(page, name, base)
                        page.close()
                    ctx.close()
            browser.close()
    finally:
        httpd.shutdown()

    # collapse duplicates (same message on many viewports)
    merged = {}
    for f in findings:
        key = (f["severity"], f["page"], f["check"], f["message"])
        where = f"{f['viewport']}/{f['theme']}"
        if key in merged:
            if where not in merged[key]["seen_in"]:
                merged[key]["seen_in"].append(where)
        else:
            merged[key] = {**f, "seen_in": [f"{f['viewport']}/{f['theme']}"]}
    result = sorted(merged.values(), key=lambda f: (f["severity"] != "error", f["page"], f["check"]))
    errors = sum(f["severity"] == "error" for f in result)
    summary = {"errors": errors, "warnings": len(result) - errors,
               "screenshots": str(SHOTS.relative_to(ROOT)), "findings": result}
    (OUT / "results.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))

    print(f"Errors: {errors}  Warnings: {len(result) - errors}")
    for f in result:
        print(f"  [{f['severity']}] {f['page']} {f['check']}: {f['message']}  ({', '.join(f['seen_in'][:4])})")
    print(f"Full results: {OUT / 'results.json'}")
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.exit(run(headed="--headed" in sys.argv))
    except Exception as e:
        print(f"CHECK CRASHED: {e}", file=sys.stderr)
        sys.exit(2)
