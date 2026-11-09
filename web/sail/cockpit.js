'use strict';
// ---- Timer-Verwaltung: beim Ansichtswechsel aufräumen ----
const timers = [];
const every = (fn, ms) => { const id = setInterval(fn, ms); timers.push(id); return id; };
const clearTimers = () => { while (timers.length) clearInterval(timers.pop()); };

// Kompassrose im Stil einer Seekarte
function roseSvg(initialDir = 0, interactive = true) {
  const C = 200, pol = (a, r) => [C + r * Math.sin(a * Math.PI / 180), C - r * Math.cos(a * Math.PI / 180)];
  let s = '';
  s += `<circle class="ring" cx="${C}" cy="${C}" r="186"/><circle class="ring" cx="${C}" cy="${C}" r="171"/>`;
  for (let a = 0; a < 360; a += 5) {
    const len = a % 30 === 0 ? 15 : a % 10 === 0 ? 10 : 5, p1 = pol(a, 186), p2 = pol(a, 186 - len);
    s += `<line class="tk" x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}"/>`;
  }
  for (let a = 0; a < 360; a += 30) { const p = pol(a, 158); s += `<text class="lab" x="${p[0].toFixed(1)}" y="${(p[1] + 4.5).toFixed(1)}">${a}</text>`; }
  // 8-Strahl-Rose, jede Spitze halb gefüllt
  for (let i = 0; i < 8; i++) {
    const a = i * 45, R = i % 2 === 0 ? 112 : 78, tip = pol(a, R), l = pol(a - 22.5, 17), r = pol(a + 22.5, 17);
    const f = p => p.map(v => v.toFixed(1)).join(',');
    s += `<polygon class="${i === 0 ? 'star1 north' : 'star1'}" points="${f(tip)} ${f(l)} ${C},${C}"/><polygon class="star2" points="${f(tip)} ${C},${C} ${f(r)}"/>`;
  }
  [['N', 0], ['O', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => { const p = pol(a, 133); s += `<text class="card" x="${p[0].toFixed(1)}" y="${(p[1] + 7.5).toFixed(1)}">${t}</text>`; });
  s += `<circle cx="${C}" cy="${C}" r="5" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5"/>`;
  // Windpfeil: von der Seite, aus der der Wind kommt, durch die Mitte; Spitze zeigt in Windrichtung
  s += `<g class="needle" id="needle" style="transform:rotate(${initialDir}deg)">
    <g stroke-linecap="round" stroke-linejoin="round">
      <path d="M200 26V316" stroke="var(--paper)" stroke-width="9"/><path d="M186 26l14 -2 14 2M190 38l10-2 10 2" stroke="var(--paper)" stroke-width="7" fill="none"/>
      <path d="M200 26V300" stroke="var(--mag)" stroke-width="4.5"/>
      <path d="M186 20l14 12 14-12M188 36l12 10 12-10" stroke="var(--mag)" stroke-width="3.2" fill="none"/>
      <path d="M184 296l16 34 16-34z" fill="var(--mag)" stroke="var(--paper)" stroke-width="2.5"/>
    </g></g>`;
  const t = document.createElement('template');
  t.innerHTML = `<svg class="rose" viewBox="0 0 400 400" role="img" aria-label="Windrose">${s}</svg>`;
  return t.content.firstChild;
}

function cockpitView(root, ctx) {
  const rose = roseSvg(0);
  const readout = h('div', { class: 'readout' }, h('p', { class: 'mut' }, 'Lade Wetterdaten …'));
  const hero = h('section', { class: 'cockpit', 'aria-label': 'Aktueller Wind' },
    h('div', { class: 'chartpanel' }, rose, h('span', { class: 'cap' }, 'Ammersee 47°59′ N 11°08′ O'), h('span', { class: 'cap2' }, 'Wind aus Grad')),
    readout);
  const dl = h('div', { class: 'dl' }), chartPanel = h('section', { class: 'panel chartcol' }), fcPanel = h('section', { class: 'panel', style: 'margin-top:24px' });
  root.append(hero, h('div', { class: 'cols2' }, h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', {}, 'Messwerte')), h('div', { class: 'pb' }, dl)), chartPanel), fcPanel);

  let days = 1, src = 'h', cur = null, hist = [], first = true;

  function drawHero(c, err) {
    if (!c) { if (err) readout.replaceChildren(h('p', { class: 'err' }, err.message), h('button', { class: 'btn', onclick: () => Live.load() }, 'Erneut laden')); return; }
    cur = c;
    const st = c.station, wk = st.wind_kn, gk = st.gust_kn, dir = st.wind_dir, cond = conditions(wk, gk), b = bft(wk ?? 0);
    const age = st.time ? Math.round((Date.now() - new Date(st.time)) / 60000) : null, old = c.stale || (age != null && age > 45);
    // Windpfeil schwingt beim ersten Laden ein
    const needle = rose.querySelector('#needle');
    if (dir != null) requestAnimationFrame(() => requestAnimationFrame(() => { needle.style.transform = `rotate(${dir}deg)`; }));
    const nEl = h('span', { class: 'n' }, first ? '0' : f0(wk));
    if (first) countUp(nEl, wk ?? 0, 0, 1300);
    const mk = h('b', { style: `left:${first ? 0 : (b + .5) / 13 * 100}%` });
    if (first) requestAnimationFrame(() => requestAnimationFrame(() => { mk.style.left = (b + .5) / 13 * 100 + '%'; }));
    readout.replaceChildren(
      h('div', { class: 'status' }, h('span', {}, h('span', { class: 'dot' + (old ? ' off' : '') }), 'Station Herrsching'), st.time ? h('span', {}, `${hhmm(st.time)} Uhr`) : null,
        old ? h('span', { style: 'color:var(--bad)' }, age != null && age > 45 ? `Messung ${age} min alt` : 'zwischengespeichert') : null),
      h('div', { class: 'windbig' }, nEl, h('span', { class: 'u' }, 'kn'), h('div', { class: 'bf' }, h('b', { class: 'num' }, b), h('span', {}, 'Beaufort'))),
      h('div', { class: 'ruler' }, h('div', { class: 'cells' }, BFT_COL.map(c => h('i', { style: `background:${c}` }))), h('div', { class: 'mk' }, mk),
        h('div', { class: 'ticks' }, BFT_COL.map((_, i) => h('span', {}, i)))),
      h('div', { class: 'verdict' }, h('i', { style: `background:${cond.c}` }), cond.t),
      h('div', { class: 'threefig' },
        h('div', {}, h('div', { class: 'k' }, 'Böen'), h('div', { class: 'v num' }, f1(gk), h('small', {}, 'kn'))),
        h('div', {}, h('div', { class: 'k' }, 'Wind aus'), h('div', { class: 'v num' }, dir != null ? `${dirText(dir)} ${f0(dir)}°` : '–')),
        h('div', {}, h('div', { class: 'k' }, 'Boje'), h('div', { class: 'v num' }, f1(c.buoy.wind_kn), h('small', {}, `kn · ${dirText(c.buoy.wind_dir)}`)))),
      h('p', { class: 'hint' }, 'Orientierung aus Messwerten. Sie ersetzt keine eigene Lagebeurteilung vor dem Auslaufen.'));
    first = false;
    // Messwerte
    const tm = c.temp_minmax, sun = c.sun || {};
    const R = (k, v, unit, sub) => h('div', {}, h('span', { class: 'k' }, k), h('span', { class: 'v num' }, v, unit ? h('small', {}, unit) : null, sub ? h('span', { class: 's' }, sub) : null));
    dl.replaceChildren(
      R('Lufttemperatur', f1(c.station.air_temp), '°C', tm ? `heute ${f1(tm.AirMin)} bis ${f1(tm.AirMax)} °C` : ''),
      R('Wassertemperatur', f1(c.lake_temp), '°C', tm ? `heute ${f1(tm.LakeMin)} bis ${f1(tm.LakeMax)} °C` : ''),
      R('Luftfeuchte', f0(c.station.humidity), '%'), R('Luftdruck', f0(c.pressure), 'hPa'),
      R('Pegel Ammersee', c.pegel ? f0(c.pegel.cm) : '–', 'cm', c.pegel ? `${c.pegel.nhn} m ü. NHN` : ''),
      R('Regen, 24 Stunden', f1(c.rain_24h), 'mm'),
      R('Sonne', `${sun.sonneAuf || '–'} bis ${sun.sonneUnter || '–'}`, '', sun.tagLaenge ? `Tageslänge ${sun.tagLaenge}` : ''),
      R('Mond', `${sun.mondAuf || '–'} bis ${sun.mondUnter || '–'}`, ''));
  }
  ctx.cleanup = Live.on(drawHero);
  Live.load();

  // ---- Verlauf ----
  const cv = h('canvas', { class: 'chart' }), tip = h('div', { class: 'mut small', style: 'min-height:1.5em;padding:0 20px 14px' }, ' ');
  function renderChart() {
    chartPanel.replaceChildren(
      h('div', { class: 'ph' }, h('h2', {}, 'Windverlauf'), h('span', { class: 'sp' }),
        h('div', { class: 'seg' }, ...[['h', 'Herrsching'], ['u', 'Utting']].map(([k, l]) => h('button', { class: src === k ? 'on' : '', onclick: () => { src = k; renderChart(); } }, l))),
        h('div', { class: 'seg' }, ...[1, 2, 3].map(d => h('button', { class: days === d ? 'on' : '', onclick: () => { days = d; loadHist(); } }, d * 24 + ' h')))),
      h('div', { class: 'chartbox' }, cv), tip);
    ro.disconnect(); ro.observe(cv.parentNode);
    drawChart();
  }
  const ro = new ResizeObserver(() => drawChart());
  let pts = [];
  function drawChart(hover) {
    const dpr = devicePixelRatio || 1, W = cv.clientWidth || 600, H = cv.clientHeight || 250;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const ink = css('--ink'), mut = css('--ink2'), mag = css('--mag'), line = css('--line'), sh = css('--shallow');
    pts = hist.map(p => ({ t: p.t, w: p[src + '_wind'], g: p[src + '_gust'], d: p[src + '_dir'] }));
    g.font = '500 13px "Barlow Condensed", sans-serif';
    if (pts.filter(p => p.w != null || p.g != null).length < 2) { g.fillStyle = mut; g.fillText('Keine Verlaufsdaten', 12, 24); return; }
    const L = 34, B = 26, T = 10, R = 10, maxV = Math.max(10, Math.ceil(Math.max(...pts.map(p => Math.max(p.w ?? 0, p.g ?? 0))) / 5) * 5);
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, X = t => L + (t - t0) / (t1 - t0) * (W - L - R), Y = v => T + (1 - v / maxV) * (H - T - B);
    g.fillStyle = sh; g.globalAlpha = .5; g.fillRect(L, Y(Math.min(21, maxV)), W - L - R, Y(7) - Y(Math.min(21, maxV))); g.globalAlpha = 1;
    g.strokeStyle = line; g.lineWidth = 1; g.fillStyle = mut;
    for (let v = 0; v <= maxV; v += maxV / 5) { g.beginPath(); g.moveTo(L, Y(v) + .5); g.lineTo(W - R, Y(v) + .5); g.stroke(); g.fillText(Math.round(v), 8, Y(v) + 4); }
    const step = days === 1 ? 3 : days === 2 ? 6 : 12;
    for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) { const hr = +new Date(t).toLocaleString('de-DE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Berlin' }); if (hr % step === 0) g.fillText(hr + ' h', X(t) - 10, H - 8); }
    const path = (key, fill) => {
      g.beginPath(); let on = false, lx = 0, fx = 0;
      pts.forEach(p => { const v = p[key]; if (v == null) { on = false; return; } const x = X(p.t), y = Y(v); if (!on) { g.moveTo(x, y); on = true; if (!fx) fx = x; } else g.lineTo(x, y); lx = x; });
      return [lx, fx];
    };
    g.setLineDash([4, 3]); g.strokeStyle = mag; g.lineWidth = 1.4; path('g'); g.stroke(); g.setLineDash([]);
    const [lx, fx] = path('w'); g.strokeStyle = ink; g.lineWidth = 2.2; g.lineJoin = 'round'; g.stroke();
    g.lineTo(lx, Y(0)); g.lineTo(fx, Y(0)); g.closePath(); g.globalAlpha = .12; g.fillStyle = ink; g.fill(); g.globalAlpha = 1;
    if (hover != null) { const p = pts[hover], x = X(p.t); g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.moveTo(x + .5, T); g.lineTo(x + .5, H - B); g.stroke(); if (p.w != null) { g.fillStyle = ink; g.beginPath(); g.arc(x, Y(p.w), 4, 0, 7); g.fill(); } }
  }
  const onMove = e => {
    if (pts.length < 2) return;
    const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const t = pts[0].t + (x - 34) / (r.width - 44) * (pts[pts.length - 1].t - pts[0].t);
    let bi = 0, bd = 1e18; pts.forEach((p, i) => { const d = Math.abs(p.t - t); if (d < bd && p.w != null) { bd = d; bi = i; } });
    const p = pts[bi]; drawChart(bi);
    tip.textContent = `${new Date(p.t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr: Ø ${f1(p.w)} kn, Böe ${f1(p.g)} kn, ${p.d != null ? dirText(p.d) + ' ' + f0(p.d) + '°' : 'keine Richtung'}`;
  };
  cv.addEventListener('mousemove', onMove); cv.addEventListener('touchmove', onMove, { passive: true });
  cv.addEventListener('mouseleave', () => { drawChart(); tip.textContent = ' '; });
  const off = ctx.cleanup; ctx.cleanup = () => { off(); ro.disconnect(); };
  renderChart();
  async function loadHist() { try { hist = (await api('/api/weather/history?days=' + days)).points; } catch { hist = []; } renderChart(); }

  // ---- Vorhersage ----
  fcPanel.append(h('div', { class: 'ph' }, h('h2', {}, 'Vorhersage Seemitte'), h('span', { class: 'mut small' }, 'Modell, Wind in kn, darunter Böen')), h('div', { class: 'fct', id: 'fc' }, h('span', { class: 'mut', style: 'padding:20px 0' }, 'lädt …')));
  async function loadForecast() {
    const box = fcPanel.querySelector('#fc');
    try {
      const { forecast: f } = await api('/api/weather/forecast');
      const c = f.points[Math.floor(f.rows / 2) * f.cols + Math.floor(f.cols / 2)], now = berlinHour();
      let i0 = f.times.findIndex(t => t.slice(0, 13) >= now); if (i0 < 0) i0 = 0;
      const maxW = Math.max(12, ...c.gust.slice(i0, i0 + 30));
      box.replaceChildren(...f.times.slice(i0, i0 + 30).map((t, k) => {
        const i = i0 + k, w = c.wind[i], gk = c.gust[i], d = c.dir[i], col = windColor(w), dt = new Date(t), newDay = k > 0 && t.slice(11, 13) === '00';
        const bar = h('i', { style: `height:${Math.max(2, w / maxW * 80)}px;--c:${col};background:${col};animation-delay:${k * 18}ms` });
        const tick = h('u', { style: `bottom:${Math.min(gk / maxW * 80, 82)}px` });
        return h('div', { class: 'fc' + (newDay ? ' day' : ''), title: `${t.replace('T', ' ')} Uhr, Beaufort ${bft(w)}` },
          h('span', { class: 'dn' }, WD[dt.getDay()]), h('div', { class: 't' }, t.slice(11, 13) + ' h'), windArrow(d, col, 22), h('div', { class: 'col' }, bar, tick), h('div', { class: 'w' }, f0(w)), h('div', { class: 'g' }, f0(gk)));
      }));
    } catch (e) { box.replaceChildren(h('span', { class: 'mut', style: 'padding:20px 0' }, e.message)); }
  }
  loadHist(); loadForecast();
  every(loadHist, 300e3); every(loadForecast, 1800e3);
}
