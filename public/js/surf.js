// Surf report for South Florida beaches.
// Waves, swell, water temperature and sea level (incl. tides) come from the
// Open-Meteo Marine API; wind from the Open-Meteo forecast API; beach and marine
// hazards (rip currents, high surf, small craft) from NWS alerts (api.weather.gov).

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ALERTS_URL = 'https://api.weather.gov/alerts/active';
const STORAGE_KEY = 'fau-owl-weather-surf';
const SVG_NS = 'http://www.w3.org/2000/svg';

// `facing` is the compass direction the beach faces out to sea (degrees).
export const SPOTS = [
  { id: 'boca-inlet', name: 'Boca Raton Inlet', latitude: 26.3358, longitude: -80.0703, facing: 100 },
  { id: 'deerfield', name: 'Deerfield Beach Pier', latitude: 26.3172, longitude: -80.0742, facing: 100 },
  { id: 'delray', name: 'Delray Beach', latitude: 26.4600, longitude: -80.0583, facing: 95 },
  { id: 'pompano', name: 'Pompano Beach Pier', latitude: 26.2339, longitude: -80.0886, facing: 100 },
  { id: 'lake-worth', name: 'Lake Worth Beach Pier', latitude: 26.6123, longitude: -80.0337, facing: 95 },
  { id: 'juno', name: 'Juno Beach Pier', latitude: 26.8936, longitude: -80.0553, facing: 80 },
  { id: 'jupiter', name: 'Jupiter Inlet', latitude: 26.9437, longitude: -80.0700, facing: 75 },
  { id: 'fort-lauderdale', name: 'Fort Lauderdale Beach', latitude: 26.1224, longitude: -80.1030, facing: 95 },
  { id: 'south-beach', name: 'Miami – South Beach', latitude: 25.7826, longitude: -80.1300, facing: 95 },
];

const UNITS = {
  imperial: { length_unit: 'imperial', wind_speed_unit: 'mph', h: 'ft', w: 'mph', t: '°F' },
  metric: { length_unit: 'metric', wind_speed_unit: 'kmh', h: 'm', w: 'km/h', t: '°C' },
};

const RATINGS = ['Flat', 'Poor', 'Poor to fair', 'Fair', 'Good', 'Epic'];

const BEACH_ALERT = /rip|surf|beach|coastal|marine|small craft|gale|tropical|hurricane|storm surge|waterspout/i;

const $ = (id) => document.getElementById(id);

const state = {
  spot: SPOTS[0],
  units: 'imperial',
  requestId: 0,
  data: null,
};

// ---------- Helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

async function fetchJSON(url, headers) {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) {
    let reason = `${res.status} ${res.statusText}`;
    try { reason = (await res.json()).reason || reason; } catch { /* ignore */ }
    throw new Error(reason);
  }
  return res.json();
}

function compass(deg) {
  if (!Number.isFinite(deg)) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Smallest angle between two compass bearings (0-180).
const angleBetween = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

// "2026-10-22T14:00" (local, from timezone=auto) -> parts without timezone conversion.
function parseLocal(iso) {
  const [date, time = '00:00'] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return { y, m, d, hh, mm };
}

function fmtTime(hh, mm = 0) {
  const h = hh % 12 || 12;
  return `${h}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'AM' : 'PM'}`;
}

function fmtDay({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

const toFt = (v, units) => (units === 'metric' ? v * 3.281 : v);
const toMph = (v, units) => (units === 'metric' ? v / 1.609 : v);

function fmtHeight(v, units) {
  if (!Number.isFinite(v)) return '--';
  return units === 'metric' ? v.toFixed(1) : (Math.round(v * 10) / 10).toFixed(1);
}

// ---------- Surf science (simple, transparent heuristics) ----------
function windRelation(windFrom, speedMph, facing) {
  if (!Number.isFinite(windFrom) || !Number.isFinite(speedMph)) return { label: '', kind: 'unknown' };
  if (speedMph < 5) return { label: 'Light & variable', kind: 'light' };
  const a = angleBetween(windFrom, facing); // 0 = straight onshore, 180 = straight offshore
  if (a <= 45) return { label: 'Onshore', kind: 'onshore' };
  if (a <= 80) return { label: 'Cross-onshore', kind: 'cross-on' };
  if (a < 100) return { label: 'Cross-shore', kind: 'cross' };
  if (a < 135) return { label: 'Cross-offshore', kind: 'cross-off' };
  return { label: 'Offshore', kind: 'offshore' };
}

// Breaking-wave face height range (ft) estimated from significant wave height and period.
function surfRangeFt(hsFt, period) {
  if (!Number.isFinite(hsFt)) return null;
  const f = period >= 12 ? 1.4 : period >= 9 ? 1.2 : 1;
  return [hsFt * 0.8 * f, hsFt * 1.2 * f];
}

function sizeLabel(highFt) {
  if (highFt < 1) return 'Flat';
  if (highFt < 2) return 'Ankle to knee high';
  if (highFt < 3) return 'Knee to waist high';
  if (highFt < 4) return 'Waist to chest high';
  if (highFt < 6) return 'Chest to head high';
  return 'Overhead';
}

function score(hsFt, period, windFrom, windMph, facing) {
  if (!Number.isFinite(hsFt) || hsFt < 0.8) return 0;
  let s = hsFt < 1.5 ? 1 : hsFt < 2.5 ? 2 : hsFt < 4 ? 3 : hsFt < 8 ? 4 : 3;
  if (period >= 12) s += 1; else if (period >= 9) s += 0.5; else if (period < 6) s -= 0.5;
  const rel = windRelation(windFrom, windMph, facing).kind;
  if (rel === 'light') s += 1;
  else if ((rel === 'offshore' || rel === 'cross-off') && windMph < 20) s += 1;
  else if (rel === 'onshore' || rel === 'cross-on') s -= windMph >= 12 ? 1.5 : windMph >= 7 ? 1 : 0;
  else if (rel === 'cross' && windMph >= 15) s -= 0.5;
  return Math.max(s, 0.5);
}

function ratingIndex(s) {
  if (s === 0) return 0;
  if (s < 1.5) return 1;
  if (s < 2.5) return 2;
  if (s < 3.5) return 3;
  if (s < 4.5) return 4;
  return 5;
}

// Local highs and lows in an hourly series, refined to sub-hour timing.
function tideTurns(times, levels, start, end) {
  const turns = [];
  for (let i = Math.max(start, 1); i < Math.min(end, levels.length - 1); i++) {
    const [y0, y1, y2] = [levels[i - 1], levels[i], levels[i + 1]];
    if (![y0, y1, y2].every(Number.isFinite)) continue;
    const isHigh = y1 > y0 && y1 >= y2;
    const isLow = y1 < y0 && y1 <= y2;
    if (!isHigh && !isLow) continue;
    const denom = y0 - 2 * y1 + y2;
    const offset = denom ? Math.max(-0.5, Math.min(0.5, (y0 - y2) / (2 * denom))) : 0;
    const value = y1 - ((y0 - y2) * offset) / 4;
    turns.push({ index: i + offset, offset, type: isHigh ? 'High' : 'Low', value, time: times[i] });
  }
  return turns;
}

function turnLabel(turn) {
  const { hh } = parseLocal(turn.time);
  const mins = (Math.round((hh * 60 + turn.offset * 60) / 5) * 5 + 1440) % 1440;
  return fmtTime(Math.floor(mins / 60), mins % 60);
}

// ---------- Data ----------
async function load() {
  const id = ++state.requestId;
  const { spot, units } = state;
  const u = UNITS[units];
  const section = $('surf');
  section.setAttribute('aria-busy', 'true');
  $('surf-status').textContent = 'Loading surf report…';
  $('surf-status').classList.remove('is-error');

  const marineParams = new URLSearchParams({
    latitude: String(spot.latitude),
    longitude: String(spot.longitude),
    current: 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,sea_surface_temperature,sea_level_height_msl',
    hourly: 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_level_height_msl',
    timezone: 'auto',
    forecast_days: '3',
    length_unit: u.length_unit,
  });
  const windParams = new URLSearchParams({
    latitude: String(spot.latitude),
    longitude: String(spot.longitude),
    current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'wind_speed_10m,wind_direction_10m',
    daily: 'sunrise,sunset',
    wind_speed_unit: u.wind_speed_unit,
    timezone: 'auto',
    forecast_days: '3',
  });

  const alertsPromise = fetchJSON(`${ALERTS_URL}?point=${spot.latitude.toFixed(4)},${spot.longitude.toFixed(4)}`, { Accept: 'application/geo+json' })
    .catch(() => null);
  try {
    const [marine, wind] = await Promise.all([
      fetchJSON(`${MARINE_URL}?${marineParams}`),
      fetchJSON(`${FORECAST_URL}?${windParams}`),
    ]);
    if (id !== state.requestId) return;
    state.data = { marine, wind, units };
    render();
    $('surf-status').textContent = '';
  } catch (err) {
    if (id !== state.requestId) return;
    console.error(err);
    $('surf-status').textContent = `Couldn’t load the surf report (${err.message}).`;
    $('surf-status').classList.add('is-error');
  } finally {
    if (id === state.requestId) section.setAttribute('aria-busy', 'false');
  }

  const alerts = await alertsPromise;
  if (id === state.requestId) renderAlerts(alerts);
}

// ---------- Rendering ----------
function render() {
  const { marine, wind, units } = state.data;
  const u = UNITS[units];
  const { spot } = state;
  const c = marine.current;
  const hsFt = toFt(c.wave_height, units);
  const windMph = toMph(wind.current.wind_speed_10m, units);
  const period = c.wave_period;
  const s = score(hsFt, period, wind.current.wind_direction_10m, windMph, spot.facing);
  const rating = RATINGS[ratingIndex(s)];

  // Hero: estimated surf height and rating
  const range = surfRangeFt(hsFt, period);
  let rangeText = 'Flat';
  if (range && range[1] >= 1) {
    if (units === 'metric') {
      rangeText = `${(range[0] / 3.281).toFixed(1)}–${(range[1] / 3.281).toFixed(1)}`;
    } else {
      const lo = Math.max(Math.floor(range[0]), 1);
      const hi = Math.max(Math.ceil(range[1]), lo + 1);
      rangeText = `${lo}–${hi}`;
    }
  }
  $('surf-height').textContent = rangeText;
  $('surf-height-unit').textContent = rangeText === 'Flat' ? '' : u.h;
  $('surf-size').textContent = range ? sizeLabel(range[1]) : '';
  const ratingEl = $('surf-rating');
  ratingEl.dataset.rating = rating.toLowerCase().replace(/\s+/g, '-');
  $('surf-rating-text').textContent = rating;

  const rel = windRelation(wind.current.wind_direction_10m, windMph, spot.facing);
  $('surf-best').textContent = bestWindow(marine, wind, units, spot);

  // Detail tiles
  const sst = c.sea_surface_temperature;
  const water = Number.isFinite(sst) ? (units === 'imperial' ? `${Math.round(sst * 9 / 5 + 32)}°F` : `${Math.round(sst)}°C`) : '--';
  const nowIdx = currentIndex(marine.hourly.time, c.time);
  const turns = tideTurns(marine.hourly.time, marine.hourly.sea_level_height_msl, nowIdx, nowIdx + 30);
  const nextHigh = turns.find((t) => t.type === 'High');
  const nextLow = turns.find((t) => t.type === 'Low');
  const tiles = [
    ['Primary swell', `${fmtHeight(c.swell_wave_height, units)} ${u.h} @ ${Math.round(c.swell_wave_period)}s`, c.swell_wave_direction, `from ${compass(c.swell_wave_direction)}`],
    ['Wave height', `${fmtHeight(c.wave_height, units)} ${u.h} @ ${Math.round(c.wave_period)}s`, c.wave_direction, `from ${compass(c.wave_direction)}`],
    ['Wind', `${Math.round(wind.current.wind_speed_10m)} ${u.w} ${compass(wind.current.wind_direction_10m)}`, wind.current.wind_direction_10m, `${rel.label}${Number.isFinite(wind.current.wind_gusts_10m) ? ` · gusts ${Math.round(wind.current.wind_gusts_10m)}` : ''}`],
    ['Water temp', water, null, ''],
    ['Next high tide', nextHigh ? turnLabel(nextHigh) : '--', null, nextHigh ? `${fmtHeight(nextHigh.value, units)} ${u.h} vs. mean sea level` : ''],
    ['Next low tide', nextLow ? turnLabel(nextLow) : '--', null, nextLow ? `${fmtHeight(nextLow.value, units)} ${u.h} vs. mean sea level` : ''],
  ];
  $('surf-details').replaceChildren(...tiles.map(([label, value, dir, sub]) => {
    const wrap = el('div', 'detail');
    const dd = el('dd');
    if (Number.isFinite(dir)) {
      const arrow = svg('svg', { class: 'dir-arrow', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
      arrow.append(svg('path', { d: 'M12 3l6 14-6-3-6 3z', fill: 'currentColor' }));
      arrow.style.transform = `rotate(${(dir + 180) % 360}deg)`; // points where it's heading
      dd.append(arrow);
    }
    dd.append(document.createTextNode(value));
    wrap.append(el('dt', '', label), dd);
    if (sub) wrap.append(el('p', 'detail-sub', sub));
    return wrap;
  }));

  renderWaveChart(marine, units, nowIdx);
  renderTideChart(marine, units, nowIdx, turns);
}

function currentIndex(times, now) {
  const idx = times.findIndex((t) => t.slice(0, 13) === now.slice(0, 13));
  return idx < 0 ? 0 : idx;
}

// Best stretch of daylight in the next ~15 hours, by the same score.
function bestWindow(marine, wind, units, spot) {
  const t = marine.hourly.time;
  const now = currentIndex(t, marine.current.time);
  const windIdx = (time) => wind.hourly.time.indexOf(time);
  const scores = [];
  for (let i = now; i < Math.min(now + 15, t.length); i++) {
    const { hh } = parseLocal(t[i]);
    if (hh < 6 || hh > 19) continue;
    const wi = windIdx(t[i]);
    if (wi < 0) continue;
    const s = score(toFt(marine.hourly.wave_height[i], units), marine.hourly.wave_period[i],
      wind.hourly.wind_direction_10m[wi], toMph(wind.hourly.wind_speed_10m[wi], units), spot.facing);
    scores.push({ i, s, hh, wi });
  }
  if (!scores.length) return '';
  const best = Math.max(...scores.map((x) => x.s));
  if (best === 0) return 'Flat all day: a good day for the beach, not the board.';
  const top = scores.filter((x) => x.s >= best - 0.25);
  // first contiguous run of top hours
  const run = [top[0]];
  for (let k = 1; k < top.length && top[k].i === run[run.length - 1].i + 1; k++) run.push(top[k]);
  const first = run[0];
  const last = run[run.length - 1];
  const day = parseLocal(t[first.i]).d === parseLocal(t[now]).d ? '' : 'Tomorrow ';
  const rel = windRelation(wind.hourly.wind_direction_10m[first.wi], toMph(wind.hourly.wind_speed_10m[first.wi], units), spot.facing);
  const when = first.i === last.i ? fmtTime(first.hh) : `${fmtTime(first.hh)}–${fmtTime((last.hh + 1) % 24)}`;
  return `Best window: ${day}${when} (${RATINGS[ratingIndex(first.s)].toLowerCase()}, ${rel.label.toLowerCase()} wind).`;
}

// ---------- Charts ----------
let tooltipEl;
function tooltip() {
  if (!tooltipEl) {
    tooltipEl = el('div', 'chart-tooltip');
    tooltipEl.setAttribute('role', 'presentation');
    tooltipEl.hidden = true;
    document.body.append(tooltipEl);
  }
  return tooltipEl;
}

function showTip(evt, lines) {
  const tip = tooltip();
  tip.replaceChildren(...lines.map((l, i) => el(i === 0 ? 'strong' : 'span', '', l)));
  tip.hidden = false;
  const pad = 12;
  const { clientX: x, clientY: y } = evt.touches ? evt.touches[0] : evt;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
  const top = y - h - pad < 8 ? y + pad : y - h - pad;
  tip.style.left = `${left + window.scrollX}px`;
  tip.style.top = `${top + window.scrollY}px`;
}

function hideTip() {
  if (tooltipEl) tooltipEl.hidden = true;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const steps = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
  return steps.find((s) => s >= v) || Math.ceil(v / 10) * 10;
}

function tableView(caption, headers, rows) {
  const details = el('details', 'chart-table');
  details.append(el('summary', '', 'Table view'));
  const wrap = el('div', 'chart-table-scroll');
  const table = el('table');
  table.append(el('caption', 'visually-hidden', caption));
  const thead = el('thead');
  const tr = el('tr');
  headers.forEach((h) => tr.append(el('th', '', h)));
  thead.append(tr);
  const tbody = el('tbody');
  rows.forEach((r) => {
    const row = el('tr');
    r.forEach((v) => row.append(el('td', '', v)));
    tbody.append(row);
  });
  table.append(thead, tbody);
  wrap.append(table);
  details.append(wrap);
  return details;
}

function hourLabel(iso) {
  const p = parseLocal(iso);
  return `${fmtDay(p)} ${fmtTime(p.hh)}`;
}

function renderWaveChart(marine, units, start) {
  const box = $('surf-chart');
  const u = UNITS[units];
  const h = marine.hourly;
  const end = Math.min(start + 48, h.time.length);
  const idx = Array.from({ length: end - start }, (_, k) => start + k);
  const width = Math.max(box.clientWidth, 280);
  const height = 200;
  const m = { top: 26, right: 8, bottom: 28, left: 34 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const max = niceMax(Math.max(...idx.map((i) => h.wave_height[i] || 0)) * 1.1);
  const band = plotW / idx.length;
  const barW = Math.min(24, Math.max(band - 2, 1)); // 2px surface gap between bars
  const y = (v) => m.top + plotH - (v / max) * plotH;
  const tickHours = band * 6 < 60 ? 12 : 6; // keep time labels from colliding on narrow screens

  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
    'aria-label': `Wave height for the next ${idx.length} hours, in ${u.h === 'ft' ? 'feet' : 'meters'}. Peak ${fmtHeight(Math.max(...idx.map((i) => h.wave_height[i] || 0)), units)} ${u.h}.` });

  // grid + y ticks
  const ticks = [0, max / 2, max];
  ticks.forEach((t) => {
    root.append(svg('line', { class: 'chart-grid', x1: m.left, x2: width - m.right, y1: y(t), y2: y(t) }));
    root.append(svg('text', { class: 'chart-tick', x: m.left - 6, y: y(t) + 4, 'text-anchor': 'end' }, `${+t.toFixed(1)}`));
  });
  root.append(svg('text', { class: 'chart-tick', x: m.left - 6, y: m.top - 14, 'text-anchor': 'end' }, u.h));

  // bars with 4px rounded tops, square at the baseline
  idx.forEach((i, k) => {
    const v = h.wave_height[i];
    if (!Number.isFinite(v)) return;
    const x = m.left + k * band + (band - barW) / 2;
    const top = y(v);
    const base = y(0);
    const r = Math.min(4, barW / 2, base - top);
    const d = `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${base}Z`;
    root.append(svg('path', { class: k === 0 ? 'chart-bar is-now' : 'chart-bar', d }));

    const { hh } = parseLocal(h.time[i]);
    if (hh % tickHours === 0) {
      const label = hh === 0 ? fmtDay(parseLocal(h.time[i])) : fmtTime(hh);
      root.append(svg('text', { class: hh === 0 ? 'chart-tick is-day' : 'chart-tick', x: m.left + k * band + band / 2, y: height - 8, 'text-anchor': 'middle' }, label));
    }
  });

  // hit targets bigger than the marks
  idx.forEach((i, k) => {
    const hit = svg('rect', { class: 'chart-hit', x: m.left + k * band, y: m.top, width: band, height: plotH });
    const lines = [
      k === 0 ? `Now (${hourLabel(h.time[i])})` : hourLabel(h.time[i]),
      `Waves ${fmtHeight(h.wave_height[i], units)} ${u.h} @ ${Math.round(h.wave_period[i])}s from ${compass(h.wave_direction[i])}`,
      `Swell ${fmtHeight(h.swell_wave_height[i], units)} ${u.h} @ ${Math.round(h.swell_wave_period[i])}s`,
    ];
    hit.addEventListener('pointermove', (e) => showTip(e, lines));
    hit.addEventListener('pointerleave', hideTip);
    root.append(hit);
  });

  box.replaceChildren(root, tableView('Hourly wave forecast', ['Time', `Waves (${u.h})`, 'Period', 'From', `Swell (${u.h})`],
    idx.map((i) => [hourLabel(h.time[i]), fmtHeight(h.wave_height[i], units), `${Math.round(h.wave_period[i])}s`,
      compass(h.wave_direction[i]), fmtHeight(h.swell_wave_height[i], units)])));
}

function renderTideChart(marine, units, start, turns) {
  const box = $('tide-chart');
  const u = UNITS[units];
  const h = marine.hourly;
  const end = Math.min(start + 30, h.time.length);
  const idx = Array.from({ length: end - start }, (_, k) => start + k).filter((i) => Number.isFinite(h.sea_level_height_msl[i]));
  if (idx.length < 3) { box.replaceChildren(el('p', 'card-note', 'Tide data isn’t available for this spot.')); return; }
  const width = Math.max(box.clientWidth, 280);
  const height = 184;
  const m = { top: 24, right: 12, bottom: 42, left: 34 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const vals = idx.map((i) => h.sea_level_height_msl[i]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || 0.5;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (i) => m.left + ((i - start) / (end - 1 - start)) * plotW;
  const y = (v) => m.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img',
    'aria-label': `Tide (sea level) for the next ${idx.length} hours. ${turns.map((t) => `${t.type} at ${turnLabel(t)}`).join(', ')}.` });

  [yMin + pad, (yMin + yMax) / 2, yMax - pad].forEach((t) => {
    root.append(svg('line', { class: 'chart-grid', x1: m.left, x2: width - m.right, y1: y(t), y2: y(t) }));
    root.append(svg('text', { class: 'chart-tick', x: m.left - 6, y: y(t) + 4, 'text-anchor': 'end' }, t.toFixed(1)));
  });
  root.append(svg('text', { class: 'chart-tick', x: m.left - 6, y: m.top - 10, 'text-anchor': 'end' }, u.h));

  // smooth curve (Catmull-Rom -> cubic Bezier)
  const pts = idx.map((i) => [x(i), y(h.sea_level_height_msl[i])]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] || pts[k];
    const p1 = pts[k];
    const p2 = pts[k + 1];
    const p3 = pts[k + 2] || p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const base = m.top + plotH;
  root.append(svg('path', { class: 'chart-area', d: `${d}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z` }));
  root.append(svg('path', { class: 'chart-line', d }));

  // x ticks every 6 hours
  idx.forEach((i) => {
    const { hh } = parseLocal(h.time[i]);
    if (hh % (plotW / (end - 1 - start) * 6 < 60 ? 12 : 6) === 0) {
      const label = hh === 0 ? fmtDay(parseLocal(h.time[i])) : fmtTime(hh);
      root.append(svg('text', { class: hh === 0 ? 'chart-tick is-day' : 'chart-tick', x: x(i), y: height - 6, 'text-anchor': 'middle' }, label));
    }
  });

  // "now" marker
  root.append(svg('line', { class: 'chart-now', x1: x(start), x2: x(start), y1: m.top - 6, y2: base }));
  root.append(svg('text', { class: 'chart-tick', x: x(start) + 4, y: m.top - 10 }, 'Now'));

  // highs and lows: dots with a surface ring + selective labels
  turns.filter((t) => t.index >= start && t.index <= end - 1).forEach((t) => {
    const cx = x(t.index);
    const cy = y(t.value);
    root.append(svg('circle', { class: 'chart-dot', cx, cy, r: 4.5 }));
    const above = t.type === 'High';
    root.append(svg('text', { class: 'chart-label', x: cx, y: above ? cy - 10 : cy + 18, 'text-anchor': 'middle' }, `${t.type} ${turnLabel(t)}`));
  });

  // crosshair + tooltip
  const cross = svg('line', { class: 'chart-cross', x1: 0, x2: 0, y1: m.top, y2: base, visibility: 'hidden' });
  const dot = svg('circle', { class: 'chart-dot', r: 4.5, visibility: 'hidden' });
  const hit = svg('rect', { class: 'chart-hit', x: m.left, y: 0, width: plotW, height });
  root.append(cross, dot, hit);
  const move = (e) => {
    const rect = root.getBoundingClientRect();
    const px = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) * (width / rect.width);
    const k = Math.round(((px - m.left) / plotW) * (end - 1 - start));
    const i = Math.max(start, Math.min(end - 1, start + k));
    const v = h.sea_level_height_msl[i];
    if (!Number.isFinite(v)) return;
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(v)); dot.setAttribute('visibility', 'visible');
    showTip(e, [hourLabel(h.time[i]), `Sea level ${fmtHeight(v, units)} ${u.h} vs. mean sea level`]);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });

  box.replaceChildren(root, tableView('Hourly tide (sea level) forecast', ['Time', `Sea level (${u.h})`],
    idx.map((i) => [hourLabel(h.time[i]), fmtHeight(h.sea_level_height_msl[i], units)])));
}

function renderAlerts(geo) {
  const box = $('surf-alerts');
  box.replaceChildren();
  if (!geo || !Array.isArray(geo.features)) {
    box.append(el('p', 'alerts-none', 'NWS beach alerts are unavailable right now.'));
    return;
  }
  const alerts = geo.features.map((f) => f.properties || {}).filter((p) => p.event);
  alerts.sort((a, b) => Number(BEACH_ALERT.test(b.event)) - Number(BEACH_ALERT.test(a.event)));
  if (!alerts.length) {
    const ok = el('p', 'alerts-none');
    ok.append(el('span', 'alerts-ok-dot'), document.createTextNode('No active NWS alerts for this beach. Always swim near a lifeguard.'));
    box.append(ok);
    return;
  }
  alerts.slice(0, 4).forEach((p) => {
    const item = el('details', `alert alert-${String(p.severity || 'unknown').toLowerCase()}`);
    const summary = el('summary');
    summary.append(el('strong', '', p.event));
    const until = p.ends || p.expires;
    if (until) {
      const t = new Date(until);
      if (!Number.isNaN(t.getTime())) {
        summary.append(el('span', '', ` until ${t.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`));
      }
    }
    item.append(summary);
    if (p.headline) item.append(el('p', 'alert-headline', p.headline));
    if (p.description) item.append(el('p', 'alert-body', p.description));
    if (p.instruction) item.append(el('p', 'alert-body', p.instruction));
    box.append(item);
  });
}

// ---------- Public API ----------
function setupPicker() {
  const select = $('surf-spot');
  select.replaceChildren(...SPOTS.map((s) => {
    const o = el('option', '', s.name);
    o.value = s.id;
    return o;
  }));
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const spot = SPOTS.find((s) => s.id === saved);
    if (spot) state.spot = spot;
  } catch { /* ignore */ }
  select.value = state.spot.id;
  select.addEventListener('change', () => {
    state.spot = SPOTS.find((s) => s.id === select.value) || SPOTS[0];
    try { localStorage.setItem(STORAGE_KEY, state.spot.id); } catch { /* ignore */ }
    load();
  });
}

let started = false;
export function initSurf(units) {
  state.units = units;
  setupPicker();
  // Redraw charts at the new width when the layout changes.
  let w = 0;
  new ResizeObserver(([entry]) => {
    const nw = Math.round(entry.contentRect.width);
    if (state.data && Math.abs(nw - w) > 8) {
      w = nw;
      const { marine } = state.data;
      const now = currentIndex(marine.hourly.time, marine.current.time);
      renderWaveChart(marine, state.data.units, now);
      renderTideChart(marine, state.data.units, now, tideTurns(marine.hourly.time, marine.hourly.sea_level_height_msl, now, now + 30));
    }
  }).observe($('surf-chart'));
  const go = () => { if (!started) { started = true; load(); } };
  if (!('IntersectionObserver' in window)) { go(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); go(); }
  }, { rootMargin: '600px 0px' });
  io.observe($('surf'));
  setInterval(() => { if (started && document.visibilityState === 'visible') load(); }, 30 * 60 * 1000);
}

export function setSurfUnits(units) {
  if (units === state.units) return;
  state.units = units;
  if (started) load();
}
