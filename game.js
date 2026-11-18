(() => {
  'use strict';

  /* =========================================================
     Utilities
     ========================================================= */
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  const rotateTowards = (a, b, step) => a + clamp(angleDiff(a, b), -step, step);

  /* =========================================================
     Configuration
     ========================================================= */
  const CONFIG = {
    playerHp: 3,
    enemyHp: 3,
    bossHp: 50,
    killsPerBoss: 8,      // a boss appears after this many sinkings
    scrollSpeed: 38,      // ocean drift (px/s)
    maxParticles: 1500,
    player: { speed: 270, accel: 5, fireCooldown: 0.45, bulletSpeed: 760, invuln: 1.6 },
    powerups: {
      dropChance: 0.22,     // chance a sunk frigate drops a weapon crate
      bossDropChance: 1,    // the Dreadnought always drops one
      duration: 5,          // seconds a special weapon stays active
      pickupLife: 9,        // seconds a crate floats before sinking
      maxOnField: 3,
    },
    homing: {
      baseChance: 0.12,     // chance a frigate shot is a homing torpedo
      perWave: 0.02,        // added per wave...
      maxChance: 0.25,      // ...up to this cap
      trackTime: 10,        // seconds a torpedo steers toward the player
      speed: 170, turnRate: 1.7, maxLife: 18, maxActive: 4,
    },
  };

  // Special weapons granted by crates
  const WEAPONS = {
    spread:  { name: 'Tempest Spread', color: '#ffc94a', rgb: '255, 201, 74', hue: 44, cooldown: 0.3, pellets: 5, fan: 0.16, speed: 720, life: 0.75 },
    lance:   { name: 'Arc Lance', color: '#c77dff', rgb: '199, 125, 255', hue: 276, tick: 0.2 },
    missile: { name: 'Hunter Missiles', color: '#9dff4a', rgb: '157, 255, 74', hue: 95, cooldown: 0.55, damage: 2, blast: 55 },
  };
  const WEAPON_KEYS = Object.keys(WEAPONS);
  const BEST_KEY = 'ironclad-tide-best';

  const PALETTES = {
    player: {
      hull: '#56809e', hullLight: '#a3c8e0', hullDark: '#223749', edge: '#0b1823',
      deck: '#c8ad7f', deckLine: 'rgba(90, 60, 30, 0.35)',
      bridge: '#e3edf4', bridgeShade: '#8aa3b5',
      turret: '#47657c', turretTop: '#86abc6', barrel: '#1f2c37', accent: '#3ef2ff',
    },
    enemy: {
      hull: '#9a3340', hullLight: '#d9666f', hullDark: '#4a121b', edge: '#1d0609',
      deck: '#4d3f37', deckLine: 'rgba(0, 0, 0, 0.25)',
      bridge: '#eadacb', bridgeShade: '#9b7f70',
      turret: '#6b2630', turretTop: '#ad4652', barrel: '#2a0d12', accent: '#ffb347',
    },
    boss: {
      hull: '#363d4c', hullLight: '#636e84', hullDark: '#10131a', edge: '#05070a',
      deck: '#262b36', deckLine: 'rgba(255, 60, 90, 0.10)',
      bridge: '#4d566a', bridgeShade: '#20252f',
      turret: '#2a303c', turretTop: '#55617a', barrel: '#0b0d12', accent: '#ff3b5c',
    },
  };

  const SHIPS = {
    player: {
      len: 66, wid: 22,
      bridge: { x: -4, w: 15, h: 12 }, funnels: [-15],
      turrets: [{ off: 17, size: 6.5 }, { off: -25, size: 6 }],
      hit: { offs: [-18, 0, 18], r: 11 },
    },
    enemy: {
      len: 56, wid: 19,
      bridge: { x: -8, w: 13, h: 10 }, funnels: [-19],
      turrets: [{ off: 13, size: 5.5 }],
      hit: { offs: [-14, 0, 14], r: 11 },
    },
    boss: {
      len: 172, wid: 50,
      bridge: { x: -8, w: 34, h: 24 }, funnels: [-36],
      turrets: [{ off: 62, size: 10 }, { off: 33, size: 9 }, { off: -62, size: 10 }],
      hit: { offs: [-62, -31, 0, 31, 62], r: 24 },
    },
  };

  /* =========================================================
     Canvas / resize
     ========================================================= */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, oceanGrad = null;
  let G = null;            // current game world
  let state = 'menu';      // menu | playing | paused | dying | over
  let oceanT = 0;
  let shake = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    oceanGrad = ctx.createLinearGradient(0, 0, 0, H);
    oceanGrad.addColorStop(0, '#0a3150');
    oceanGrad.addColorStop(0.5, '#0c4a6b');
    oceanGrad.addColorStop(1, '#072b44');
    if (G) {
      G.player.x = clamp(G.player.x, 36, W - 36);
      G.player.y = clamp(G.player.y, H * 0.42, H - 44);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  /* =========================================================
     Ocean textures
     ========================================================= */
  function makeWaveTile(size, count, alpha, width, minLen, maxLen) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.strokeStyle = `rgba(190, 235, 255, ${alpha})`;
    g.lineWidth = width;
    g.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const len = rand(minLen, maxLen), h = len * rand(0.12, 0.22);
      for (let ox = -size; ox <= size; ox += size) {
        for (let oy = -size; oy <= size; oy += size) {
          g.beginPath();
          g.moveTo(x + ox, y + oy);
          g.quadraticCurveTo(x + ox + len / 2, y + oy - h, x + ox + len, y + oy);
          g.stroke();
        }
      }
    }
    return c;
  }
  function makeSparkleTile(size, count) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = rand(0.6, 1.6);
      g.fillStyle = `rgba(220, 245, 255, ${rand(0.08, 0.3)})`;
      for (let ox = -size; ox <= size; ox += size) {
        for (let oy = -size; oy <= size; oy += size) {
          g.beginPath(); g.arc(x + ox, y + oy, r, 0, TAU); g.fill();
        }
      }
    }
    return c;
  }
  const oceanLayers = [
    { tile: makeWaveTile(512, 26, 0.05, 3, 40, 90), speed: 0.55, sway: 14 },
    { tile: makeWaveTile(320, 64, 0.11, 1.4, 12, 34), speed: 1, sway: 6 },
    { tile: makeSparkleTile(256, 44), speed: 1, sway: 0, twinkle: true },
  ].map(l => ({ ...l, pattern: ctx.createPattern(l.tile, 'repeat'), size: l.tile.width }));

  function drawOcean() {
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(-30, -30, W + 60, H + 60);
    for (const l of oceanLayers) {
      const off = (oceanT * CONFIG.scrollSpeed * l.speed) % l.size;
      const sx = Math.sin(oceanT * 0.35 + l.size) * l.sway;
      ctx.save();
      if (l.twinkle) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(oceanT * 2.2);
      ctx.translate(sx, off);
      ctx.fillStyle = l.pattern;
      ctx.fillRect(-30 - sx, -off - 30, W + 60, H + 60);
      ctx.restore();
    }
  }

  /* =========================================================
     Ship drawing
     ========================================================= */
  function hullPath(g, L, Wd) {
    const h = L / 2, w = Wd / 2;
    g.beginPath();
    g.moveTo(h, 0);
    g.quadraticCurveTo(h * 0.62, -w * 1.06, h * 0.1, -w);
    g.lineTo(-h * 0.85, -w * 0.92);
    g.quadraticCurveTo(-h, -w * 0.86, -h, 0);
    g.quadraticCurveTo(-h, w * 0.86, -h * 0.85, w * 0.92);
    g.lineTo(h * 0.1, w);
    g.quadraticCurveTo(h * 0.62, w * 1.06, h, 0);
    g.closePath();
  }
  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function makeShip(kind, x, y, angle) {
    const tpl = SHIPS[kind];
    return {
      kind, x, y, vx: 0, vy: 0, angle,
      len: tpl.len, wid: tpl.wid, tpl, pal: PALETTES[kind],
      turrets: tpl.turrets.map(t => ({ off: t.off, size: t.size, angle, recoil: 0 })),
      flash: 0, wakeTimer: 0, dead: false,
    };
  }

  function drawShip(g, s, t = 0) {
    const { len: L, wid: Wd, pal, tpl } = s;

    // Shadow
    g.save();
    g.translate(s.x + 5, s.y + 8);
    g.rotate(s.angle);
    hullPath(g, L * 1.02, Wd * 1.12);
    g.fillStyle = 'rgba(0, 8, 20, 0.35)';
    g.fill();
    g.restore();

    g.save();
    g.translate(s.x, s.y);
    g.rotate(s.angle);

    // Hull
    hullPath(g, L, Wd);
    const hg = g.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
    hg.addColorStop(0, pal.hullLight);
    hg.addColorStop(0.45, pal.hull);
    hg.addColorStop(1, pal.hullDark);
    g.fillStyle = hg;
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = pal.edge;
    g.stroke();

    // Deck with planking
    g.save();
    g.scale(0.84, 0.66);
    hullPath(g, L, Wd);
    g.fillStyle = pal.deck;
    g.fill();
    g.clip();
    g.strokeStyle = pal.deckLine;
    g.lineWidth = 1;
    for (let y = -Wd / 2; y < Wd / 2; y += 3.4) {
      g.beginPath(); g.moveTo(-L / 2, y); g.lineTo(L / 2, y); g.stroke();
    }
    g.restore();

    // Bow chevron
    g.save();
    if (s.kind === 'boss') { g.shadowColor = pal.accent; g.shadowBlur = 10; }
    g.strokeStyle = pal.accent;
    g.lineWidth = s.kind === 'boss' ? 2.5 : 1.6;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(L * 0.33, -Wd * 0.2);
    g.lineTo(L * 0.41, 0);
    g.lineTo(L * 0.33, Wd * 0.2);
    g.stroke();
    g.restore();

    // Boss armour lines + running lights
    if (s.kind === 'boss') {
      g.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      g.lineWidth = 1;
      for (const lx of [-50, -22, 20, 48]) {
        g.beginPath(); g.moveTo(lx, -Wd * 0.32); g.lineTo(lx, Wd * 0.32); g.stroke();
      }
      const pulse = 0.55 + 0.45 * Math.sin(t * 5);
      g.fillStyle = `rgba(255, 59, 92, ${pulse})`;
      for (const lx of [-76, -46, 48, 74]) {
        for (const ly of [-1, 1]) {
          g.beginPath(); g.arc(lx, ly * Wd * 0.38, 1.9, 0, TAU); g.fill();
        }
      }
    }

    // Bridge / superstructure
    const b = tpl.bridge;
    g.fillStyle = pal.bridgeShade;
    roundRectPath(g, b.x - b.w / 2 + 1.5, -b.h / 2 + 1.5, b.w, b.h, 3);
    g.fill();
    g.fillStyle = pal.bridge;
    roundRectPath(g, b.x - b.w / 2, -b.h / 2, b.w, b.h, 3);
    g.fill();
    g.fillStyle = pal.accent;
    g.globalAlpha = 0.9;
    g.fillRect(b.x + b.w / 2 - 3, -b.h / 2 + 2, 1.7, b.h - 4);
    g.globalAlpha = 1;
    g.fillStyle = pal.bridgeShade;
    g.beginPath(); g.arc(b.x - 1, 0, Math.max(2, b.h * 0.18), 0, TAU); g.fill();

    // Funnels
    for (const f of tpl.funnels) {
      const r = Wd * 0.17;
      g.fillStyle = pal.hullDark;
      g.beginPath(); g.ellipse(f, 0, r * 1.3, r, 0, 0, TAU); g.fill();
      g.fillStyle = '#05080c';
      g.beginPath(); g.ellipse(f, 0, r * 0.8, r * 0.55, 0, 0, TAU); g.fill();
    }

    // Turrets
    for (const tu of s.turrets) {
      g.save();
      g.translate(tu.off, 0);
      g.rotate(tu.angle - s.angle);
      const r = tu.size;
      const bl = r * 2.3 - tu.recoil * r * 0.6;
      const th = Math.max(2, r * 0.3);
      g.fillStyle = pal.barrel;
      g.fillRect(0, -r * 0.42 - th / 2, bl, th);
      g.fillRect(0, r * 0.42 - th / 2, bl, th);
      g.beginPath(); g.arc(0, 0, r, 0, TAU);
      g.fillStyle = pal.turret; g.fill();
      g.strokeStyle = pal.edge; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.arc(-r * 0.15, 0, r * 0.55, 0, TAU);
      g.fillStyle = pal.turretTop; g.fill();
      g.restore();
    }

    // Damage flash
    if (s.flash > 0) {
      hullPath(g, L, Wd);
      g.fillStyle = `rgba(255, 255, 255, ${Math.min(0.85, s.flash * 7)})`;
      g.fill();
    }
    g.restore();
  }

  /* =========================================================
     Crates, weapon glyphs, torpedoes (shared by game + legend)
     ========================================================= */
  function drawWeaponGlyph(g, type, s, color) {
    g.save();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(1.5, s * 0.17);
    g.shadowColor = color;
    g.shadowBlur = s * 0.6;
    if (type === 'spread') {
      for (const [ex, ey] of [[-0.62, -0.5], [0, -0.68], [0.62, -0.5]]) {
        g.beginPath(); g.moveTo(0, s * 0.6); g.lineTo(ex * s, ey * s); g.stroke();
        g.beginPath(); g.arc(ex * s, ey * s, s * 0.14, 0, TAU); g.fill();
      }
    } else if (type === 'lance') {
      g.beginPath();
      g.moveTo(s * 0.18, -s * 0.78);
      g.lineTo(-s * 0.38, s * 0.1);
      g.lineTo(-s * 0.02, s * 0.1);
      g.lineTo(-s * 0.18, s * 0.78);
      g.lineTo(s * 0.38, -s * 0.1);
      g.lineTo(s * 0.02, -s * 0.1);
      g.closePath();
      g.fill();
    } else {
      g.rotate(-Math.PI / 4);
      roundRectPath(g, -s * 0.55, -s * 0.2, s * 0.95, s * 0.4, s * 0.12);
      g.fill();
      g.beginPath(); g.moveTo(s * 0.38, -s * 0.2); g.quadraticCurveTo(s * 0.8, 0, s * 0.38, s * 0.2); g.fill();
      g.beginPath();
      g.moveTo(-s * 0.55, -s * 0.2); g.lineTo(-s * 0.78, -s * 0.48); g.lineTo(-s * 0.3, -s * 0.2);
      g.moveTo(-s * 0.55, s * 0.2); g.lineTo(-s * 0.78, s * 0.48); g.lineTo(-s * 0.3, s * 0.2);
      g.fill();
    }
    g.restore();
  }

  function drawCrate(g, x, y, type, t, alpha = 1, s = 13) {
    const w = WEAPONS[type];
    g.save();
    g.translate(x, y + Math.sin(t * 3) * 2.5);
    g.globalAlpha = alpha;
    // glow
    const glow = g.createRadialGradient(0, 0, 2, 0, 0, s * 3);
    glow.addColorStop(0, `rgba(${w.rgb}, 0.45)`);
    glow.addColorStop(1, `rgba(${w.rgb}, 0)`);
    g.fillStyle = glow;
    g.beginPath(); g.arc(0, 0, s * 3, 0, TAU); g.fill();
    // ripple
    const rp = (t * 0.8) % 1;
    g.strokeStyle = `rgba(${w.rgb}, ${0.55 * (1 - rp)})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, s * (1.3 + rp * 1.5), 0, TAU); g.stroke();
    // crate body
    g.rotate(Math.sin(t * 1.6) * 0.18);
    roundRectPath(g, -s, -s, s * 2, s * 2, s * 0.38);
    const body = g.createLinearGradient(0, -s, 0, s);
    body.addColorStop(0, '#173650');
    body.addColorStop(1, '#07141f');
    g.fillStyle = body;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = w.color;
    g.stroke();
    roundRectPath(g, -s * 0.78, -s * 0.78, s * 1.56, s * 1.56, s * 0.26);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    g.stroke();
    drawWeaponGlyph(g, type, s * 0.66, w.color);
    g.restore();
  }

  function drawTorpedoBody(g, x, y, a, t, tracking) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    // fins
    g.fillStyle = '#161c24';
    g.beginPath();
    g.moveTo(-10, -3); g.lineTo(-14, -6.5); g.lineTo(-7, -3);
    g.moveTo(-10, 3); g.lineTo(-14, 6.5); g.lineTo(-7, 3);
    g.fill();
    // body
    roundRectPath(g, -12, -3.2, 20, 6.4, 3);
    const bg = g.createLinearGradient(0, -3.2, 0, 3.2);
    bg.addColorStop(0, '#5d6b7c');
    bg.addColorStop(1, '#1c232d');
    g.fillStyle = bg;
    g.fill();
    // warhead
    g.fillStyle = '#d23a52';
    g.beginPath(); g.moveTo(7, -3.2); g.quadraticCurveTo(14, 0, 7, 3.2); g.closePath(); g.fill();
    // blinking seeker light
    if (tracking && Math.sin(t * 18) > 0) {
      const lg = g.createRadialGradient(3, 0, 0, 3, 0, 9);
      lg.addColorStop(0, 'rgba(255, 80, 100, 0.9)');
      lg.addColorStop(1, 'rgba(255, 80, 100, 0)');
      g.fillStyle = lg;
      g.beginPath(); g.arc(3, 0, 9, 0, TAU); g.fill();
      g.fillStyle = '#ffe3e8';
      g.beginPath(); g.arc(3, 0, 1.6, 0, TAU); g.fill();
    }
    g.restore();
  }

  /* =========================================================
     DOM / UI
     ========================================================= */
  const $ = id => document.getElementById(id);
  const ui = {
    hud: $('hud'), hearts: $('hearts'), score: $('score'), wave: $('wave'),
    progressWrap: $('progress-wrap'), progressFill: $('progress-fill'), progressText: $('progress-text'),
    bossWrap: $('boss-wrap'), bossSegs: $('boss-segments'), bossHpText: $('boss-hp-text'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    start: $('start-screen'), pause: $('pause-screen'), over: $('gameover-screen'),
    damage: $('damage-flash'), menuBest: $('menu-best'),
    finalScore: $('final-score'), finalBest: $('final-best'), finalKills: $('final-kills'),
    finalBosses: $('final-bosses'), newBest: $('new-best'),
    weaponChip: $('weapon-chip'), weaponName: $('weapon-name'),
    weaponTime: $('weapon-time'), weaponFill: $('weapon-fill'),
  };

  const HEART_SVG = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>';

  const getBest = () => parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;

  function buildHUD() {
    ui.hearts.innerHTML = '';
    for (let i = 0; i < CONFIG.playerHp; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.innerHTML = HEART_SVG;
      ui.hearts.appendChild(h);
    }
    ui.bossSegs.innerHTML = '';
    const segCount = Math.min(CONFIG.bossHp, 10);
    for (let i = 0; i < segCount; i++) {
      const s = document.createElement('div');
      s.className = 'seg on';
      ui.bossSegs.appendChild(s);
    }
  }

  function updateHUD() {
    if (!G) return;
    const p = G.player;
    [...ui.hearts.children].forEach((h, i) => {
      const lost = i >= p.hp;
      const wasLost = h.classList.contains('lost');
      if (lost && !wasLost) { h.classList.remove('gain'); h.classList.add('lost'); }
      else if (!lost && wasLost) { h.classList.remove('lost'); h.classList.add('gain'); }
    });
    ui.score.textContent = G.score.toLocaleString();
    ui.wave.textContent = G.wave;
    document.body.classList.toggle('low-hp', p.hp === 1 && p.alive);

    const bossPhase = !!G.boss || G.bossIncoming;
    ui.progressWrap.classList.toggle('hidden', bossPhase);
    ui.bossWrap.classList.toggle('hidden', !bossPhase);
    ui.progressFill.style.width = (Math.min(1, G.killsSinceBoss / CONFIG.killsPerBoss) * 100) + '%';
    ui.progressText.textContent = `${Math.min(G.killsSinceBoss, CONFIG.killsPerBoss)}/${CONFIG.killsPerBoss}`;
    const bossHp = G.boss ? G.boss.hp : CONFIG.bossHp;
    const segs = ui.bossSegs.children.length || 1;
    [...ui.bossSegs.children].forEach((s, i) => {
      const fill = clamp((bossHp / CONFIG.bossHp) * segs - i, 0, 1);
      s.classList.toggle('on', fill > 0);
      s.style.opacity = fill > 0 ? String(0.35 + 0.65 * fill) : '';
    });
    ui.bossHpText.textContent = `${bossHp}/${CONFIG.bossHp}`;
  }

  // Active special-weapon chip (runs every frame; only touches the DOM when needed)
  let chipWeapon = null;
  function updateWeaponChip() {
    const p = G && G.player;
    const wk = p && p.alive ? p.weapon : null;
    if (wk !== chipWeapon) {
      chipWeapon = wk;
      ui.weaponChip.classList.toggle('hidden', !wk);
      if (wk) {
        const w = WEAPONS[wk];
        ui.weaponChip.style.setProperty('--wc', w.color);
        ui.weaponChip.style.setProperty('--wc-rgb', w.rgb);
        ui.weaponName.textContent = w.name;
        ui.weaponChip.classList.remove('pop');
        void ui.weaponChip.offsetWidth;
        ui.weaponChip.classList.add('pop');
      }
    }
    if (wk) {
      ui.weaponFill.style.width = (p.weaponTime / CONFIG.powerups.duration * 100) + '%';
      ui.weaponTime.textContent = p.weaponTime.toFixed(1) + 's';
      ui.weaponChip.classList.toggle('ending', p.weaponTime < 1.5);
    }
  }

  let bannerTimeout = null;
  function showBanner(title, sub, variant = '', duration = 2600) {
    ui.banner.className = 'banner ' + variant;
    ui.bannerTitle.textContent = title;
    ui.bannerSub.textContent = sub;
    void ui.banner.offsetWidth;
    ui.banner.classList.add('show');
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => ui.banner.classList.remove('show'), duration);
  }

  function flashDamage() {
    ui.damage.classList.remove('hit');
    void ui.damage.offsetWidth;
    ui.damage.classList.add('hit');
  }
  ui.damage.addEventListener('animationend', e => {
    if (e.animationName === 'dmg') ui.damage.classList.remove('hit');
  });

  function renderLegendIcons() {
    document.querySelectorAll('.legend-icon').forEach(c => {
      const g = c.getContext('2d');
      const kind = c.dataset.kind;
      if (kind === 'powerups') {
        g.clearRect(0, 0, c.width, c.height);
        WEAPON_KEYS.forEach((k, i) => drawCrate(g, c.width * (0.2 + i * 0.3), c.height / 2, k, 0.55 + i * 0.9, 1, 19));
        return;
      }
      if (kind === 'torpedo') {
        g.clearRect(0, 0, c.width, c.height);
        g.save();
        g.strokeStyle = 'rgba(225, 245, 255, 0.4)';
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.setLineDash([2, 8]);
        g.beginPath(); g.moveTo(16, 72); g.quadraticCurveTo(80, 78, 124, 50); g.stroke();
        g.restore();
        g.save();
        g.translate(150, 36);
        g.scale(2.6, 2.6);
        drawTorpedoBody(g, 0, 0, -0.5, 0.05, true);
        g.restore();
        g.save();
        g.translate(212, 22);
        g.strokeStyle = 'rgba(255, 59, 92, 0.9)';
        g.lineWidth = 2.5;
        g.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2;
          g.beginPath(); g.arc(0, 0, 14, a - 0.4, a + 0.4); g.stroke();
        }
        g.fillStyle = '#ff3b5c';
        g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
        g.restore();
        return;
      }
      const ship = makeShip(kind, 0, 0, 0);
      const scale = Math.min((c.width * 0.84) / ship.len, (c.height * 0.78) / (ship.wid * 1.25));
      g.clearRect(0, 0, c.width, c.height);
      g.save();
      g.scale(scale, scale);
      ship.x = c.width / 2 / scale - 2;
      ship.y = c.height / 2 / scale - 3;
      drawShip(g, ship, 0.3);
      g.restore();
    });
    const badges = {
      '.hp-badge.player': `${CONFIG.playerHp} HP`,
      '.hp-badge.enemy': `${CONFIG.enemyHp} HP`,
      '.hp-badge.boss': `${CONFIG.bossHp} HP`,
      '.hp-badge.power': `${CONFIG.powerups.duration} s`,
      '.hp-badge.torpedo': `${CONFIG.homing.trackTime} s`,
    };
    for (const [sel, txt] of Object.entries(badges)) {
      const el = document.querySelector(sel);
      if (el) el.textContent = txt;
    }
  }

  /* =========================================================
     Input
     ========================================================= */
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, active: false };
  const touch = { x: 0, y: 0, active: false, used: false };

  window.addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (e.code === 'Enter' && (state === 'menu' || state === 'over')) startGame();
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; if (state === 'playing') togglePause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(); });

  canvas.addEventListener('mousemove', e => {
    if (touch.used) return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
  });
  canvas.addEventListener('mousedown', e => {
    if (touch.used || e.button !== 0) return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; mouse.down = true;
  });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function onTouch(e) {
    e.preventDefault();
    touch.used = true;
    mouse.active = false;
    if (e.touches.length) {
      const t = e.touches[0];
      touch.x = t.clientX; touch.y = t.clientY; touch.active = true;
    } else {
      touch.active = false;
    }
  }
  canvas.addEventListener('touchstart', onTouch, { passive: false });
  canvas.addEventListener('touchmove', onTouch, { passive: false });
  canvas.addEventListener('touchend', onTouch, { passive: false });
  canvas.addEventListener('touchcancel', onTouch, { passive: false });

  /* =========================================================
     Game setup
     ========================================================= */
  function makePlayer() {
    const p = makeShip('player', W / 2, H * 0.78, -Math.PI / 2);
    Object.assign(p, { hp: CONFIG.playerHp, cooldown: 0, invuln: 0, nextTurret: 0, alive: true, weapon: null, weaponTime: 0 });
    return p;
  }

  function newGame() {
    G = {
      player: makePlayer(),
      enemies: [], boss: null, bullets: [], shells: [], torpedoes: [], pickups: [], lance: null,
      particles: [], foam: [], wrecks: [], floaters: [], timers: [],
      score: 0, kills: 0, killsSinceBoss: 0, wave: 1, bossesDefeated: 0,
      bossIncoming: false, bossTimer: 0, spawnTimer: 1.0, time: 0, deathTimer: 0,
    };
    shake = 0;
    buildHUD();
    updateHUD();
    updateWeaponChip();
  }

  const difficulty = () => 1 + (G.wave - 1) * 0.2;
  const maxEnemies = () => Math.min(2 + G.wave, 7);
  const shellSpeed = () => Math.min(360, 210 + (G.wave - 1) * 16);
  const later = (t, fn) => G.timers.push({ t, fn });

  /* =========================================================
     Particles & effects
     ========================================================= */
  function addP(p) { if (G.particles.length < CONFIG.maxParticles) G.particles.push(p); }

  function splash(x, y, scale = 1) {
    for (let i = 0; i < 10 * scale; i++) {
      const a = rand(0, TAU), sp = rand(20, 110) * scale, life = rand(0.5, 0.9);
      addP({ type: 'splash', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: rand(1.5, 3.5), drag: 3 });
    }
    addP({ type: 'ripple', x, y, vx: 0, vy: 0, life: 0.9, max: 0.9, size: 26 * scale, drag: 0 });
  }

  function explode(x, y, scale = 1) {
    const n = Math.round(22 * scale), sq = Math.sqrt(scale);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(30, 230) * sq, life = rand(0.35, 0.8);
      addP({ type: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: rand(3, 7) * sq, drag: 3.2 });
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = rand(0, TAU), sp = rand(10, 70) * sq, life = rand(1, 1.9);
      addP({ type: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: rand(6, 12) * sq, drag: 1.5 });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const a = rand(0, TAU), sp = rand(150, 420) * sq, life = rand(0.25, 0.6);
      addP({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: 1, drag: 2 });
    }
    addP({ type: 'ring', x, y, vx: 0, vy: 0, life: 0.55, max: 0.55, size: 55 * scale, drag: 0 });
    addP({ type: 'flash', x, y, vx: 0, vy: 0, life: 0.2, max: 0.2, size: 45 * scale, drag: 0 });
    splash(x, y, scale);
    shake = Math.max(shake, 7 * scale);
  }

  function sparks(x, y, n = 8, hue = 35) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(80, 260), life = rand(0.2, 0.45);
      addP({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: 1, drag: 3, hue });
    }
    addP({ type: 'flash', x, y, vx: 0, vy: 0, life: 0.12, max: 0.12, size: 18, drag: 0 });
  }

  function muzzleFlash(x, y, a, hue) {
    for (let i = 0; i < 6; i++) {
      const d = a + rand(-0.35, 0.35), sp = rand(60, 200), life = rand(0.1, 0.2);
      addP({ type: 'fire', x, y, vx: Math.cos(d) * sp, vy: Math.sin(d) * sp, life, max: life, size: rand(2, 3.5), drag: 4, hue });
    }
    for (let i = 0; i < 2; i++) {
      const life = rand(0.5, 0.8);
      addP({ type: 'smoke', x, y, vx: Math.cos(a) * 30 + rand(-10, 10), vy: Math.sin(a) * 30 + rand(-10, 10), life, max: life, size: 3, drag: 2 });
    }
  }

  function floater(x, y, text, color, size = 16) {
    G.floaters.push({ x, y, text, color, size, life: 1.2, max: 1.2 });
  }

  function emitWake(s, dt, rate = 0.035) {
    s.wakeTimer -= dt;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    while (s.wakeTimer <= 0) {
      s.wakeTimer += rate;
      const side = Math.random() < 0.5 ? -1 : 1;
      const sx = s.x - c * s.len * 0.48, sy = s.y - sn * s.len * 0.48;
      G.foam.push({
        x: sx + rand(-2, 2), y: sy + rand(-2, 2),
        vx: -c * 20 - sn * side * rand(8, 22), vy: -sn * 20 + c * side * rand(8, 22),
        life: 1.4, max: 1.4, size: s.wid * rand(0.16, 0.26),
      });
      if (Math.random() < 0.5) {
        const bx = s.x + c * s.len * 0.42, by = s.y + sn * s.len * 0.42;
        G.foam.push({
          x: bx, y: by, vx: -sn * side * rand(15, 35), vy: c * side * rand(15, 35),
          life: 0.8, max: 0.8, size: s.wid * 0.12,
        });
      }
    }
  }

  function addWreck(s) {
    const w = {
      x: s.x, y: s.y, angle: s.angle, len: s.len, wid: s.wid, pal: s.pal,
      t: 0, dur: s.kind === 'boss' ? 3.4 : 2.2, roll: rand(-0.5, 0.5), smokeT: 0,
    };
    G.wrecks.push(w);
    return w;
  }

  /* =========================================================
     Collision helpers
     ========================================================= */
  function hitCircles(s) {
    const c = Math.cos(s.angle), sn = Math.sin(s.angle), r = s.tpl.hit.r;
    return s.tpl.hit.offs.map(o => ({ x: s.x + c * o, y: s.y + sn * o, r }));
  }
  function circleHitsShip(x, y, r, s) {
    for (const h of hitCircles(s)) {
      const dx = x - h.x, dy = y - h.y, rr = r + h.r;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }
  function shipsOverlap(a, b) {
    for (const h of hitCircles(a)) if (circleHitsShip(h.x, h.y, h.r, b)) return true;
    return false;
  }
  const offscreen = (o, m) => o.x < -m || o.x > W + m || o.y < -m || o.y > H + m;

  function turretMuzzle(s, tu) {
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    const ox = s.x + c * tu.off, oy = s.y + sn * tu.off, bl = tu.size * 2.3;
    return { x: ox + Math.cos(tu.angle) * bl, y: oy + Math.sin(tu.angle) * bl, a: tu.angle, ox, oy };
  }
  function aimTurrets(s, tx, ty, rate) {
    for (const tu of s.turrets) {
      const m = turretMuzzle(s, tu);
      tu.angle = rotateTowards(tu.angle, Math.atan2(ty - m.oy, tx - m.ox), rate);
      tu.recoil = Math.max(0, tu.recoil - rate * 0.6);
    }
  }

  function nearestTarget(p) {
    let best = null, bd = Infinity;
    const list = G.boss ? [...G.enemies, G.boss] : G.enemies;
    for (const e of list) {
      if (e.dead || e.y < 0) continue;
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /* =========================================================
     Player
     ========================================================= */
  function updatePlayer(dt) {
    const p = G.player;
    let ax = 0, ay = 0, spd = CONFIG.player.speed;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ax -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ax += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) ay -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) ay += 1;

    if (touch.active) {
      const dx = touch.x - p.x, dy = touch.y - 80 - p.y, d = Math.hypot(dx, dy);
      if (d > 6) { ax = dx / d; ay = dy / d; spd *= Math.min(1, d / 80); }
    } else {
      const m = Math.hypot(ax, ay);
      if (m > 0) { ax /= m; ay /= m; }
    }

    const k = Math.min(1, dt * CONFIG.player.accel);
    p.vx = lerp(p.vx, ax * spd, k);
    p.vy = lerp(p.vy, ay * spd, k);
    p.x = clamp(p.x + p.vx * dt, 36, W - 36);
    p.y = clamp(p.y + p.vy * dt, H * 0.42, H - 44);
    p.angle = -Math.PI / 2 + clamp(p.vx / CONFIG.player.speed, -1, 1) * 0.28;

    // Aim: mouse if available, otherwise auto-target nearest ship
    let aim;
    if (mouse.active && !touch.used) aim = mouse;
    else aim = nearestTarget(p) || { x: p.x, y: p.y - 500 };
    aimTurrets(p, aim.x, aim.y, dt * 10);

    p.cooldown -= dt;
    p.invuln = Math.max(0, p.invuln - dt);
    p.flash = Math.max(0, p.flash - dt);

    // Special weapon countdown
    if (p.weapon) {
      p.weaponTime -= dt;
      if (p.weaponTime <= 0) {
        p.weapon = null;
        p.weaponTime = 0;
        floater(p.x, p.y - 46, 'WEAPON OFFLINE', '#8eb1c6', 13);
      }
    }

    const firing = mouse.down || keys.has('Space') || keys.has('KeyJ') || touch.active;
    if (firing && p.weapon === 'lance') fireLance(p, dt);
    else if (firing && p.cooldown <= 0) firePlayer(p);
    emitWake(p, dt);
  }

  function firePlayer(p) {
    const wk = p.weapon;

    // Hunter Missiles: one homing missile from every turret
    if (wk === 'missile') {
      const w = WEAPONS.missile;
      for (const tu of p.turrets) {
        const m = turretMuzzle(p, tu), a = m.a + rand(-0.3, 0.3), sp = 240;
        G.bullets.push({
          kind: 'missile', x: m.x, y: m.y, angle: a, speed: sp,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 5, life: 2.8, target: null, trailT: 0,
        });
        tu.recoil = 1;
        muzzleFlash(m.x, m.y, m.a, w.hue);
      }
      p.cooldown = w.cooldown;
      return;
    }

    const tu = p.turrets[p.nextTurret++ % p.turrets.length];
    const m = turretMuzzle(p, tu);
    if (wk === 'spread') {
      // Tempest Spread: shotgun fan
      const w = WEAPONS.spread, half = (w.pellets - 1) / 2;
      for (let i = -half; i <= half; i++) {
        const a = m.a + i * w.fan;
        G.bullets.push({
          kind: 'spread', x: m.x, y: m.y,
          vx: Math.cos(a) * w.speed + p.vx * 0.3, vy: Math.sin(a) * w.speed + p.vy * 0.3,
          r: 4, life: w.life,
        });
      }
      p.cooldown = w.cooldown;
      muzzleFlash(m.x, m.y, m.a, w.hue);
      shake = Math.max(shake, 1.5);
    } else {
      const sp = CONFIG.player.bulletSpeed;
      G.bullets.push({
        kind: 'shot', x: m.x, y: m.y,
        vx: Math.cos(m.a) * sp + p.vx * 0.3, vy: Math.sin(m.a) * sp + p.vy * 0.3,
        r: 4, life: 1.6,
      });
      p.cooldown = CONFIG.player.fireCooldown;
      muzzleFlash(m.x, m.y, m.a, 185);
    }
    tu.recoil = 1;
  }

  // Arc Lance: continuous piercing beam from the forward turret
  function fireLance(p, dt) {
    const w = WEAPONS.lance, tu = p.turrets[0], m = turretMuzzle(p, tu);
    const dx = Math.cos(m.a), dy = Math.sin(m.a), reach = Math.hypot(W, H) + 60;
    const L = { x1: m.x, y1: m.y, x2: m.x + dx * reach, y2: m.y + dy * reach, hits: [] };
    G.lance = L;
    tu.recoil = Math.max(tu.recoil, 0.35);

    const targets = G.boss ? [...G.enemies, G.boss] : G.enemies.slice();
    for (const e of targets) {
      if (e.dead || e.y < -10) continue;
      let hit = null;
      for (const h of hitCircles(e)) {
        const k = (h.x - m.x) * dx + (h.y - m.y) * dy;
        if (k < 0) continue;
        const px = m.x + dx * k, py = m.y + dy * k;
        if ((h.x - px) ** 2 + (h.y - py) ** 2 < h.r * h.r) { hit = { x: px, y: py }; break; }
      }
      if (!hit) continue;
      L.hits.push(hit);
      e.lanceCd = (e.lanceCd || 0) - dt;
      if (e.lanceCd <= 0) {
        e.lanceCd = w.tick;
        damageShip(e, hit.x, hit.y);
      } else if (Math.random() < 0.35) {
        sparks(hit.x, hit.y, 2, w.hue);
      }
    }
    for (const t of G.torpedoes) {
      if (t.dead) continue;
      const k = (t.x - m.x) * dx + (t.y - m.y) * dy;
      if (k < 0) continue;
      const px = m.x + dx * k, py = m.y + dy * k;
      if ((t.x - px) ** 2 + (t.y - py) ** 2 < (t.r + 6) ** 2) killTorpedo(t);
    }
    if (Math.random() < 0.5) {
      addP({ type: 'fire', x: m.x, y: m.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.15, max: 0.15, size: rand(2, 3.5), drag: 3, hue: w.hue });
    }
  }

  function hitPlayer(x, y) {
    const p = G.player;
    if (!p.alive || p.invuln > 0) return;
    p.hp -= 1;
    p.invuln = CONFIG.player.invuln;
    p.flash = 0.2;
    shake = Math.max(shake, 14);
    explode(x, y, 0.7);
    flashDamage();
    floater(p.x, p.y - 40, '-1 HULL', '#ff6b81', 17);
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      const w = addWreck(p);
      explode(p.x, p.y, 1.8);
      for (let i = 1; i <= 4; i++) {
        later(i * 0.22, () => explode(w.x + rand(-25, 25), w.y + rand(-12, 12), rand(0.7, 1.1)));
      }
      shake = 26;
      state = 'dying';
      G.deathTimer = 2.4;
    }
    updateHUD();
  }

  /* =========================================================
     Enemies
     ========================================================= */
  function spawnEnemy() {
    const e = makeShip('enemy', rand(60, W - 60), -40, Math.PI / 2);
    Object.assign(e, {
      hp: CONFIG.enemyHp, maxHp: CONFIG.enemyHp,
      state: 'enter',
      targetY: rand(H * 0.08, H * 0.36) + 20,
      patrol: rand(45, 85) * (Math.random() < 0.5 ? -1 : 1) * (1 + (G.wave - 1) * 0.08),
      fireTimer: rand(1.0, 2.2),
      phase: rand(0, TAU),
    });
    G.enemies.push(e);
  }

  function updateEnemy(e, dt) {
    const p = G.player;
    e.flash = Math.max(0, e.flash - dt);

    if (e.state === 'enter') {
      e.vx = lerp(e.vx, 0, dt * 2);
      e.vy = 85;
      if (e.y >= e.targetY) e.state = 'patrol';
    } else {
      if (e.x < 50 && e.patrol < 0) e.patrol = -e.patrol;
      if (e.x > W - 50 && e.patrol > 0) e.patrol = -e.patrol;
      e.vx = lerp(e.vx, e.patrol, dt * 1.5);
      e.vy = Math.sin(G.time * 0.8 + e.phase) * 18 + (e.targetY - e.y) * 0.5;
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (Math.hypot(e.vx, e.vy) > 5) e.angle = rotateTowards(e.angle, Math.atan2(e.vy, e.vx), dt * 1.8);

    aimTurrets(e, p.x, p.y, dt * 3);
    emitWake(e, dt, 0.05);

    if (e.y > 20 && p.alive) {
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        const tu = e.turrets[0], m = turretMuzzle(e, tu), speed = shellSpeed();
        const hc = CONFIG.homing;
        const torpChance = Math.min(hc.maxChance, hc.baseChance + (G.wave - 1) * hc.perWave);
        if (Math.random() < torpChance && activeTorpedoes() < hc.maxActive) {
          fireTorpedo(m.x, m.y, Math.atan2(p.y - m.y, p.x - m.x));
          muzzleFlash(m.x, m.y, m.a, 0);
        } else {
          const lead = Math.min(0.6, (G.wave - 1) * 0.15);
          const tt = Math.hypot(p.x - m.x, p.y - m.y) / speed;
          const ax = p.x + p.vx * tt * lead, ay = p.y + p.vy * tt * lead;
          fireShell(m.x, m.y, Math.atan2(ay - m.y, ax - m.x) + rand(-0.1, 0.1), speed, false);
          muzzleFlash(m.x, m.y, m.a, null);
        }
        tu.recoil = 1;
        e.fireTimer = rand(1.7, 3.0) / difficulty();
      }
    }

    if (p.alive && p.invuln <= 0 && shipsOverlap(e, p)) {
      hitPlayer(p.x, p.y);
      damageShip(e, e.x, e.y);
    }
  }

  function separateEnemies(dt) {
    const list = G.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        if (d < 64) {
          const push = (64 - d) * dt * 2;
          a.x -= (dx / d) * push; b.x += (dx / d) * push;
          a.targetY -= (dy / d) * push; b.targetY += (dy / d) * push;
        }
      }
    }
  }

  function fireShell(x, y, a, speed, boss) {
    G.shells.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: boss ? 6 : 5, life: 7, boss });
  }

  /* =========================================================
     Homing torpedoes (enemy)
     ========================================================= */
  const activeTorpedoes = () => G.torpedoes.reduce((n, t) => n + (t.dead ? 0 : 1), 0);

  function fireTorpedo(x, y, a) {
    const hc = CONFIG.homing;
    G.torpedoes.push({
      x, y, angle: a, speed: hc.speed * 0.55, track: hc.trackTime, life: hc.maxLife,
      r: 6, trailT: 0, dead: false, lost: false, born: rand(0, 10),
    });
    splash(x, y, 0.35);
  }

  function killTorpedo(t, scored = true) {
    if (t.dead) return;
    t.dead = true;
    explode(t.x, t.y, 0.45);
    if (scored) {
      const pts = 25 * G.wave;
      G.score += pts;
      floater(t.x, t.y - 18, `+${pts}`, '#ffe08a', 13);
      updateHUD();
    }
  }

  function updateTorpedoes(dt) {
    const p = G.player, hc = CONFIG.homing;
    G.torpedoes = G.torpedoes.filter(t => !t.dead);
    for (const t of G.torpedoes) {
      t.life -= dt;
      t.track -= dt;
      t.speed = Math.min(hc.speed, t.speed + 140 * dt);
      if (t.track > 0 && p.alive) {
        t.angle = rotateTowards(t.angle, Math.atan2(p.y - t.y, p.x - t.x), hc.turnRate * dt);
      } else if (!t.lost) {
        // tracking time is over: seeker shuts off and it runs straight
        t.lost = true;
        sparks(t.x, t.y, 4, 0);
      }
      const c = Math.cos(t.angle), s = Math.sin(t.angle);
      t.x += c * t.speed * dt;
      t.y += s * t.speed * dt;

      t.trailT -= dt;
      if (t.trailT <= 0) {
        t.trailT = 0.035;
        G.foam.push({
          x: t.x - c * 12 + rand(-1.5, 1.5), y: t.y - s * 12 + rand(-1.5, 1.5),
          vx: -c * 15 + rand(-6, 6), vy: -s * 15 + rand(-6, 6), life: 0.9, max: 0.9, size: rand(1.6, 2.8),
        });
      }

      if (p.alive && p.invuln <= 0 && circleHitsShip(t.x, t.y, t.r, p)) {
        t.dead = true;
        hitPlayer(t.x, t.y);
        continue;
      }
      if (t.life <= 0) { killTorpedo(t, false); continue; }
      if (offscreen(t, t.track > 0 ? 260 : 50)) t.dead = true;
    }
  }

  /* =========================================================
     Weapon crates
     ========================================================= */
  function spawnPickup(x, y, type) {
    if (G.pickups.length >= CONFIG.powerups.maxOnField) return;
    type = type || WEAPON_KEYS[Math.floor(Math.random() * WEAPON_KEYS.length)];
    G.pickups.push({
      x: clamp(x, 30, W - 30), y, type, t: 0, phase: rand(0, TAU),
      life: CONFIG.powerups.pickupLife, vx: rand(-25, 25), vy: rand(-40, -10),
    });
  }

  function updatePickups(dt) {
    const p = G.player, drag = Math.max(0, 1 - 1.6 * dt);
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const k = G.pickups[i];
      k.t += dt;
      k.life -= dt;
      k.vx *= drag;
      k.vy *= drag;
      k.x = clamp(k.x + k.vx * dt, 24, W - 24);
      k.y += (k.vy + CONFIG.scrollSpeed + 24) * dt;
      if (p.alive && circleHitsShip(k.x, k.y, 16, p)) {
        collectPickup(k);
        G.pickups.splice(i, 1);
        continue;
      }
      if (k.life <= 0 || k.y > H + 30) {
        if (k.life <= 0) splash(k.x, k.y, 0.6);
        G.pickups.splice(i, 1);
      }
    }
  }

  function collectPickup(k) {
    const p = G.player, w = WEAPONS[k.type];
    p.weapon = k.type;
    p.weaponTime = CONFIG.powerups.duration;
    p.cooldown = 0;
    floater(p.x, p.y - 52, `${w.name.toUpperCase()}!`, w.color, 18);
    sparks(k.x, k.y, 16, w.hue);
    addP({ type: 'ring', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 70, drag: 0, rgb: w.rgb });
    chipWeapon = null; // force the HUD chip to re-pop
    updateWeaponChip();
  }

  /* =========================================================
     Boss
     ========================================================= */
  function spawnBoss() {
    const b = makeShip('boss', W / 2, -90, 0);
    Object.assign(b, {
      hp: CONFIG.bossHp, maxHp: CONFIG.bossHp,
      state: 'enter', targetY: Math.max(120, H * 0.2),
      dir: Math.random() < 0.5 ? -1 : 1,
      fireTimer: 1.6, pattern: 0, burst: 0, burstTimer: 0, smokeTimer: 0,
    });
    G.boss = b;
    G.bossIncoming = false;
    updateHUD();
  }

  function updateBoss(b, dt) {
    const p = G.player;
    b.flash = Math.max(0, b.flash - dt);
    const speed = 95 + (G.wave - 1) * 12;

    if (b.state === 'enter') {
      b.vx = 0;
      b.vy = 70;
      if (b.y >= b.targetY) b.state = 'fight';
    } else {
      const margin = Math.min(b.len * 0.6, W * 0.3);
      if (b.x > W - margin) b.dir = -1;
      if (b.x < margin) b.dir = 1;
      b.vx = lerp(b.vx, b.dir * speed, dt * 1.2);
      b.vy = Math.sin(G.time * 0.7) * 20 + (b.targetY - b.y) * 0.8;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle = clamp(b.vx / speed, -1, 1) * 0.06;

    aimTurrets(b, p.x, p.y, dt * 2.5);
    emitWake(b, dt, 0.03);

    // Funnel smoke
    b.smokeTimer -= dt;
    if (b.smokeTimer <= 0) {
      b.smokeTimer = 0.09;
      const f = b.tpl.funnels[0];
      const fx = b.x + Math.cos(b.angle) * f, fy = b.y + Math.sin(b.angle) * f, life = rand(1.2, 1.8);
      addP({ type: 'smoke', x: fx, y: fy, vx: rand(-8, 8) - b.vx * 0.3, vy: rand(-6, 6), life, max: life, size: rand(5, 8), drag: 0.6 });
    }

    if (b.state !== 'fight' || !p.alive) return;

    b.fireTimer -= dt;
    if (b.fireTimer <= 0) {
      const pat = b.pattern++ % 4;
      if (pat === 0) {
        // aimed 5-shell fan from the forward turret
        const tu = b.turrets[1], m = turretMuzzle(b, tu);
        const base = Math.atan2(p.y - m.y, p.x - m.x);
        for (let i = -2; i <= 2; i++) fireShell(m.x, m.y, base + i * 0.16, shellSpeed() * 0.95, true);
        tu.recoil = 1;
        muzzleFlash(m.x, m.y, m.a, 350);
        b.fireTimer = 2.0 / difficulty();
      } else if (pat === 1) {
        // rapid burst cycling through all turrets
        b.burst = 6;
        b.burstTimer = 0;
        b.fireTimer = 2.4 / difficulty();
      } else if (pat === 2) {
        // broadside arc
        const n = 12, rot = rand(-0.08, 0.08);
        for (let i = 0; i < n; i++) {
          const a = lerp(Math.PI * 0.1, Math.PI * 0.9, i / (n - 1)) + rot;
          fireShell(b.x + Math.cos(a) * 30, b.y + Math.sin(a) * 20, a, shellSpeed() * 0.75, true);
        }
        shake = Math.max(shake, 5);
        sparks(b.x, b.y + 20, 10, 350);
        b.fireTimer = 2.2 / difficulty();
      } else {
        // homing torpedo salvo launched from both beams
        for (const side of [-1, 1]) {
          const ox = b.x + side * 30, oy = b.y + b.wid * 0.5;
          fireTorpedo(ox, oy, Math.PI / 2 + side * 0.7);
          muzzleFlash(ox, oy, Math.PI / 2 + side * 0.7, 0);
        }
        b.fireTimer = 2.4 / difficulty();
      }
    }

    if (b.burst > 0) {
      b.burstTimer -= dt;
      if (b.burstTimer <= 0) {
        const tu = b.turrets[b.burst % b.turrets.length], m = turretMuzzle(b, tu);
        fireShell(m.x, m.y, Math.atan2(p.y - m.y, p.x - m.x) + rand(-0.05, 0.05), shellSpeed() * 1.1, true);
        tu.recoil = 1;
        muzzleFlash(m.x, m.y, m.a, 350);
        b.burst--;
        b.burstTimer = 0.14;
      }
    }

    if (p.invuln <= 0 && shipsOverlap(b, p)) hitPlayer(p.x, p.y);
  }

  /* =========================================================
     Damage / destruction
     ========================================================= */
  function damageShip(s, x, y, amount = 1) {
    if (s.dead) return;
    s.hp = Math.max(0, s.hp - amount);
    s.flash = 0.14;
    sparks(x, y, 9, s.kind === 'boss' ? 350 : 35);
    splash(x, y, 0.4);
    if (s.kind === 'boss') shake = Math.max(shake, 4);
    if (s.hp <= 0) destroyShip(s);
    updateHUD();
  }

  function destroyShip(s) {
    s.dead = true;
    if (s.kind === 'boss') {
      const pts = 1000 * G.wave;
      G.score += pts;
      G.bossesDefeated++;
      G.wave++;
      G.killsSinceBoss = 0;
      G.boss = null;
      G.spawnTimer = 3.2;

      const w = addWreck(s);
      for (let i = 0; i < 9; i++) {
        later(i * 0.13, () => {
          const o = rand(-w.len * 0.45, w.len * 0.45);
          explode(w.x + Math.cos(w.angle) * o, w.y + Math.sin(w.angle) * o + rand(-12, 12), rand(0.7, 1.2));
        });
      }
      later(1.25, () => explode(w.x, w.y, 2.6));
      floater(s.x, s.y - 50, `+${pts.toLocaleString()}`, '#ffd36b', 26);
      if (Math.random() < CONFIG.powerups.bossDropChance) spawnPickup(s.x, s.y);

      // Reward: repair one hull point (never above max)
      const p = G.player;
      let repaired = false;
      if (p.alive && p.hp < CONFIG.playerHp) {
        p.hp++;
        repaired = true;
        later(0.6, () => floater(p.x, p.y - 44, '+1 HULL', '#5dffa8', 18));
      }
      showBanner(`WAVE ${G.wave}`, repaired ? 'Dreadnought sunk · Hull repaired' : 'Dreadnought sunk', 'victory', 3000);
    } else {
      const pts = 100 * G.wave;
      G.score += pts;
      G.kills++;
      G.killsSinceBoss++;
      addWreck(s);
      explode(s.x, s.y, 1.1);
      floater(s.x, s.y - 30, `+${pts}`, '#ffe08a');
      if (Math.random() < CONFIG.powerups.dropChance) spawnPickup(s.x, s.y);

      if (G.killsSinceBoss >= CONFIG.killsPerBoss && !G.boss && !G.bossIncoming) {
        G.bossIncoming = true;
        G.bossTimer = 3;
        showBanner('⚠ WARNING ⚠', 'Enemy Dreadnought approaching', 'boss', 2900);
      }
    }
    updateHUD();
  }

  /* =========================================================
     World update
     ========================================================= */
  function updateBullets(dt) {
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      if (b.kind === 'missile') steerMissile(b, dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let hit = false;
      const targets = G.boss ? [...G.enemies, G.boss] : G.enemies.slice();
      for (const e of targets) {
        if (e.dead || e.y < -10) continue;
        if (circleHitsShip(b.x, b.y, b.r, e)) {
          if (b.kind === 'missile') missileBlast(b, e, targets);
          else damageShip(e, b.x, b.y);
          hit = true;
          break;
        }
      }
      // Player fire can shoot down homing torpedoes
      if (!hit) {
        for (const t of G.torpedoes) {
          if (t.dead) continue;
          const dx = b.x - t.x, dy = b.y - t.y, rr = b.r + t.r + 3;
          if (dx * dx + dy * dy < rr * rr) { killTorpedo(t); hit = true; break; }
        }
      }
      if (hit || b.life <= 0 || offscreen(b, 40)) {
        if (!hit && b.life <= 0) {
          if (b.kind === 'missile') explode(b.x, b.y, 0.3);
          else splash(b.x, b.y, 0.5);
        }
        G.bullets.splice(i, 1);
      }
    }
  }

  function steerMissile(b, dt) {
    if (!b.target || b.target.dead) b.target = nearestTarget(b);
    b.speed = Math.min(640, b.speed + 950 * dt);
    if (b.target) b.angle = rotateTowards(b.angle, Math.atan2(b.target.y - b.y, b.target.x - b.x), 6 * dt);
    b.vx = Math.cos(b.angle) * b.speed;
    b.vy = Math.sin(b.angle) * b.speed;
    b.trailT -= dt;
    if (b.trailT <= 0) {
      b.trailT = 0.018;
      const life = rand(0.35, 0.6);
      addP({ type: 'smoke', x: b.x, y: b.y, vx: rand(-8, 8), vy: rand(-8, 8), life, max: life, size: rand(1.5, 2.6), drag: 1.5 });
      addP({ type: 'fire', x: b.x, y: b.y, vx: -b.vx * 0.08, vy: -b.vy * 0.08, life: 0.14, max: 0.14, size: rand(1.8, 2.8), drag: 3, hue: WEAPONS.missile.hue });
    }
  }

  function missileBlast(b, e, targets) {
    const w = WEAPONS.missile;
    damageShip(e, b.x, b.y, w.damage);
    explode(b.x, b.y, 0.5);
    for (const o of targets) {
      if (o === e || o.dead || o.y < -10) continue;
      if (circleHitsShip(b.x, b.y, w.blast, o)) damageShip(o, o.x, o.y, 1);
    }
  }

  function updateShells(dt) {
    const p = G.player;
    for (let i = G.shells.length - 1; i >= 0; i--) {
      const s = G.shells[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (p.alive && p.invuln <= 0 && circleHitsShip(s.x, s.y, s.r, p)) {
        hitPlayer(s.x, s.y);
        G.shells.splice(i, 1);
        continue;
      }
      if (s.life <= 0 || offscreen(s, 40)) {
        if (s.life <= 0) splash(s.x, s.y, 0.5);
        G.shells.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    const scroll = CONFIG.scrollSpeed;
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.life -= dt;
      if (p.life <= 0) { G.particles.splice(i, 1); continue; }
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'smoke' || p.type === 'ripple') p.y += scroll * dt;
    }
  }

  function updateFoam(dt) {
    const scroll = CONFIG.scrollSpeed, drag = Math.max(0, 1 - 1.5 * dt);
    for (let i = G.foam.length - 1; i >= 0; i--) {
      const f = G.foam[i];
      f.life -= dt;
      if (f.life <= 0) { G.foam.splice(i, 1); continue; }
      f.vx *= drag; f.vy *= drag;
      f.x += f.vx * dt;
      f.y += (f.vy + scroll) * dt;
    }
  }

  function updateWrecks(dt) {
    for (let i = G.wrecks.length - 1; i >= 0; i--) {
      const w = G.wrecks[i];
      w.t += dt;
      w.y += CONFIG.scrollSpeed * dt;
      w.angle += w.roll * dt * 0.3;
      w.smokeT -= dt;
      if (w.smokeT <= 0 && w.t < w.dur * 0.8) {
        w.smokeT = 0.06;
        const o = rand(-w.len * 0.35, w.len * 0.35), life = rand(1, 1.6);
        const x = w.x + Math.cos(w.angle) * o, y = w.y + Math.sin(w.angle) * o;
        addP({ type: 'smoke', x, y, vx: rand(-10, 10), vy: rand(-10, 4), life, max: life, size: rand(5, 9), drag: 0.8 });
        if (Math.random() < 0.5) {
          addP({ type: 'fire', x, y, vx: rand(-15, 15), vy: rand(-25, 0), life: 0.4, max: 0.4, size: rand(2.5, 4.5), drag: 1 });
        }
        G.foam.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: 0, vy: 0, life: 1, max: 1, size: rand(2, 5) });
      }
      if (w.t >= w.dur) G.wrecks.splice(i, 1);
    }
  }

  function updateFloaters(dt) {
    for (let i = G.floaters.length - 1; i >= 0; i--) {
      const f = G.floaters[i];
      f.life -= dt;
      f.y -= 32 * dt;
      if (f.life <= 0) G.floaters.splice(i, 1);
    }
  }

  function update(dt) {
    G.time += dt;

    for (let i = G.timers.length - 1; i >= 0; i--) {
      const t = G.timers[i];
      t.t -= dt;
      if (t.t <= 0) { G.timers.splice(i, 1); t.fn(); }
    }

    G.lance = null;
    if (G.player.alive) updatePlayer(dt);

    // Spawning
    if (G.bossIncoming) {
      G.bossTimer -= dt;
      if (G.bossTimer <= 0) spawnBoss();
    } else if (!G.boss) {
      G.spawnTimer -= dt;
      if (G.spawnTimer <= 0) {
        if (G.enemies.length < maxEnemies()) spawnEnemy();
        G.spawnTimer = rand(1.3, 2.3) / difficulty();
      }
    }

    for (const e of G.enemies) updateEnemy(e, dt);
    separateEnemies(dt);
    if (G.boss) updateBoss(G.boss, dt);

    updateBullets(dt);
    updateShells(dt);
    updateTorpedoes(dt);
    updatePickups(dt);
    G.enemies = G.enemies.filter(e => !e.dead);
    updateParticles(dt);
    updateFoam(dt);
    updateWrecks(dt);
    updateFloaters(dt);
    updateWeaponChip();

    if (state === 'dying') {
      G.deathTimer -= dt;
      if (G.deathTimer <= 0) gameOver();
    }
  }

  /* =========================================================
     Rendering
     ========================================================= */
  function drawFoam() {
    for (const f of G.foam) {
      const t = f.life / f.max;
      ctx.fillStyle = `rgba(225, 245, 255, ${0.3 * t})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size * (1 + (1 - t) * 1.8), 0, TAU);
      ctx.fill();
    }
  }

  function drawWrecks() {
    for (const w of G.wrecks) {
      const k = w.t / w.dur;
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.angle);
      ctx.scale(1 - k * 0.3, 1 - k * 0.55);
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
      hullPath(ctx, w.len, w.wid);
      ctx.fillStyle = w.pal.hullDark;
      ctx.fill();
      ctx.scale(0.8, 0.6);
      hullPath(ctx, w.len, w.wid);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of G.particles) {
      const t = p.life / p.max;
      switch (p.type) {
        case 'smoke':
          ctx.fillStyle = `rgba(38, 44, 56, ${0.42 * t})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + (1 - t) * 2.2), 0, TAU); ctx.fill();
          break;
        case 'splash':
          ctx.fillStyle = `rgba(220, 244, 255, ${0.85 * t})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
          break;
        case 'ripple':
          ctx.strokeStyle = `rgba(210, 240, 255, ${0.5 * t})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 4 + p.size * (1 - t), 0, TAU); ctx.stroke();
          break;
        case 'ring':
          ctx.strokeStyle = `rgba(${p.rgb || '255, 230, 190'}, ${0.7 * t})`;
          ctx.lineWidth = 3 * t + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6 + p.size * (1 - t), 0, TAU); ctx.stroke();
          break;
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of G.particles) {
      const t = p.life / p.max;
      switch (p.type) {
        case 'fire': {
          const hue = p.hue != null ? p.hue : 12 + 38 * t;
          ctx.fillStyle = `hsla(${hue}, 100%, ${45 + 40 * t}%, ${t})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * t), 0, TAU); ctx.fill();
          break;
        }
        case 'spark': {
          const hue = p.hue != null ? p.hue : 38;
          ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${t})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
          break;
        }
        case 'flash': {
          const r = p.size * (1.4 - t * 0.4);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, `rgba(255, 250, 225, ${t})`);
          g.addColorStop(0.4, `rgba(255, 180, 90, ${0.5 * t})`);
          g.addColorStop(1, 'rgba(255, 120, 40, 0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
          break;
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBullets() {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of G.bullets) {
      if (b.kind === 'missile') continue;
      const spread = b.kind === 'spread';
      const tx = b.x - b.vx * 0.035, ty = b.y - b.vy * 0.035;
      ctx.strokeStyle = spread ? 'rgba(255, 190, 60, 0.32)' : 'rgba(62, 242, 255, 0.28)';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = spread ? 'rgba(255, 244, 210, 0.95)' : 'rgba(200, 255, 255, 0.95)';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of G.bullets) if (b.kind === 'missile') drawMissile(b);
  }

  function drawMissile(b) {
    const w = WEAPONS.missile;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(-8, 0, 0, -8, 0, 12);
    g.addColorStop(0, `rgba(${w.rgb}, 0.75)`);
    g.addColorStop(1, `rgba(${w.rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(-8, 0, 12, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#3f6a17';
    ctx.beginPath();
    ctx.moveTo(-7, -2.2); ctx.lineTo(-9.5, -4.8); ctx.lineTo(-4, -2.2);
    ctx.moveTo(-7, 2.2); ctx.lineTo(-9.5, 4.8); ctx.lineTo(-4, 2.2);
    ctx.fill();
    roundRectPath(ctx, -7, -2.2, 12, 4.4, 2);
    ctx.fillStyle = '#eef7dc';
    ctx.fill();
    ctx.fillStyle = w.color;
    ctx.beginPath(); ctx.moveTo(5, -2.2); ctx.quadraticCurveTo(10.5, 0, 5, 2.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawLance() {
    const L = G.lance;
    if (!L) return;
    const w = WEAPONS.lance, fl = 0.8 + 0.2 * Math.sin(oceanT * 70);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const beam = (width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(L.x1, L.y1); ctx.lineTo(L.x2, L.y2); ctx.stroke();
    };
    beam(24 * fl, `rgba(${w.rgb}, 0.12)`);
    beam(10 * fl, `rgba(${w.rgb}, 0.38)`);
    beam(3.2, 'rgba(250, 236, 255, 0.95)');
    // crackling arc wrapped around the beam
    const dx = L.x2 - L.x1, dy = L.y2 - L.y1, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    ctx.strokeStyle = `rgba(${w.rgb}, 0.85)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(L.x1, L.y1);
    for (let d = 18; d < len; d += 18) {
      const o = rand(-6, 6);
      ctx.lineTo(L.x1 + dx * d / len + nx * o, L.y1 + dy * d / len + ny * o);
    }
    ctx.stroke();
    // muzzle + impact glows
    const glows = [{ x: L.x1, y: L.y1, r: 16 }, ...L.hits.map(h => ({ x: h.x, y: h.y, r: 24 }))];
    for (const pt of glows) {
      const r = pt.r * fl;
      const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
      g.addColorStop(0, 'rgba(255, 245, 255, 0.95)');
      g.addColorStop(0.35, `rgba(${w.rgb}, 0.55)`);
      g.addColorStop(1, `rgba(${w.rgb}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawPickups() {
    for (const k of G.pickups) {
      const blink = k.life < 2 && Math.floor(k.life * 8) % 2 === 0;
      const grow = Math.min(1, k.t * 3);
      drawCrate(ctx, k.x, k.y, k.type, k.t + k.phase, (blink ? 0.35 : 1) * grow, 13 * (0.6 + 0.4 * grow));
    }
  }

  function drawTorpedoes() {
    for (const t of G.torpedoes) {
      if (t.dead) continue;
      drawTorpedoBody(ctx, t.x, t.y, t.angle, oceanT + t.born, t.track > 0);
      if (t.track > 0) {
        // remaining tracking time
        const f = t.track / CONFIG.homing.trackTime;
        ctx.strokeStyle = 'rgba(255, 70, 95, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(t.x, t.y, 15, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
      }
    }
  }

  function drawPlayerOverlays(p) {
    // Special weapon timer ring
    if (p.weapon) {
      const w = WEAPONS[p.weapon], f = p.weaponTime / CONFIG.powerups.duration;
      const dim = p.weaponTime < 1.5 && Math.floor(oceanT * 10) % 2 === 0;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(${w.rgb}, 0.16)`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 40, 0, TAU); ctx.stroke();
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = `rgba(${w.rgb}, ${dim ? 0.3 : 0.95})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 40, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
      ctx.restore();
    }
    // Torpedo lock-on warning
    if (G.torpedoes.some(t => !t.dead && t.track > 0)) {
      const pulse = 0.5 + 0.5 * Math.sin(oceanT * 12), r = 54 + pulse * 3, rot = oceanT * 1.5;
      const col = `rgba(255, 59, 92, ${0.55 + 0.4 * pulse})`;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = rot + i * Math.PI / 2;
        ctx.beginPath(); ctx.arc(0, 0, r, a - 0.32, a + 0.32); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r - 7), Math.sin(a) * (r - 7));
        ctx.lineTo(Math.cos(a) * (r + 4), Math.sin(a) * (r + 4));
        ctx.stroke();
      }
      ctx.font = '800 11px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = col;
      ctx.fillText('LOCKED ON', 0, -r - 13);
      ctx.restore();
    }
  }

  function drawShells() {
    ctx.lineCap = 'round';
    for (const s of G.shells) {
      const col = s.boss ? '255, 60, 110' : '255, 140, 50';
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${col}, 0.35)`;
      ctx.lineWidth = s.r * 1.3;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.06, s.y - s.vy * 0.06); ctx.stroke();
      ctx.fillStyle = `rgba(${col}, 0.28)`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.4, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.boss ? '#ff3b6b' : '#ff9a3c';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      ctx.fillStyle = s.boss ? '#ffe0e8' : '#fff1c9';
      ctx.beginPath(); ctx.arc(s.x - s.r * 0.2, s.y - s.r * 0.2, s.r * 0.5, 0, TAU); ctx.fill();
    }
  }

  function drawPips(s, yOff) {
    if (s.y < 0) return;
    const n = s.maxHp, boss = s.kind === 'boss', pips = Math.min(n, 10);
    const w = boss ? 14 : 9, h = boss ? 5 : 4, gap = 3;
    const total = pips * w + (pips - 1) * gap;
    const x0 = s.x - total / 2, y = s.y - yOff;
    roundRectPath(ctx, x0 - 3, y - 3, total + 6, h + 6, 4);
    ctx.fillStyle = 'rgba(0, 10, 20, 0.45)';
    ctx.fill();
    for (let i = 0; i < pips; i++) {
      const px = x0 + i * (w + gap);
      roundRectPath(ctx, px, y, w, h, 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fill();
      const fill = clamp((s.hp / n) * pips - i, 0, 1);
      if (fill > 0) {
        roundRectPath(ctx, px, y, w * fill, h, Math.min(2, w * fill * 0.5));
        ctx.fillStyle = boss ? '#ff3b5c' : '#ffb347';
        ctx.fill();
      }
    }
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of G.floaters) {
      const t = f.life / f.max;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.font = `800 ${f.size}px Outfit, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 10, 20, 0.6)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawCrosshair() {
    const { x, y } = mouse;
    const r = 13;
    const ready = G && G.player.cooldown <= 0;
    ctx.save();
    ctx.strokeStyle = ready ? 'rgba(62, 242, 255, 0.95)' : 'rgba(62, 242, 255, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
      ctx.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shake > 0.2) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawOcean();

    if (G) {
      drawFoam();
      drawWrecks();
      drawPickups();

      if (G.boss) {
        const b = G.boss, pulse = 0.5 + 0.5 * Math.sin(oceanT * 3);
        const g = ctx.createRadialGradient(b.x, b.y, 10, b.x, b.y, 140);
        g.addColorStop(0, `rgba(255, 40, 80, ${0.12 + 0.08 * pulse})`);
        g.addColorStop(1, 'rgba(255, 40, 80, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, 140, 0, TAU); ctx.fill();
      }

      for (const e of G.enemies) drawShip(ctx, e, oceanT);
      if (G.boss) drawShip(ctx, G.boss, oceanT);

      const p = G.player;
      if (p.alive) {
        if (p.invuln > 0) {
          ctx.strokeStyle = `rgba(62, 242, 255, ${0.25 + 0.2 * Math.sin(oceanT * 20)})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 44, 0, TAU); ctx.stroke();
          if (Math.floor(oceanT * 14) % 2 === 0) ctx.globalAlpha = 0.45;
        }
        drawShip(ctx, p, oceanT);
        ctx.globalAlpha = 1;
        drawPlayerOverlays(p);
      }

      drawTorpedoes();
      drawBullets();
      drawLance();
      drawShells();
      drawParticles();
      for (const e of G.enemies) drawPips(e, 36);
      if (G.boss) drawPips(G.boss, 48);
      drawFloaters();
    }
    ctx.restore();

    if ((state === 'playing' || state === 'dying') && mouse.active && !touch.used) drawCrosshair();
  }

  /* =========================================================
     Game flow
     ========================================================= */
  function show(el, visible) { el.classList.toggle('hidden', !visible); }

  function startGame() {
    newGame();
    state = 'playing';
    show(ui.start, false);
    show(ui.over, false);
    show(ui.pause, false);
    show(ui.hud, true);
    document.body.classList.add('playing');
    showBanner('WAVE 1', `Sink ${CONFIG.killsPerBoss} ships to draw out the Dreadnought`);
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      show(ui.pause, true);
      document.body.classList.remove('playing');
      mouse.down = false;
    } else if (state === 'paused') {
      state = 'playing';
      show(ui.pause, false);
      document.body.classList.add('playing');
    }
  }

  function gameOver() {
    state = 'over';
    const best = getBest();
    const isBest = G.score > best;
    if (isBest) localStorage.setItem(BEST_KEY, String(G.score));
    ui.finalScore.textContent = G.score.toLocaleString();
    ui.finalBest.textContent = Math.max(best, G.score).toLocaleString();
    ui.finalKills.textContent = G.kills;
    ui.finalBosses.textContent = G.bossesDefeated;
    show(ui.newBest, isBest && G.score > 0);
    show(ui.hud, false);
    show(ui.over, true);
    document.body.classList.remove('playing', 'low-hp');
  }

  function toMenu() {
    state = 'menu';
    G = null;
    show(ui.pause, false);
    show(ui.over, false);
    show(ui.hud, false);
    show(ui.start, true);
    document.body.classList.remove('playing', 'low-hp');
    ui.banner.classList.remove('show');
    ui.menuBest.textContent = getBest().toLocaleString();
  }

  $('start-btn').addEventListener('click', startGame);
  $('restart-btn').addEventListener('click', startGame);
  $('resume-btn').addEventListener('click', togglePause);
  $('pause-btn').addEventListener('click', togglePause);
  $('quit-btn').addEventListener('click', toMenu);
  $('menu-btn').addEventListener('click', toMenu);

  /* =========================================================
     Main loop
     ========================================================= */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state !== 'paused') {
      oceanT += dt;
      if (G && (state === 'playing' || state === 'dying' || state === 'over')) update(dt);
      shake *= Math.exp(-dt * 7);
    }
    render();
    requestAnimationFrame(frame);
  }

  renderLegendIcons();
  ui.menuBest.textContent = getBest().toLocaleString();
  requestAnimationFrame(frame);
})();
