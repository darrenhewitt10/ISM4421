// 12-hour animated radar loop.
// Radar: NEXRAD high-resolution base reflectivity mosaic (N0Q, downscaled from
// super-res N0B) from the Iowa Environmental Mesonet tile service. Archived
// frames are available every 5 minutes: ridge::USCOMP-N0Q-YYYYMMDDHHMI (UTC).
// Basemap: our own (js/basemap.js, Natural Earth data). Leaflet is loaded on demand.

import { loadLeaflet, addBasemap } from './basemap.js';

export { loadLeaflet };

const TILE_URL = 'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0Q-{stamp}/{z}/{x}/{y}.png';

const HOURS = 12;
const STEP_MIN = 15;
const LAG_MIN = 10;         // newest mosaic usually posts within ~5-10 minutes
const FRAME_MS = 450;       // animation speed
const HOLD_MS = 1600;       // pause on the newest frame before looping
const OPACITY = 0.8;
const PRELOAD_AHEAD = 4;    // frames kept loading ahead of the one on screen
const CONUS = { south: 23, north: 50.5, west: -126, east: -65 };

const $ = (id) => document.getElementById(id);

// UTC stamp like 202610221705 for a time that is a multiple of 5 minutes.
const stamp = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 12);

export function frameTimes(now = Date.now()) {
  const five = 5 * 60 * 1000;
  const latest = Math.floor((now - LAG_MIN * 60 * 1000) / five) * five;
  const count = (HOURS * 60) / STEP_MIN;
  return Array.from({ length: count + 1 }, (_, i) => latest - (count - i) * STEP_MIN * 60 * 1000);
}

class RadarLoop {
  constructor() {
    this.map = null;
    this.marker = null;
    this.times = [];
    this.layers = new Map(); // stamp -> { layer, loaded }
    this.index = 0;
    this.playing = false;
    this.timer = 0;
    this.waited = 0;
    this.timeZone = 'America/New_York';
    this.location = null;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async init(location) {
    const L = await loadLeaflet();
    this.L = L;
    this.map = L.map('radar-map', {
      zoomControl: true,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 11,
      scrollWheelZoom: false, // don't hijack page scrolling; pinch / buttons / double-click still zoom
      worldCopyJump: true,
    });
    this.map.on('focus', () => this.map.scrollWheelZoom.enable());
    this.map.on('blur', () => this.map.scrollWheelZoom.disable());


    addBasemap(this.map, { style: 'day' });
    this.map.attributionControl.addAttribution('Radar &copy; <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a> / NWS NEXRAD');

    this.marker = L.circleMarker([0, 0], { radius: 7, color: '#ffffff', weight: 2.5, fillColor: '#cc0000', fillOpacity: 1 });
    this.setLocation(location);

    this.bindControls();
    this.refreshTimes();
    this.show(this.times.length - 1);
    if (!this.reduced) this.play();

    // New frames arrive every 5 minutes; refresh the time list periodically.
    setInterval(() => this.refreshTimes(), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playing) { this.pause(); this.resumeOnVisible = true; }
      else if (!document.hidden && this.resumeOnVisible) { this.resumeOnVisible = false; this.play(); }
    });
  }

  setLocation(location, timeZone) {
    if (timeZone) this.timeZone = timeZone;
    this.location = location;
    if (!this.map) return;
    const ll = [location.latitude, location.longitude];
    this.map.setView(ll, 7, { animate: false });
    this.marker.setLatLng(ll).bindTooltip(location.name).addTo(this.map);
    const inside = location.latitude >= CONUS.south && location.latitude <= CONUS.north
      && location.longitude >= CONUS.west && location.longitude <= CONUS.east;
    $('radar-note').textContent = inside
      ? ''
      : 'Heads up: this radar covers the continental U.S. only, so there may be no data for this location.';
    this.updateLabel();
  }

  refreshTimes() {
    const wasLatest = this.index >= this.times.length - 1;
    const current = this.times[this.index];
    this.times = frameTimes();
    const keep = new Set(this.times.map(stamp));
    for (const [key, entry] of this.layers) {
      if (!keep.has(key)) { entry.layer.remove(); this.layers.delete(key); }
    }
    const slider = $('radar-slider');
    slider.max = String(this.times.length - 1);
    const idx = wasLatest ? this.times.length - 1 : Math.max(0, this.times.indexOf(current));
    if (this.map) this.show(idx < 0 ? this.times.length - 1 : idx);
  }

  layerFor(i) {
    const key = stamp(this.times[i]);
    let entry = this.layers.get(key);
    if (!entry) {
      const layer = this.L.tileLayer(TILE_URL, {
        stamp: key,
        opacity: 0,
        maxNativeZoom: 10,
        maxZoom: 11,
        zIndex: 300,
        updateWhenIdle: true,
        keepBuffer: 1,
        className: 'radar-frame',
      });
      entry = { layer, loaded: false };
      layer.on('loading', () => { entry.loaded = false; });
      layer.on('load', () => { entry.loaded = true; });
      this.layers.set(key, entry);
    }
    return entry;
  }

  // Keep only the visible frame and the next few frames attached to the map.
  syncWindow(i) {
    const want = new Set();
    for (let k = 0; k <= PRELOAD_AHEAD; k++) want.add(stamp(this.times[(i + k) % this.times.length]));
    for (const [key, entry] of this.layers) {
      if (!want.has(key) && this.map.hasLayer(entry.layer)) entry.layer.remove();
    }
    for (const key of want) {
      const idx = this.times.findIndex((t) => stamp(t) === key);
      const entry = this.layerFor(idx);
      if (!this.map.hasLayer(entry.layer)) entry.layer.addTo(this.map);
    }
  }

  show(i) {
    this.index = i;
    this.syncWindow(i);
    const key = stamp(this.times[i]);
    for (const [k, entry] of this.layers) entry.layer.setOpacity(k === key ? OPACITY : 0);
    $('radar-slider').value = String(i);
    this.updateLabel();
  }

  updateLabel() {
    const t = this.times[this.index];
    if (!t) return;
    const fmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: this.timeZone, timeZoneName: 'short',
    });
    let label;
    try { label = fmt.format(t); } catch { label = new Date(t).toLocaleString(); }
    const ago = Math.round((Date.now() - t) / 60000);
    const rel = ago < 60 ? `${ago} min ago` : `${Math.floor(ago / 60)} hr ${ago % 60 ? `${ago % 60} min ` : ''}ago`;
    $('radar-time').textContent = `${label} · ${rel}`;
    $('radar-slider').setAttribute('aria-valuetext', `${label}, ${rel}`);
  }

  step(delta) {
    const n = this.times.length;
    this.show((this.index + delta + n) % n);
  }

  tick() {
    const n = this.times.length;
    const next = (this.index + 1) % n;
    const entry = this.layerFor(next);
    // Wait (briefly) for the next frame's tiles so the loop doesn't flash blank frames.
    if (!entry.loaded && this.waited < 6) {
      this.waited++;
      this.timer = setTimeout(() => this.tick(), FRAME_MS / 2);
      return;
    }
    this.waited = 0;
    this.show(next);
    this.timer = setTimeout(() => this.tick(), next === n - 1 ? HOLD_MS : FRAME_MS);
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.setPlayButton();
    this.timer = setTimeout(() => this.tick(), FRAME_MS);
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.setPlayButton();
  }

  setPlayButton() {
    const btn = $('radar-play');
    btn.setAttribute('aria-label', this.playing ? 'Pause radar loop' : 'Play radar loop');
    btn.classList.toggle('is-playing', this.playing);
  }

  bindControls() {
    $('radar-play').addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    $('radar-prev').addEventListener('click', () => { this.pause(); this.step(-1); });
    $('radar-next').addEventListener('click', () => { this.pause(); this.step(1); });
    $('radar-latest').addEventListener('click', () => { this.pause(); this.show(this.times.length - 1); });
    $('radar-slider').addEventListener('input', (e) => { this.pause(); this.show(Number(e.target.value)); });
  }
}

const radar = new RadarLoop();
let pendingLocation = null;
let pendingTimeZone = null;
let started = false;

// Start the map only when the radar section is about to scroll into view.
export function initRadar(location) {
  pendingLocation = location;
  const section = $('radar');
  const start = () => {
    if (started) return;
    started = true;
    radar.init(pendingLocation).then(() => {
      if (pendingTimeZone) radar.setLocation(pendingLocation, pendingTimeZone);
    }).catch((err) => {
      console.error(err);
      $('radar-note').textContent = 'The radar map couldn’t load. Check your connection and refresh.';
    });
  };
  if (!('IntersectionObserver' in window)) { start(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
  }, { rootMargin: '400px 0px' });
  io.observe(section);
}

export function setRadarLocation(location, timeZone) {
  pendingLocation = location;
  pendingTimeZone = timeZone || pendingTimeZone;
  if (radar.map) radar.setLocation(location, timeZone);
}
