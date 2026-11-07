'use strict';

// Phones: header controls at the bottom, footer credits at the top. Phones = up to 600px
// wide, or sideways with a touch screen and at most 500px tall (section 5d in style.css)
const SWAP = '(max-width: 600px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)';

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

  // Browser bar / the strip around the notch: the page background. On phones and tablets,
  // while the menu is open, the orange its panel starts with (--glow-rgb at 80% over --bg,
  // the same mix as in style.css), so the panel seems to reach up behind the clock.
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)');
  let menuOpen = false;
  function browserColor() {
    const style = getComputedStyle(root);
    const bg = style.getPropertyValue('--bg').trim();
    const glow = style.getPropertyValue('--glow-rgb').split(',').map(Number);
    const hex = /^#([0-9a-f]{6})$/i.exec(bg);
    if (!menuOpen || !touch.matches || window.matchMedia(SWAP).matches || !hex || glow.length !== 3) return bg;
    const base = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
    const mix = glow.map((c, i) => Math.round(c * 0.8 + base[i] * 0.2));
    return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    if (themeColor) themeColor.content = browserColor();
  }

  // The menu (below) tells when it opens or closes
  document.addEventListener('menu:toggle', (event) => {
    menuOpen = event.detail.open;
    if (themeColor) themeColor.content = browserColor();
  });

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

  // When scrolling settles: hop back near the real list, and (phones) switch the track
  // if another album is now in the middle (switchOnSwipe, defined below)
  const settled = () => {
    recenter();
    switchOnSwipe();
  };

  if ('onscrollend' in window) {
    scroller.addEventListener('scrollend', settled);
  } else {
    // Older browsers without the scrollend event: wait for scrolling to go quiet
    let quietTimer = 0;
    scroller.addEventListener('scroll', () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(settled, 150);
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

  const phone = window.matchMedia('(max-width: 600px)');

  // Start this cover's track from the beginning
  function start(cover) {
    audio.pause();
    resetCurrent();
    currentTrack = cover.dataset.track;
    audio.src = cover.dataset.src;
    paint(currentTrack, { progress: 0, active: true });
    audio.play().catch(resetCurrent);
  }

  // Same track: pause / resume. Another one: switch to it.
  function toggle(cover) {
    if (cover.dataset.track !== currentTrack) {
      start(cover);
    } else if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  scroller.addEventListener('click', (event) => {
    const cover = event.target.closest('.album-cover');
    if (!cover) return;
    // Phones: a tap on the playing track's progress bar seeks (below), it doesn't pause
    if (phone.matches && event.target.closest('.progress') && cover.dataset.track === currentTrack) return;
    toggle(cover);
  });

  /* ---- Phones: a tiny player ----------------------------------------------
     The button in the bottom row plays / pauses the album in the middle of the
     carousel. Swiping to another album while music plays switches the track.
     The progress bar can be tapped or dragged to jump within the track. */

  const playButton = document.querySelector('.player-toggle');

  // The cover in the middle of the carousel (the real album or one of its copies)
  function centeredCover() {
    const box = scroller.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    let best = null;
    let distance = Infinity;
    for (const item of scroller.children) {
      const r = item.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - middle);
      if (d < distance) { distance = d; best = item; }
    }
    return best && best.querySelector('.album-cover');
  }

  function syncButton() {
    if (!playButton) return;
    const playing = Boolean(currentTrack) && !audio.paused;
    playButton.classList.toggle('is-playing', playing);
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  if (playButton) {
    playButton.addEventListener('click', () => {
      const cover = centeredCover();
      if (cover) toggle(cover);
    });
  }

  function switchOnSwipe() {
    if (!phone.matches || !currentTrack || audio.paused) return;
    const cover = centeredCover();
    if (cover && cover.dataset.track !== currentTrack) start(cover);
  }

  function seekTo(event, bar) {
    if (!audio.duration) return;
    const r = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
    audio.currentTime = ratio * audio.duration;
    paint(currentTrack, { progress: ratio });
  }

  scroller.addEventListener('pointerdown', (event) => {
    const bar = event.target.closest('.progress');
    if (!bar || !phone.matches) return;
    if (bar.closest('.album-cover').dataset.track !== currentTrack) return;
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    seekTo(event, bar);
    const move = (e) => seekTo(e, bar);
    const stop = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', stop);
      bar.removeEventListener('pointercancel', stop);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  });

  audio.addEventListener('play', () => {
    paint(currentTrack, { playing: true, active: true });
    syncButton();
    wake();
  });
  audio.addEventListener('pause', () => {
    if (currentTrack) paint(currentTrack, { playing: false });
    syncButton();
  });
  audio.addEventListener('ended', () => {
    resetCurrent();
    currentTrack = null;
    syncButton();
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

  // Touch screens: keep the album that was in the middle in the middle (turning a phone
  // sideways and back changes the album size and how many are on screen)
  const touchScreen = window.matchMedia('(hover: none) and (pointer: coarse)');
  let middleItem = null;
  scroller.addEventListener('scroll', () => {
    if (touchScreen.matches) middleItem = centeredCover()?.closest('li') || middleItem;
  }, { passive: true });

  function layout() {
    measure();
    scroller.scrollLeft = home + place * period;
    if (touchScreen.matches && middleItem) {
      const box = scroller.getBoundingClientRect();
      const r = middleItem.getBoundingClientRect();
      scroller.scrollLeft += r.left + r.width / 2 - (box.left + box.width / 2);
    }
    pos = scroller.scrollLeft;
  }

  // Phone turned back upright from the albums-only view: play the album in the middle
  const sideways = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (hover: none) and (pointer: coarse)');
  sideways.addEventListener('change', () => {
    if (sideways.matches) return;
    setTimeout(switchOnSwipe, 350);   // after the layout has settled
  });

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
    // height of the capitals: phones make the header buttons exactly this tall (style.css, 5c)
    document.documentElement.style.setProperty('--name-cap-h', (m.actualBoundingBoxAscent / size).toFixed(4));
    // width of "ROMAN LAV" per 1px of font size: phones size the name to the album's width
    if (!temporary) {
      const link = name.querySelector('a') || name;
      const width = link.getBoundingClientRect().width;
      const linkSize = parseFloat(getComputedStyle(link).fontSize) || size;
      if (width) document.documentElement.style.setProperty('--name-ratio', (width / linkSize).toFixed(4));
    }
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
    document.dispatchEvent(new CustomEvent('menu:toggle', { detail: { open } }));
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
  const swap = window.matchMedia(SWAP);
  function fitWidth() {
    if (!header) return;

    // Phones and tablets: the menu rises from the bottom (style.css, 5d). It covers the
    // button row and the links plus the same inset as below, measured from the bottom edge.
    if (swap.matches) {
      const box = button.getBoundingClientRect();
      const center = box.top + box.height / 2;
      const lineTop = Math.min(box.top, center - (links ? links.offsetHeight / 2 : 0));
      const inset = Math.min(48, Math.max(16, window.innerWidth * 0.03));
      root.style.setProperty('--menu-h', `${Math.round(window.innerHeight - lineTop + inset)}px`);
      return;
    }

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
  const phone = window.matchMedia('(max-width: 600px)');

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
    // Everything around the text: buttons and footer pieces. Whatever sits in the top
    // half of the screen bounds the box from above, the rest from below (on phones and
    // tablets the buttons are at the bottom and the credits at the top, style.css 5d)
    const around = [menuButton, themeButton, ...footerParts].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, upper: r.top + r.height / 2 < window.innerHeight / 2 };
    });
    const topBound = Math.max(0, ...around.filter((r) => r.upper).map((r) => r.bottom));
    let footerTop = Math.min(...around.filter((r) => !r.upper).map((r) => r.top));
    // Phones: stop above the whole footer (its orange glow), not just above its contents,
    // so "waves of music." stays on the plain background
    const footer = document.querySelector('.footer');
    if (footer && (phone.matches || window.matchMedia(SWAP).matches)) {
      footerTop = Math.min(footerTop, footer.getBoundingClientRect().top + window.scrollY);
    }

    const inset = Math.min(48, Math.max(16, window.innerWidth * 0.03));
    // Phones (upright or sideways): the text runs the full width between the outer edges
    // of the two buttons
    const insetX = phone.matches || window.matchMedia(SWAP).matches ? 0 : inset;
    // The buttons swap sides on phones, so take whichever is further left / right
    const left = Math.min(menu.left, theme.left);
    const right = Math.max(menu.right, theme.right);
    const box = {
      x: left + insetX,
      y: topBound + inset,
      w: right - left - insetX * 2,
      h: footerTop - topBound - inset * 2,
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
   Another click or tap anywhere (photo or backdrop), Enter, Space or Esc closes it,
   and the focus goes back to the photo. Without the photo file it shows the silhouette.
   ========================================================================== */

(() => {
  const photo = document.querySelector('.contact-photo');
  const viewer = document.querySelector('.photo-viewer');
  if (!photo || !viewer || typeof viewer.showModal !== 'function') return;
  const body = viewer.querySelector('.photo-viewer-body');

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
    viewer.focus();
  }

  const isPress = (event) => event.key === 'Enter' || event.key === ' ';

  photo.addEventListener('click', open);
  photo.addEventListener('keydown', (event) => {
    if (!isPress(event)) return;
    event.preventDefault();   // Space would scroll the page
    event.stopPropagation();  // so the same key press doesn't reach the open dialog
    open();
  });

  viewer.addEventListener('click', () => viewer.close());
  viewer.addEventListener('keydown', (event) => {
    if (!isPress(event)) return;
    event.preventDefault();
    viewer.close();
  });
  viewer.addEventListener('close', () => {
    body.replaceChildren();
    photo.focus();
  });
})();


/* ==========================================================================
   Contacts, phone held sideways: the photo is exactly as tall as the text column
   next to it (top of the name's capitals to the baseline of the last line)
   ========================================================================== */

(() => {
  const photo = document.querySelector('.contact-photo');
  const info = document.querySelector('.contact-info');
  if (!photo || !info) return;
  const sideways = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');

  function size() {
    photo.style.height = sideways.matches ? `${Math.round(info.getBoundingClientRect().height)}px` : '';
  }

  size();
  sideways.addEventListener('change', size);
  window.addEventListener('resize', size);
  if (document.fonts) document.fonts.ready.then(size);
})();



/* ==========================================================================
   Vox: stickers you can peel off, stick somewhere else, and throw
   Drag with a mouse or a finger: the sticker follows, pushes the others out of the way
   and stays where it's dropped. Let go while moving and it slides on, slowing down,
   bouncing off the other stickers and the screen edges. Overlaps are sorted out on load
   and on resize. Positions are remembered in this browser (localStorage, as 0..1 of the
   free space, so they survive any screen size). Arrow keys nudge a focused sticker.
   ========================================================================== */

(() => {
  const area = document.querySelector('.stickers');
  if (!area) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const KEY = 'vox-stickers';
  const FRICTION = 0.92;   // speed kept per frame while sliding
  const BOUNCE = 0.55;     // speed kept after hitting something
  const INSET = 0.07;      // the cut-outs have transparent margins: collide a bit inside the box
  let zTop = 0;

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { saved = {}; }

  const items = Array.from(area.querySelectorAll('.sticker')).map((el) => {
    const spot = saved[el.dataset.id];
    const fx = Array.isArray(spot) ? spot[0] : parseFloat(el.style.getPropertyValue('--x')) || 0;
    const fy = Array.isArray(spot) ? spot[1] : parseFloat(el.style.getPropertyValue('--y')) || 0;
    el.style.zIndex = ++zTop;
    return { el, fx, fy, x: 0, y: 0, w: 0, h: 0, vx: 0, vy: 0, drag: false };
  });

  let W = 0;
  let H = 0;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // Sizes in pixels, positions from the stored fractions
  function measure() {
    const box = area.getBoundingClientRect();
    W = box.width;
    H = box.height;
    for (const it of items) {
      it.w = it.el.offsetWidth;
      it.h = it.el.offsetHeight;
      it.x = it.fx * Math.max(0, W - it.w);
      it.y = it.fy * Math.max(0, H - it.h);
    }
  }

  function render() {
    for (const it of items) {
      it.fx = W > it.w ? clamp01(it.x / (W - it.w)) : 0;
      it.fy = H > it.h ? clamp01(it.y / (H - it.h)) : 0;
      it.el.style.setProperty('--x', it.fx.toFixed(4));
      it.el.style.setProperty('--y', it.fy.toFixed(4));
    }
  }

  function save() {
    const spots = {};
    for (const it of items) spots[it.el.dataset.id] = [+it.fx.toFixed(4), +it.fy.toFixed(4)];
    try { localStorage.setItem(KEY, JSON.stringify(spots)); } catch { /* private mode: just don't remember */ }
  }

  // Equal masses; a sticker held in the hand counts as immovable (it pushes, it isn't pushed)
  function exchange(a, b, axis) {
    const va = a[axis];
    const vb = b[axis];
    if (a.drag) b[axis] = va + BOUNCE * (va - vb);
    else if (b.drag) a[axis] = vb + BOUNCE * (vb - va);
    else {
      const mid = (va + vb) / 2;
      a[axis] = mid - (BOUNCE * (va - vb)) / 2;
      b[axis] = mid + (BOUNCE * (va - vb)) / 2;
    }
  }

  function walls(it) {
    const maxX = Math.max(0, W - it.w);
    const maxY = Math.max(0, H - it.h);
    if (it.x < 0) { it.x = 0; if (it.vx < 0) it.vx = -it.vx * BOUNCE; }
    if (it.x > maxX) { it.x = maxX; if (it.vx > 0) it.vx = -it.vx * BOUNCE; }
    if (it.y < 0) { it.y = 0; if (it.vy < 0) it.vy = -it.vy * BOUNCE; }
    if (it.y > maxY) { it.y = maxY; if (it.vy > 0) it.vy = -it.vy * BOUNCE; }
  }

  // Push overlapping stickers apart along the shorter overlap, and bounce their speeds
  function collide(passes) {
    for (let pass = 0; pass < passes; pass++) {
      let touched = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const ax = a.w * INSET, ay = a.h * INSET, bx = b.w * INSET, by = b.h * INSET;
          const ox = Math.min(a.x + a.w - ax, b.x + b.w - bx) - Math.max(a.x + ax, b.x + bx);
          const oy = Math.min(a.y + a.h - ay, b.y + b.h - by) - Math.max(a.y + ay, b.y + by);
          if (ox <= 0 || oy <= 0) continue;
          touched = true;
          const shareA = a.drag ? 0 : b.drag ? 1 : 0.5;
          const shareB = 1 - shareA;
          if (ox < oy) {
            const dir = a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1;   // a is left of b: a goes left
            a.x += dir * ox * shareA;
            b.x -= dir * ox * shareB;
            if ((a.vx - b.vx) * dir < 0) exchange(a, b, 'vx');
          } else {
            const dir = a.y + a.h / 2 < b.y + b.h / 2 ? -1 : 1;
            a.y += dir * oy * shareA;
            b.y -= dir * oy * shareB;
            if ((a.vy - b.vy) * dir < 0) exchange(a, b, 'vy');
          }
        }
      }
      items.forEach(walls);
      if (!touched) break;
    }
  }

  const box = (it, x = it.x, y = it.y) => [x + it.w * INSET, y + it.h * INSET, x + it.w * (1 - INSET), y + it.h * (1 - INSET)];
  const overlap = (p, q) => Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0])) * Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));

  // Every sticker that lies on one placed before it moves to the nearest free spot
  // (a grid search around where it was). Used on load, on resize, and when a throw
  // comes to rest against the others: pushing in pairs alone can get stuck.
  function unstack() {
    const placed = [];
    const order = items.slice().sort((a, b) => (a.drag ? -1 : 0) - (b.drag ? -1 : 0));
    for (const it of order) {
      const hits = (x, y) => placed.reduce((sum, p) => sum + overlap(box(it, x, y), box(p)), 0);
      if (hits(it.x, it.y) > 0) {
        const maxX = Math.max(0, W - it.w);
        const maxY = Math.max(0, H - it.h);
        const stepPx = Math.max(8, Math.min(W, H) / 60);
        let best = null;
        for (let y = 0; y <= maxY + 0.5; y += stepPx) {
          for (let x = 0; x <= maxX + 0.5; x += stepPx) {
            const cx = Math.min(x, maxX);
            const cy = Math.min(y, maxY);
            const cost = hits(cx, cy) * 1e6 + (cx - it.x) ** 2 + (cy - it.y) ** 2;
            if (!best || cost < best.cost) best = { cost, cx, cy };
          }
        }
        if (best) { it.x = best.cx; it.y = best.cy; }
      }
      placed.push(it);
    }
  }

  // Sort out overlaps without animation (on load, on resize)
  function settle() {
    measure();
    unstack();
    render();
  }

  let frame = 0;
  let last = 0;
  function step(now) {
    const dt = Math.min(2, (now - last) / 16.67);
    last = now;
    let moving = false;
    for (const it of items) {
      if (it.drag) continue;
      if (Math.abs(it.vx) + Math.abs(it.vy) < 0.05) { it.vx = 0; it.vy = 0; continue; }
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      const keep = Math.pow(FRICTION, dt);
      it.vx *= keep;
      it.vy *= keep;
      moving = true;
    }
    collide(4);
    if (moving || items.some((it) => it.drag)) {
      render();
      frame = requestAnimationFrame(step);
    } else {
      unstack();   // came to rest pressed against the others: tidy up
      render();
      frame = 0;
      save();
    }
  }

  function wake() {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(step);
  }

  for (const it of items) {
    it.el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      it.el.setPointerCapture(event.pointerId);
      it.el.classList.add('is-dragging');
      it.el.style.zIndex = ++zTop;
      it.drag = true;
      it.vx = 0;
      it.vy = 0;

      const box = area.getBoundingClientRect();
      const offX = event.clientX - box.left - it.x;
      const offY = event.clientY - box.top - it.y;
      let lastT = performance.now();

      const move = (e) => {
        const now = performance.now();
        const frames = Math.max(0.5, (now - lastT) / 16.67);
        lastT = now;
        const nx = e.clientX - box.left - offX;
        const ny = e.clientY - box.top - offY;
        // speed in px per frame, smoothed, for the throw and for the hits
        it.vx = it.vx * 0.5 + ((nx - it.x) / frames) * 0.5;
        it.vy = it.vy * 0.5 + ((ny - it.y) / frames) * 0.5;
        it.x = nx;
        it.y = ny;
        wake();
      };
      const drop = () => {
        it.drag = false;
        it.el.classList.remove('is-dragging');
        // a pause before letting go means no throw; reduced motion: never
        if (reduceMotion.matches || performance.now() - lastT > 80) { it.vx = 0; it.vy = 0; }
        it.el.removeEventListener('pointermove', move);
        it.el.removeEventListener('pointerup', drop);
        it.el.removeEventListener('pointercancel', drop);
        wake();
      };
      it.el.addEventListener('pointermove', move);
      it.el.addEventListener('pointerup', drop);
      it.el.addEventListener('pointercancel', drop);
    });

    it.el.addEventListener('keydown', (event) => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!steps) return;
      event.preventDefault();
      it.el.style.zIndex = ++zTop;
      it.x += steps[0] * W * 0.02;
      it.y += steps[1] * H * 0.02;
      collide(20);
      render();
      save();
    });
  }

  settle();
  window.addEventListener('resize', settle);
  window.addEventListener('load', settle);   // image sizes are known for sure by now
  window.addEventListener('pagehide', () => { render(); save(); });
})();
