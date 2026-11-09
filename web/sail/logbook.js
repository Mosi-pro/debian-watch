'use strict';
const LB = { data: null };

async function loadYear(y) {
  LB.data = await api('/api/logbook?year=' + y);
  return LB.data;
}

function yearChips(years, onPick) {
  return h('div', { class: 'years', role: 'tablist' }, years.map(y => h('button', { class: y === S.year ? 'on' : '', onclick: () => onPick(y) }, y)));
}

async function logbookView(root, ctx) {
  const rerender = async () => { root.replaceChildren(); await logbookView(root, ctx); };
  let d;
  try { d = await loadYear(S.year); } catch (e) { root.append(h('div', { class: 'err' }, e.message)); return; }
  const st = d.stats, closed = d.closed;
  root.append(...[
    h('div', { class: 'head' }, h('h2', {}, 'Logbuch'), yearChips(d.years, y => { S.year = y; rerender(); }), h('span', { class: 'sp' }),
      closed ? null : h('button', { class: 'btn pri', onclick: () => entryModal(null, rerender) }, '+ Neuer Törn')),
    closed ? h('div', { class: 'banner' }, h('span', { style: 'font-size:22px' }, '🔒'), h('div', {}, h('b', {}, `Saison ${d.year} ist abgeschlossen`), h('div', { class: 'small mut' }, `am ${new Date(d.season.closed).toLocaleDateString('de-DE')} von ${d.season.by}. Einträge sind schreibgeschützt.`)), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: () => { S.view = 'season'; render(); } }, 'Saisonbericht')) : null,
    h('div', { class: 'grid tiles', style: 'margin-bottom:14px' },
      ...[['Törns', f0(st.trips)], ['Seemeilen', f1(st.nm) + ' sm'], ['Stunden', f1(st.hours) + ' h'], ['Segeltage', f0(st.days)]].map(([k, v]) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v num' }, v))))].filter(Boolean));
  if (!d.entries.length) {
    root.append(h('div', { class: 'card empty' }, icon('boat'), h('h3', { style: 'margin:10px 0 4px' }, `Noch kein Eintrag für ${d.year}`), h('div', {}, closed ? '' : 'Lege deinen ersten Törn an.')));
    return;
  }
  root.append(h('div', { class: 'entries' }, d.entries.map(e => {
    const dt = new Date(e.date + 'T12:00:00');
    return h('div', { class: 'card entry', role: 'button', tabindex: 0, onclick: () => entryModal(e, rerender, closed), onkeydown: ev => ev.key === 'Enter' && entryModal(e, rerender, closed) },
      h('div', { class: 'date' }, h('b', {}, dt.getDate()), h('span', {}, MONTHS[dt.getMonth()])),
      h('div', {}, h('h4', {}, e.title, ' ', h('span', { class: 'tag' }, e.type)),
        h('div', { class: 'meta' }, e.start ? h('span', {}, `${e.start}${e.end ? '–' + e.end : ''}`) : null, e.boat ? h('span', {}, '⛵ ' + e.boat) : null, e.crew ? h('span', {}, '👥 ' + e.crew) : null,
          e.wind_avg ? h('span', {}, `💨 Ø ${f0(e.wind_avg)}${e.wind_max ? ' / ' + f0(e.wind_max) : ''} kn ${e.wind_dir ? dirText(e.wind_dir) : ''}`) : null, e.route && e.route.length > 1 ? h('span', {}, '🗺 Route') : null),
        e.notes ? h('div', { class: 'small mut', style: 'margin-top:6px;white-space:pre-wrap' }, e.notes.length > 160 ? e.notes.slice(0, 160) + '…' : e.notes) : null),
      h('div', { class: 'nm' }, h('b', { class: 'num' }, f1(e.distance)), h('span', {}, 'sm'), e.hours ? h('span', {}, f1(e.hours) + ' h') : null));
  })));
}

// ---- Eintrag anlegen / bearbeiten ----
function entryModal(e, done, readonly) {
  const isNew = !e;
  e = e || { date: new Date().toISOString().slice(0, 10), type: 'Törn', route: [] };
  const v = (k, props = {}) => h('input', { value: e[k] ?? '', ...props });
  const date = v('date', { type: 'date', required: true }), start = v('start', { type: 'time' }), end = v('end', { type: 'time' });
  const title = v('title', { placeholder: 'z. B. Herrsching – Dießen und zurück', maxlength: 120 });
  const type = h('select', {}, ['Törn', 'Regatta', 'Training', 'Überführung', 'Sonstiges'].map(t => h('option', { value: t, selected: t === e.type }, t)));
  const boat = v('boat', { placeholder: 'Boot', maxlength: 80, list: 'boats' });
  const crew = v('crew', { placeholder: 'Namen, kommagetrennt', maxlength: 300 });
  const dist = v('distance', { type: 'number', step: '0.1', min: 0, placeholder: 'sm' });
  const hours = v('hours', { type: 'number', step: '0.1', min: 0, placeholder: 'h' });
  const wavg = v('wind_avg', { type: 'number', step: '0.1', min: 0, placeholder: 'kn' });
  const wmax = v('wind_max', { type: 'number', step: '0.1', min: 0, placeholder: 'kn' });
  const wdir = v('wind_dir', { type: 'number', step: '1', min: 0, max: 360, placeholder: '° (woher)' });
  const notes = h('textarea', { maxlength: 8000, placeholder: 'Verlauf, Besonderheiten, Crew-Notizen …' }, e.notes || '');
  const err = h('div', { class: 'err', role: 'alert' });
  const boatList = h('datalist', { id: 'boats' }, [...new Set((LB.data?.entries || []).map(x => x.boat).filter(Boolean))].map(b => h('option', { value: b })));
  let route = (e.route || []).map(p => [...p]);

  // Route: Kartenfeld
  const rmEl = h('div', { id: 'routemap', style: 'height:260px;border-radius:14px;overflow:hidden' });
  const rinfo = h('span', { class: 'small mut' });
  let rmap, line, mk = [];
  const gpx = h('input', { type: 'file', accept: '.gpx', style: 'display:none' });
  function redraw() {
    if (!rmap) return;
    line.setLatLngs(route); mk.forEach(m => rmap.removeLayer(m)); mk = [];
    if (route.length) { mk.push(L.circleMarker(route[0], { radius: 6, color: '#2dd4a5', fillOpacity: 1 }).addTo(rmap)); if (route.length > 1) mk.push(L.circleMarker(route[route.length - 1], { radius: 6, color: '#ff8a3d', fillOpacity: 1 }).addTo(rmap)); }
    const nm = routeNM(route); rinfo.textContent = route.length > 1 ? `${route.length} Punkte · ${f1(nm)} sm` : 'Klicke auf die Karte, um Routenpunkte zu setzen, oder importiere eine GPX-Datei.';
  }
  const setRouteDistance = () => { if (route.length > 1) dist.value = Math.round(routeNM(route) * 10) / 10; };
  function initMap() {
    rmap = L.map(rmEl, { zoomSnap: .5 }).setView(route.length ? route[0] : [LAKE.lat, LAKE.lon], LAKE.zoom);
    tileLayer(prefersDark()).addTo(rmap);
    line = L.polyline(route, { color: '#ff8a3d', weight: 4 }).addTo(rmap);
    if (route.length > 1) rmap.fitBounds(line.getBounds().pad(.2));
    if (!readonly) rmap.on('click', ev => { route.push([+ev.latlng.lat.toFixed(5), +ev.latlng.lng.toFixed(5)]); redraw(); setRouteDistance(); });
    redraw();
  }
  gpx.onchange = async () => {
    const f = gpx.files[0]; if (!f) return;
    const doc = new DOMParser().parseFromString(await f.text(), 'application/xml');
    let pts = [...doc.getElementsByTagName('trkpt')];
    if (!pts.length) pts = [...doc.getElementsByTagName('rtept')];
    let r = pts.map(p => [+p.getAttribute('lat'), +p.getAttribute('lon')]).filter(p => isFinite(p[0]) && isFinite(p[1]));
    if (!r.length) return toast('Keine Trackpunkte in der GPX-Datei');
    const step = Math.ceil(r.length / 1500); r = r.filter((_, i) => i % step === 0 || i === r.length - 1);
    route = r.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
    const t = pts.map(p => p.getElementsByTagName('time')[0]?.textContent).filter(Boolean);
    if (t.length > 1 && !hours.value) hours.value = Math.round((new Date(t[t.length - 1]) - new Date(t[0])) / 360000) / 10;
    if (t.length && isNew) { const d0 = new Date(t[0]); date.value = d0.toISOString().slice(0, 10); }
    rmap.fitBounds(L.polyline(route).getBounds().pad(.2)); redraw(); setRouteDistance(); toast('GPX importiert');
  };
  const autoHours = () => { if (start.value && end.value && !hours.value) { let m = (+end.value.slice(0, 2) * 60 + +end.value.slice(3)) - (+start.value.slice(0, 2) * 60 + +start.value.slice(3)); if (m < 0) m += 1440; hours.value = Math.round(m / 6) / 10; } };
  start.onchange = end.onchange = autoHours;

  const useWeather = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try { const c = await api('/api/weather/current'); wavg.value = c.station.wind_kn ?? ''; wmax.value = c.station.gust_kn ?? ''; wdir.value = c.station.wind_dir != null ? Math.round(c.station.wind_dir) : ''; toast('Aktuelle Windwerte übernommen'); } catch (x) { toast(x.message); }
  } }, '💨 Aktuelles Wetter übernehmen');

  const close = () => ov.remove();
  const save = async () => {
    err.textContent = '';
    const body = { date: date.value, start: start.value, end: end.value, title: title.value, type: type.value, boat: boat.value, crew: crew.value,
      distance: +dist.value || 0, hours: +hours.value || 0, wind_avg: +wavg.value || 0, wind_max: +wmax.value || 0, wind_dir: +wdir.value || 0, notes: notes.value, route };
    try { if (isNew) await api('/api/logbook', 'POST', body); else await api('/api/logbook/' + e.id, 'PUT', body); close(); toast('Gespeichert'); S.year = +body.date.slice(0, 4); done(); }
    catch (x) { err.textContent = x.message; }
  };
  const del = async () => { if (!confirm('Eintrag wirklich löschen?')) return; try { await api('/api/logbook/' + e.id, 'DELETE'); close(); toast('Gelöscht'); done(); } catch (x) { err.textContent = x.message; } };

  [date, start, end, title, type, boat, crew, dist, hours, wavg, wmax, wdir, notes].forEach(x => readonly && (x.disabled = true));
  const ov = h('div', { class: 'ov', onmousedown: ev => ev.target === ov && close() },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('h2', {}, isNew ? 'Neuer Törn' : readonly ? 'Törn (Saison abgeschlossen)' : 'Törn bearbeiten'),
      h('label', {}, 'Titel'), title,
      h('div', { class: 'f3' }, h('div', {}, h('label', {}, 'Datum'), date), h('div', {}, h('label', {}, 'Start'), start), h('div', {}, h('label', {}, 'Ende'), end)),
      h('div', { class: 'f3' }, h('div', {}, h('label', {}, 'Art'), type), h('div', {}, h('label', {}, 'Boot'), boat), h('div', {}, h('label', {}, 'Crew'), crew)),
      boatList,
      h('div', { class: 'f2' }, h('div', {}, h('label', {}, 'Distanz (sm)'), dist), h('div', {}, h('label', {}, 'Dauer (h)'), hours)),
      h('div', { class: 'f3' }, h('div', {}, h('label', {}, 'Wind Ø (kn)'), wavg), h('div', {}, h('label', {}, 'Böen max (kn)'), wmax), h('div', {}, h('label', {}, 'Richtung (°)'), wdir)),
      readonly ? null : h('div', { style: 'margin-top:8px' }, useWeather),
      h('label', {}, 'Route'), rmEl,
      h('div', { class: 'row', style: 'margin-top:8px' }, rinfo, h('span', { class: 'sp' }),
        readonly ? null : [h('button', { class: 'btn', type: 'button', onclick: () => { route.pop(); redraw(); setRouteDistance(); } }, '↶ Letzter Punkt'), h('button', { class: 'btn', type: 'button', onclick: () => { route = []; redraw(); } }, 'Leeren'), h('button', { class: 'btn', type: 'button', onclick: () => gpx.click() }, 'GPX importieren'), gpx]),
      h('label', {}, 'Notizen'), notes, err,
      h('div', { class: 'btns' }, !isNew && !readonly ? h('button', { class: 'btn danger', onclick: del }, 'Löschen') : null, h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: close }, readonly ? 'Schließen' : 'Abbrechen'), readonly ? null : h('button', { class: 'btn pri', onclick: save }, 'Speichern'))));
  document.body.append(ov);
  initMap();
  const obs = new MutationObserver(() => { if (!document.body.contains(ov)) { rmap && rmap.remove(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  title.focus();
}
