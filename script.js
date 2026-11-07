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
    root.classList.toggle('menu-open', open);
    menu.inert = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) menu.querySelector('a')?.focus({ preventScroll: true });
  }

  const isOpen = () => root.classList.contains('menu-open');

  // The glow ends just above "Collection of my favorite sounds" (inner pages: at the top of main)
  const heading = document.querySelector('.albums-heading') || document.querySelector('.main');
  function fitWidth() {
    if (!heading) return;
    root.style.setProperty('--menu-h', `${Math.round(heading.getBoundingClientRect().top + window.scrollY)}px`);
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
