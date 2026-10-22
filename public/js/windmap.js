// Animated wind map: particles flowing with the 10 m wind over our basemap.
// Wind comes from one Open-Meteo request for a grid of points (the API accepts
// comma-separated coordinates), interpolated bilinearly between grid points.
// Time steps: now and the next 24 hours.

import { loadLeaflet, addBasemap } from './basemap.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const GRID = 9;            // 9 x 9 points
const SPAN_LAT = 3.6;      // degrees from the center (about 250 miles)
const SPAN_LON = 4.2;
const CACHE_KEY = 'fau-owl-weather-windgrid';
const CACHE_MS = 20 * 60 * 1000;
const STEPS = [0, 3, 6, 12, 24]; // hours ahead

// Speed color ramp (mph)
export const WIND_COLORS = [
  [0, '#7cc8ff'], [5, '#5fd3c6'], [10, '#8be07e'], [15, '#f2e35b'], [20, '#ffb547'], [30, '#ff6b5b'], [40, '#e05cff'],
];

const $ = (id) => document.getElementById(id);

function colorFor(mph) {
  let c = WIND_COLORS[0][1];
  for (const [v, col] of WIND_COLORS) if (mph >= v) c = col;
  return c;
}

function compass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function gridPoints(lat, lon) {
  const lats = Array.from({ length: GRID }, (_, i) => +(lat - SPAN_LAT + (2 * SPAN_LAT * i) / (GRID - 1)).toFixed(3));
  const lons = Array.from({ length: GRID }, (_, j) => +(lon - SPAN_LON + (2 * SPAN_LON * j) / (GRID - 1)).toFixed(3));
  return { lats, lons };
}

async function fetchGrid(location) {
  const cLat = Math.round(location.latitude * 4) / 4;
  const cLon = Math.round(location.longitude * 4) / 4;
  const key = `${cLat},${cLon}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.grid;
  } catch { /* ignore */ }
  const { lats, lons } = gridPoints(cLat, cLon);
  const la = [];
  const lo = [];
  lats.forEach((y) => lons.forEach((x) => { la.push(y); lo.push(x); }));
  const params = new URLSearchParams({
    latitude: la.join(','),
    longitude: lo.join(','),
    current: 'wind_speed_10m,wind_direction_10m',
    hourly: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'mph',
    forecast_hours: '25',
    timezone: 'auto',
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Wind grid: HTTP ${res.status}`);
  const list = await res.json();
  const arr = Array.isArray(list) ? list : [list];
  if (arr.length !== GRID * GRID || !arr[0]?.hourly?.wind_speed_10m) throw new Error('Wind grid: unexpected response');
  // speed/direction per time step, per grid point
  const steps = STEPS.map((h) => arr.map((p) => (h === 0
    ? [p.current.wind_speed_10m, p.current.wind_direction_10m]
    : [p.hourly.wind_speed_10m[h], p.hourly.wind_direction_10m[h]])));
  const times = STEPS.map((h) => (h === 0 ? arr[0].current.time : arr[0].hourly.time[h]));
  const grid = { lats, lons, steps, times };
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ key, at: Date.now(), grid })); } catch { /* ignore */ }
  return grid;
}

// Bilinear interpolation of (u, v) in mph at a lat/lon, or null outside the grid.
function makeField(grid, step) {
  const { lats, lons } = grid;
  const uv = grid.steps[step].map(([speed, dir]) => {
    const r = (dir * Math.PI) / 180;
    return [-speed * Math.sin(r), -speed * Math.cos(r)]; // toward which the wind blows (east, north)
  });
  const at = (i, j) => uv[i * GRID + j];
  return (lat, lon) => {
    const fi = ((lat - lats[0]) / (lats[GRID - 1] - lats[0])) * (GRID - 1);
    const fj = ((lon - lons[0]) / (lons[GRID - 1] - lons[0])) * (GRID - 1);
    if (fi < 0 || fj < 0 || fi > GRID - 1 || fj > GRID - 1) return null;
    const i = Math.min(Math.floor(fi), GRID - 2);
    const j = Math.min(Math.floor(fj), GRID - 2);
    const ti = fi - i;
    const tj = fj - j;
    const a = at(i, j); const b = at(i, j + 1); const c = at(i + 1, j); const d = at(i + 1, j + 1);
    if (!a || !b || !c || !d) return null;
    const u = (a[0] * (1 - tj) + b[0] * tj) * (1 - ti) + (c[0] * (1 - tj) + d[0] * tj) * ti;
    const v = (a[1] * (1 - tj) + b[1] * tj) * (1 - ti) + (c[1] * (1 - tj) + d[1] * tj) * ti;
    return [u, v];
  };
}

function makeFlowLayer(L) {
  const Flow = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      const pane = map.getPane('wind') || map.createPane('wind');
      pane.style.zIndex = 420;
      pane.style.pointerEvents = 'none';
      this._canvas = L.DomUtil.create('canvas', 'wind-canvas', pane);
      this._ctx = this._canvas.getContext('2d');
      this._particles = [];
      map.on('movestart zoomstart', this._pause, this);
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
    },
    onRemove(map) {
      map.off('movestart zoomstart', this._pause, this);
      map.off('moveend zoomend resize', this._reset, this);
      cancelAnimationFrame(this._raf);
      this._canvas.remove();
    },
    setField(field) {
      this._field = field;
      this._reset();
    },
    setRunning(on) {
      this._running = on;
      if (on) this._loop();
      else cancelAnimationFrame(this._raf);
    },
    _pause() {
      cancelAnimationFrame(this._raf);
      this._canvas.style.visibility = 'hidden';
    },
    _reset() {
      const map = this._map;
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint([0, 0]));
      this._canvas.width = Math.round(size.x * dpr);
      this._canvas.height = Math.round(size.y * dpr);
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._canvas.style.visibility = 'visible';
      this._size = size;
      const n = Math.min(1600, Math.round((size.x * size.y) / 260));
      this._particles = Array.from({ length: n }, () => this._spawn({}));
      this._ctx.clearRect(0, 0, size.x, size.y);
      if (this._running) this._loop();
      else this._drawStatic();
    },
    _spawn(p) {
      p.x = Math.random() * this._size.x;
      p.y = Math.random() * this._size.y;
      p.age = Math.floor(Math.random() * 80);
      return p;
    },
    _velocity(x, y) {
      if (!this._field) return null;
      const ll = this._map.containerPointToLatLng([x, y]);
      return this._field(ll.lat, ll.lng);
    },
    _loop() {
      cancelAnimationFrame(this._raf);
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        this._frame(dt);
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    },
    _frame(dt) {
      const ctx = this._ctx;
      const { x: w, y: h } = this._size;
      // fade old trails
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      const scale = 3.2; // px per second per mph
      for (const p of this._particles) {
        const uv = this._velocity(p.x, p.y);
        if (!uv || p.age > 100) { this._spawn(p); p.age = 0; continue; }
        const speed = Math.hypot(uv[0], uv[1]);
        const nx = p.x + uv[0] * scale * dt;
        const ny = p.y - uv[1] * scale * dt;
        ctx.strokeStyle = colorFor(speed);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        p.x = nx; p.y = ny; p.age++;
        if (nx < 0 || ny < 0 || nx > w || ny > h) this._spawn(p);
      }
    },
    // Reduced motion: short static streamlines instead of animation
    _drawStatic() {
      const ctx = this._ctx;
      ctx.lineWidth = 1.4;
      for (const p of this._particles.slice(0, 500)) {
        let { x, y } = p;
        ctx.beginPath();
        ctx.moveTo(x, y);
        let speed = 0;
        for (let k = 0; k < 8; k++) {
          const uv = this._velocity(x, y);
          if (!uv) break;
          speed = Math.hypot(uv[0], uv[1]);
          x += uv[0] * 0.25; y -= uv[1] * 0.25;
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = colorFor(speed);
        ctx.stroke();
      }
    },
  });
  return new Flow();
}

class WindMap {
  constructor() {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.step = 0;
    this.grid = null;
    this.location = null;
  }

  async init(location) {
    const L = await loadLeaflet();
    this.L = L;
    this.map = L.map('wind-map', { minZoom: 5, maxZoom: 10, scrollWheelZoom: false, zoomSnap: 0.25 });
    this.map.on('focus', () => this.map.scrollWheelZoom.enable());
    this.map.on('blur', () => this.map.scrollWheelZoom.disable());
    this.map.setView([location.latitude, location.longitude], 6);
    addBasemap(this.map, { style: 'night' });
    this.map.attributionControl.addAttribution('Wind: Open-Meteo');
    this.flow = makeFlowLayer(L).addTo(this.map);
    this.arrows = L.layerGroup().addTo(this.map);
    this.marker = L.circleMarker([0, 0], { radius: 7, color: '#ffffff', weight: 2.5, fillColor: '#cc0000', fillOpacity: 1, pane: 'markerPane' });

    document.querySelectorAll('#wind-steps button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.step = Number(btn.dataset.step);
        document.querySelectorAll('#wind-steps button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        this.apply();
      });
    });
    const io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.syncRunning(); });
    io.observe($('wind-map'));
    document.addEventListener('visibilitychange', () => this.syncRunning());
    await this.setLocation(location);
  }

  syncRunning() {
    if (!this.flow) return;
    this.flow.setRunning(Boolean(this.visible && !document.hidden && !this.reduced && this.grid));
  }

  async setLocation(location) {
    this.location = location;
    if (!this.map) return;
    const ll = [location.latitude, location.longitude];
    this.marker.setLatLng(ll).bindTooltip(location.name).addTo(this.map);
    $('wind-map-note').textContent = 'Loading wind…';
    try {
      this.grid = await fetchGrid(location);
      if (location !== this.location) return;
      const { lats, lons } = this.grid;
      this.map.fitBounds([[lats[1], lons[1]], [lats[GRID - 2], lons[GRID - 2]]], { animate: false });
      this.map.setMaxBounds([[lats[0] - 1, lons[0] - 1], [lats[GRID - 1] + 1, lons[GRID - 1] + 1]]);
      this.apply();
      $('wind-map-note').textContent = '';
    } catch (err) {
      console.error(err);
      $('wind-map-note').textContent = 'Wind data is unavailable right now.';
    }
  }

  apply() {
    if (!this.grid) return;
    const L = this.L;
    this.flow.setField(makeField(this.grid, this.step));
    this.syncRunning();
    // labeled arrows at every other grid point
    this.arrows.clearLayers();
    const { lats, lons } = this.grid;
    const data = this.grid.steps[this.step];
    for (let i = 0; i < GRID; i += 2) {
      for (let j = 0; j < GRID; j += 2) {
        const [speed, dir] = data[i * GRID + j];
        if (!Number.isFinite(speed)) continue;
        const icon = L.divIcon({ className: 'wind-arrow', html: '<b></b><span></span>', iconSize: [36, 36], iconAnchor: [18, 18] });
        const m = L.marker([lats[i], lons[j]], { icon, interactive: false, keyboard: false }).addTo(this.arrows);
        const node = m.getElement();
        node.querySelector('b').style.transform = `rotate(${(dir + 180) % 360}deg)`;
        node.querySelector('span').textContent = Math.round(speed);
        node.title = `${Math.round(speed)} mph from ${compass(dir)}`;
      }
    }
    const t = this.grid.times[this.step];
    const [, hm] = (t || '').split('T');
    if (hm) {
      const [hh, mm] = hm.split(':').map(Number);
      $('wind-map-time').textContent = `${this.step === 0 ? 'Now' : `+${STEPS[this.step]} h`} · ${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
    }
  }
}

const windMap = new WindMap();
let started = false;
let pending = null;

export function initWindMap(location) {
  pending = location;
  const start = () => {
    if (started) return;
    started = true;
    windMap.init(pending).catch((err) => {
      console.error(err);
      $('wind-map-note').textContent = 'The wind map couldn’t load.';
    });
  };
  if (!('IntersectionObserver' in window)) { start(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
  }, { rootMargin: '400px 0px' });
  io.observe($('windmap'));
}

export function setWindMapLocation(location) {
  pending = location;
  const cur = windMap.location;
  if (windMap.map && !(cur && cur.latitude === location.latitude && cur.longitude === location.longitude)) windMap.setLocation(location);
}
