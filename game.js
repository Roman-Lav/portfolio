'use strict';

/* ==========================================================================
   STORM – a tiny game hidden in the site.
   Open: press G, or tap "PROJECT .LAV" in the footer three times.
   Dodge the lightning (a dashed orange line warns where it will hit),
   catch the orange sparks for bonus points. It gets faster over time.
   Colors come from the current theme.
   ========================================================================== */

(() => {
  const root = document.documentElement;
  const BEST_KEY = 'storm-best';
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();

  let overlay, canvas, ctx, screenEl, scoreEl, bestEl, titleEl, textEl;
  let width = 0, height = 0;
  let raf = 0, lastTime = 0;
  let state = 'closed';            // closed | ready | playing | over
  let returnFocus = null;

  // game state
  let time, bonus, nextStrikeAt, nextSparkAt, shake;
  let player, target, strikes, sparks, particles;
  const keys = new Set();
  let colors = {};

  const readBest = () => { try { return parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* private mode */ } };


  /* ---- Overlay ---------------------------------------------------------- */

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'game';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Mini game: Storm');
    overlay.innerHTML = `
      <canvas class="game-canvas" aria-hidden="true"></canvas>
      <div class="game-hud" aria-live="off">
        <span class="game-score">0.0</span>
        <span class="game-best"></span>
      </div>
      <div class="game-screen">
        <p class="game-title">STORM</p>
        <p class="game-text">Dodge the lightning. Catch the sparks.</p>
        <p class="game-hint">mouse · finger · arrows &nbsp;/&nbsp; click, tap or space to start &nbsp;/&nbsp; esc to leave</p>
      </div>
      <button class="game-close" type="button" aria-label="Close game"><span></span><span></span></button>`;
    document.body.append(overlay);

    canvas = overlay.querySelector('canvas');
    ctx = canvas.getContext('2d');
    screenEl = overlay.querySelector('.game-screen');
    scoreEl = overlay.querySelector('.game-score');
    bestEl = overlay.querySelector('.game-best');
    titleEl = overlay.querySelector('.game-title');
    textEl = overlay.querySelector('.game-text');

    overlay.querySelector('.game-close').addEventListener('click', close);

    overlay.addEventListener('pointermove', (e) => { target = { x: e.clientX, y: e.clientY }; });
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.game-close')) return;
      target = { x: e.clientX, y: e.clientY };
      if (state !== 'playing') start();
    });

    window.addEventListener('resize', () => { if (state !== 'closed') resize(); });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function open() {
    if (state !== 'closed') return;
    if (!overlay) build();
    returnFocus = document.activeElement;
    if (root.classList.contains('menu-open')) document.querySelector('.menu-toggle')?.click();
    root.classList.add('game-open');
    overlay.classList.add('is-open');
    resize();
    reset();
    showScreen('STORM', 'Dodge the lightning. Catch the sparks.');
    state = 'ready';
    overlay.querySelector('.game-close').focus({ preventScroll: true });
    loop();
  }

  function close() {
    if (state === 'closed') return;
    state = 'closed';
    cancelAnimationFrame(raf);
    raf = 0;
    overlay.classList.remove('is-open');
    root.classList.remove('game-open');
    keys.clear();
    returnFocus?.focus?.({ preventScroll: true });
  }

  function showScreen(title, text) {
    titleEl.textContent = title;
    textEl.textContent = text;
    const best = readBest();
    bestEl.textContent = best ? `best ${best.toFixed(1)}` : '';
    screenEl.hidden = false;
  }


  /* ---- Game ------------------------------------------------------------- */

  function reset() {
    colors = {
      ink: cssVar('--ink') || '#2a2a2a',
      bg: cssVar('--bg') || '#f7f4ef',
      glow: cssVar('--glow-rgb') || '255, 120, 0',
    };
    time = 0;
    bonus = 0;
    shake = 0;
    nextStrikeAt = 0.9;
    nextSparkAt = 1.5;
    player = { x: width / 2, y: height * 0.7, r: 9 };
    target = target || { x: player.x, y: player.y };
    strikes = [];
    sparks = [];
    particles = [];
    scoreEl.textContent = '0.0';
  }

  function start() {
    reset();
    target = { x: player.x, y: player.y };
    screenEl.hidden = true;
    state = 'playing';
  }

  function gameOver() {
    state = 'over';
    shake = 14;
    burst(player.x, player.y, colors.ink, 40);
    const score = time + bonus;
    const best = readBest();
    if (score > best) saveBest(score);
    showScreen(score > best ? 'NEW BEST' : 'STRUCK', `${score.toFixed(1)} points. Click, tap or space to try again.`);
  }

  // A bolt from the top of the screen down to the bottom, near x
  function boltPath(x) {
    let pts = [[x, -20], [x + (Math.random() * 2 - 1) * 30, height + 20]];
    let off = 40;
    for (let pass = 0; pass < 6; pass++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        next.push([(ax + bx) / 2 + (Math.random() * 2 - 1) * off, (ay + by) / 2], [bx, by]);
      }
      pts = next;
      off /= 2;
    }
    return pts;
  }

  // x of the bolt at height y (points go strictly downwards)
  function boltXAt(path, y) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      if (y >= ay && y <= by) return ax + (bx - ax) * ((y - ay) / (by - ay || 1));
    }
    return path[path.length - 1][0];
  }

  function spawnStrike() {
    const level = Math.min(time / 45, 1);                 // 0 → 1 over 45 seconds
    const warn = 0.85 - level * 0.45;                     // warning time, seconds
    const aim = Math.random() < 0.45 ? player.x : Math.random() * width; // some strikes hunt you
    const x = Math.max(20, Math.min(width - 20, aim + (Math.random() * 2 - 1) * 60));
    strikes.push({ x, path: boltPath(x), hitAt: time + warn, warnFrom: time, done: false });
    nextStrikeAt = time + Math.max(0.28, 1.15 - level * 0.85) * (0.7 + Math.random() * 0.6);
  }

  function spawnSpark() {
    sparks.push({
      x: 40 + Math.random() * (width - 80),
      y: 80 + Math.random() * (height - 160),
      born: time,
      life: 5,
    });
    nextSparkAt = time + 1.6 + Math.random() * 2.2;
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 260;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.6, age: 0, color });
    }
  }

  function update(dt) {
    // particles keep moving on every screen
    particles.forEach((p) => { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 240 * dt; });
    particles = particles.filter((p) => p.age < p.life);
    shake = Math.max(0, shake - dt * 40);

    if (state !== 'playing') return;
    time += dt;

    // movement: keyboard wins over the pointer
    const speed = 460;
    let kx = 0, ky = 0;
    if (keys.has('ArrowLeft') || keys.has('a')) kx -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) kx += 1;
    if (keys.has('ArrowUp') || keys.has('w')) ky -= 1;
    if (keys.has('ArrowDown') || keys.has('s')) ky += 1;
    if (kx || ky) {
      const len = Math.hypot(kx, ky);
      player.x += (kx / len) * speed * dt;
      player.y += (ky / len) * speed * dt;
      target = { x: player.x, y: player.y };
    } else {
      const k = 1 - Math.exp(-dt * 14);
      player.x += (target.x - player.x) * k;
      player.y += (target.y - player.y) * k;
    }
    player.x = Math.max(player.r, Math.min(width - player.r, player.x));
    player.y = Math.max(player.r, Math.min(height - player.r, player.y));

    if (time >= nextStrikeAt) spawnStrike();
    if (time >= nextSparkAt) spawnSpark();

    for (const s of strikes) {
      if (!s.done && time >= s.hitAt) {
        s.done = true;
        shake = Math.max(shake, 5);
        if (Math.abs(boltXAt(s.path, player.y) - player.x) < player.r + 7) {
          gameOver();
          return;
        }
      }
    }
    strikes = strikes.filter((s) => time - s.hitAt < 0.35);

    sparks = sparks.filter((sp) => {
      if (Math.hypot(sp.x - player.x, sp.y - player.y) < player.r + 12) {
        bonus += 3;
        burst(sp.x, sp.y, `rgb(${colors.glow})`, 18);
        return false;
      }
      return time - sp.born < sp.life;
    });

    scoreEl.textContent = (time + bonus).toFixed(1);
  }

  function render() {
    const { ink, glow } = colors;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (shake) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);

    // faint dot grid
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.07;
    for (let x = 24; x < width; x += 32) for (let y = 24; y < height; y += 32) ctx.fillRect(x, y, 1.5, 1.5);
    ctx.globalAlpha = 1;

    // strikes: dashed warning, then the bolt
    for (const s of strikes) {
      if (time < s.hitAt) {
        const p = (time - s.warnFrom) / (s.hitAt - s.warnFrom);
        ctx.strokeStyle = `rgba(${glow}, ${0.2 + p * 0.6})`;
        ctx.lineWidth = 1 + p * 2;
        ctx.setLineDash([6, 10]);
        ctx.lineDashOffset = -time * 80;
        ctx.beginPath();
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, height);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const a = 1 - (time - s.hitAt) / 0.35;
        ctx.fillStyle = ink;
        ctx.globalAlpha = a * 0.08;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = a;
        ctx.strokeStyle = ink;
        ctx.shadowColor = `rgb(${glow})`;
        ctx.shadowBlur = 16;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        s.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }

    // sparks
    for (const sp of sparks) {
      const left = sp.life - (time - sp.born);
      const blink = left < 1.2 ? (Math.sin(time * 20) > 0 ? 1 : 0.3) : 1;
      const pulse = 1 + Math.sin((time - sp.born) * 6) * 0.15;
      ctx.globalAlpha = blink;
      ctx.fillStyle = `rgba(${glow}, .25)`;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 14 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${glow})`;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 5 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // particles
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // player: an orange orb, like the theme button
    if (state !== 'over') {
      const g = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, player.r * 3);
      g.addColorStop(0, `rgba(${glow}, .55)`);
      g.addColorStop(1, `rgba(${glow}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(player.x, player.y, player.r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  function loop() {
    lastTime = performance.now();
    const frame = (now) => {
      if (state === 'closed') return;
      const dt = Math.min((now - lastTime) / 1000, 0.05); // a hidden tab simply pauses the game
      lastTime = now;
      update(dt);
      render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }


  /* ---- Ways in ---------------------------------------------------------- */

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, [contenteditable="true"]');

    if (state === 'closed') {
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'g') open();
      return;
    }

    if (e.key === 'Escape') { close(); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.target.closest?.('.game-close')) return;
      e.preventDefault();
      if (state !== 'playing') start();
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault();
      keys.add(k);
    }
  });

  document.addEventListener('keyup', (e) => {
    keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  });

  // Three quick taps on "PROJECT .LAV"
  const project = document.querySelector('.footer-project');
  if (project) {
    let taps = 0, tapTimer = 0;
    project.addEventListener('click', () => {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { taps = 0; }, 700);
      if (taps >= 3) { taps = 0; open(); }
    });
  }

  window.storm = open;
})();
