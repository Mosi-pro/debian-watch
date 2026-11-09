'use strict';

// ---- Windfeld aus dem Vorhersage-Raster ----
class WindField {
  constructor(f) {
    this.f = f; this.cols = f.cols; this.rows = f.rows;
    this.lat0 = f.points[0].lat; this.lat1 = f.points[(f.rows - 1) * f.cols].lat;
    this.lon0 = f.points[0].lon; this.lon1 = f.points[f.cols - 1].lon;
    this.setHour(0);
  }
  setHour(i) {
    this.i = i;
    this.uv = this.f.points.map(p => {
      const s = p.wind[i] ?? 0, to = ((p.dir[i] ?? 0) + 180) * Math.PI / 180;
      return [s * Math.sin(to), s * Math.cos(to)]; // u = nach Osten, v = nach Norden
    });
  }
  sample(lat, lon) {
    const fy = Math.min(Math.max((this.lat0 - lat) / (this.lat0 - this.lat1), 0), 1) * (this.rows - 1);
    const fx = Math.min(Math.max((lon - this.lon0) / (this.lon1 - this.lon0), 0), 1) * (this.cols - 1);
    const y0 = Math.min(Math.floor(fy), this.rows - 2), x0 = Math.min(Math.floor(fx), this.cols - 2), ty = fy - y0, tx = fx - x0;
    const g = (y, x) => this.uv[y * this.cols + x];
    const mix = k => (g(y0, x0)[k] * (1 - tx) + g(y0, x0 + 1)[k] * tx) * (1 - ty) + (g(y0 + 1, x0)[k] * (1 - tx) + g(y0 + 1, x0 + 1)[k] * tx) * ty;
    const u = mix(0), v = mix(1);
    return { u, v, s: Math.hypot(u, v) };
  }
}

// ---- Partikel-Animation (Canvas über der Karte) ----
class Particles {
  constructor(map, field) {
    this.map = map; this.field = field; this.run = false;
    this.cv = h('canvas', { class: 'windcv' });
    map.getContainer().append(this.cv);
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.on('movestart zoomstart', () => { this.cv.style.opacity = 0; });
    map.on('moveend zoomend', () => { this.resize(); this.cv.style.opacity = 1; });
    this.resize();
  }
  resize() {
    const el = this.map.getContainer(), dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = el.clientWidth; this.H = el.clientHeight;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.g = this.cv.getContext('2d'); this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(Math.max(Math.round(this.W * this.H / 2200), 200), 800);
    this.p = Array.from({ length: n }, () => this.spawn({}));
  }
  spawn(p) { p.x = Math.random() * this.W; p.y = Math.random() * this.H; p.age = 0; p.max = 40 + Math.random() * 70; return p; }
  start() { if (this.run || this.reduce) return; this.run = true; const loop = () => { if (!this.run) return; this.frame(); this.raf = requestAnimationFrame(loop); }; loop(); }
  stop() { this.run = false; cancelAnimationFrame(this.raf); }
  destroy() { this.stop(); this.cv.remove(); }
  frame() {
    if (document.hidden) return;
    const g = this.g, m = this.map;
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.075)'; g.fillRect(0, 0, this.W, this.H);
    g.globalCompositeOperation = 'source-over'; g.lineWidth = 1.7; g.lineCap = 'round';
    for (const p of this.p) {
      const ll = m.containerPointToLatLng([p.x, p.y]), w = this.field.sample(ll.lat, ll.lng);
      if (w.s < 0.3 || ++p.age > p.max) { this.spawn(p); continue; }
      const k = 0.22, nx = p.x + w.u * k, ny = p.y - w.v * k;
      g.strokeStyle = windColor(w.s); g.globalAlpha = Math.min(1, p.age / 8) * 0.85;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(nx, ny); g.stroke();
      p.x = nx; p.y = ny;
      if (nx < 0 || ny < 0 || nx > this.W || ny > this.H) this.spawn(p);
    }
    g.globalAlpha = 1;
  }
}

// ---- Kartenansicht ----
async function mapView(root, ctx) {
  const wrap = h('div', { class: 'mapwrap' });
  const mapEl = h('div', { id: 'map' });
  const legend = h('div', { class: 'legend' }, h('div', {}, 'Wind in kn'),
    h('div', { class: 'sc' }, ...[0, 2, 5, 9, 13, 19, 25, 31, 38].map(k => h('i', { style: `background:${windColor(k)}`, title: `${k} kn` }))),
    h('div', { class: 'tk' }, h('span', {}, '0'), h('span', {}, '10'), h('span', {}, '20'), h('span', {}, '30+')));
  const slider = h('input', { type: 'range', min: 0, max: 0, value: 0, 'aria-label': 'Vorhersagezeit' });
  const lab = h('div', { class: 'tl num' }, '…');
  const play = h('button', { class: 'btn sm', title: 'Abspielen', 'aria-label': 'Abspielen' }, '▶');
  const now = h('button', { class: 'btn sm quiet' }, 'Jetzt');
  const routesBtn = h('button', { class: 'btn' }, ic('route'), 'Törns ' + S.year);
  const info = h('span', { class: 'mut small' }, '');
  wrap.append(mapEl, h('div', { class: 'maptools' }, routesBtn), legend, h('div', { class: 'mapui' }, play, slider, lab, now, info));
  root.append(wrap);

  const map = L.map(mapEl, { zoomControl: true, attributionControl: true, zoomSnap: 0.5 }).setView([LAKE.lat, LAKE.lon], LAKE.zoom);
  let tiles = tileLayer(prefersDark()).addTo(map);
  const onTheme = () => { map.removeLayer(tiles); tiles = tileLayer(prefersDark()).addTo(map); };
  document.addEventListener('themechange', onTheme);
  ctx.cleanup = () => { document.removeEventListener('themechange', onTheme); parts && parts.destroy(); clearInterval(timer); map.remove(); };

  // Törn-Routen
  let routeLayer = null;
  routesBtn.onclick = async () => {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; routesBtn.classList.remove('on'); return; }
    try {
      const lb = await api('/api/logbook?year=' + S.year);
      routeLayer = L.featureGroup();
      lb.entries.filter(e => e.route && e.route.length > 1).forEach(e => {
        const pop = h('div', {}, h('b', {}, e.title), h('br'), `${e.date} · ${f1(e.distance)} sm`);
        L.polyline(e.route, { color: '#b0245f', weight: 3.5, opacity: .95 }).bindPopup(pop).addTo(routeLayer);
      });
      if (!routeLayer.getLayers().length) { toast('Keine Routen im Logbuch ' + S.year); routeLayer = null; return; }
      routeLayer.addTo(map); map.fitBounds(routeLayer.getBounds().pad(.15)); routesBtn.classList.add('on');
    } catch (e) { toast(e.message); }
  };

  // Stationen
  const stIcon = txt => L.divIcon({ className: '', html: `<div class="stmark">${txt}</div>`, iconSize: null, iconAnchor: [-6, 12] });
  Promise.all([api('/api/weather/current').catch(() => null), api('/api/weather/history?days=1').catch(() => null)]).then(([c, hs]) => {
    if (!map._loaded && !map.getContainer().isConnected) return;
    if (c && c.station.wind_kn != null) L.marker([47.9993, 11.179], { icon: stIcon(`Herrsching ${f0(c.station.wind_kn)}/${f0(c.station.gust_kn)} kn ${dirText(c.station.wind_dir)}`), keyboard: false }).bindTooltip('Wetterstation Herrsching (Position ungefähr)').addTo(map);
    const lastU = hs && [...hs.points].reverse().find(p => p.u_wind != null);
    if (lastU) L.marker([48.03, 11.084], { icon: stIcon(`Utting ${f0(lastU.u_wind)}/${f0(lastU.u_gust)} kn ${dirText(lastU.u_dir)}`), keyboard: false }).bindTooltip('Wetterstation Utting (Position ungefähr)').addTo(map);
  });

  // Vorhersage laden
  let parts = null, field = null, F = null, i0 = 0, markers = [], timer = null;
  try {
    F = (await api('/api/weather/forecast')).forecast;
  } catch (e) {
    info.textContent = 'Vorhersage nicht verfügbar: ' + e.message; slider.disabled = play.disabled = now.disabled = true; return;
  }
  const nowH = berlinHour(); i0 = Math.max(0, F.times.findIndex(t => t.slice(0, 13) >= nowH));
  const N = F.times.length - i0;
  slider.max = N - 1; field = new WindField(F);
  F.points.forEach(p => {
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: '', iconSize: [34, 44], iconAnchor: [17, 22] }), interactive: false, keyboard: false }).addTo(map);
    markers.push(m);
  });
  function show(k) {
    const i = i0 + k; field.setHour(i);
    F.points.forEach((p, j) => {
      const w = p.wind[i], col = windColor(w), el = markers[j].getElement(); if (!el) return;
      el.innerHTML = `<div class="warrow"><svg viewBox="0 0 24 24" width="30" height="30" style="transform:rotate(${(p.dir[i] + 180) % 360}deg)"><path d="M12 2l6.5 10h-4.5v10h-4V12H5.5z" fill="${col}" stroke="#fff" stroke-width="1.2"/></svg><b>${Math.round(w)}</b></div>`;
    });
    const t = new Date(F.times[i] + ':00');
    lab.textContent = `${WD[t.getDay()]} ${F.times[i].slice(11, 16)} Uhr`;
    const c = F.points[Math.floor(F.rows / 2) * F.cols + Math.floor(F.cols / 2)];
    info.textContent = `Seemitte: Ø ${f0(c.wind[i])}, Böe ${f0(c.gust[i])} kn aus ${dirText(c.dir[i])}`;
  }
  map.whenReady(() => { show(0); parts = new Particles(map, field); parts.start(); });
  slider.oninput = () => show(+slider.value);
  now.onclick = () => { stopPlay(); slider.value = 0; show(0); };
  function stopPlay() { clearInterval(timer); timer = null; play.textContent = '▶'; }
  play.onclick = () => {
    if (timer) return stopPlay();
    play.textContent = '❚❚';
    timer = setInterval(() => { slider.value = (+slider.value + 1) % N; show(+slider.value); }, 900);
  };
  map.on('zoomend moveend', () => show(+slider.value));
}
