// Detail cards: air quality, wind compass, sunrise/sunset, precipitation, humidity.
// Weather from the Open-Meteo forecast API (passed in from app.js); air quality
// from the Open-Meteo Air Quality API (US AQI, CAMS model).

import { svg, barChart, lineChart, tableView, autoResize } from './charts.js';

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const round = (n) => (Number.isFinite(n) ? Math.round(n) : '--');

function compass(deg) {
  if (!Number.isFinite(deg)) return '--';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

const DIR_NAMES = { N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast', E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast', S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest', W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest' };

function parseLocal(iso) {
  const [date, time = '00:00'] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return { y, m, d, hh, mm, minutes: hh * 60 + mm };
}

function fmtClock(iso) {
  const { hh, mm } = parseLocal(iso);
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

function fmtHour(iso) {
  const { hh } = parseLocal(iso);
  return `${hh % 12 || 12} ${hh < 12 ? 'AM' : 'PM'}`;
}

function fmtMinutes(min) {
  const mm = ((Math.round(min) % 1440) + 1440) % 1440;
  const hh = Math.floor(mm / 60);
  return `${hh % 12 || 12}:${String(mm % 60).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function detail(label, value, sub) {
  const wrap = el('div', 'detail');
  wrap.append(el('dt', '', label), el('dd', '', value));
  if (sub) wrap.append(el('p', 'detail-sub', sub));
  return wrap;
}

function nowIndex(times, now) {
  const i = times.findIndex((t) => t.slice(0, 13) === now.slice(0, 13));
  return i < 0 ? 0 : i;
}

// ---------- Air quality ----------
export const AQI_LEVELS = [
  { max: 50, label: 'Good', color: '#00e400', advice: 'Air quality is satisfactory. Enjoy being outside.' },
  { max: 100, label: 'Moderate', color: '#ffff00', advice: 'Acceptable. Unusually sensitive people should consider limiting long or heavy outdoor exertion.' },
  { max: 150, label: 'Unhealthy for sensitive groups', color: '#ff7e00', advice: 'People with heart or lung disease, older adults, children and teens should reduce long or heavy outdoor exertion.' },
  { max: 200, label: 'Unhealthy', color: '#ff0000', advice: 'Everyone may begin to feel effects. Limit long or heavy outdoor exertion; sensitive groups should avoid it.' },
  { max: 300, label: 'Very unhealthy', color: '#8f3f97', advice: 'Health alert: everyone should avoid long or heavy outdoor exertion.' },
  { max: 500, label: 'Hazardous', color: '#7e0023', advice: 'Emergency conditions: everyone should avoid all outdoor exertion.' },
];

export function aqiLevel(aqi) {
  return AQI_LEVELS.find((l) => aqi <= l.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
}

// Position on an equal-width 6-segment scale (0..1).
function aqiPosition(aqi) {
  const v = Math.max(0, Math.min(aqi, 500));
  let lo = 0;
  for (let k = 0; k < AQI_LEVELS.length; k++) {
    const hi = AQI_LEVELS[k].max;
    if (v <= hi) return (k + (v - lo) / (hi - lo)) / AQI_LEVELS.length;
    lo = hi;
  }
  return 1;
}

let aqRequest = 0;
export async function loadAirQuality(location) {
  const id = ++aqRequest;
  const body = $('aq-body');
  const params = new URLSearchParams({
    latitude: location.latitude.toFixed(4),
    longitude: location.longitude.toFixed(4),
    current: 'us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,pm2_5,pm10,ozone,nitrogen_dioxide,carbon_monoxide',
    hourly: 'us_aqi',
    timezone: 'auto',
    forecast_days: '2',
  });
  try {
    const res = await fetch(`${AQ_URL}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (id !== aqRequest) return;
    renderAirQuality(data);
  } catch (err) {
    if (id !== aqRequest) return;
    console.error(err);
    body.replaceChildren(el('p', 'card-note', 'Air quality data is unavailable right now.'));
  }
}

function renderAirQuality(data) {
  const c = data.current;
  const aqi = c.us_aqi;
  const body = $('aq-body');
  if (!Number.isFinite(aqi)) {
    body.replaceChildren(el('p', 'card-note', 'No air quality data for this location.'));
    return;
  }
  const level = aqiLevel(aqi);

  const head = el('div', 'aq-head');
  const big = el('p', 'aq-value');
  big.append(el('span', 'aq-number', String(Math.round(aqi))), el('span', 'aq-unit', 'US AQI'));
  const cat = el('div', 'aq-cat');
  const name = el('p', 'aq-level');
  const dot = el('span', 'aq-dot');
  dot.style.background = level.color;
  name.append(dot, document.createTextNode(level.label));
  cat.append(name, el('p', 'aq-advice', level.advice));
  head.append(big, cat);

  // segmented bar
  const bar = el('div', 'aq-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Air quality index ${Math.round(aqi)}, ${level.label}, on a scale from 0 to 500`);
  AQI_LEVELS.forEach((l) => {
    const seg = el('span', 'aq-seg');
    seg.style.background = l.color;
    seg.title = `${l.label} (up to ${l.max})`;
    bar.append(seg);
  });
  const marker = el('span', 'aq-marker');
  marker.style.left = `${aqiPosition(aqi) * 100}%`;
  bar.append(marker);
  const ticks = el('div', 'aq-ticks');
  ['0', '50', '100', '150', '200', '300', '500'].forEach((t) => ticks.append(el('span', '', t)));

  // pollutants
  const subs = [
    ['PM2.5', c.pm2_5, 'µg/m³', c.us_aqi_pm2_5],
    ['PM10', c.pm10, 'µg/m³', c.us_aqi_pm10],
    ['Ozone', c.ozone, 'µg/m³', c.us_aqi_ozone],
    ['NO₂', c.nitrogen_dioxide, 'µg/m³', c.us_aqi_nitrogen_dioxide],
  ];
  const main = subs.filter((s) => Number.isFinite(s[3])).sort((a, b) => b[3] - a[3])[0];
  const list = el('dl', 'details aq-pollutants');
  subs.forEach(([label, value, unit, sub]) => {
    const wrap = detail(label, Number.isFinite(value) ? `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}` : '--');
    if (Number.isFinite(sub)) {
      const p = el('p', 'detail-sub');
      const d = el('span', 'aq-dot aq-dot-small');
      d.style.background = aqiLevel(sub).color;
      p.append(d, document.createTextNode(`AQI ${Math.round(sub)} · ${aqiLevel(sub).label}`));
      wrap.append(p);
    }
    list.append(wrap);
  });

  // peak later today
  const h = data.hourly;
  const start = nowIndex(h.time, c.time);
  const today = parseLocal(c.time).d;
  let peak = null;
  for (let i = start; i < h.time.length && parseLocal(h.time[i]).d === today; i++) {
    if (Number.isFinite(h.us_aqi[i]) && (!peak || h.us_aqi[i] > peak.v)) peak = { v: h.us_aqi[i], t: h.time[i] };
  }
  const notes = [];
  if (main) notes.push(`Main pollutant: ${main[0]}.`);
  if (peak && Math.round(peak.v) > Math.round(aqi)) notes.push(`Peaks near ${Math.round(peak.v)} (${aqiLevel(peak.v).label.toLowerCase()}) around ${fmtHour(peak.t)}.`);
  notes.push('Model estimate (CAMS via Open-Meteo).');

  body.replaceChildren(head, bar, ticks, list, el('p', 'card-note', notes.join(' ')));
}

// ---------- Wind ----------
function beaufort(mph) {
  const scale = [[1, 'Calm'], [4, 'Light air'], [8, 'Light breeze'], [13, 'Gentle breeze'], [19, 'Moderate breeze'], [25, 'Fresh breeze'],
    [32, 'Strong breeze'], [39, 'Near gale'], [47, 'Gale'], [55, 'Strong gale'], [64, 'Storm'], [73, 'Violent storm']];
  const hit = scale.find(([max]) => mph < max);
  return hit ? hit[1] : 'Hurricane force';
}

function compassSvg() {
  const root = svg('svg', { class: 'compass', viewBox: '0 0 220 220', 'aria-hidden': 'true' });
  root.append(svg('circle', { class: 'compass-face', cx: 110, cy: 110, r: 104 }));
  for (let a = 0; a < 360; a += 10) {
    const major = a % 30 === 0;
    const r1 = major ? 88 : 94;
    const rad = (a * Math.PI) / 180;
    root.append(svg('line', {
      class: major ? 'compass-tick is-major' : 'compass-tick',
      x1: 110 + Math.sin(rad) * r1, y1: 110 - Math.cos(rad) * r1,
      x2: 110 + Math.sin(rad) * 100, y2: 110 - Math.cos(rad) * 100,
    }));
  }
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => {
    const rad = (a * Math.PI) / 180;
    root.append(svg('text', { class: t === 'N' ? 'compass-letter is-north' : 'compass-letter', x: 110 + Math.sin(rad) * 74, y: 110 - Math.cos(rad) * 74 + 6, 'text-anchor': 'middle' }, t));
  });
  [['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]].forEach(([t, a]) => {
    const rad = (a * Math.PI) / 180;
    root.append(svg('text', { class: 'compass-letter is-minor', x: 110 + Math.sin(rad) * 74, y: 110 - Math.cos(rad) * 74 + 4, 'text-anchor': 'middle' }, t));
  });
  // arrow (points the way the wind is blowing); rotated via CSS
  const arrow = svg('g', { class: 'compass-arrow' });
  arrow.append(svg('line', { class: 'compass-shaft', x1: 110, y1: 186, x2: 110, y2: 44 }));
  arrow.append(svg('path', { class: 'compass-head', d: 'M110,18 L124,48 L110,42 L96,48 Z' }));
  arrow.append(svg('circle', { class: 'compass-tail', cx: 110, cy: 190, r: 6 }));
  root.append(arrow);
  root.append(svg('circle', { class: 'compass-hub', cx: 110, cy: 110, r: 42 }));
  root.append(svg('text', { class: 'compass-speed', x: 110, y: 112, 'text-anchor': 'middle' }, '--'));
  root.append(svg('text', { class: 'compass-unit', x: 110, y: 132, 'text-anchor': 'middle' }, 'mph'));
  return root;
}

function renderWind(data, units, u) {
  const { current, hourly, daily } = data;
  const body = $('wind-body');
  let dial = body.querySelector('.compass');
  if (!dial) {
    const wrap = el('div', 'wind-layout');
    const dialBox = el('div', 'compass-box');
    dial = compassSvg();
    dialBox.append(dial);
    wrap.append(dialBox, el('dl', 'details wind-stats'));
    body.replaceChildren(wrap, el('ol', 'wind-hours'));
  }
  const dir = current.wind_direction_10m;
  const heading = (dir + 180) % 360;
  dial.querySelector('.compass-arrow').style.transform = `rotate(${heading}deg)`;
  dial.querySelector('.compass-speed').textContent = round(current.wind_speed_10m);
  dial.querySelector('.compass-unit').textContent = u.wind;
  const mph = units === 'imperial' ? current.wind_speed_10m : current.wind_speed_10m / 1.609;
  const from = compass(dir);
  dial.parentElement.setAttribute('role', 'img');
  dial.parentElement.setAttribute('aria-label', `Wind from the ${DIR_NAMES[from] || from} at ${round(current.wind_speed_10m)} ${u.wind}, gusting to ${round(current.wind_gusts_10m)} ${u.wind}`);

  body.querySelector('.wind-stats').replaceChildren(
    detail('Wind', `${round(current.wind_speed_10m)} ${u.wind}`, beaufort(mph)),
    detail('Gusts', `${round(current.wind_gusts_10m)} ${u.wind}`, Number.isFinite(daily.wind_gusts_10m_max?.[0]) ? `Up to ${round(daily.wind_gusts_10m_max[0])} today` : ''),
    detail('From', `${from} · ${round(dir)}°`, `Blowing toward the ${DIR_NAMES[compass(heading)] || compass(heading)}`),
    detail('Today’s high', `${round(daily.wind_speed_10m_max[0])} ${u.wind}`, Number.isFinite(daily.wind_direction_10m_dominant?.[0]) ? `Mostly from ${compass(daily.wind_direction_10m_dominant[0])}` : ''),
  );

  // next 12 hours, every 2 hours
  const start = nowIndex(hourly.time, current.time);
  const items = [];
  for (let i = start + 2; i <= Math.min(start + 12, hourly.time.length - 1); i += 2) {
    const li = el('li', 'wind-hour');
    li.append(el('span', 'wind-hour-time', fmtHour(hourly.time[i])));
    const arrow = svg('svg', { class: 'wind-hour-arrow', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    arrow.append(svg('path', { d: 'M12 3l6 14-6-3-6 3z', fill: 'currentColor' }));
    arrow.style.transform = `rotate(${(hourly.wind_direction_10m[i] + 180) % 360}deg)`;
    li.append(arrow);
    li.append(el('span', 'wind-hour-speed', `${round(hourly.wind_speed_10m[i])}`));
    li.append(el('span', 'wind-hour-gust', `G ${round(hourly.wind_gusts_10m[i])}`));
    li.title = `${fmtHour(hourly.time[i])}: ${round(hourly.wind_speed_10m[i])} ${u.wind} from ${compass(hourly.wind_direction_10m[i])}, gusts ${round(hourly.wind_gusts_10m[i])}`;
    items.push(li);
  }
  body.querySelector('.wind-hours').replaceChildren(...items);
}

// ---------- Sun ----------
function renderSun(data) {
  const { current, daily } = data;
  const body = $('sun-body');
  const rise = parseLocal(daily.sunrise[0]).minutes;
  const set = parseLocal(daily.sunset[0]).minutes;
  const now = parseLocal(current.time).minutes;
  const f = (now - rise) / (set - rise);
  const isDay = f >= 0 && f <= 1;

  const W = 300;
  const H = 150;
  const cx = 150;
  const base = 124;
  const rx = 128;
  const ry = 100;
  const pt = (t) => [cx - rx * Math.cos(Math.PI * t), base - ry * Math.sin(Math.PI * t)];
  const root = svg('svg', { class: 'sun-arc', viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Sunrise ${fmtClock(daily.sunrise[0])}, sunset ${fmtClock(daily.sunset[0])}. ${isDay ? `The sun is ${Math.round(f * 100)}% of the way across the sky.` : 'The sun is down.'}` });
  root.append(svg('path', { class: 'sun-track', d: `M${cx - rx},${base} A${rx},${ry} 0 0 1 ${cx + rx},${base}` }));
  if (isDay) {
    const [x, y] = pt(f);
    root.append(svg('path', { class: 'sun-track-done', d: `M${cx - rx},${base} A${rx},${ry} 0 0 1 ${x},${y}` }));
    root.append(svg('circle', { class: 'sun-glow', cx: x, cy: y, r: 18 }));
    root.append(svg('circle', { class: 'sun-dot', cx: x, cy: y, r: 9 }));
  }
  root.append(svg('line', { class: 'sun-horizon', x1: 8, x2: W - 8, y1: base, y2: base }));
  root.append(svg('text', { class: 'chart-tick', x: cx - rx, y: base + 18, 'text-anchor': 'middle' }, fmtClock(daily.sunrise[0])));
  root.append(svg('text', { class: 'chart-tick', x: cx + rx, y: base + 18, 'text-anchor': 'middle' }, fmtClock(daily.sunset[0])));
  if (!isDay) {
    const moon = svg('path', { class: 'sun-moon', d: `M${cx + 6},${base - 58}a22,22 0 1 0 16,30a17,17 0 0 1 -16,-30z` });
    root.append(moon);
  }

  const len = daily.daylight_duration?.[0];
  const next = daily.daylight_duration?.[1];
  const change = Number.isFinite(len) && Number.isFinite(next) ? Math.round((next - len) / 60) : null;
  let status;
  if (isDay) status = `Sunset in ${fmtDuration((set - now) * 60)}`;
  else if (now < rise) status = `Sunrise in ${fmtDuration((rise - now) * 60)}`;
  else {
    const tomorrowRise = daily.sunrise[1] ? parseLocal(daily.sunrise[1]).minutes + 1440 : rise + 1440;
    status = `Sunrise in ${fmtDuration((tomorrowRise - now) * 60)}`;
  }
  const stats = el('dl', 'details sun-stats');
  stats.append(
    detail('Sunrise', fmtClock(daily.sunrise[0])),
    detail('Sunset', fmtClock(daily.sunset[0])),
    detail('Daylight', Number.isFinite(len) ? fmtDuration(len) : fmtDuration((set - rise) * 60),
      change === null ? '' : change === 0 ? 'Same length tomorrow' : `${Math.abs(change)} min ${change > 0 ? 'longer' : 'shorter'} tomorrow`),
    detail('Golden hour', `≈ ${fmtMinutes(set - 60)}`, 'About an hour before sunset'),
  );
  body.replaceChildren(el('p', 'sun-status', status), root, stats);
}

// ---------- Precipitation ----------
let precipDraw = null;
function renderPrecip(data, u) {
  const { current, hourly, daily } = data;
  const body = $('precip-body');
  const start = nowIndex(hourly.time, current.time);
  const idx = Array.from({ length: Math.min(24, hourly.time.length - start) }, (_, k) => start + k);
  const fmtAmt = (v) => (Number.isFinite(v) ? `${u.precip === 'in' ? v.toFixed(2) : v.toFixed(1)} ${u.precip}` : '--');
  const week = daily.precipitation_sum.reduce((a, b) => a + (b || 0), 0);
  const next = idx.find((i) => hourly.precipitation_probability[i] >= 40);
  const summary = next === undefined
    ? 'No rain expected in the next 24 hours.'
    : next === start ? `Rain is possible right now (${hourly.precipitation_probability[next]}% chance).`
      : `Rain ${hourly.precipitation_probability[next] >= 60 ? 'likely' : 'possible'} starting around ${fmtHour(hourly.time[next])} (${hourly.precipitation_probability[next]}% chance).`;

  const stats = el('dl', 'details precip-stats');
  stats.append(
    detail('Today', fmtAmt(daily.precipitation_sum[0]), `${round(daily.precipitation_probability_max[0])}% chance`),
    detail('Right now', fmtAmt(current.precipitation), current.precipitation > 0 ? 'Falling now' : 'Dry at the moment'),
    detail('Next 7 days', fmtAmt(week), Number.isFinite(daily.precipitation_hours?.[0]) ? `${round(daily.precipitation_hours[0])} wet hours today` : ''),
  );
  const chartBox = el('div', 'chart-box');
  body.replaceChildren(el('p', 'precip-summary', summary), stats, el('h3', 'sub-title', 'Chance of rain, next 24 hours'), chartBox);
  precipDraw = () => {
    const chart = barChart(chartBox, {
      values: idx.map((i) => hourly.precipitation_probability[i]),
      max: 100,
      ticks: [0, 50, 100],
      tickFmt: (t) => `${t}%`,
      xLabel: (k) => (k % 6 === 0 ? (k === 0 ? 'Now' : fmtHour(hourly.time[idx[k]])) : null),
      tip: (k) => [k === 0 ? 'Now' : fmtHour(hourly.time[idx[k]]), `${round(hourly.precipitation_probability[idx[k]])}% chance`, `${fmtAmt(hourly.precipitation[idx[k]])} expected`],
      highlight: (k) => k === 0,
      aria: `Hourly chance of rain for the next 24 hours. ${summary}`,
    });
    chartBox.replaceChildren(chart, tableView('Hourly precipitation', ['Time', 'Chance', 'Amount'],
      idx.map((i) => [fmtHour(hourly.time[i]), `${round(hourly.precipitation_probability[i])}%`, fmtAmt(hourly.precipitation[i])])));
  };
  precipDraw();
}

// ---------- Humidity ----------
function comfort(dewF) {
  if (!Number.isFinite(dewF)) return '';
  if (dewF < 50) return 'Dry and comfortable';
  if (dewF < 60) return 'Comfortable';
  if (dewF < 65) return 'A little sticky';
  if (dewF < 70) return 'Muggy';
  if (dewF < 75) return 'Oppressive';
  return 'Miserable';
}

let humidDraw = null;
function renderHumidity(data, units, u) {
  const { current, hourly } = data;
  const body = $('humidity-body');
  const rh = current.relative_humidity_2m;
  const dew = current.dew_point_2m;
  const dewF = units === 'imperial' ? dew : dew * 9 / 5 + 32;
  const head = el('div', 'humid-head');
  const big = el('p', 'humid-value');
  big.append(el('span', 'humid-number', String(round(rh))), el('span', 'humid-unit', '%'));
  const info = el('div');
  info.append(el('p', 'humid-comfort', comfort(dewF)), el('p', 'detail-sub', `Dew point ${round(dew)}${u.temp}`));
  head.append(big, info);

  const meter = el('div', 'meter');
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  meter.setAttribute('aria-valuenow', String(round(rh)));
  meter.setAttribute('aria-label', 'Relative humidity');
  const fill = el('span', 'meter-fill');
  fill.style.width = `${Math.max(0, Math.min(100, rh))}%`;
  meter.append(fill);

  const start = nowIndex(hourly.time, current.time);
  const idx = Array.from({ length: Math.min(24, hourly.time.length - start) }, (_, k) => start + k);
  const chartBox = el('div', 'chart-box');
  body.replaceChildren(head, meter, el('h3', 'sub-title', 'Humidity, next 24 hours'), chartBox);
  humidDraw = () => {
    const values = idx.map((i) => hourly.relative_humidity_2m[i]);
    const chart = lineChart(chartBox, {
      values,
      min: 0,
      max: 100,
      ticks: [0, 50, 100],
      tickFmt: (t) => `${t}%`,
      xLabel: (k) => (k % 6 === 0 ? (k === 0 ? 'Now' : fmtHour(hourly.time[idx[k]])) : null),
      tip: (k) => [k === 0 ? 'Now' : fmtHour(hourly.time[idx[k]]), `Humidity ${round(values[k])}%`, `Dew point ${round(hourly.dew_point_2m[idx[k]])}${u.temp}`],
      aria: `Relative humidity for the next 24 hours, between ${round(Math.min(...values))}% and ${round(Math.max(...values))}%.`,
    });
    chartBox.replaceChildren(chart, tableView('Hourly humidity', ['Time', 'Humidity', 'Dew point'],
      idx.map((i) => [fmtHour(hourly.time[i]), `${round(hourly.relative_humidity_2m[i])}%`, `${round(hourly.dew_point_2m[i])}${u.temp}`])));
  };
  humidDraw();
}

let resizeBound = false;
// Each card renders on its own so one bad field can't blank the others.
function safely(boxId, fn) {
  try { fn(); } catch (err) {
    console.error(`${boxId} render failed`, err);
    $(boxId).replaceChildren(el('p', 'card-note', 'This data isn\u2019t available right now.'));
  }
}

export function renderConditions(data, units, u) {
  safely('wind-body', () => renderWind(data, units, u));
  safely('sun-body', () => renderSun(data));
  safely('precip-body', () => renderPrecip(data, u));
  safely('humidity-body', () => renderHumidity(data, units, u));
  if (!resizeBound) {
    resizeBound = true;
    autoResize($('precip-body'), () => precipDraw?.());
    autoResize($('humidity-body'), () => humidDraw?.());
  }
}
