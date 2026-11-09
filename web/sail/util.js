'use strict';
// ---- globaler Zustand ----
const S = { user: null, csrf: null, totp: false, year: new Date().getFullYear(), view: 'cockpit' };
const $app = document.getElementById('app');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v; // nur für eigene, statische SVGs
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

// hängt Kinder an und überspringt null/false (sonst erscheint "null" als Text)
const put = (parent, ...kids) => { parent.append(...kids.flat().filter(k => k != null && k !== false)); return parent; };

async function api(path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (method !== 'GET') opt.headers['X-CSRF-Token'] = S.csrf || '';
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.user) { S.user = null; boot(); }
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.data = j; e.status = r.status; throw e; }
  return j;
}

// ---- Icons (eigene Linien-Icons, 24er Raster) ----
const ICONS = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2.1 5.5-5.5 2.1 2.1-5.5z"/>',
  chart: '<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  book: '<path d="M5 4.5h11.5A2.5 2.5 0 0119 7v13H7.5A2.5 2.5 0 015 17.5z"/><path d="M9 9h6M9 12.5h6"/>',
  flag: '<path d="M5.5 21V4M5.5 5h12.5l-2.8 4 2.8 4H5.5"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3 3 0 000-6h-5a3 3 0 010-6H16"/>',
  wind: '<path d="M3 9h11a2.5 2.5 0 10-2.5-2.5M3 14h15a2.5 2.5 0 11-2.5 2.5M3 19h8"/>',
  crew: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><path d="M16 5.8a3 3 0 010 5.4M18 14.6c1.6.6 2.7 2 3 4.4"/>',
  boat: '<path d="M12 3v14M12 4.5L19 15h-7zM11 7L5.5 15H11z"/><path d="M3.5 18.5h17l-2.2 2.5H5.7z"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 01-1-1v-5a2 2 0 012-2h12a2 2 0 012 2v5a1 1 0 01-1 1h-2"/><path d="M7 14h10v6H7z"/>',
  download: '<path d="M12 4v11M7.5 11L12 15.5 16.5 11M5 20h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
  arrow: '<path d="M12 3l6.5 11h-4.7V21h-3.6v-7H5.5z" fill="currentColor" stroke="none"/>',
};
function ic(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.5v20M16 5.5l9.5 16H16zM15 9L6.5 21.5H15z" fill="currentColor"/><path d="M4.5 27h23" stroke="#e5528d" stroke-width="2.6"/></svg>';
const logo = () => h('span', { html: LOGO, style: 'display:inline-grid;color:var(--ink)' });

function toast(msg, ms = 3600) {
  const t = h('div', { class: 'toast', role: 'status' }, ic('check'), msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

// ---- Theme ----
const prefersDark = () => document.documentElement.dataset.theme === 'dark';
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('mosisail_theme', t); } catch (e) {}
  document.dispatchEvent(new CustomEvent('themechange'));
}

// ---- Seefahrt-Helfer ----
const BFT_LIMITS = [1, 4, 7, 11, 16, 22, 28, 34, 41, 48, 56, 64];
const bft = kn => { let b = 0; for (const l of BFT_LIMITS) if (kn >= l) b++; return b; };
// Farbskala: von Flaute (grau) über Segelwind (grün/gelb) bis Sturm (Magenta/Violett), auf Hell und Dunkel lesbar
const BFT_COL = ['#8aa0ab', '#4d8fb5', '#2f7fa8', '#1f8f7a', '#4f9a3a', '#a3a62a', '#d99a14', '#d9701a', '#cf4a2b', '#b0245f', '#8a1b6a', '#6a1a73', '#4c1a73'];
const windColor = kn => BFT_COL[bft(kn)];
const DIRS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const dirText = d => d == null ? '–' : DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const nf = (v, d) => v == null || isNaN(v) ? '–' : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d });
const f1 = v => nf(v, 1), f0 = v => nf(v, 0);
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const hhmm = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

// Orientierung für den Wind (keine Sicherheitsfreigabe)
function conditions(avg, gust) {
  const g = Math.max(avg ?? 0, gust ?? 0);
  if (avg == null) return { t: 'Keine Daten', c: '#8aa0ab' };
  if (g >= 34) return { t: 'Sturm. Nicht auslaufen.', c: '#8a1b6a' };
  if (g >= 25 || avg >= 22) return { t: 'Starkwind. Reffen, Vorsicht.', c: '#cf4a2b' };
  if (avg >= 16) return { t: 'Frischer Wind', c: '#d99a14' };
  if (avg >= 7) return { t: 'Gute Segelbedingungen', c: '#1f8f7a' };
  if (avg >= 3) return { t: 'Leichter Wind', c: '#2f7fa8' };
  return { t: 'Flaute', c: '#8aa0ab' };
}

// Pfeil in Windrichtung (dir = Grad, woher der Wind kommt)
function windArrow(dir, color, size = 26) {
  const a = ic('arrow'); a.setAttribute('width', size); a.setAttribute('height', size);
  a.style.cssText = `transform:rotate(${(dir + 180) % 360}deg);color:${color};width:${size}px;height:${size}px`;
  return a;
}

function haversineNM(a, b) {
  const R = 3440.065, r = Math.PI / 180, dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r;
  const x = Math.sin(dla / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const routeNM = r => (r || []).reduce((s, p, i) => i ? s + haversineNM(r[i - 1], p) : 0, 0);
const berlinHour = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T').slice(0, 13);

// Ammersee
const LAKE = { lat: 47.995, lon: 11.13, zoom: 12 };

// Kartenkacheln: ruhige Graukarte (CARTO), passend zum Theme
function tileLayer(dark) {
  const v = dark ? 'dark_all' : 'light_all';
  return L.tileLayer(`https://{s}.basemaps.cartocdn.com/${v}/{z}/{x}/{y}.png`, { subdomains: 'abcd', maxZoom: 18, attribution: '© OpenStreetMap · © CARTO' });
}

// ---- Animation: Zahl hochzählen ----
function countUp(el, to, dec = 0, ms = 1100, from = 0) {
  const fmt = v => nf(v, dec);
  if (REDUCED || to == null || isNaN(to)) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), d = to - from;
  el.dataset.v = to;
  const step = now => {
    if (!el.isConnected || +el.dataset.v !== to) return;
    const p = Math.min((now - t0) / ms, 1), e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(from + d * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const num = (to, dec = 0, from = 0, ms) => { const s = h('span', { class: 'num' }, nf(from, dec)); countUp(s, to, dec, ms, from); return s; };

// ---- Routen-Vorschau (ohne Kartenkacheln, zeichnet sich selbst) ----
function routeThumb(route, w = 150, hgt = 64) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('class', 'thumb'); svg.setAttribute('aria-hidden', 'true');
  const el = (t, a) => { const n = document.createElementNS('http://www.w3.org/2000/svg', t); for (const k in a) n.setAttribute(k, a[k]); svg.append(n); return n; };
  if (!route || route.length < 2) { el('path', { d: `M6 ${hgt / 2}H${w - 6}`, class: 'noroute' }); return svg; }
  const lat = route.map(p => p[0]), lon = route.map(p => p[1]), la0 = Math.min(...lat), la1 = Math.max(...lat), lo0 = Math.min(...lon), lo1 = Math.max(...lon);
  const k = Math.cos(((la0 + la1) / 2) * Math.PI / 180), dx = Math.max((lo1 - lo0) * k, 1e-5), dy = Math.max(la1 - la0, 1e-5), pad = 7;
  const sc = Math.min((w - 2 * pad) / dx, (hgt - 2 * pad) / dy), ox = (w - dx * sc) / 2, oy = (hgt - dy * sc) / 2;
  const P = p => [ox + (p[1] - lo0) * k * sc, hgt - oy - (p[0] - la0) * sc];
  const pts = route.map(P);
  const d = 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
  el('path', { d, pathLength: 1, class: 'draw' });
  el('circle', { cx: pts[0][0], cy: pts[0][1], r: 3.2, class: 's' });
  el('circle', { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: 3.2, class: 'e' });
  return svg;
}

// ---- Stempel (Saisonabschluss) ----
function stampSvg(year, slam) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="stamp${slam ? ' slam' : ''}" viewBox="0 0 132 132" role="img" aria-label="Saison ${year} abgeschlossen">
    <circle cx="66" cy="66" r="62" stroke-width="3"/><circle cx="66" cy="66" r="55" stroke-width="1"/><circle cx="66" cy="66" r="33" stroke-width="1"/>
    <defs><path id="stpath" d="M66,66 m-44.5,0 a44.5,44.5 0 1,1 89,0 a44.5,44.5 0 1,1 -89,0"/></defs>
    <text class="sm" dy="4"><textPath href="#stpath" textLength="276" lengthAdjust="spacing">SAISONABSCHLUSS · MOSISAIL · AMMERSEE ·</textPath></text>
    <text class="big" x="66" y="76">${year}</text></svg>`;
  return t.content.firstChild;
}

// ---- Live-Wind (für Messleiste und Cockpit) ----
const Live = {
  cur: null, subs: [],
  on(fn) { this.subs.push(fn); if (this.cur) fn(this.cur); return () => { this.subs = this.subs.filter(x => x !== fn); }; },
  async load() {
    try { this.cur = await api('/api/weather/current'); this.subs.forEach(f => f(this.cur)); } catch (e) { this.err = e; this.subs.forEach(f => f(this.cur, e)); }
    return this.cur;
  },
};
