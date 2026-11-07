'use strict';

/* ==========================================================================
   Visual layers (all optional, all off with "reduce motion"):
   1. Storm      – faint lightning strikes in the background (canvas)
   2. Glow       – soft orange light that follows the mouse
   3. Grain      – film grain over the whole page (pure CSS, see style.css)
   4. Scramble   – "ROMAN LAV" and "PROJECT .LAV" decode themselves on load and on hover
   5. Tilt       – album covers tilt in 3D under the mouse, with a glare
   ========================================================================== */

(() => {
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();


  /* ---- 1. Storm ----------------------------------------------------------
     Bolts are built with midpoint displacement: split a line in half, nudge
     the middle sideways, repeat. A few branches fork off the main bolt.
     The canvas only animates while a bolt is fading, so it costs nothing
     the rest of the time. Click on an empty spot to call a strike there. */

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-storm';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let width = 0;
  let height = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function jagged(x1, y1, x2, y2, roughness) {
    let points = [[x1, y1], [x2, y2]];
    let offset = roughness;
    for (let pass = 0; pass < 6; pass++) {
      const next = [points[0]];
      for (let i = 0; i < points.length - 1; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[i + 1];
        next.push(
          [(ax + bx) / 2 + (Math.random() * 2 - 1) * offset, (ay + by) / 2 + (Math.random() * 2 - 1) * offset * 0.2],
          [bx, by]
        );
      }
      points = next;
      offset /= 2;
    }
    return points;
  }

  function makeStrike(targetX, targetY) {
    const fromX = targetX ?? width * (0.1 + Math.random() * 0.8);
    const toY = targetY ?? height * (0.45 + Math.random() * 0.55);
    const toX = targetX !== undefined ? targetX : fromX + (Math.random() * 2 - 1) * width * 0.15;
    const startX = targetX !== undefined ? targetX + (Math.random() * 2 - 1) * width * 0.12 : fromX;

    const main = jagged(startX, -10, toX, toY, Math.max(width * 0.06, 40));
    const branches = [];
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const [px, py] = main[Math.floor(main.length * (0.2 + Math.random() * 0.6))];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const len = toY * (0.12 + Math.random() * 0.22);
      branches.push(jagged(px, py, px + dir * len * 0.6, py + len, len * 0.3));
    }

    return {
      main,
      branches,
      born: performance.now(),
      flicker: Math.random() < 0.6,
      rgb: cssVar('--storm-rgb') || '42, 42, 42',
      alpha: parseFloat(cssVar('--storm-alpha')) || 0.15,
    };
  }

  const LIFE = 1100;
  let strikes = [];
  let frame = 0;

  // Bright flash, a quick dip (flicker), then a slow fade
  function envelope(strike, age) {
    let a = Math.exp(-age / 280);
    if (strike.flicker && age > 70 && age < 140) a *= 0.3;
    return a;
  }

  function stroke(points, lineWidth) {
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    strikes = strikes.filter((s) => now - s.born < LIFE);

    for (const s of strikes) {
      const a = envelope(s, now - s.born) * s.alpha;
      const color = `rgba(${s.rgb}, ${a.toFixed(3)})`;

      // the whole sky lights up a little
      ctx.fillStyle = `rgba(${s.rgb}, ${(a * 0.12).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      stroke(s.main, 1.6);
      s.branches.forEach((b) => stroke(b, 0.8));
      ctx.shadowBlur = 0;
    }

    frame = strikes.length ? requestAnimationFrame(draw) : 0;
  }

  function strike(x, y) {
    if (reduce.matches) return;
    strikes.push(makeStrike(x, y));
    if (!frame) frame = requestAnimationFrame(draw);
  }

  // Random strikes every few seconds, only while the tab is visible
  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!document.hidden) strike();
      schedule();
    }, 3500 + Math.random() * 6000);
  }
  setTimeout(() => strike(), 1200);
  schedule();

  // Click on empty space: lightning hits right there
  document.addEventListener('click', (event) => {
    if (event.target.closest('a, button, input, .menu, .game, .album, .footer')) return;
    if (root.classList.contains('menu-open')) return;
    strike(event.clientX, event.clientY);
  });

  window.fxStrike = strike; // used by the console greeting below


  /* ---- 2. Mouse glow ---------------------------------------------------- */

  if (finePointer.matches) {
    const glow = document.createElement('div');
    glow.className = 'fx-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.prepend(glow);

    let tx = 0, ty = 0, x = 0, y = 0, raf = 0, placed = false;

    function step() {
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      glow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(step) : 0;
    }

    window.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || reduce.matches) return;
      tx = event.clientX;
      ty = event.clientY;
      if (!placed) { x = tx; y = ty; placed = true; }
      glow.classList.add('is-on');
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });

    document.documentElement.addEventListener('mouseleave', () => glow.classList.remove('is-on'));
  }


  /* ---- 4. Text scramble ------------------------------------------------
     Letters turn into random glyphs and settle back left to right.
     Used on "ROMAN LAV" (header) and "PROJECT .LAV" (footer):
     on page load, and again on mouse hover. */

  const GLYPHS = 'ABCDEFGHKLNOPRSTUVXYZ0123456789';   // no extra-wide letters (W, M…)
  const KEEP = new Set([' ', '.']);                    // these stay put

  function scrambler(el) {
    const finalText = el.textContent;
    el.setAttribute('aria-label', finalText);
    let running = 0;

    return function scramble(duration) {
      if (reduce.matches) return;
      cancelAnimationFrame(running);
      // freeze the width so random letters can't wrap the line or shift the page
      el.style.cssText = '';
      el.style.display = 'inline-block';
      el.style.width = `${el.getBoundingClientRect().width}px`;
      el.style.whiteSpace = 'nowrap';
      const start = performance.now();
      let lastSwap = 0;
      const tick = (now) => {
        const p = Math.min((now - start) / duration, 1);
        if (now - lastSwap > 45 || p === 1) {
          lastSwap = now;
          const resolved = Math.floor(p * (finalText.length + 3)) - 3; // letters settle left to right
          el.textContent = Array.from(finalText, (c, i) =>
            KEEP.has(c) || i < resolved ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          ).join('');
        }
        if (p < 1) running = requestAnimationFrame(tick);
        else { el.textContent = finalText; el.style.cssText = ''; }
      };
      running = requestAnimationFrame(tick);
    };
  }

  // Header and footer always scramble together: same start, same duration.
  // Hovering either one replays both.
  const scrambleTargets = ['.name a', '.footer-project']
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  const scramblers = scrambleTargets.map(scrambler);
  const scrambleAll = (duration) => scramblers.forEach((scramble) => scramble(duration));

  scrambleAll(1200);
  if (finePointer.matches) {
    scrambleTargets.forEach((el) => el.addEventListener('pointerenter', () => scrambleAll(600)));
  }


  /* ---- 5. Album tilt ---------------------------------------------------- */

  const scroller = document.querySelector('.albums');
  if (scroller && finePointer.matches) {
    let active = null;

    const reset = (cover) => {
      cover.classList.remove('is-tilted');
      ['--rx', '--ry', '--gx', '--gy'].forEach((p) => cover.style.removeProperty(p));
    };

    scroller.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || reduce.matches) return;
      const cover = event.target.closest('.album-cover');
      if (active && active !== cover) reset(active);
      active = cover;
      if (!cover) return;

      const box = cover.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width;
      const py = (event.clientY - box.top) / box.height;
      cover.style.setProperty('--rx', `${((0.5 - py) * 9).toFixed(2)}deg`);
      cover.style.setProperty('--ry', `${((px - 0.5) * 11).toFixed(2)}deg`);
      cover.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
      cover.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
      cover.classList.add('is-tilted');
    });

    scroller.addEventListener('pointerleave', () => {
      if (active) reset(active);
      active = null;
    });
  }


  /* ---- Hello, fellow developer ----------------------------------------- */

  console.log(
    '%cROMAN LAV%c\nHand-written HTML, CSS and vanilla JS. No frameworks, no build step.\n' +
    '→ press G anywhere (or tap "PROJECT .LAV" three times) to play STORM\n' +
    '→ fxStrike() calls a lightning strike',
    'font: 200 28px system-ui; letter-spacing: .08em; color: #ff7800;',
    'font: 12px ui-monospace, monospace; color: inherit;'
  );
})();
