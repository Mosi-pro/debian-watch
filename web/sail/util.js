'use strict';
// ---- globaler Zustand ----
const S = { user: null, csrf: null, totp: false, year: new Date().getFullYear(), view: 'cockpit' };
const $app = document.getElementById('app');

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

function toast(msg, ms = 3200) {
  const t = h('div', { class: 'toast' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

// ---- Seefahrt-Helfer ----
const BFT_LIMITS = [1, 4, 7, 11, 16, 22, 28, 34, 41, 48, 56, 64];
const bft = kn => { let b = 0; for (const l of BFT_LIMITS) if (kn >= l) b++; return b; };
const BFT_COL = ['#7a8ba6', '#7fd1ff', '#4fc3f7', '#2dd4a5', '#7bd957', '#d4e157', '#ffc247', '#ff9a3d', '#ff6b4a', '#f0436b', '#c2185b', '#9c27b0', '#7b1fa2'];
const windColor = kn => BFT_COL[bft(kn)];
const DIRS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const dirText = d => d == null ? '–' : DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const f1 = v => v == null || isNaN(v) ? '–' : (Math.round(v * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const f0 = v => v == null || isNaN(v) ? '–' : Math.round(v).toLocaleString('de-DE');
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const hhmm = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

// Orientierung für den Wind (keine Sicherheitsfreigabe)
function conditions(avg, gust) {
  const g = Math.max(avg ?? 0, gust ?? 0);
  if (avg == null) return { t: 'keine Daten', c: '#7a8ba6' };
  if (g >= 34) return { t: 'Sturm – nicht auslaufen', c: '#ff5d73' };
  if (g >= 25 || avg >= 22) return { t: 'Starkwind – Reffen / Vorsicht', c: '#ff6b4a' };
  if (avg >= 16) return { t: 'Frischer Wind', c: '#ffc247' };
  if (avg >= 7) return { t: 'Gute Segelbedingungen', c: '#2dd4a5' };
  if (avg >= 3) return { t: 'Leichter Wind', c: '#4fc3f7' };
  return { t: 'Flaute', c: '#7a8ba6' };
}

// Pfeil (zeigt in Richtung, in die der Wind weht); dir = Grad, woher der Wind kommt
const arrowSvg = (dir, color, size = 26) => h('span', { html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${(dir + 180) % 360}deg)"><path d="M12 2l6 9h-4v11h-4V11H6z" fill="${color}"/></svg>` });

const ICON = {
  cockpit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 12l4-6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M9 9h6M9 13h6"/></svg>',
  season: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  logo: '<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0a2a47"/><path d="M16 5v19M16 6l8 14h-8zM15 9L8 20h7z" fill="#33d6ff"/><path d="M6 26c3-2 6 2 10 0s7 2 10 0" stroke="#33d6ff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  boat: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M32 8v38M32 10l18 30H32zM30 16L14 40h16M8 50h48l-6 8H14z"/></svg>',
};
const icon = k => h('span', { html: ICON[k] || '' });

function haversineNM(a, b) {
  const R = 3440.065, r = Math.PI / 180, dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r;
  const x = Math.sin(dla / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const routeNM = r => (r || []).reduce((s, p, i) => i ? s + haversineNM(r[i - 1], p) : 0, 0);

// aktuelle Zeit als lokaler Berliner Zeitstring "YYYY-MM-DDTHH"
const berlinHour = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T').slice(0, 13);

// Ammersee
const LAKE = { lat: 47.995, lon: 11.13, zoom: 12 };

// Tile-Layer (Hell/Dunkel)
function tileLayer(dark) {
  return dark
    ? L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { subdomains: 'abcd', maxZoom: 18, attribution: '© OpenStreetMap © CARTO' })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' });
}
const prefersDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
