// WMO weather interpretation codes used by Open-Meteo.
// https://open-meteo.com/en/docs#weathervariables
const CODES = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'partly'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Light freezing drizzle', 'sleet'],
  57: ['Freezing drizzle', 'sleet'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Light freezing rain', 'sleet'],
  67: ['Freezing rain', 'sleet'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Violent showers', 'rain'],
  85: ['Light snow showers', 'snow'],
  86: ['Snow showers', 'snow'],
  95: ['Thunderstorms', 'thunder'],
  96: ['Thunderstorms with hail', 'thunder'],
  99: ['Severe thunderstorms with hail', 'thunder'],
};

export function describe(code) {
  return (CODES[code] || ['Unknown', 'cloudy'])[0];
}

export function kind(code) {
  return (CODES[code] || ['Unknown', 'cloudy'])[1];
}

// ---- Icons (inline SVG, 64x64) ----
const CLOUD = 'M18 48H46A10 10 0 0 0 46 28A14 14 0 0 0 20 26A11 11 0 0 0 18 48Z';

const sun = (cx, cy, r) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 9), y2 = cy + Math.sin(a) * (r + 9);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join('');
  return `<g class="i-sun"><g class="i-rays">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}"/></g>`;
};

const moon = (cx, cy, r) =>
  `<path class="i-moon" d="M${cx + r * 0.35} ${cy - r}A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.35}A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.35} ${cy - r}Z"/>`;

const cloud = (transform = '', cls = 'i-cloud') =>
  `<path class="${cls}" d="${CLOUD}" transform="${transform}"/>`;

const lines = (xs, y1, y2, slant = 3) =>
  xs.map((x) => `<line x1="${x}" y1="${y1}" x2="${x - slant}" y2="${y2}"/>`).join('');

const flakes = (pts) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6"/>`).join('');

export function icon(code, isDay = true) {
  const k = kind(code);
  let body;
  switch (k) {
    case 'clear':
      body = isDay ? sun(32, 32, 12) : moon(32, 32, 16);
      break;
    case 'partly':
      body = (isDay ? sun(24, 22, 9) : moon(24, 22, 11)) + cloud('translate(6 6)');
      break;
    case 'cloudy':
      body = cloud('translate(-8 -4) scale(0.8)', 'i-cloud i-cloud-back') + cloud('translate(4 4)');
      break;
    case 'fog':
      body = cloud('translate(0 -8)') +
        `<g class="i-fog"><line x1="12" y1="48" x2="52" y2="48"/><line x1="16" y1="55" x2="48" y2="55"/></g>`;
      break;
    case 'drizzle':
      body = cloud('translate(0 -8)') + `<g class="i-rain">${lines([26, 38], 47, 53, 2)}</g>`;
      break;
    case 'rain':
      body = cloud('translate(0 -8)') + `<g class="i-rain">${lines([22, 32, 42], 46, 58)}</g>`;
      break;
    case 'sleet':
      body = cloud('translate(0 -8)') +
        `<g class="i-rain">${lines([24, 40], 46, 56)}</g><g class="i-snow">${flakes([[32, 52]])}</g>`;
      break;
    case 'snow':
      body = cloud('translate(0 -8)') + `<g class="i-snow">${flakes([[22, 49], [32, 55], [42, 49], [27, 60], [38, 60]])}</g>`;
      break;
    case 'thunder':
      body = cloud('translate(0 -10)') +
        `<polygon class="i-bolt" points="35,38 25,52 32,52 28,62 41,46 34,46 38,38"/>` +
        `<g class="i-rain">${lines([20, 46], 44, 52, 2)}</g>`;
      break;
    default:
      body = cloud('translate(0 0)');
  }
  return `<svg class="wx-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
}
