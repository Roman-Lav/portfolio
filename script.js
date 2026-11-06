// Endless carousel: the album list is repeated 5 times and the scroll position is
// moved by exactly one list width, so the jump is invisible.
(() => {
  const scroller = document.querySelector('.albums');
  const edgeLeft = document.querySelector('.edge-left');
  const edgeRight = document.querySelector('.edge-right');
  const heading = document.querySelector('.main h2');
  if (!scroller || !scroller.children.length) return;

  const SETS_EACH_SIDE = 3;
  const SPEED = 520;      // px per second while hovering an edge
  const EASE = 0.14;      // seconds to reach full speed or stop
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const originals = Array.from(scroller.children);
  const count = originals.length;

  const makeSet = () => {
    const fragment = document.createDocumentFragment();
    originals.forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('a').forEach((a) => a.setAttribute('tabindex', '-1'));
      fragment.append(clone);
    });
    return fragment;
  };
  for (let i = 0; i < SETS_EACH_SIDE; i++) {
    scroller.insertBefore(makeSet(), scroller.firstChild);
    scroller.append(makeSet());
  }

  let period = 0;   // width of one full album list, with gaps
  let home = 0;     // scroll position where the first real album lines up with the heading
  let progress = 0; // position inside the list, kept across resizes
  let lastWidth = 0;

  function measure() {
    const first = scroller.children[count * SETS_EACH_SIDE].getBoundingClientRect();
    const next = scroller.children[count * (SETS_EACH_SIDE + 1)].getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const gutter = heading ? heading.getBoundingClientRect().left - box.left : 0;
    period = Math.round(next.left - first.left);
    home = first.left - box.left + scroller.scrollLeft - gutter;
  }

  // Move the scroll position back into the middle list. Returns how far it moved.
  function normalize() {
    const current = scroller.scrollLeft;
    let offset = (current - home) % period;
    if (offset >= period / 2) offset -= period;
    else if (offset < -period / 2) offset += period;
    const target = home + offset;
    if (Math.abs(target - current) < 0.5) return 0;
    scroller.scrollLeft = target;
    return target - current;
  }

  // 60 second previews: one shared audio element, works for the cloned albums too
  const audio = new Audio();
  audio.preload = 'none';
  let current = null;
  let progressRaf = null;

  const coversOf = (key) => scroller.querySelectorAll(`.album-cover[data-track="${key}"]`);
  const paint = (key, props) => coversOf(key).forEach((c) => {
    if ('p' in props) c.style.setProperty('--p', props.p);
    if ('playing' in props) c.classList.toggle('is-playing', props.playing);
    if ('active' in props) c.classList.toggle('is-active', props.active);
  });
  const updateProgress = () => {
    if (current && audio.duration) paint(current, { p: audio.currentTime / audio.duration });
    progressRaf = audio.paused ? null : requestAnimationFrame(updateProgress);
  };
  const stopPreview = (reset) => {
    audio.pause();
    if (current) paint(current, reset ? { playing: false, active: false, p: 0 } : { playing: false });
  };

  scroller.addEventListener('click', (e) => {
    const cover = e.target.closest('.album-cover');
    if (!cover) return;
    const key = cover.dataset.track;
    if (current === key) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }
    stopPreview(true);
    current = key;
    audio.src = cover.dataset.src;
    paint(key, { p: 0, active: true });
    audio.play().catch(() => stopPreview(true));
  });
  audio.addEventListener('play', () => {
    paint(current, { playing: true, active: true });
    if (!progressRaf) progressRaf = requestAnimationFrame(updateProgress);
  });
  audio.addEventListener('pause', () => { if (current) paint(current, { playing: false }); });
  audio.addEventListener('ended', () => { if (current) { paint(current, { playing: false, active: false, p: 0 }); current = null; } });

  // Edge hover scrolling, with ease-in and ease-out
  let targetSpeed = 0;
  let speed = 0;
  let pos = 0;
  let last = 0;
  let raf = null;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    speed += (targetSpeed - speed) * (1 - Math.exp(-dt / EASE));

    if (targetSpeed === 0 && Math.abs(speed) < 2) {
      speed = 0;
      raf = null;
      settle();
      return;
    }
    if (Math.abs(scroller.scrollLeft - pos) > 2) pos = scroller.scrollLeft;
    pos += speed * dt;
    scroller.scrollLeft = pos;
    pos += normalize();
    raf = requestAnimationFrame(tick);
  }

  function setTarget(direction) {
    targetSpeed = direction * SPEED;
    if (raf === null && direction !== 0) {
      pos = scroller.scrollLeft;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }

  // Swipe, trackpad and keyboard scrolling are native. Re-center only when they are done.
  let touching = false;
  let idleTimer = null;

  function settle() {
    if (touching || raf !== null) return;
    normalize();
  }

  function onScroll() {
    let p = (scroller.scrollLeft - home) / period;
    progress = p - Math.round(p);

    // Safety net for a very long fling: re-center before reaching the real end
    const max = scroller.scrollWidth - scroller.clientWidth;
    if (raf === null && !touching &&
        (scroller.scrollLeft < period * 0.5 || scroller.scrollLeft > max - period * 0.5)) {
      normalize();
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(settle, 120);
  }

  scroller.addEventListener('scroll', onScroll, { passive: true });
  scroller.addEventListener('touchstart', () => { touching = true; }, { passive: true });
  ['touchend', 'touchcancel'].forEach((name) =>
    scroller.addEventListener(name, () => {
      touching = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(settle, 120);
    }, { passive: true })
  );

  [edgeLeft, edgeRight].forEach((edge) => {
    if (!edge) return;
    const dir = edge.dataset.direction === 'left' ? -1 : 1;
    edge.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !reduceMotion.matches) setTarget(dir);
    });
    edge.addEventListener('pointerleave', () => setTarget(0));
    edge.addEventListener('click', () => {
      setTarget(0);
      scroller.scrollBy({ left: dir * (period / count), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
  });

  window.addEventListener('blur', () => setTarget(0));
  document.addEventListener('visibilitychange', () => setTarget(0));

  // Start position, and keep the same place when the window is resized
  measure();
  scroller.scrollLeft = home;
  lastWidth = scroller.clientWidth;

  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (scroller.clientWidth === lastWidth) return;
      lastWidth = scroller.clientWidth;
      measure();
      scroller.scrollLeft = home + progress * period;
    }).observe(scroller);
  }
})();
