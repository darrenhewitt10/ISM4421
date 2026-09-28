import { describe, icon, intensity, kind } from './weather-codes.js';
import { SkyVisualizer } from './visualizer.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

// Florida Atlantic University, Boca Raton campus.
const DEFAULT_LOCATION = {
  name: 'FAU – Boca Raton',
  region: 'Florida, United States',
  latitude: 26.3754,
  longitude: -80.1010,
};

const UNITS = {
  imperial: { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', temp: '°F', wind: 'mph', precip: 'in' },
  metric: { temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm', temp: '°C', wind: 'km/h', precip: 'mm' },
};

const STORAGE_KEY = 'fau-owl-weather';

const $ = (id) => document.getElementById(id);

const state = {
  location: DEFAULT_LOCATION,
  units: 'imperial',
  requestId: 0,
  liveScene: null,
  preview: '',
};

// Scenes for the "Sky visualizer" preview menu.
const PREVIEW_SCENES = {
  'clear-day': { kind: 'clear', isDay: true, intensity: 0, wind: 0.1, cloudCover: 0 },
  'clear-night': { kind: 'clear', isDay: false, intensity: 0, wind: 0.1, cloudCover: 0 },
  partly: { kind: 'partly', isDay: true, intensity: 0, wind: 0.25, cloudCover: 45 },
  cloudy: { kind: 'cloudy', isDay: true, intensity: 0, wind: 0.3, cloudCover: 100 },
  fog: { kind: 'fog', isDay: true, intensity: 0, wind: 0.1, cloudCover: 100 },
  drizzle: { kind: 'drizzle', isDay: true, intensity: 0.6, wind: 0.2, cloudCover: 100 },
  rain: { kind: 'rain', isDay: true, intensity: 0.8, wind: 0.35, cloudCover: 100 },
  thunder: { kind: 'thunder', isDay: true, intensity: 1, wind: 0.6, cloudCover: 100 },
  sleet: { kind: 'sleet', isDay: true, intensity: 0.7, wind: 0.3, cloudCover: 100 },
  snow: { kind: 'snow', isDay: true, intensity: 0.8, wind: 0.2, cloudCover: 100 },
};

const sky = new SkyVisualizer($('sky'));

function applyScene() {
  sky.set(PREVIEW_SCENES[state.preview] || state.liveScene);
}

// ---------- Persistence (best effort; storage may be unavailable) ----------
function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.units in UNITS) state.units = saved.units;
    const loc = saved.location;
    if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && typeof loc.name === 'string') {
      state.location = { name: loc.name, region: String(loc.region || ''), latitude: loc.latitude, longitude: loc.longitude };
    }
  } catch { /* ignore */ }
}

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ units: state.units, location: state.location }));
  } catch { /* ignore */ }
}

// ---------- Formatting helpers ----------
// Open-Meteo returns local times (timezone=auto) like "2026-09-28T14:00".
function parseLocal(iso) {
  const [date, time = '00:00'] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return { y, m, d, hh, mm };
}

function fmtHour(iso) {
  const { hh } = parseLocal(iso);
  const h = hh % 12 || 12;
  return `${h} ${hh < 12 ? 'AM' : 'PM'}`;
}

function fmtClock(iso) {
  const { hh, mm } = parseLocal(iso);
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

function fmtDay(iso, index) {
  if (index === 0) return 'Today';
  const { y, m, d } = parseLocal(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function fmtDate(iso) {
  const { y, m, d } = parseLocal(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const round = (n) => (Number.isFinite(n) ? Math.round(n) : '--');

function compass(deg) {
  if (!Number.isFinite(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function uvLabel(uv) {
  if (!Number.isFinite(uv)) return '';
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Status ----------
function setStatus(message, { error = false, retry = false } = {}) {
  const box = $('status');
  box.replaceChildren();
  box.classList.toggle('is-error', error);
  if (!message) return;
  box.append(el('span', '', message));
  if (retry) {
    const btn = el('button', 'btn btn-small', 'Try again');
    btn.type = 'button';
    btn.addEventListener('click', () => loadWeather());
    box.append(btn);
  }
}

// ---------- Data ----------
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let reason = `${res.status} ${res.statusText}`;
    try { reason = (await res.json()).reason || reason; } catch { /* ignore */ }
    throw new Error(reason);
  }
  return res.json();
}

function forecastUrl({ latitude, longitude }, units) {
  const u = UNITS[units];
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day', 'precipitation',
      'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
    ].join(','),
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset', 'uv_index_max',
      'precipitation_probability_max', 'precipitation_sum', 'wind_speed_10m_max',
    ].join(','),
    temperature_unit: u.temperature_unit,
    wind_speed_unit: u.wind_speed_unit,
    precipitation_unit: u.precipitation_unit,
    timezone: 'auto',
    forecast_days: '7',
  });
  return `${FORECAST_URL}?${params}`;
}

async function loadWeather() {
  const id = ++state.requestId;
  const { location, units } = state;
  renderLocation(location);
  $('weather').setAttribute('aria-busy', 'true');
  setStatus('Loading forecast…');
  try {
    const data = await fetchJSON(forecastUrl(location, units));
    if (id !== state.requestId) return; // a newer request superseded this one
    render(data, units);
    setStatus('');
  } catch (err) {
    if (id !== state.requestId) return;
    console.error(err);
    setStatus(`Couldn't load the forecast (${err.message}).`, { error: true, retry: true });
  } finally {
    if (id === state.requestId) $('weather').setAttribute('aria-busy', 'false');
  }
}

// ---------- Rendering ----------
function renderLocation(loc) {
  $('loc-name').textContent = loc.name;
  $('loc-region').textContent = loc.region || '';
  document.title = `${loc.name} · FAU Owl Weather`;
}

function render(data, units) {
  const u = UNITS[units];
  const { current, hourly, daily } = data;
  const isDay = current.is_day === 1;

  document.body.dataset.daypart = isDay ? 'day' : 'night';

  const windKmh = units === 'imperial' ? current.wind_speed_10m * 1.609 : current.wind_speed_10m;
  state.liveScene = {
    kind: kind(current.weather_code),
    isDay,
    intensity: intensity(current.weather_code),
    wind: Math.min(Math.max((windKmh || 0) / 60, 0), 1),
    cloudCover: current.cloud_cover,
  };
  applyScene();

  // Hero
  $('current-icon').innerHTML = icon(current.weather_code, isDay);
  $('current-temp').textContent = round(current.temperature_2m);
  $('current-unit').textContent = u.temp;
  $('current-desc').textContent = describe(current.weather_code);
  $('current-range').textContent =
    `H ${round(daily.temperature_2m_max[0])}°  ·  L ${round(daily.temperature_2m_min[0])}°  ·  Feels like ${round(current.apparent_temperature)}°`;
  $('updated').textContent = `Updated ${fmtClock(current.time)} ${data.timezone_abbreviation || ''}`.trim();
  $('summary').textContent = summarize(data, u);

  // Details
  const pressure = units === 'imperial'
    ? `${(current.pressure_msl * 0.02953).toFixed(2)} inHg`
    : `${round(current.pressure_msl)} hPa`;
  const details = [
    ['Feels like', `${round(current.apparent_temperature)}${u.temp}`],
    ['Humidity', `${round(current.relative_humidity_2m)}%`],
    ['Wind', `${round(current.wind_speed_10m)} ${u.wind} ${compass(current.wind_direction_10m)}`],
    ['Gusts', `${round(current.wind_gusts_10m)} ${u.wind}`],
    ['UV index', `${round(daily.uv_index_max[0])} ${uvLabel(daily.uv_index_max[0])}`],
    ['Rain chance', `${round(daily.precipitation_probability_max[0])}%`],
    ['Cloud cover', `${round(current.cloud_cover)}%`],
    ['Pressure', pressure],
    ['Sunrise', fmtClock(daily.sunrise[0])],
    ['Sunset', fmtClock(daily.sunset[0])],
  ];
  $('details').replaceChildren(...details.map(([k, v]) => {
    const wrap = el('div', 'detail');
    wrap.append(el('dt', '', k), el('dd', '', v));
    return wrap;
  }));

  // Hourly: next 24 hours starting at the current hour
  const nowHour = current.time.slice(0, 13);
  let start = hourly.time.findIndex((t) => t.slice(0, 13) === nowHour);
  if (start < 0) start = 0;
  const hours = [];
  for (let i = start; i < Math.min(start + 24, hourly.time.length); i++) {
    const li = el('li', 'hour');
    li.append(el('span', 'hour-time', i === start ? 'Now' : fmtHour(hourly.time[i])));
    const ic = el('span', 'hour-icon');
    ic.innerHTML = icon(hourly.weather_code[i], hourly.is_day[i] === 1);
    ic.title = describe(hourly.weather_code[i]);
    li.append(ic);
    li.append(el('span', 'hour-temp', `${round(hourly.temperature_2m[i])}°`));
    const pop = hourly.precipitation_probability[i];
    li.append(el('span', `hour-pop${pop >= 20 ? '' : ' is-low'}`, `💧${round(pop)}%`));
    hours.push(li);
  }
  $('hourly').replaceChildren(...hours);
  $('hourly').scrollLeft = 0;

  // Daily with temperature range bars
  const weekMin = Math.min(...daily.temperature_2m_min);
  const weekMax = Math.max(...daily.temperature_2m_max);
  const span = Math.max(weekMax - weekMin, 1);
  const days = daily.time.map((t, i) => {
    const li = el('li', 'day');
    const name = el('span', 'day-name');
    name.append(el('strong', '', fmtDay(t, i)), el('small', '', fmtDate(t)));
    const ic = el('span', 'day-icon');
    ic.innerHTML = icon(daily.weather_code[i], true);
    const desc = el('span', 'day-desc', describe(daily.weather_code[i]));
    const pop = el('span', `day-pop${daily.precipitation_probability_max[i] >= 20 ? '' : ' is-low'}`,
      `💧${round(daily.precipitation_probability_max[i])}%`);
    const lo = el('span', 'day-lo', `${round(daily.temperature_2m_min[i])}°`);
    const hi = el('span', 'day-hi', `${round(daily.temperature_2m_max[i])}°`);
    const bar = el('span', 'range');
    const fill = el('span', 'range-fill');
    fill.style.left = `${((daily.temperature_2m_min[i] - weekMin) / span) * 100}%`;
    fill.style.right = `${((weekMax - daily.temperature_2m_max[i]) / span) * 100}%`;
    bar.append(fill);
    li.title = describe(daily.weather_code[i]);
    li.append(name, ic, desc, pop, lo, bar, hi);
    return li;
  });
  $('daily').replaceChildren(...days);
}

function summarize(data, u) {
  const { daily, hourly, current } = data;
  const parts = [];
  const pop = daily.precipitation_probability_max[0];
  if (pop >= 60) parts.push(`Rain is likely today (${pop}% chance) — grab an umbrella on the way to class.`);
  else if (pop >= 30) parts.push(`A few showers are possible today (${pop}% chance).`);
  else parts.push('Rain looks unlikely today.');

  const uv = daily.uv_index_max[0];
  if (uv >= 8) parts.push(`UV is ${uvLabel(uv).toLowerCase()} — wear sunscreen.`);

  // Next hour with a meaningful rain chance
  const nowHour = current.time.slice(0, 13);
  const start = Math.max(0, hourly.time.findIndex((t) => t.slice(0, 13) === nowHour));
  for (let i = start + 1; i < Math.min(start + 12, hourly.time.length); i++) {
    if (hourly.precipitation_probability[i] >= 50) {
      parts.push(`Best chance of rain around ${fmtHour(hourly.time[i])}.`);
      break;
    }
  }
  if (Number.isFinite(current.wind_gusts_10m) && current.wind_gusts_10m >= (u.wind === 'mph' ? 30 : 48)) {
    parts.push('It\'s gusty out there.');
  }
  return parts.join(' ');
}

// ---------- Search ----------
function setupSearch() {
  const input = $('search-input');
  const list = $('search-results');
  let results = [];
  let active = -1;
  let timer;
  let searchId = 0;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
    if (i >= 0 && list.children[i]) {
      input.setAttribute('aria-activedescendant', list.children[i].id);
      list.children[i].scrollIntoView({ block: 'nearest' });
    }
  };

  const choose = (r) => {
    if (!r) return;
    const region = [r.admin1, r.country].filter(Boolean).join(', ');
    state.location = { name: r.name, region, latitude: r.latitude, longitude: r.longitude };
    savePrefs();
    input.value = '';
    close();
    input.blur();
    loadWeather();
  };

  const show = (items, message) => {
    list.replaceChildren();
    if (message) {
      list.append(el('li', 'search-empty', message));
    }
    items.forEach((r, i) => {
      const li = el('li', 'search-option');
      li.id = `search-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.append(el('strong', '', r.name));
      li.append(el('span', '', [r.admin1, r.country].filter(Boolean).join(', ')));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(r); });
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };

  const search = async (q) => {
    const id = ++searchId;
    try {
      const params = new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' });
      const data = await fetchJSON(`${GEOCODE_URL}?${params}`);
      if (id !== searchId) return;
      results = data.results || [];
      show(results, results.length ? '' : `No places found for “${q}”.`);
    } catch (err) {
      if (id !== searchId) return;
      results = [];
      show([], 'Search is unavailable right now.');
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { searchId++; results = []; close(); return; }
    timer = setTimeout(() => search(q), 250);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !results.length) {
      if (e.key === 'Escape') close();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + results.length) % results.length); }
    else if (e.key === 'Escape') close();
  });

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (results.length) choose(results[Math.max(active, 0)]);
  });

  input.addEventListener('blur', () => setTimeout(close, 100));
}

// ---------- Controls ----------
function setupControls() {
  $('scene-select').addEventListener('change', (e) => {
    state.preview = e.target.value;
    applyScene();
  });

  const unitButtons = document.querySelectorAll('.unit-toggle button');
  const syncUnits = () => unitButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.units === state.units)));
  syncUnits();
  unitButtons.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.units === state.units) return;
    state.units = btn.dataset.units;
    syncUnits();
    savePrefs();
    loadWeather();
  }));

  $('home-btn').addEventListener('click', () => {
    state.location = DEFAULT_LOCATION;
    savePrefs();
    loadWeather();
  });

  const locateBtn = $('locate-btn');
  if (!('geolocation' in navigator)) {
    locateBtn.hidden = true;
    return;
  }
  locateBtn.addEventListener('click', () => {
    locateBtn.disabled = true;
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        locateBtn.disabled = false;
        state.location = {
          name: 'My location',
          region: `${coords.latitude.toFixed(3)}°, ${coords.longitude.toFixed(3)}°`,
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
        savePrefs();
        loadWeather();
      },
      (err) => {
        locateBtn.disabled = false;
        setStatus(err.code === err.PERMISSION_DENIED
          ? 'Location access was denied. Search for a city instead.'
          : 'Couldn\'t determine your location.', { error: true });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

// ---------- Boot ----------
loadPrefs();
setupControls();
setupSearch();
loadWeather();

// Refresh every 15 minutes while the tab is open and visible.
setInterval(() => { if (document.visibilityState === 'visible') loadWeather(); }, 15 * 60 * 1000);
