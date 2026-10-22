// FAU Owl Weather's own basemap, drawn from bundled Natural Earth data
// (public domain): land, lakes, borders, major highways and city labels.
// No map provider or API key needed. An optional "Streets" view swaps in
// OpenStreetMap tiles for street-level detail.

const DATA_URL = '/data/basemap-na.json';
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const STYLES = {
  day: {
    water: '#a8cfe6', land: '#f4f1e8', lake: '#a8cfe6', lakeLine: '#86b6d3',
    country: '#5f6b7a', state: '#9aa4b0', road: '#e6a23c', roadMinor: '#efc583',
  },
  night: {
    water: '#0b1d33', land: '#2f3d50', lake: '#0b1d33', lakeLine: '#1d3a5c',
    country: '#9fb0c8', state: '#62738c', road: '#a08452', roadMinor: '#6e6248',
  },
};

// Which city ranks (Natural Earth scalerank, lower = bigger) show at each zoom.
const RANK_FOR_ZOOM = [[4, 2], [5, 3], [6, 6], [7, 7], [8, 8], [9, 10]];

function loadAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    node.onload = resolve;
    node.onerror = () => reject(new Error(`Failed to load ${attrs.src || attrs.href}`));
    document.head.append(node);
  });
}

let leafletPromise;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ||= Promise.all([
    loadAsset('link', { rel: 'stylesheet', href: '/vendor/leaflet-1.9.4/leaflet.css' }),
    loadAsset('script', { src: '/vendor/leaflet-1.9.4/leaflet.js' }),
  ]).then(() => window.L);
  return leafletPromise;
}

let dataPromise;
function loadData() {
  dataPromise ||= fetch(DATA_URL).then((res) => {
    if (!res.ok) throw new Error(`Basemap data: HTTP ${res.status}`);
    return res.json();
  });
  return dataPromise;
}

function maxRank(zoom) {
  let rank = 1;
  for (const [z, r] of RANK_FOR_ZOOM) if (zoom >= z) rank = r;
  return rank;
}

/**
 * Add the basemap to a Leaflet map. Returns { ready, setStreets(on) }.
 * Panes: base (land/lakes) < baseLines (borders/roads) < tiles (radar) < overlays < baseLabels.
 */
export function addBasemap(map, { style = 'day' } = {}) {
  const L = window.L;
  const s = STYLES[style];
  const container = map.getContainer();
  container.classList.add('owl-map', `owl-map-${style}`);
  container.style.background = s.water;

  const pane = (name, z) => {
    const p = map.getPane(name) || map.createPane(name);
    p.style.zIndex = z;
    p.style.pointerEvents = 'none';
    return name;
  };
  pane('base', 150);
  pane('baseLines', 160);
  pane('baseLabels', 645);
  const fillRenderer = L.canvas({ pane: 'base', padding: 0.4 });
  const lineRenderer = L.canvas({ pane: 'baseLines', padding: 0.4 });

  const own = L.layerGroup().addTo(map);
  const labels = L.layerGroup().addTo(map);
  const streets = L.tileLayer(OSM_URL, {
    maxZoom: 19,
    zIndex: 1,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  });
  map.attributionControl.addAttribution('Map data: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>');

  let roadsMajor;
  let roadsMinor;
  let places = [];
  let streetsOn = false;

  const geo = (geoms, opts) => L.geoJSON(geoms, { interactive: false, ...opts });

  const ready = loadData().then((data) => {
    const fill = (color) => ({ renderer: fillRenderer, style: { stroke: false, fill: true, fillColor: color, fillOpacity: 1 } });
    geo(data.world, fill(s.land)).addTo(own);
    geo(data.land, fill(s.land)).addTo(own);
    geo(data.lakes, { renderer: fillRenderer, style: { color: s.lakeLine, weight: 0.8, fill: true, fillColor: s.lake, fillOpacity: 1 } }).addTo(own);
    geo(data.states, { renderer: lineRenderer, style: { color: s.state, weight: 0.9, dashArray: '4 3', fill: false } }).addTo(own);
    geo(data.countries, { renderer: lineRenderer, style: { color: s.country, weight: 1.4, fill: false } }).addTo(own);
    roadsMajor = geo(data.roads.filter((r) => r[0] <= 4).map((r) => r[1]), { renderer: lineRenderer, style: { color: s.road, weight: 1.6, fill: false } });
    roadsMinor = geo(data.roads.filter((r) => r[0] > 4).map((r) => r[1]), { renderer: lineRenderer, style: { color: s.roadMinor, weight: 1, fill: false } });
    places = data.places;
    update();
  }).catch((err) => {
    console.error(err);
    setStreets(true); // fall back to street tiles if our data can't load
  });

  function update() {
    const z = map.getZoom();
    if (!streetsOn && roadsMajor) {
      toggle(roadsMajor, z >= 5);
      toggle(roadsMinor, z >= 7);
    }
    labels.clearLayers();
    if (streetsOn) return; // OSM tiles already have labels
    const bounds = map.getBounds().pad(0.1);
    const limit = maxRank(z);
    const shown = [];
    places
      .filter(([, lon, lat, rank]) => rank <= limit && bounds.contains([lat, lon]))
      .sort((a, b) => a[3] - b[3])
      .forEach(([name, lon, lat, rank]) => {
        // skip labels that would overlap an already-placed bigger city
        const p = map.latLngToContainerPoint([lat, lon]);
        if (shown.some((q) => Math.abs(q.x - p.x) < 70 && Math.abs(q.y - p.y) < 16)) return;
        shown.push(p);
        const size = rank <= 2 ? 'is-major' : rank <= 5 ? 'is-mid' : '';
        L.marker([lat, lon], {
          pane: 'baseLabels',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({ className: `owl-label owl-label-${style} ${size}`, html: '<i></i><span></span>', iconSize: [0, 0] }),
        }).addTo(labels).getElement().querySelector('span').textContent = name;
      });
  }

  function toggle(layer, on) {
    if (on && !own.hasLayer(layer)) own.addLayer(layer);
    if (!on && own.hasLayer(layer)) own.removeLayer(layer);
  }

  function setStreets(on) {
    streetsOn = on;
    if (on) {
      map.removeLayer(own);
      streets.addTo(map);
      container.style.background = '#f2efe9';
    } else {
      map.removeLayer(streets);
      own.addTo(map);
      container.style.background = s.water;
    }
    container.classList.toggle('is-streets', on);
    update();
  }

  // Map style switch: our map vs. street detail
  const Switch = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const box = L.DomUtil.create('div', 'leaflet-bar owl-map-switch');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Map style');
      [['Map', false], ['Streets', true]].forEach(([label, value]) => {
        const btn = L.DomUtil.create('button', '', box);
        btn.type = 'button';
        btn.textContent = label;
        btn.setAttribute('aria-pressed', String(value === streetsOn));
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.stop(e);
          setStreets(value);
          box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        });
      });
      L.DomEvent.disableClickPropagation(box);
      return box;
    },
  });
  new Switch().addTo(map);

  map.on('zoomend moveend', update);
  return { ready, setStreets };
}
