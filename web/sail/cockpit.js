'use strict';
// ---- Timer-Verwaltung: beim Ansichtswechsel aufräumen ----
const timers = [];
const every = (fn, ms) => { const id = setInterval(fn, ms); timers.push(id); return id; };
const clearTimers = () => { while (timers.length) clearInterval(timers.pop()); };

function compassSvg() {
  let ticks = '';
  for (let a = 0; a < 360; a += 10) {
    const len = a % 90 === 0 ? 14 : a % 30 === 0 ? 10 : 5, r1 = 128, r2 = r1 - len, rad = (a - 90) * Math.PI / 180;
    ticks += `<line class="tick" x1="${150 + r1 * Math.cos(rad)}" y1="${150 + r1 * Math.sin(rad)}" x2="${150 + r2 * Math.cos(rad)}" y2="${150 + r2 * Math.sin(rad)}" stroke-width="${a % 90 === 0 ? 2 : 1}"/>`;
  }
  const lab = (t, a) => { const rad = (a - 90) * Math.PI / 180; return `<text x="${150 + 104 * Math.cos(rad)}" y="${155 + 104 * Math.sin(rad)}">${t}</text>`; };
  return `<svg class="compass" viewBox="0 0 300 300" role="img" aria-label="Windrose">
    <circle class="ring" cx="150" cy="150" r="140"/><circle class="ring" cx="150" cy="150" r="82" stroke-dasharray="2 6"/>
    <circle class="avgring" id="avgring" cx="150" cy="150" r="146" stroke-width="6" transform="rotate(-90 150 150)" stroke-dasharray="0 999"/>
    <circle class="gustring" id="gustring" cx="150" cy="150" r="136" stroke-width="3" transform="rotate(-90 150 150)" stroke-dasharray="0 999"/>
    ${ticks}${lab('N', 0)}${lab('O', 90)}${lab('S', 180)}${lab('W', 270)}
    <g class="arrow" id="arrow"><path d="M150 40l22 62h-14v108h-16V102h-14z" fill="var(--acc)" opacity=".95"/><circle cx="150" cy="150" r="6" fill="var(--bg)" stroke="var(--acc)" stroke-width="2"/></g>
  </svg>`;
}

function cockpitView(root) {
  const hero = h('div', { class: 'hero' });
  const tiles = h('div', { class: 'grid tiles', style: 'margin-top:14px' });
  const chartCard = h('div', { class: 'card', style: 'margin-top:14px' });
  const fcCard = h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', {}, 'Vorhersage Ammersee (Modell, Seemitte)'), h('div', { class: 'fc', id: 'fc' }, h('span', { class: 'mut' }, 'lädt …')));
  root.append(hero, tiles, chartCard, fcCard);

  let days = 1, src = 'h', cur = null, hist = [];
  hero.append(h('div', { html: compassSvg() }), h('div', { id: 'herotxt' }, h('span', { class: 'mut' }, 'Lade Wetterdaten …')));

  const ringLen = 2 * Math.PI * 146;
  function drawHero() {
    const st = cur.station, wk = st.wind_kn, gk = st.gust_kn, dir = st.wind_dir;
    const cond = conditions(wk, gk), col = windColor(wk ?? 0);
    const arrow = hero.querySelector('#arrow');
    if (dir != null) arrow.style.transform = `rotate(${(dir + 180) % 360}deg)`;
    arrow.querySelector('path').setAttribute('fill', col);
    arrow.style.opacity = (wk ?? 0) < 1 ? .3 : 1;
    const frac = k => Math.min((k ?? 0) / 40, 1) * 0.98;
    hero.querySelector('#avgring').setAttribute('stroke-dasharray', `${frac(wk) * ringLen} 999`);
    hero.querySelector('#avgring').style.strokeOpacity = frac(wk) > 0.005 ? 1 : 0;
    hero.querySelector('#gustring').style.strokeOpacity = frac(gk) > 0.005 ? 1 : 0;
    hero.querySelector('#avgring').setAttribute('stroke', col);
    const gr = 2 * Math.PI * 136;
    hero.querySelector('#gustring').setAttribute('stroke-dasharray', `${frac(gk) * gr} 999`);
    const t = st.time ? hhmm(st.time) : '';
    const age = st.time ? Math.round((Date.now() - new Date(st.time)) / 60000) : null;
    const box = hero.querySelector('#herotxt');
    box.replaceChildren(
      h('div', { class: 'row', style: 'margin-bottom:8px' },
        h('span', { class: 'chip', style: `--c:${cond.c}` }, cond.t),
        h('span', { class: 'mut small' }, h('span', { class: 'live' + (cur.stale || (age != null && age > 45) ? ' off' : '') }), ' ', 'Station Herrsching · ', t ? `${t} Uhr` : '', age != null && age > 45 ? ` (${age} min alt)` : '', cur.stale ? ' · zwischengespeichert' : '')),
      h('div', { class: 'kn num', style: `color:${col}` }, f1(wk), h('small', {}, 'kn')),
      h('div', { class: 'row', style: 'gap:22px;margin-top:10px' },
        h('div', {}, h('div', { class: 'mut small' }, 'Böen'), h('div', { class: 'num', style: 'font-size:28px;font-weight:700;color:var(--gust)' }, f1(gk), ' ', h('small', { class: 'mut', style: 'font-size:14px' }, 'kn'))),
        h('div', {}, h('div', { class: 'mut small' }, 'Beaufort'), h('div', { class: 'num', style: 'font-size:28px;font-weight:700' }, bft(wk ?? 0))),
        h('div', {}, h('div', { class: 'mut small' }, 'Richtung'), h('div', { class: 'num', style: 'font-size:28px;font-weight:700' }, dir != null ? `${dirText(dir)} ` : '–', h('small', { class: 'mut', style: 'font-size:14px' }, dir != null ? `${f0(dir)}°` : '')))),
      h('div', { class: 'row', style: 'margin-top:18px;gap:18px' },
        h('div', { class: 'mut small' }, 'Boje: ', h('b', { class: 'num', style: 'color:var(--fg)' }, f1(cur.buoy.wind_kn), ' kn'), ' (Böen ', f1(cur.buoy.gust_kn), ', ', dirText(cur.buoy.wind_dir), ')')),
      h('div', { class: 'mut small', style: 'margin-top:14px;max-width:46ch' }, 'Orientierung aus Messwerten – ersetzt keine eigene Lagebeurteilung vor dem Auslaufen.'));
  }

  function drawTiles() {
    const c = cur, tm = c.temp_minmax, sun = c.sun || {};
    const T = (k, v, s) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v num' }, ...v), s ? h('div', { class: 's' }, s) : null);
    tiles.replaceChildren(
      T('Lufttemperatur', [f1(c.station.air_temp), h('small', {}, ' °C')], tm ? `Heute ${f1(tm.AirMin)} … ${f1(tm.AirMax)} °C` : ''),
      T('Wassertemperatur', [f1(c.lake_temp), h('small', {}, ' °C')], tm ? `Heute ${f1(tm.LakeMin)} … ${f1(tm.LakeMax)} °C` : ''),
      T('Luftfeuchte', [f0(c.station.humidity), h('small', {}, ' %')]),
      T('Luftdruck', [f0(c.pressure), h('small', {}, ' hPa')]),
      T('Pegel Ammersee', [c.pegel ? f0(c.pegel.cm) : '–', h('small', {}, ' cm')], c.pegel ? `${c.pegel.nhn} m ü. NHN` : ''),
      T('Regen 24 h', [f1(c.rain_24h), h('small', {}, ' mm')]),
      T('Sonne', [sun.sonneAuf || '–', h('small', {}, ' – ' + (sun.sonneUnter || '–'))], sun.tagLaenge ? `Tageslänge ${sun.tagLaenge}` : ''),
      T('Mond', [sun.mondAuf || '–', h('small', {}, ' – ' + (sun.mondUnter || '–'))]));
  }

  // ---- Verlauf ----
  const cv = h('canvas', { class: 'chart' });
  const tip = h('div', { class: 'mut small', style: 'min-height:1.4em;margin-top:6px' }, ' ');
  function chartHead() {
    return h('div', { class: 'row', style: 'margin-bottom:8px' }, h('h3', { style: 'margin:0' }, 'Windverlauf'), h('span', { class: 'sp' }),
      h('div', { class: 'seg' }, ...[['h', 'Herrsching'], ['u', 'Utting']].map(([k, l]) => h('button', { class: src === k ? 'on' : '', onclick: () => { src = k; renderChart(); } }, l))),
      h('div', { class: 'seg' }, ...[1, 2, 3].map(d => h('button', { class: days === d ? 'on' : '', onclick: () => { days = d; loadHist(); } }, d === 1 ? '24 h' : d * 24 + ' h'))));
  }
  function renderChart() {
    chartCard.replaceChildren(chartHead(), cv, tip);
    drawChart();
  }
  let pts = [];
  function drawChart(hover) {
    const dpr = devicePixelRatio || 1, W = cv.clientWidth || 600, H = cv.clientHeight || 230;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const mut = css('--mut'), acc = css('--acc'), gust = css('--gust');
    pts = hist.map(p => ({ t: p.t, w: p[src + '_wind'], g: p[src + '_gust'], d: p[src + '_dir'] }));
    const valid = pts.filter(p => p.w != null || p.g != null);
    if (valid.length < 2) { g.fillStyle = mut; g.fillText('Keine Verlaufsdaten', 12, 24); return; }
    const L = 34, B = 26, T = 10, R = 8;
    const maxV = Math.max(10, Math.ceil(Math.max(...pts.map(p => Math.max(p.w ?? 0, p.g ?? 0))) / 5) * 5);
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const X = t => L + (t - t0) / (t1 - t0) * (W - L - R), Y = v => T + (1 - v / maxV) * (H - T - B);
    g.font = '11px system-ui'; g.fillStyle = mut; g.strokeStyle = mut; g.lineWidth = 1;
    for (let v = 0; v <= maxV; v += maxV / 5) { g.globalAlpha = .18; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.globalAlpha = 1; g.fillText(Math.round(v), 6, Y(v) + 4); }
    const step = days === 1 ? 3 : days === 2 ? 6 : 12;
    for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) { const hr = +new Date(t).toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }); if (hr % step === 0) g.fillText(hr + ' h', X(t) - 10, H - 8); }
    // Beaufort-Band 4-6 (7..21 kn) dezent
    g.fillStyle = 'rgba(45,212,165,.07)'; g.fillRect(L, Y(Math.min(21, maxV)), W - L - R, Y(7) - Y(Math.min(21, maxV)));
    const line = (key, color, w, dash, fill) => {
      g.beginPath(); let started = false, lx = 0;
      pts.forEach(p => { const v = p[key]; if (v == null) { started = false; return; } const x = X(p.t), y = Y(v); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); lx = x; });
      g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
      if (fill) { g.lineTo(lx, Y(0)); g.lineTo(L, Y(0)); g.closePath(); g.globalAlpha = .13; g.fillStyle = color; g.fill(); g.globalAlpha = 1; }
    };
    line('g', gust, 1.4, [4, 3]); line('w', acc, 2.4, null, true);
    if (hover != null) {
      const p = pts[hover]; const x = X(p.t);
      g.strokeStyle = mut; g.globalAlpha = .5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, H - B); g.stroke(); g.globalAlpha = 1;
      if (p.w != null) { g.fillStyle = acc; g.beginPath(); g.arc(x, Y(p.w), 4, 0, 7); g.fill(); }
    }
  }
  const onMove = e => {
    if (pts.length < 2) return;
    const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left, L = 34, R = 8;
    const t = pts[0].t + (x - L) / (r.width - L - R) * (pts[pts.length - 1].t - pts[0].t);
    let bi = 0, bd = 1e18; pts.forEach((p, i) => { const d = Math.abs(p.t - t); if (d < bd && p.w != null) { bd = d; bi = i; } });
    const p = pts[bi]; drawChart(bi);
    tip.textContent = `${new Date(p.t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} · Ø ${f1(p.w)} kn · Böe ${f1(p.g)} kn · ${p.d != null ? dirText(p.d) + ' ' + f0(p.d) + '°' : '–'}`;
  };
  cv.addEventListener('mousemove', onMove); cv.addEventListener('touchmove', onMove, { passive: true });
  cv.addEventListener('mouseleave', () => { drawChart(); tip.textContent = ' '; });
  addEventListener('resize', () => drawChart());

  async function loadHist() {
    try { hist = (await api('/api/weather/history?days=' + days)).points; } catch { hist = []; }
    renderChart();
  }
  async function loadCurrent() {
    try { cur = await api('/api/weather/current'); drawHero(); drawTiles(); }
    catch (e) { if (!cur) hero.querySelector('#herotxt').replaceChildren(h('div', { class: 'err' }, e.message), h('button', { class: 'btn', onclick: loadCurrent }, 'Erneut versuchen')); }
  }
  async function loadForecast() {
    const box = fcCard.querySelector('#fc');
    try {
      const { forecast: f } = await api('/api/weather/forecast');
      const c = f.points[Math.floor(f.rows / 2) * f.cols + Math.floor(f.cols / 2)], now = berlinHour();
      let i0 = f.times.findIndex(t => t.slice(0, 13) >= now); if (i0 < 0) i0 = 0;
      box.replaceChildren(...f.times.slice(i0, i0 + 30).map((t, k) => {
        const i = i0 + k, w = c.wind[i], gk = c.gust[i], d = c.dir[i], col = windColor(w), dt = new Date(t);
        const lab = k === 0 || t.slice(11, 13) === '00' ? WD[dt.getDay()] + ' ' : '';
        return h('div', { class: 'h', style: `--c:${col}`, title: `${t.replace('T', ' ')} · Beaufort ${bft(w)}` },
          h('div', { class: 't' }, lab + t.slice(11, 16)), arrowSvg(d, col), h('div', { class: 'w num' }, f0(w)), h('div', { class: 'g num' }, f0(gk)));
      }));
    } catch (e) { box.replaceChildren(h('span', { class: 'mut' }, e.message)); }
  }
  loadCurrent(); loadHist(); loadForecast();
  every(loadCurrent, 120e3); every(loadHist, 300e3); every(loadForecast, 1800e3);
}
