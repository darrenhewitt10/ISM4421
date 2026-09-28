// Animated sky behind the main weather card. Draws on a <canvas> based on a
// "scene": { kind, isDay, intensity (0-1), wind (0-1), cloudCover (0-100) }.
// `kind` matches weather-codes.js: clear, partly, cloudy, fog, drizzle, rain, sleet, snow, thunder.

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const SKIES = {
  day: {
    clear: ['#003366', '#2272c3'],
    partly: ['#063d73', '#3a78b5'],
    cloudy: ['#24405f', '#56708f'],
    fog: ['#3b4d63', '#74869b'],
    drizzle: ['#1f344d', '#46607d'],
    rain: ['#172a40', '#3a5068'],
    sleet: ['#1f344d', '#51677f'],
    snow: ['#2d4a6d', '#7189a8'],
    thunder: ['#0c1522', '#2c3548'],
  },
  night: {
    clear: ['#010915', '#0d2a4f'],
    partly: ['#020c1c', '#123158'],
    cloudy: ['#0b1523', '#26354a'],
    fog: ['#18212e', '#3b4656'],
    drizzle: ['#0a131f', '#223245'],
    rain: ['#08101b', '#1f2c3d'],
    sleet: ['#0c1624', '#2a3a50'],
    snow: ['#13223a', '#3a4d68'],
    thunder: ['#05080f', '#1a2130'],
  },
};

// How many clouds each kind of weather gets (before scaling by width).
const CLOUDS = { clear: 0, partly: 4, cloudy: 8, fog: 3, drizzle: 7, rain: 8, sleet: 8, snow: 7, thunder: 9 };

export class SkyVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = null;
    this.w = 0;
    this.h = 0;
    this.visible = true;
    this.rafId = 0;
    this.last = 0;
    this.time = 0;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.frame = this.frame.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.sync();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.sync());
    this.reduced.addEventListener?.('change', () => this.sync());
  }

  set(scene) {
    const same = this.scene && scene && JSON.stringify(this.scene) === JSON.stringify(scene);
    if (same) return;
    this.scene = scene;
    this.build();
    this.draw();
    this.sync();
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.build();
    this.draw();
    this.sync();
  }

  // Start or stop the animation loop depending on visibility and motion preferences.
  sync() {
    const run = this.scene && this.w && this.visible && !document.hidden && !this.reduced.matches;
    if (run && !this.rafId) {
      this.last = performance.now();
      this.rafId = requestAnimationFrame(this.frame);
    } else if (!run && this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  frame(now) {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.update(dt);
    this.draw();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ---------- Setup ----------
  build() {
    const s = this.scene;
    const { w, h } = this;
    this.drops = [];
    this.flakes = [];
    this.splashes = [];
    this.clouds = [];
    this.stars = [];
    this.fog = [];
    this.flash = 0;
    this.bolt = null;
    this.nextStrike = rand(1, 3);
    if (!s || !w) return;

    const area = w * h;
    const k = s.kind;
    this.slant = 0.08 + s.wind * 0.45; // horizontal px per vertical px for falling rain

    if (!s.isDay) {
      const n = Math.round(area / 3500) * (k === 'clear' ? 1 : k === 'partly' ? 0.7 : 0.25);
      for (let i = 0; i < n; i++) {
        this.stars.push({ x: rand(0, w), y: rand(0, h * 0.75), r: rand(0.4, 1.5), phase: rand(0, 6.3), speed: rand(0.8, 2.5) });
      }
    }

    let clouds = CLOUDS[k] ?? 4;
    if (k === 'partly' && Number.isFinite(s.cloudCover)) clouds = Math.round(clamp(s.cloudCover / 15, 2, 6));
    clouds = Math.round(clouds * clamp(w / 700, 0.6, 1.4));
    for (let i = 0; i < clouds; i++) this.clouds.push(this.makeCloud(rand(-0.1 * w, w * 1.1), i / Math.max(clouds, 1)));
    this.clouds.sort((a, b) => a.scale - b.scale); // far (small) clouds first

    const rainy = { drizzle: 0.45, rain: 1, sleet: 0.6, thunder: 1.15 }[k];
    if (rainy) {
      const n = Math.min(Math.round((area / 1800) * rainy * (0.4 + s.intensity * 0.6)), 450);
      const drizzle = k === 'drizzle';
      for (let i = 0; i < n; i++) {
        this.drops.push({
          x: rand(-this.slant * h, w), y: rand(-h, h),
          len: drizzle ? rand(5, 9) : rand(12, 24),
          speed: drizzle ? rand(280, 380) : rand(620, 900),
          alpha: rand(0.25, 0.6),
        });
      }
    }

    const snowy = { snow: 1, sleet: 0.5 }[k];
    if (snowy) {
      const n = Math.min(Math.round((area / 2600) * snowy * (0.4 + s.intensity * 0.6)), 300);
      for (let i = 0; i < n; i++) {
        this.flakes.push({ x: rand(0, w), y: rand(-h, h), r: rand(1, 3.4), speed: rand(25, 70), phase: rand(0, 6.3), sway: rand(10, 30) });
      }
    }

    if (k === 'fog') {
      for (let i = 0; i < 16; i++) {
        this.fog.push({ x: rand(-0.2 * w, w * 1.2), y: rand(h * 0.25, h * 1.05), r: rand(h * 0.25, h * 0.55), speed: rand(4, 14), alpha: rand(0.12, 0.26) });
      }
    }
  }

  makeCloud(x, depth) {
    const s = this.scene;
    const scale = rand(0.55, 1.15) * clamp(this.w / 700, 0.6, 1.2);
    const puffs = [];
    const count = Math.round(rand(5, 8));
    const width = 150 * scale;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const r = (18 + Math.sin(t * Math.PI) * 18 + rand(-4, 6)) * scale;
      puffs.push({ dx: (t - 0.5) * width, dy: -Math.sin(t * Math.PI) * 14 * scale + rand(-4, 4) * scale, r });
    }
    const heavy = ['rain', 'thunder', 'sleet', 'drizzle'].includes(s.kind);
    const band = heavy ? [0.02, 0.45] : s.kind === 'partly' ? [0.12, 0.6] : [0.05, 0.55];
    return {
      x,
      y: this.h * rand(band[0], band[1]) + depth * 10,
      scale,
      width,
      puffs,
      speed: (6 + s.wind * 30) * rand(0.6, 1.3) * scale,
    };
  }

  // ---------- Animation ----------
  update(dt) {
    const s = this.scene;
    const { w, h } = this;
    this.time += dt;

    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x - c.width > w + 40) c.x = -c.width - rand(20, 120);
    }

    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x += d.speed * this.slant * dt;
      if (d.y > h) {
        if (s.kind !== 'drizzle' && this.splashes.length < 120 && Math.random() < 0.5) {
          for (let i = 0; i < 2; i++) {
            this.splashes.push({ x: d.x, y: h - 6, vx: rand(-40, 40), vy: rand(-90, -40), life: 0.35 });
          }
        }
        d.y = rand(-40, -d.len);
        d.x = rand(-this.slant * h, w);
      }
    }

    for (const p of this.splashes) {
      p.vy += 400 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.splashes = this.splashes.filter((p) => p.life > 0);

    const drift = s.wind * 40;
    for (const f of this.flakes) {
      f.y += f.speed * dt;
      f.x += (Math.sin(this.time * 1.3 + f.phase) * f.sway + drift) * dt;
      if (f.y > h + 4) { f.y = -4; f.x = rand(-20, w); }
      if (f.x > w + 10) f.x = -10;
    }

    for (const f of this.fog) {
      f.x += f.speed * dt;
      if (f.x - f.r > w) f.x = -f.r;
    }

    if (s.kind === 'thunder') {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.strike();
        this.nextStrike = Math.random() < 0.3 ? 0.15 : rand(2.5, 7) / (0.6 + s.intensity * 0.6);
      }
      this.flash = Math.max(0, this.flash - dt * 2.8);
    }
  }

  strike() {
    const { w, h } = this;
    const main = [];
    let x = rand(w * 0.15, w * 0.85);
    let y = 0;
    main.push([x, y]);
    while (y < h * rand(0.6, 0.9)) {
      x += rand(-22, 22);
      y += rand(12, 28);
      main.push([x, y]);
    }
    const branchStart = main[Math.floor(main.length * rand(0.25, 0.6))];
    const branch = [branchStart];
    let [bx, by] = branchStart;
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 5; i++) {
      bx += dir * rand(8, 22);
      by += rand(10, 22);
      branch.push([bx, by]);
    }
    this.bolt = [main, branch];
    this.flash = 1;
  }

  // ---------- Drawing ----------
  draw() {
    const { ctx, w, h, scene: s } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    if (!s) return;

    const [top, bottom] = (s.isDay ? SKIES.day : SKIES.night)[s.kind] || SKIES.day.partly;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, top);
    sky.addColorStop(1, bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    this.drawStars();
    if (s.kind === 'clear' || s.kind === 'partly') {
      if (s.isDay) this.drawSun(); else this.drawMoon();
    }
    this.drawClouds();
    this.drawFog();
    this.drawRain();
    this.drawSnow();
    this.drawLightning();
  }

  drawStars() {
    const { ctx } = this;
    for (const st of this.stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(this.time * st.speed + st.phase));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawSun() {
    const { ctx, w, h } = this;
    const x = w * 0.82;
    const y = h * 0.24;
    const r = clamp(Math.min(w, h) * 0.09, 22, 44);

    const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 5);
    glow.addColorStop(0, 'rgba(255, 214, 102, 0.55)');
    glow.addColorStop(0.35, 'rgba(255, 196, 64, 0.16)');
    glow.addColorStop(1, 'rgba(255, 196, 64, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.time * 0.15);
    ctx.strokeStyle = 'rgba(255, 213, 90, 0.55)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const pulse = 1 + 0.15 * Math.sin(this.time * 2 + i);
      ctx.lineWidth = i % 2 ? 2 : 3.5;
      ctx.beginPath();
      ctx.moveTo(r * 1.35, 0);
      ctx.lineTo(r * (i % 2 ? 1.7 : 2.05) * pulse, 0);
      ctx.stroke();
      ctx.rotate(Math.PI / 6);
    }
    ctx.restore();

    const disc = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    disc.addColorStop(0, '#fff3b0');
    disc.addColorStop(1, '#fdb813');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMoon() {
    const { ctx, w, h } = this;
    const x = w * 0.82;
    const y = h * 0.24;
    const r = clamp(Math.min(w, h) * 0.075, 18, 36);

    const glow = ctx.createRadialGradient(x, y, r, x, y, r * 4);
    glow.addColorStop(0, 'rgba(230, 236, 255, 0.28)');
    glow.addColorStop(1, 'rgba(230, 236, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#f1ecd2';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(180, 170, 140, 0.35)';
    for (const [dx, dy, cr] of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.35, -0.35, 0.1], [-0.1, 0.45, 0.09]]) {
      ctx.beginPath();
      ctx.arc(x + dx * r, y + dy * r, cr * r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawClouds() {
    const { ctx, scene: s } = this;
    const k = s.kind;
    let light;
    let dark;
    if (k === 'thunder') { light = [92, 102, 120]; dark = [40, 46, 60]; }
    else if (['rain', 'drizzle', 'sleet'].includes(k)) { light = [150, 162, 180]; dark = [82, 95, 115]; }
    else if (k === 'cloudy' || k === 'fog' || k === 'snow') { light = [228, 234, 242]; dark = [160, 174, 194]; }
    else { light = [255, 255, 255]; dark = [205, 218, 234]; }
    if (!s.isDay) {
      light = light.map((v) => Math.round(v * 0.45));
      dark = dark.map((v) => Math.round(v * 0.4));
    }
    const alpha = s.isDay ? 0.82 : 0.85;

    for (const c of this.clouds) {
      const top = c.y - 40 * c.scale;
      const bottom = c.y + 30 * c.scale;
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, `rgba(${light},${alpha})`);
      grad.addColorStop(1, `rgba(${dark},${alpha})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (const p of c.puffs) {
        ctx.moveTo(c.x + p.dx + p.r, c.y + p.dy);
        ctx.arc(c.x + p.dx, c.y + p.dy, p.r, 0, Math.PI * 2);
      }
      // flat-ish base
      ctx.rect(c.x - c.width / 2, c.y, c.width, 14 * c.scale);
      ctx.fill();
    }
  }

  drawFog() {
    const { ctx } = this;
    const tint = this.scene.isDay ? '235, 240, 247' : '150, 160, 175';
    for (const f of this.fog) {
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(${tint}, ${f.alpha})`);
      g.addColorStop(1, `rgba(${tint}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
  }

  drawRain() {
    const { ctx } = this;
    if (!this.drops.length) return;
    ctx.lineCap = 'round';
    ctx.lineWidth = this.scene.kind === 'drizzle' ? 1 : 1.3;
    for (const d of this.drops) {
      ctx.strokeStyle = `rgba(190, 215, 255, ${d.alpha})`;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * this.slant, d.y - d.len);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200, 222, 255, 0.6)';
    for (const p of this.splashes) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawSnow() {
    const { ctx } = this;
    for (const f of this.flakes) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + f.r / 7})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawLightning() {
    const { ctx, w, h } = this;
    if (this.flash <= 0) return;
    ctx.fillStyle = `rgba(220, 230, 255, ${(this.flash * 0.35).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    if (!this.bolt || this.flash < 0.35) return;
    ctx.save();
    ctx.shadowColor = 'rgba(170, 200, 255, 0.9)';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = `rgba(255, 255, 255, ${this.flash.toFixed(3)})`;
    ctx.lineJoin = 'round';
    this.bolt.forEach((path, i) => {
      ctx.lineWidth = i === 0 ? 3 : 1.6;
      ctx.beginPath();
      path.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    });
    ctx.restore();
  }
}
