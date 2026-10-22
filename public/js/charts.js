// Small SVG chart helpers (single-series bar and line charts) with hover
// tooltips and a table view. Marks follow the app's chart rules: thin bars with
// 4px rounded tops, 2px gaps, 2px lines, hairline grid, text in text colors.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let tipEl;
export function showTip(evt, lines) {
  if (!tipEl) {
    tipEl = el('div', 'chart-tooltip');
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  tipEl.replaceChildren(...lines.map((l, i) => el(i === 0 ? 'strong' : 'span', '', l)));
  tipEl.hidden = false;
  const { clientX: x, clientY: y } = evt;
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
  const top = y - h - 12 < 8 ? y + 12 : y - h - 12;
  tipEl.style.left = `${left + window.scrollX}px`;
  tipEl.style.top = `${top + window.scrollY}px`;
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

export function tableView(caption, headers, rows) {
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

// Re-render a chart when its box changes width.
export function autoResize(box, draw) {
  let w = 0;
  new ResizeObserver(([entry]) => {
    const nw = Math.round(entry.contentRect.width);
    if (Math.abs(nw - w) > 8) { w = nw; draw(); }
  }).observe(box);
}

function frame(box, height, m, aria) {
  const width = Math.max(box.clientWidth, 260);
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': aria });
  return { root, width, plotW: width - m.left - m.right, plotH: height - m.top - m.bottom };
}

function grid(root, m, width, y, ticks, fmt) {
  ticks.forEach((t) => {
    root.append(svg('line', { class: 'chart-grid', x1: m.left, x2: width - m.right, y1: y(t), y2: y(t) }));
    root.append(svg('text', { class: 'chart-tick', x: m.left - 6, y: y(t) + 4, 'text-anchor': 'end' }, fmt(t)));
  });
}

/**
 * Column chart. opts: values[], max, ticks[], tickFmt, xLabel(i) -> string|null,
 * tip(i) -> [lines], aria, highlight(i) -> bool
 */
export function barChart(box, opts) {
  const height = opts.height || 170;
  const m = { top: 14, right: 6, bottom: 26, left: 34 };
  const { root, width, plotW, plotH } = frame(box, height, m, opts.aria);
  const n = opts.values.length;
  const band = plotW / n;
  const barW = Math.min(24, Math.max(band - 2, 1));
  const y = (v) => m.top + plotH - (Math.min(v, opts.max) / opts.max) * plotH;
  grid(root, m, width, y, opts.ticks, opts.tickFmt);
  opts.values.forEach((v, k) => {
    const x = m.left + k * band + (band - barW) / 2;
    if (Number.isFinite(v) && v > 0) {
      const top = y(v);
      const base = y(0);
      const r = Math.min(4, barW / 2, base - top);
      root.append(svg('path', {
        class: opts.highlight?.(k) ? 'chart-bar is-now' : 'chart-bar',
        d: `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${base}Z`,
      }));
    }
    const label = opts.xLabel(k);
    if (label) root.append(svg('text', { class: 'chart-tick', x: m.left + k * band + band / 2, y: height - 8, 'text-anchor': 'middle' }, label));
  });
  opts.values.forEach((_, k) => {
    const hit = svg('rect', { class: 'chart-hit', x: m.left + k * band, y: m.top, width: band, height: plotH });
    hit.addEventListener('pointermove', (e) => showTip(e, opts.tip(k)));
    hit.addEventListener('pointerleave', hideTip);
    root.append(hit);
  });
  return root;
}

/**
 * Line chart with a 10% area wash and crosshair tooltip.
 * opts: values[], min, max, ticks[], tickFmt, xLabel(i), tip(i), aria
 */
export function lineChart(box, opts) {
  const height = opts.height || 160;
  const m = { top: 14, right: 10, bottom: 26, left: 34 };
  const { root, width, plotW, plotH } = frame(box, height, m, opts.aria);
  const n = opts.values.length;
  const x = (i) => m.left + (i / Math.max(n - 1, 1)) * plotW;
  const y = (v) => m.top + plotH - ((v - opts.min) / (opts.max - opts.min)) * plotH;
  grid(root, m, width, y, opts.ticks, opts.tickFmt);
  const pts = opts.values.map((v, i) => [x(i), y(v)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  const base = m.top + plotH;
  root.append(svg('path', { class: 'chart-area', d: `${d}L${pts[n - 1][0]},${base}L${pts[0][0]},${base}Z` }));
  root.append(svg('path', { class: 'chart-line', d }));
  root.append(svg('circle', { class: 'chart-dot', cx: pts[0][0], cy: pts[0][1], r: 4.5 }));
  for (let i = 0; i < n; i++) {
    const label = opts.xLabel(i);
    if (label) root.append(svg('text', { class: 'chart-tick', x: x(i), y: height - 8, 'text-anchor': 'middle' }, label));
  }
  const cross = svg('line', { class: 'chart-cross', y1: m.top, y2: base, visibility: 'hidden' });
  const dot = svg('circle', { class: 'chart-dot', r: 4.5, visibility: 'hidden' });
  const hit = svg('rect', { class: 'chart-hit', x: m.left, y: 0, width: plotW, height });
  root.append(cross, dot, hit);
  hit.addEventListener('pointermove', (e) => {
    const rect = root.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (width / rect.width);
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.left) / plotW) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(opts.values[i])); dot.setAttribute('visibility', 'visible');
    showTip(e, opts.tip(i));
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
  return root;
}
