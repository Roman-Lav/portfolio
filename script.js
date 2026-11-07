'use strict';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');


/* ==========================================================================
   Theme toggle
   The starting theme is already set by the small script in <head>.
   ========================================================================== */

(() => {
  const root = document.documentElement;
  const toggle = document.querySelector('.theme-toggle');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const STORAGE_KEY = 'theme';
  if (!toggle) return;

  const currentTheme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  function savedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  function saveTheme(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode: just don't remember */ }
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    if (themeColor) themeColor.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  }

  // New theme grows as a circle from the button until it covers the screen
  function spreadFromButton(theme) {
    const box = toggle.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    root.classList.add('theme-switching');
    const transition = document.startViewTransition(() => applyTheme(theme));
    transition.finished.finally(() => root.classList.remove('theme-switching'));
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 600, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      })
      .catch(() => { /* transition skipped: the theme is applied anyway */ });
  }

  // Fallback for browsers without View Transitions
  let fadeTimer = 0;
  function fadeTo(theme) {
    root.classList.add('theme-fade');
    applyTheme(theme);
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 400);
  }

  function switchTheme(theme, fromButton) {
    if (reduceMotion.matches) applyTheme(theme);
    else if (fromButton && typeof document.startViewTransition === 'function') spreadFromButton(theme);
    else fadeTo(theme);
  }

  toggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    switchTheme(next, true);
  });

  // Follow the system setting until the visitor picks a theme
  systemDark.addEventListener('change', (event) => {
    if (!savedTheme()) switchTheme(event.matches ? 'dark' : 'light', false);
  });

  applyTheme(currentTheme());
})();


/* ==========================================================================
   Carousel and audio previews
   ========================================================================== */

(() => {
  const scroller = document.querySelector('.albums');
  const heading = document.querySelector('.albums-heading');
  const edges = document.querySelectorAll('.edge');
  if (!scroller || !scroller.children.length) return;

  const SETS_EACH_SIDE = 3; // copies of the list on each side of the real one
  const SPEED = 520;        // px per second while hovering an edge
  const EASE = 0.14;        // seconds to reach full speed or to stop

  /* ---- Endless loop -------------------------------------------------------
     The list is copied on both sides. All copies look identical, so moving the
     scroll position by exactly one list width (the "period") is invisible.
     Swipe, trackpad and keyboard scrolling stay fully native. */

  const originals = Array.from(scroller.children);
  const count = originals.length;

  function makeCopy() {
    const fragment = document.createDocumentFragment();
    originals.forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('a, button').forEach((el) => { el.tabIndex = -1; });
      fragment.append(clone);
    });
    return fragment;
  }

  for (let i = 0; i < SETS_EACH_SIDE; i++) {
    scroller.prepend(makeCopy());
    scroller.append(makeCopy());
  }

  const firstReal = originals[0];
  const firstAfterReal = scroller.children[count * (SETS_EACH_SIDE + 1)];

  let period = 1;   // width of one full list, including gaps
  let home = 0;     // scroll position where the first real album lines up with the heading
  let place = 0;    // position inside the list (in periods), kept across resizes

  function measure() {
    const box = scroller.getBoundingClientRect();
    const first = firstReal.getBoundingClientRect();
    const gutter = heading ? heading.getBoundingClientRect().left - box.left : 0;
    period = firstAfterReal.getBoundingClientRect().left - first.left;
    home = scroller.scrollLeft + first.left - box.left - gutter;
  }

  // How far x is from the real list, in whole periods (0 while within one period of home)
  const wholePeriodsAway = (x) => Math.trunc((x - home) / period) * period;

  // Called when the user has finished scrolling: hop back to the matching spot near the real list
  function recenter() {
    if (speed !== 0) return; // edge scrolling keeps itself centered
    const x = scroller.scrollLeft;
    const shift = wholePeriodsAway(x);
    if (shift !== 0) scroller.scrollLeft = x - shift;
  }

  scroller.addEventListener('scroll', () => {
    place = (scroller.scrollLeft - home) / period;
  }, { passive: true });

  if ('onscrollend' in window) {
    scroller.addEventListener('scrollend', recenter);
  } else {
    // Older browsers without the scrollend event: wait for scrolling to go quiet
    let quietTimer = 0;
    scroller.addEventListener('scroll', () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(recenter, 150);
    }, { passive: true });
  }

  /* ---- Audio previews ----------------------------------------------------
     One shared audio element. State is painted on the real album and on all its
     copies, so every copy looks the same (needed for the invisible loop). */

  const audio = new Audio();
  audio.preload = 'none';
  let currentTrack = null;

  function paint(track, state) {
    scroller.querySelectorAll(`.album-cover[data-track="${track}"]`).forEach((cover) => {
      if ('progress' in state) cover.style.setProperty('--p', state.progress);
      if ('playing' in state) cover.classList.toggle('is-playing', state.playing);
      if ('active' in state) cover.classList.toggle('is-active', state.active);
    });
  }

  function resetCurrent() {
    if (currentTrack) paint(currentTrack, { playing: false, active: false, progress: 0 });
  }

  scroller.addEventListener('click', (event) => {
    const cover = event.target.closest('.album-cover');
    if (!cover) return;
    const track = cover.dataset.track;

    if (track === currentTrack) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }

    audio.pause();
    resetCurrent();
    currentTrack = track;
    audio.src = cover.dataset.src;
    paint(track, { progress: 0, active: true });
    audio.play().catch(resetCurrent);
  });

  audio.addEventListener('play', () => {
    paint(currentTrack, { playing: true, active: true });
    wake();
  });
  audio.addEventListener('pause', () => {
    if (currentTrack) paint(currentTrack, { playing: false });
  });
  audio.addEventListener('ended', () => {
    resetCurrent();
    currentTrack = null;
  });

  /* ---- One animation loop -------------------------------------------------
     Drives edge hover scrolling (with ease-in and ease-out) and the progress bar.
     It runs only while one of them needs it. */

  let speed = 0;
  let targetSpeed = 0;
  let pos = 0;       // exact scroll position while edge scrolling (scrollLeft may be rounded)
  let lastTime = 0;
  let frame = 0;

  function wake() {
    if (frame) return;
    lastTime = performance.now();
    pos = scroller.scrollLeft;
    frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    let keepGoing = false;

    if (targetSpeed !== 0 || speed !== 0) {
      speed += (targetSpeed - speed) * (1 - Math.exp(-dt / EASE));
      if (targetSpeed === 0 && Math.abs(speed) < 2) speed = 0;

      if (speed !== 0) {
        if (Math.abs(scroller.scrollLeft - pos) > 1) pos = scroller.scrollLeft; // user scrolled too
        pos += speed * dt;
        pos -= wholePeriodsAway(pos);
        scroller.scrollLeft = pos;
        keepGoing = true;
      }
    }

    if (currentTrack && !audio.paused) {
      if (audio.duration) paint(currentTrack, { progress: audio.currentTime / audio.duration });
      keepGoing = true;
    }

    frame = keepGoing ? requestAnimationFrame(tick) : 0;
  }

  function setTargetSpeed(direction) {
    targetSpeed = direction * SPEED;
    if (direction !== 0) wake();
  }

  /* ---- Edge zones: hover to scroll, click or Enter to move one album ---- */

  edges.forEach((edge) => {
    const direction = edge.dataset.direction === 'left' ? -1 : 1;

    edge.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && !reduceMotion.matches) setTargetSpeed(direction);
    });
    edge.addEventListener('pointerleave', () => setTargetSpeed(0));
    edge.addEventListener('click', () => {
      if (speed !== 0) return; // already moving from hover
      scroller.scrollBy({
        left: direction * (period / count),
        behavior: reduceMotion.matches ? 'auto' : 'smooth',
      });
    });
  });

  window.addEventListener('blur', () => setTargetSpeed(0));
  document.addEventListener('visibilitychange', () => setTargetSpeed(0));
  reduceMotion.addEventListener('change', () => setTargetSpeed(0));

  /* ---- Start position, and keep the same place on resize ----
     The album size depends on both width and height, so the album itself is observed too. */

  function layout() {
    measure();
    scroller.scrollLeft = home + place * period;
    pos = scroller.scrollLeft;
  }

  layout();
  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(scroller);
  resizeObserver.observe(firstReal);
})();


/* ==========================================================================
   Theme toggle alignment
   Measures how far below the top of the h1 box the "ROMAN LAV" capitals
   start (depends on the system font), so the button's top lines up with them.
   ========================================================================== */

(() => {
  let name = document.querySelector('.name');
  let temporary = false;
  if (!name) {
    // Inner pages have no name: measure an invisible copy so the buttons sit at the same height
    const header = document.querySelector('.header');
    if (!header) return;
    name = document.createElement('div');
    name.className = 'name';
    name.textContent = 'ROMAN LAV';
    name.setAttribute('aria-hidden', 'true');
    name.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
    header.append(name);
    temporary = true;
  }

  function measure() {
    const style = getComputedStyle(name);
    const size = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight) || size;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || !size) return;

    ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    const m = ctx.measureText((name.dataset.text || name.textContent).trim() || 'R'); // data-text: fx.js may be scrambling it
    if (m.fontBoundingBoxAscent === undefined) return; // old browser: keep CSS fallback

    const fontH = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    const baseline = (lineHeight - fontH) / 2 + m.fontBoundingBoxAscent;
    const capTop = baseline - m.actualBoundingBoxAscent;

    document.documentElement.style.setProperty('--name-cap-top', (capTop / size).toFixed(4));
  }

  function measureOnce() {
    measure();
    if (temporary) name.remove();
  }

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(measureOnce);
})();


/* ==========================================================================
   Menu
   The button toggles a full-screen overlay. Closes on Esc or a link click.
   ========================================================================== */

(() => {
  const root = document.documentElement;
  const button = document.querySelector('.menu-toggle');
  const menu = document.getElementById('site-menu');
  if (!button || !menu) return;

  function setOpen(open) {
    if (open) fitWidth();   // measured while closed: the page content is in its final place by now
    root.classList.toggle('menu-open', open);
    menu.inert = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) menu.querySelector('a')?.focus({ preventScroll: true });
  }

  const isOpen = () => root.classList.contains('menu-open');

  // Home page: the glow ends right under "A small step to know me better." = bottom of the header.
  // Inner pages (About, Vox, Contacts): it only covers the line with the buttons and the links,
  // plus the same inset the About text keeps (clamp 16–48px, as in the About text code below),
  // and never reaches the page content. Text size and positions stay the same, only the
  // panel's bottom edge moves up.
  const header = document.querySelector('.header');
  const links = menu.querySelector('.menu-links');
  function fitWidth() {
    if (!header) return;
    let bottom = header.getBoundingClientRect().bottom;

    if (header.classList.contains('header--bare')) {
      const box = button.getBoundingClientRect();
      const lineBottom = Math.max(box.bottom, box.top + box.height / 2 + (links ? links.offsetHeight / 2 : 0));
      const inset = Math.min(48, Math.max(16, window.innerWidth * 0.03));
      bottom = Math.min(bottom, lineBottom + inset);
      const content = document.querySelector('.main > :not(.visually-hidden)');
      if (content) bottom = Math.min(bottom, Math.max(lineBottom, content.getBoundingClientRect().top));
    }

    root.style.setProperty('--menu-h', `${Math.round(bottom + window.scrollY)}px`);
  }

  fitWidth();
  window.addEventListener('resize', fitWidth);
  if (document.fonts) document.fonts.ready.then(fitWidth);

  button.addEventListener('click', () => setOpen(!isOpen()));

  // Click anywhere outside the panel closes it
  document.addEventListener('click', (event) => {
    const keep = menu.contains(event.target) || button.contains(event.target) || event.target.closest('.theme-toggle');
    if (isOpen() && !keep) setOpen(false);
  });

  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      button.focus();
    }
  });
})();


/* ==========================================================================
   Page transitions, fallback
   Browsers with cross-page View Transitions animate on their own (style.css, section 13).
   The rest (.page-fade, set in <head>) fade the content out here first,
   then open the next page, which fades back in with CSS.
   ========================================================================== */

(() => {
  const root = document.documentElement;
  if (!root.classList.contains('page-fade')) return;

  const FADE_OUT = 220;   // ms, matches the transition in style.css
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || reduce.matches) return;
    // Let the browser handle new tabs, downloads and modified clicks (Cmd/Ctrl/Shift/middle)
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    // A jump to an anchor on this same page: no transition
    if (url.pathname === location.pathname && url.search === location.search) return;

    event.preventDefault();
    root.classList.add('page-leaving');
    setTimeout(() => { location.href = url.href; }, FADE_OUT);
  });

  // Coming back with the Back button can restore the faded-out page from cache: show it again
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) root.classList.remove('page-leaving');
  });
})();


/* ==========================================================================
   About text: fill the free rectangle
   Rectangle: from the bottom of the menu button / theme toggle down to the top of
   the footer animation / "PROJECT .LAV · © 2026", from the menu button's left edge
   to the theme toggle's right edge. Inside it, an even inset; the text gets the
   largest font size that still fits and is centered vertically.
   Positions come from offsetTop/offsetLeft, which ignore transforms, so the
   page fade-in animation can't throw the measurement off.
   ========================================================================== */

(() => {
  const text = document.querySelector('.about-text');
  const main = text && text.closest('.main');
  const menuButton = document.querySelector('.menu-toggle');
  const themeButton = document.querySelector('.theme-toggle');
  const footerParts = document.querySelectorAll('.footer-animation, .tap-me, .footer-credits');
  if (!text || !main || !menuButton || !themeButton || !footerParts.length) return;

  // Element's top-left corner in page coordinates
  function pageOffset(el) {
    let x = 0;
    let y = 0;
    for (let node = el; node; node = node.offsetParent) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    return { x, y };
  }

  function edges(el) {
    const { x, y } = pageOffset(el);
    return { left: x, top: y, right: x + el.offsetWidth, bottom: y + el.offsetHeight };
  }

  // Gap between lines = gap between words. Measured on the real font at 100px:
  // the line box is the capitals' height + the depth of g/y/p + one space, so the
  // white strip between two lines is exactly one space wide. A ratio, so it holds
  // at any font size the fitting below picks.
  function evenRhythm() {
    const style = getComputedStyle(text);
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    ctx.font = `${style.fontWeight} 100px ${style.fontFamily}`;
    const caps = ctx.measureText('HIEBDT');
    const tails = ctx.measureText('gjpqy,');
    if (caps.actualBoundingBoxAscent === undefined) return;   // old browser: CSS fallback
    // base word gap = the space itself + word-spacing from style.css (in em, so ×100 here)
    const extra = (parseFloat(style.wordSpacing) || 0) / (parseFloat(style.fontSize) || 1) * 100;
    const space = ctx.measureText(' ').width + extra;
    const lineHeight = (caps.actualBoundingBoxAscent + tails.actualBoundingBoxDescent + space) / 100;
    if (lineHeight > 0.8 && lineHeight < 2) text.style.lineHeight = lineHeight.toFixed(4);
  }

  // How much of the width the last line before "waves of music." fills, without stretching
  const endPart = text.querySelector('.about-text-end');
  function lineBeforeEndFill(width) {
    const lead = text.firstChild;
    if (!endPart || !lead || lead.nodeType !== Node.TEXT_NODE) return 1;
    text.classList.add('is-measuring');
    const range = document.createRange();
    range.setStart(lead, 0);
    range.setEnd(lead, lead.textContent.trimEnd().length);
    const rects = Array.from(range.getClientRects());
    text.classList.remove('is-measuring');
    if (!rects.length) return 1;
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const line = rects.filter((r) => r.bottom > bottom - 2);
    const left = Math.min(...line.map((r) => r.left));
    const right = Math.max(...line.map((r) => r.right));
    return (right - left) / width;
  }

  function fit() {
    if (document.documentElement.classList.contains('menu-open')) return; // the menu button is fixed then
    const menu = edges(menuButton);
    const theme = edges(themeButton);
    let footerTop = Math.min(...Array.from(footerParts, (el) => el.getBoundingClientRect().top + window.scrollY));
    // Phones: stop above the whole footer (its orange glow), not just above its contents,
    // so "waves of music." stays on the plain background
    const footer = document.querySelector('.footer');
    if (footer && window.matchMedia('(max-width: 600px)').matches) {
      footerTop = Math.min(footerTop, footer.getBoundingClientRect().top + window.scrollY);
    }

    const inset = Math.min(48, Math.max(16, window.innerWidth * 0.03));
    const box = {
      x: menu.left + inset,
      y: Math.max(menu.bottom, theme.bottom) + inset,
      w: theme.right - menu.left - inset * 2,
      h: footerTop - Math.max(menu.bottom, theme.bottom) - inset * 2,
    };
    if (box.w < 80 || box.h < 40) {   // no room (e.g. a phone on its side): back to a plain paragraph
      text.classList.remove('is-fitted');
      text.style.cssText = '';
      return;
    }

    text.classList.add('is-fitted');
    text.style.width = `${box.w}px`;
    evenRhythm();

    // Largest font size at which the text fits: binary search, to a tenth of a pixel
    let low = 8;
    let high = Math.min(box.h, 400);
    while (high - low > 0.1) {
      const mid = (low + high) / 2;
      text.style.fontSize = `${mid}px`;
      if (text.scrollHeight <= box.h && text.scrollWidth <= box.w + 1) low = mid;
      else high = mid;
    }
    text.style.fontSize = `${low}px`;

    // The line right before "waves of music." is stretched edge to edge too. If it holds
    // only a word or two, that leaves huge holes: step the size down a little until the
    // words wrap so that line is at least ~70% full on its own.
    let size = low;
    for (let step = 0; step < 40 && lineBeforeEndFill(box.w) < 0.7; step++) {
      size *= 0.99;
      text.style.fontSize = `${size}px`;
    }

    const origin = pageOffset(main);
    text.style.left = `${box.x - origin.x}px`;
    text.style.top = `${box.y - origin.y + (box.h - text.offsetHeight) / 2}px`;
  }

  fit();
  window.addEventListener('resize', fit);
  if (document.fonts) document.fonts.ready.then(fit);
  new ResizeObserver(fit).observe(main);
})();


/* ==========================================================================
   Contacts: enlarged photo
   Click, tap, Enter or Space on the photo opens it big in a <dialog> over the page.
   Closes on the backdrop, the cross or Esc (the dialog handles Esc itself), and the
   focus goes back to the photo. Without assets/photo.jpg it shows the silhouette.
   ========================================================================== */

(() => {
  const photo = document.querySelector('.contact-photo');
  const viewer = document.querySelector('.photo-viewer');
  if (!photo || !viewer || typeof viewer.showModal !== 'function') return;
  const body = viewer.querySelector('.photo-viewer-body');
  const closeButton = viewer.querySelector('.photo-viewer-close');

  function open() {
    const img = photo.querySelector('img');
    if (img && img.naturalWidth) {
      const big = new Image();
      big.src = img.currentSrc || img.src;
      big.alt = img.alt;
      body.replaceChildren(big);
    } else {
      const empty = document.createElement('div');
      empty.className = 'photo-viewer-empty';
      empty.setAttribute('role', 'img');
      empty.setAttribute('aria-label', 'No photo yet');
      body.replaceChildren(empty);
    }
    viewer.showModal();
    closeButton.focus();
  }

  photo.addEventListener('click', open);
  photo.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();   // Space would scroll the page
      open();
    }
  });

  closeButton.addEventListener('click', () => viewer.close());
  // A click anywhere but the photo itself (the dark backdrop) closes it
  viewer.addEventListener('click', (event) => {
    if (!event.target.closest('img, .photo-viewer-empty, .photo-viewer-close')) viewer.close();
  });
  viewer.addEventListener('close', () => {
    body.replaceChildren();
    photo.focus();
  });
})();
