// Netlify Function: recent lightning flashes near a point.
//
// Source: NOAA GOES-19 (GOES-East) Geostationary Lightning Mapper (GLM),
// Level 2 "LCFA" files, published every 20 seconds to the public NOAA Open Data
// bucket on AWS (noaa-goes19). Public domain. Each file lists flash centroids
// (lat/lon) and a quality flag. GLM sees total lightning: cloud-to-ground and
// in-cloud flashes.
//
// GET /api/lightning?lat=26.5&lon=-80  ->  flashes from the last 30 minutes
// within ~240 miles of that point, newest first. Responses are cached at
// Netlify's CDN for a minute, so many visitors share one fetch.

import * as hdf5 from 'jsfive';

const BUCKET = 'https://noaa-goes19.s3.amazonaws.com';
const PRODUCT = 'GLM-L2-LCFA';
export const WINDOW_MIN = 30;
export const RADIUS_MI = 240; // 200 mi shown in the app + margin for the rounded query point
const MAX_FLASHES = 20000;
const CONCURRENCY = 16;
const FETCH_TIMEOUT_MS = 6000;
const DEADLINE_MS = 8500; // stay under the 10 s synchronous function limit
const EPOCH_2000_NOON = Date.UTC(2000, 0, 1, 12); // GLM product_time reference

// Parsed files survive between invocations while the function stays warm.
const fileCache = new Map(); // key -> { start, lat: Float32Array, lon: Float32Array }

const pad = (n, w = 2) => String(n).padStart(w, '0');

function hourPrefix(ms) {
  const d = new Date(ms);
  const doy = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  return `${PRODUCT}/${d.getUTCFullYear()}/${pad(doy, 3)}/${pad(d.getUTCHours())}/`;
}

// OR_GLM-L2-LCFA_G19_s20262951738400_e..._c....nc -> start time (ms, UTC)
export function startTime(key) {
  const m = key.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_/);
  if (!m) return NaN;
  const [, y, doy, hh, mm, ss, tenth] = m.map(Number);
  return Date.UTC(y, 0, 1) + (doy - 1) * 86400000 + hh * 3600000 + mm * 60000 + ss * 1000 + tenth * 100;
}

async function fetchWithTimeout(url, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function listKeys(prefix, fetchImpl) {
  const res = await fetchWithTimeout(`${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`, fetchImpl);
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]+\.nc)<\/Key>/g)].map((m) => m[1]);
}

export function parseGlm(arrayBuffer, name = 'glm.nc') {
  const f = new hdf5.File(arrayBuffer, name);
  const lat = f.get('flash_lat').value;
  const lon = f.get('flash_lon').value;
  let quality = null;
  try { quality = f.get('flash_quality_flag').value; } catch { /* older files */ }
  let start = NaN;
  try {
    const pt = f.get('product_time').value;
    start = EPOCH_2000_NOON + (Array.isArray(pt) || ArrayBuffer.isView(pt) ? pt[0] : pt) * 1000;
  } catch { /* fall back to the file name */ }
  const keep = [];
  for (let i = 0; i < lat.length; i++) {
    if (quality && quality[i] !== 0) continue; // 0 = good
    if (Number.isFinite(lat[i]) && Number.isFinite(lon[i])) keep.push(i);
  }
  return {
    start,
    lat: Float32Array.from(keep, (i) => lat[i]),
    lon: Float32Array.from(keep, (i) => lon[i]),
  };
}

async function loadFile(key, fetchImpl) {
  const hit = fileCache.get(key);
  if (hit) return hit;
  const res = await fetchWithTimeout(`${BUCKET}/${key}`, fetchImpl);
  const parsed = parseGlm(await res.arrayBuffer(), key);
  if (!Number.isFinite(parsed.start)) parsed.start = startTime(key);
  fileCache.set(key, parsed);
  return parsed;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i]); } catch (err) { results[i] = err; }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function recentFlashes({ lat, lon, now = Date.now(), fetchImpl = fetch }) {
  const since = now - WINDOW_MIN * 60000;
  const prefixes = [...new Set([hourPrefix(since), hourPrefix(now)])];
  const listed = (await Promise.all(prefixes.map((p) => listKeys(p, fetchImpl)))).flat();
  const keys = listed.filter((k) => startTime(k) >= since - 20000).sort();

  // Drop cached files that have aged out of the window.
  for (const [k, v] of fileCache) if (v.start < since - 120000) fileCache.delete(k);

  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve('deadline'), DEADLINE_MS); });
  const loaded = await Promise.race([pool(keys, CONCURRENCY, (k) => loadFile(k, fetchImpl)), deadline]);
  clearTimeout(timer);
  const partial = loaded === 'deadline';
  const files = partial ? keys.map((k) => fileCache.get(k)).filter(Boolean) : loaded.filter((r) => r && !(r instanceof Error));

  const flashes = [];
  let newest = 0;
  for (const file of files) {
    if (file.start < since) continue;
    newest = Math.max(newest, file.start + 20000);
    const age = Math.max(0, Math.round((now - file.start) / 1000));
    for (let i = 0; i < file.lat.length; i++) {
      // cheap box test before the exact distance
      if (Math.abs(file.lat[i] - lat) > 4 || Math.abs(file.lon[i] - lon) > 5.5) continue;
      if (milesBetween(lat, lon, file.lat[i], file.lon[i]) <= RADIUS_MI) {
        flashes.push([Math.round(file.lat[i] * 1e4) / 1e4, Math.round(file.lon[i] * 1e4) / 1e4, age]);
      }
    }
  }
  flashes.sort((a, b) => a[2] - b[2]);
  return {
    source: 'NOAA GOES-19 GLM (Geostationary Lightning Mapper), L2 LCFA',
    generated: new Date(now).toISOString(),
    latestData: newest ? new Date(newest).toISOString() : null,
    windowMinutes: WINDOW_MIN,
    center: [lat, lon],
    radiusMiles: RADIUS_MI,
    files: files.length,
    filesExpected: keys.length,
    partial,
    flashes: flashes.slice(0, MAX_FLASHES),
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 60 || Math.abs(lon) > 180) {
    return Response.json({ error: 'Pass lat (within ±60) and lon as numbers.' }, { status: 400 });
  }
  try {
    const body = await recentFlashes({ lat, lon });
    return Response.json(body, {
      headers: {
        'Cache-Control': 'public, max-age=20',
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Lightning data is temporarily unavailable.' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
};

export const config = { path: '/api/lightning' };
