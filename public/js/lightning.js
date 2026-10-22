// Lightning tracker: every flash in the last 30 minutes within 200 miles,
// colored by age, with range rings and a nearest-strike safety status, in the
// spirit of WeatherBug's Spark lightning map.
// Data: NOAA GOES-19 Geostationary Lightning Mapper via our Netlify Function
// (/api/lightning, see netlify/functions/lightning.mjs).

import { loadLeaflet, addBasemap } from './basemap.js';

const API = '/api/lightning';
const RADIUS_MI = 200;
const RINGS_MI = [10, 30, 100, 200];
const REFRESH_MS = 60 * 1000;
const REPLAY_MS = 10000;
const METERS_PER_MILE = 1609.344;

// Age buckets (minutes) -> color. Newest strikes are drawn as bolts.
export const AGE_BUCKETS = [
  { max: 5, color: '#ffffff', glow: '#ffe14d', label: '0–5 min' },
  { max: 10, color: '#ffe14d', glow: null, label: '5–10 min' },
  { max: 20, color: '#ff9f1c', glow: null, label: '10–20 min' },
  { max: 30, color: '#e63946', glow: null, label: '20–30 min' },
];

const $ = (id) => document.getElementById(id);

export function milesBetween(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

function compass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function bucketFor(ageMin) {
  return AGE_BUCKETS.find((b) => ageMin < b.max) || AGE_BUCKETS[AGE_BUCKETS.length - 1];
}

function agoText(sec) {
  if (sec < 60) return 'just now';
  const m = Math.round(sec / 60);
  return `${m} min ago`;
}

// Canvas layer that draws thousands of strikes quickly.
function makeStrikeLayer(L) {
  const StrikeLayer = L.Layer.extend({
    initialize() {
      this._strikes = [];
      this._shift = 0; // seconds subtracted from each age (used by replay)
      this._hideOlderThan = Infinity;
    },
    onAdd(map) {
      this._map = map;
      const pane = map.getPane('strikes') || map.createPane('strikes');
      pane.style.zIndex = 450;
      pane.style.pointerEvents = 'none';
      this._canvas = L.DomUtil.create('canvas', 'strike-canvas', pane);
      this._ctx = this._canvas.getContext('2d');
      map.on('moveend zoomend resize viewreset', this._reset, this);
      map.on('zoomstart', this._hide, this);
      this._reset();
    },
    onRemove(map) {
      map.off('moveend zoomend resize viewreset', this._reset, this);
      map.off('zoomstart', this._hide, this);
      this._canvas.remove();
    },
    setStrikes(strikes) {
      this._strikes = strikes;
      this._draw();
    },
    setReplay(shiftSec, hideOlderThanSec) {
      this._shift = shiftSec;
      this._hideOlderThan = hideOlderThanSec;
      this._draw();
    },
    _hide() { this._canvas.style.visibility = 'hidden'; },
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
      this._draw();
    },
    _draw() {
      if (!this._map) return;
      const ctx = this._ctx;
      const size = this._map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);
      // oldest first so the newest end up on top
      for (let i = this._strikes.length - 1; i >= 0; i--) {
        const s = this._strikes[i];
        if (s.age > this._hideOlderThan) continue;
        const age = s.age - this._shift;
        if (age < 0) continue;
        const p = this._map.latLngToContainerPoint([s.lat, s.lon]);
        if (p.x < -10 || p.y < -10 || p.x > size.x + 10 || p.y > size.y + 10) continue;
        const b = bucketFor(age / 60);
        if (age < 300) drawBolt(ctx, p.x, p.y, b, age < 60 ? 1.25 : 1);
        else drawDot(ctx, p.x, p.y, b.color, age);
      }
    },
  });
  return new StrikeLayer();
}

function drawDot(ctx, x, y, color, ageSec) {
  ctx.globalAlpha = ageSec > 1200 ? 0.75 : 0.9;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBolt(ctx, x, y, bucket, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = bucket.glow || bucket.color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(1.5, -9); ctx.lineTo(-4.5, 1); ctx.lineTo(-0.5, 1); ctx.lineTo(-2, 9);
  ctx.lineTo(4.5, -2); ctx.lineTo(0.5, -2); ctx.lineTo(2.5, -9); ctx.closePath();
  ctx.fillStyle = bucket.color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.stroke();
  ctx.restore();
}

class LightningTracker {
  constructor() {
    this.map = null;
    this.location = null;
    this.strikes = [];
    this.fetchedAt = 0;
    this.timer = 0;
    this.replaying = false;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async init(location) {
    const L = await loadLeaflet();
    this.L = L;
    this.map = L.map('lightning-map', { minZoom: 4, maxZoom: 12, scrollWheelZoom: false, zoomSnap: 0.25 });
    this.map.on('focus', () => this.map.scrollWheelZoom.enable());
    this.map.on('blur', () => this.map.scrollWheelZoom.disable());
    addBasemap(this.map, { style: 'night' });
    this.map.attributionControl.addAttribution('Lightning: NOAA GOES-19 GLM');

    this.rings = L.layerGroup().addTo(this.map);
    this.strikeLayer = makeStrikeLayer(L).addTo(this.map);
    this.marker = L.circleMarker([0, 0], { radius: 7, color: '#ffffff', weight: 2.5, fillColor: '#cc0000', fillOpacity: 1, pane: 'markerPane' });

    $('lightning-replay').addEventListener('click', () => this.replay());
    if (this.reduced) $('lightning-replay').hidden = true;
    this.setLocation(location);
    setInterval(() => this.updateClock(), 5000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - this.fetchedAt > REFRESH_MS) this.load();
    });
  }

  setLocation(location) {
    this.location = location;
    if (!this.map) return;
    const L = this.L;
    const ll = [location.latitude, location.longitude];
    this.map.setView(ll, 6, { animate: false }); // layers need a view before they can be added
    this.rings.clearLayers();
    let outer;
    RINGS_MI.forEach((mi) => {
      const ring = L.circle(ll, {
        radius: mi * METERS_PER_MILE,
        className: `range-ring${mi === RADIUS_MI ? ' is-outer' : ''}${mi === 10 ? ' is-danger' : ''}`,
        fill: false,
        interactive: false,
      }).addTo(this.rings);
      if (mi === RADIUS_MI) outer = ring;
      L.marker([location.latitude + mi / 69.05, location.longitude], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'ring-label', html: `<span>${mi} mi</span>`, iconSize: [48, 16], iconAnchor: [24, 8] }),
      }).addTo(this.rings);
    });
    this.marker.setLatLng(ll).addTo(this.map);
    this.map.fitBounds(outer.getBounds(), { padding: [8, 8], animate: false });
    this.strikes = [];
    this.strikeLayer.setStrikes([]);
    this.load();
  }

  async load() {
    clearTimeout(this.timer);
    const loc = this.location;
    const qLat = Math.round(loc.latitude * 2) / 2;
    const qLon = Math.round(loc.longitude * 2) / 2;
    this.setStatus('loading', 'Checking for lightning…', '');
    try {
      const res = await fetch(`${API}?lat=${qLat}&lon=${qLon}`);
      const type = res.headers.get('content-type') || '';
      if (!type.includes('json')) throw new Error('not-deployed');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (loc !== this.location) return;
      const serverAgeOffset = Math.max(0, (Date.now() - Date.parse(body.generated)) / 1000);
      this.strikes = body.flashes
        .map(([lat, lon, age]) => {
          const dist = milesBetween(loc.latitude, loc.longitude, lat, lon);
          return { lat, lon, age: age + serverAgeOffset, dist };
        })
        .filter((s) => s.dist <= RADIUS_MI && s.age <= 30 * 60);
      this.fetchedAt = Date.now();
      this.latestData = body.latestData ? Date.parse(body.latestData) : null;
      this.partial = body.partial;
      if (!this.replaying) this.strikeLayer.setStrikes(this.strikes);
      this.renderStats();
    } catch (err) {
      if (err.message !== 'not-deployed') console.error(err);
      if (err.message === 'not-deployed') {
        this.setStatus('error', 'Lightning data isn’t available here', 'The tracker uses this site’s Netlify Function, so it works on the deployed Netlify site (or with `netlify dev`).');
      } else {
        this.setStatus('error', 'Couldn’t load lightning data', 'We’ll try again in a minute.');
      }
      $('lightning-stats').replaceChildren();
    } finally {
      this.timer = setTimeout(() => { if (!document.hidden) this.load(); }, REFRESH_MS);
    }
  }

  setStatus(level, title, text) {
    const box = $('lightning-status');
    box.dataset.level = level;
    $('lightning-status-title').textContent = title;
    $('lightning-status-text').textContent = text;
  }

  renderStats() {
    const s = this.strikes;
    const loc = this.location;
    const nearest = s.reduce((best, x) => (!best || x.dist < best.dist ? x : best), null);
    const recentNear = (mi, sec) => s.filter((x) => x.dist <= mi && x.age <= sec).length;

    if (!nearest) {
      this.setStatus('clear', 'No lightning within 200 miles', 'Nothing detected in the last 30 minutes.');
    } else {
      const dir = compass(bearing(loc.latitude, loc.longitude, nearest.lat, nearest.lon));
      const dist = nearest.dist < 1 ? 'less than 1 mi' : `${Math.round(nearest.dist)} mi ${dir}`;
      const where = `Nearest strike ${dist}, ${agoText(nearest.age)}.`;
      if (recentNear(10, 30 * 60) > 0) {
        this.setStatus('danger', 'Lightning within 10 miles: get indoors now', `${where} If you can hear thunder, you’re close enough to be struck. Wait 30 minutes after the last strike.`);
      } else if (recentNear(30, 30 * 60) > 0) {
        this.setStatus('warning', 'Lightning within 30 miles', `${where} Storms can move in fast. Be ready to head inside.`);
      } else {
        this.setStatus('watch', 'Lightning in the area', where);
      }
    }

    const tiles = [
      ['Within 10 mi', recentNear(10, 1800)],
      ['Within 30 mi', recentNear(30, 1800)],
      ['Within 100 mi', recentNear(100, 1800)],
      ['Within 200 mi', s.length],
      ['Last 5 min', s.filter((x) => x.age <= 300).length],
      ['Last 15 min', s.filter((x) => x.age <= 900).length],
    ];
    $('lightning-stats').replaceChildren(...tiles.map(([k, v]) => {
      const wrap = document.createElement('div');
      wrap.className = 'detail';
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v.toLocaleString('en-US');
      wrap.append(dt, dd);
      return wrap;
    }));
    this.updateClock();
  }

  updateClock() {
    if (!this.fetchedAt) return;
    const sec = Math.round((Date.now() - this.fetchedAt) / 1000);
    const dataAge = this.latestData ? Math.round((Date.now() - this.latestData) / 60000) : null;
    const parts = [`Updated ${sec < 10 ? 'just now' : `${sec}s ago`}`, 'refreshes every minute'];
    if (dataAge !== null) parts.push(`newest satellite data ${dataAge <= 1 ? 'about 1 min' : `${dataAge} min`} old`);
    if (this.partial) parts.push('some files still loading');
    $('lightning-updated').textContent = `${parts.join(' · ')}.`;
  }

  replay() {
    if (this.replaying || !this.strikes.length) return;
    this.replaying = true;
    const btn = $('lightning-replay');
    btn.disabled = true;
    const label = $('lightning-replay-time');
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / REPLAY_MS);
      const cursorAgo = (1 - t) * 30 * 60; // seconds before now
      this.strikeLayer.setReplay(cursorAgo, Infinity);
      label.textContent = cursorAgo < 30 ? 'Now' : `−${Math.ceil(cursorAgo / 60)} min`;
      label.hidden = false;
      if (t < 1) requestAnimationFrame(frame);
      else {
        this.replaying = false;
        btn.disabled = false;
        label.hidden = true;
        this.strikeLayer.setReplay(0, Infinity);
        this.strikeLayer.setStrikes(this.strikes);
      }
    };
    requestAnimationFrame(frame);
  }
}

const tracker = new LightningTracker();
let started = false;
let pending = null;

export function initLightning(location) {
  pending = location;
  const start = () => {
    if (started) return;
    started = true;
    tracker.init(pending).catch((err) => {
      console.error(err);
      $('lightning-status-title').textContent = 'The lightning map couldn’t load.';
    });
  };
  if (!('IntersectionObserver' in window)) { start(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
  }, { rootMargin: '400px 0px' });
  io.observe($('lightning'));
}

export function setLightningLocation(location) {
  pending = location;
  const cur = tracker.location;
  const same = cur && cur.latitude === location.latitude && cur.longitude === location.longitude;
  if (tracker.map && !same) tracker.setLocation(location);
}
