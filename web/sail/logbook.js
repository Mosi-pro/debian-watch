'use strict';
const LB = { data: null };

async function loadYear(y) { LB.data = await api('/api/logbook?year=' + y); return LB.data; }

function yearTabs(years, onPick) {
  return h('div', { class: 'tabsx', role: 'tablist' }, years.map(y => h('button', { class: y === S.year ? 'on' : '', role: 'tab', 'aria-selected': y === S.year, onclick: () => onPick(y) }, y)));
}

const BOAT_FX = '<svg viewBox="0 0 50 50"><path d="M25 5v30M25 7L40 31H25zM23 11L10 31h13z" fill="currentColor"/><path d="M6 36h38l-5 8H11z" fill="currentColor"/></svg>';
function sailFx() {
  const wave = 'M0 10 Q12.5 0 25 10' + ' T50 10'.repeat(1) + Array.from({ length: 38 }, (_, i) => ` T${75 + i * 25} 10`).join('');
  const fx = h('div', { class: 'sailfx go', 'aria-hidden': 'true' },
    h('span', { html: `<svg class="wave" viewBox="0 0 1000 20" preserveAspectRatio="none"><path pathLength="1" vector-effect="non-scaling-stroke" d="${wave}"/></svg>` }),
    h('div', { class: 'boat', html: BOAT_FX }));
  setTimeout(() => fx.remove(), 3600);
  return fx;
}

async function logbookView(root, ctx, opts = {}) {
  const reload = o => { root.replaceChildren(); return logbookView(root, ctx, o); };
  let d;
  try { d = await loadYear(S.year); } catch (e) { root.append(h('div', { class: 'err' }, e.message)); return; }
  const st = d.stats, closed = d.closed, prev = opts.prev || {};
  const fig = (k, to, dec, unit, from = 0) => h('div', { class: 'fig' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, num(to, dec, from, opts.prev ? 900 : 1100), unit ? h('small', {}, unit) : null));

  const view = h('div', {});
  put(view, 
    h('div', { class: 'pagehead' }, yearTabs(d.years, y => { S.year = y; reload(); }),
      closed ? null : h('button', { class: 'btn pri', onclick: () => entryDrawer(null, afterSave, false) }, ic('plus'), 'Törn eintragen')),
    closed ? h('div', { class: 'lock' }, ic('lock'), h('div', {}, h('b', {}, `Saison ${d.year} ist abgeschlossen`), h('div', { class: 'small mut' }, `Seit ${new Date(d.season.closed).toLocaleDateString('de-DE')}, abgeschlossen von ${d.season.by}. Die Einträge sind schreibgeschützt.`)), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => { S.view = 'season'; render(); } }, 'Saisonbericht')) : null,
    h('div', { class: 'figs sumline' }, fig('Törns', st.trips, 0, '', prev.trips ?? 0), fig('Seemeilen', st.nm, 1, 'sm', prev.nm ?? 0), fig('Stunden', st.hours, 1, 'h', prev.hours ?? 0), fig('Segeltage', st.days, 0, '', prev.days ?? 0)),
    opts.fresh ? sailFx() : null);

  if (!d.entries.length) {
    put(view, h('div', { class: 'empty', style: 'margin-top:26px' }, ic('boat'), h('h3', {}, `Noch kein Törn in ${d.year}`), h('p', {}, closed ? 'In dieser Saison wurde nichts eingetragen.' : 'Trag deinen ersten Törn ein, mit Route, Wind und Crew.'),
      closed ? null : h('button', { class: 'btn pri', style: 'margin-top:16px', onclick: () => entryDrawer(null, afterSave, false) }, ic('plus'), 'Törn eintragen')));
    root.append(view); return;
  }
  const log = h('div', { class: 'log' });
  d.entries.forEach(e => {
    const dt = new Date(e.date + 'T12:00:00'), fresh = e.id === opts.fresh;
    const row = h('div', { class: 'lrow' + (fresh ? ' fresh' : ''), role: 'button', tabindex: 0, 'aria-label': `${e.title}, ${e.date}`, onclick: () => entryDrawer(e, afterSave, closed), onkeydown: ev => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), entryDrawer(e, afterSave, closed)) },
      h('div', { class: 'd' }, h('b', { class: 'num' }, dt.getDate()), h('span', {}, MONTHS[dt.getMonth()])),
      h('div', { style: 'min-width:0' }, h('h3', {}, e.title, h('span', { class: 'tag' }, e.type)),
        h('div', { class: 'meta' },
          e.start ? h('span', {}, ic('clock'), `${e.start}${e.end ? ' bis ' + e.end : ''}`) : null, e.boat ? h('span', {}, ic('boat'), e.boat) : null, e.crew ? h('span', {}, ic('crew'), e.crew) : null,
          e.wind_avg ? h('span', {}, ic('wind'), `Ø ${f0(e.wind_avg)}${e.wind_max ? ', Böen ' + f0(e.wind_max) : ''} kn${e.wind_dir ? ' aus ' + dirText(e.wind_dir) : ''}`) : null),
        e.notes ? h('div', { class: 'note' }, e.notes.length > 170 ? e.notes.slice(0, 170) + ' …' : e.notes) : null),
      routeThumb(e.route),
      h('div', { class: 'nm' }, h('b', { class: 'num' }, f1(e.distance)), h('span', {}, 'sm' + (e.hours ? ` · ${f1(e.hours)} h` : ''))));
    const w = h('div', { class: 'lrow-w' + (fresh ? ' enter' : ''), 'data-id': e.id }, h('div', { class: 'in' }, row));
    log.append(w);
    if (fresh) setTimeout(() => w.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' }), 120);
  });
  put(view, log);
  root.append(view);

  // nach Speichern/Löschen: Liste neu aufbauen, neuer Eintrag spielt seine Animation
  async function afterSave(info) {
    if (info.leave) {
      const w = document.querySelector(`.lrow-w[data-id="${info.leave}"]`);
      if (w && !REDUCED) { w.classList.add('leave'); await new Promise(r => setTimeout(r, 430)); }
      return reload({ prev: { trips: st.trips, nm: st.nm, hours: st.hours, days: st.days } });
    }
    const same = info.year === S.year;
    S.year = info.year;
    reload(same ? { fresh: info.id, prev: { trips: st.trips, nm: st.nm, hours: st.hours, days: st.days } } : { fresh: info.id });
  }
}

// ---- Eintrag anlegen / bearbeiten (Seitenleiste) ----
function entryDrawer(e, done, readonly) {
  const isNew = !e;
  e = e || { date: new Date().toISOString().slice(0, 10), type: 'Törn', route: [] };
  const v = (k, props = {}) => h('input', { value: e[k] ?? '', ...props });
  const date = v('date', { type: 'date', required: true }), start = v('start', { type: 'time' }), end = v('end', { type: 'time' });
  const title = v('title', { placeholder: 'z. B. Herrsching nach Dießen und zurück', maxlength: 120 });
  const type = h('select', {}, ['Törn', 'Regatta', 'Training', 'Überführung', 'Sonstiges'].map(t => h('option', { value: t, selected: t === e.type }, t)));
  const boat = v('boat', { placeholder: 'Boot', maxlength: 80, list: 'boats' });
  const crew = v('crew', { placeholder: 'Namen, durch Komma getrennt', maxlength: 300 });
  const dist = v('distance', { type: 'number', step: '0.1', min: 0, placeholder: 'sm', inputmode: 'decimal' });
  const hours = v('hours', { type: 'number', step: '0.1', min: 0, placeholder: 'h', inputmode: 'decimal' });
  const wavg = v('wind_avg', { type: 'number', step: '0.1', min: 0, placeholder: 'kn' });
  const wmax = v('wind_max', { type: 'number', step: '0.1', min: 0, placeholder: 'kn' });
  const wdir = v('wind_dir', { type: 'number', step: '1', min: 0, max: 360, placeholder: 'Grad, woher' });
  const notes = h('textarea', { maxlength: 8000, placeholder: 'Verlauf, Besonderheiten, Crew-Notizen …' }, e.notes || '');
  const err = h('div', { class: 'err', role: 'alert' });
  const boatList = h('datalist', { id: 'boats' }, [...new Set((LB.data?.entries || []).map(x => x.boat).filter(Boolean))].map(b => h('option', { value: b })));
  let route = (e.route || []).map(p => [...p]);

  const rmEl = h('div', { id: 'routemap', style: 'height:260px;margin-top:10px' });
  const rinfo = h('span', { class: 'small mut' });
  let rmap, line, mk = [];
  const gpx = h('input', { type: 'file', accept: '.gpx', style: 'display:none', 'aria-label': 'GPX-Datei' });
  function redraw() {
    if (!rmap) return;
    line.setLatLngs(route); mk.forEach(m => rmap.removeLayer(m)); mk = [];
    if (route.length) { mk.push(L.circleMarker(route[0], { radius: 6, color: '#1f7a5c', fillColor: '#1f7a5c', fillOpacity: 1 }).addTo(rmap)); if (route.length > 1) mk.push(L.circleMarker(route[route.length - 1], { radius: 6, color: '#b0245f', fillColor: '#b0245f', fillOpacity: 1 }).addTo(rmap)); }
    rinfo.textContent = route.length > 1 ? `${route.length} Punkte, ${f1(routeNM(route))} sm` : (readonly ? 'Keine Route gespeichert.' : 'Klick auf die Karte setzt Routenpunkte. Oder GPX-Datei importieren.');
  }
  const setRouteDistance = () => { if (route.length > 1) dist.value = Math.round(routeNM(route) * 10) / 10; };
  function initMap() {
    rmap = L.map(rmEl, { zoomSnap: .5 }).setView(route.length ? route[0] : [LAKE.lat, LAKE.lon], LAKE.zoom);
    tileLayer(prefersDark()).addTo(rmap);
    line = L.polyline(route, { color: '#b0245f', weight: 4 }).addTo(rmap);
    if (route.length > 1) rmap.fitBounds(line.getBounds().pad(.2));
    if (!readonly) rmap.on('click', ev => { route.push([+ev.latlng.lat.toFixed(5), +ev.latlng.lng.toFixed(5)]); redraw(); setRouteDistance(); });
    redraw();
  }
  gpx.onchange = async () => {
    const f = gpx.files[0]; if (!f) return;
    const doc = new DOMParser().parseFromString(await f.text(), 'application/xml');
    let pts = [...doc.getElementsByTagName('trkpt')]; if (!pts.length) pts = [...doc.getElementsByTagName('rtept')];
    let r = pts.map(p => [+p.getAttribute('lat'), +p.getAttribute('lon')]).filter(p => isFinite(p[0]) && isFinite(p[1]));
    if (!r.length) return toast('Keine Trackpunkte in der GPX-Datei');
    const step = Math.ceil(r.length / 1500); r = r.filter((_, i) => i % step === 0 || i === r.length - 1);
    route = r.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
    const t = pts.map(p => p.getElementsByTagName('time')[0]?.textContent).filter(Boolean);
    if (t.length > 1 && !hours.value) hours.value = Math.round((new Date(t[t.length - 1]) - new Date(t[0])) / 360000) / 10;
    if (t.length && isNew) date.value = new Date(t[0]).toISOString().slice(0, 10);
    rmap.fitBounds(L.polyline(route).getBounds().pad(.2)); redraw(); setRouteDistance(); toast('GPX-Route importiert');
  };
  const autoHours = () => { if (start.value && end.value && !hours.value) { let m = (+end.value.slice(0, 2) * 60 + +end.value.slice(3)) - (+start.value.slice(0, 2) * 60 + +start.value.slice(3)); if (m < 0) m += 1440; hours.value = Math.round(m / 6) / 10; } };
  start.onchange = end.onchange = autoHours;
  const useWeather = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    try { const c = Live.cur || await Live.load(); wavg.value = c.station.wind_kn ?? ''; wmax.value = c.station.gust_kn ?? ''; wdir.value = c.station.wind_dir != null ? Math.round(c.station.wind_dir) : ''; toast('Aktuelle Windwerte übernommen'); } catch (x) { toast(x.message); }
  } }, ic('wind'), 'Aktuellen Wind übernehmen');

  // ---- Drawer-Gerüst ----
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  let closing = false;
  function close() { if (closing) return; closing = true; scrim.classList.add('out'); drawer.classList.add('out'); document.removeEventListener('keydown', onKey); setTimeout(() => { if (rmap) { rmap.remove(); rmap = null; } scrim.remove(); drawer.remove(); }, 300); }
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  const ck = h('span', { class: 'ck', html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' });
  const saveBtn = h('button', { class: 'btn pri savebtn' }, h('span', {}, 'Speichern'), ck);
  let saving = false;
  async function save() {
    if (saving) return;
    err.textContent = ''; [title, date].forEach(x => x.classList.remove('bad'));
    if (!title.value.trim()) { title.classList.add('bad'); title.focus(); err.textContent = 'Gib dem Törn einen Titel.'; return; }
    if (!date.value) { date.classList.add('bad'); date.focus(); err.textContent = 'Wähle ein Datum.'; return; }
    const body = { date: date.value, start: start.value, end: end.value, title: title.value, type: type.value, boat: boat.value, crew: crew.value,
      distance: +dist.value || 0, hours: +hours.value || 0, wind_avg: +wavg.value || 0, wind_max: +wmax.value || 0, wind_dir: +wdir.value || 0, notes: notes.value, route };
    saving = true; saveBtn.disabled = true; saveBtn.firstChild.textContent = 'Speichert …';
    try {
      const out = isNew ? await api('/api/logbook', 'POST', body) : await api('/api/logbook/' + e.id, 'PUT', body);
      saveBtn.classList.add('done'); saveBtn.disabled = false;
      await new Promise(r => setTimeout(r, REDUCED ? 0 : 750));
      close(); await new Promise(r => setTimeout(r, REDUCED ? 0 : 260));
      toast(isNew ? 'Törn eingetragen' : 'Änderungen gespeichert');
      done({ id: out.id, year: +out.date.slice(0, 4) });
    } catch (x) { saving = false; saveBtn.disabled = false; saveBtn.firstChild.textContent = 'Speichern'; err.textContent = x.message; }
  }
  saveBtn.onclick = save;
  let confirmDel = false, delTimer;
  const delBtn = h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    if (!confirmDel) { confirmDel = true; delBtn.textContent = 'Wirklich löschen?'; delBtn.classList.add('on'); delBtn.style.background = 'var(--bad)'; delBtn.style.color = '#fff'; delTimer = setTimeout(() => { confirmDel = false; delBtn.textContent = 'Löschen'; delBtn.style.background = delBtn.style.color = ''; }, 4000); return; }
    clearTimeout(delTimer);
    try { await api('/api/logbook/' + e.id, 'DELETE'); close(); await new Promise(r => setTimeout(r, 280)); toast('Törn gelöscht'); done({ leave: e.id }); } catch (x) { err.textContent = x.message; }
  } }, ic('trash'), 'Löschen');

  if (readonly) [date, start, end, title, type, boat, crew, dist, hours, wavg, wmax, wdir, notes].forEach(x => x.disabled = true);
  const L2 = (t, el) => h('div', {}, h('label', { class: 'f' }, t), el);
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Neuer Törn' : 'Törn' },
    h('header', {}, h('h2', {}, isNew ? 'Neuer Törn' : readonly ? 'Törn (schreibgeschützt)' : 'Törn bearbeiten'), h('span', { class: 'sp' }), h('button', { class: 'iconbtn', 'aria-label': 'Schließen', onclick: () => close() }, ic('x'))),
    h('div', { class: 'body' },
      h('section', { class: 'sec' }, h('h3', {}, 'Wann'), h('div', { class: 'f3' }, L2('Datum', date), L2('Start', start), L2('Ende', end))),
      h('section', { class: 'sec' }, h('h3', {}, 'Törn'), h('label', { class: 'f' }, 'Titel'), title, h('div', { class: 'f3' }, L2('Art', type), L2('Boot', boat), L2('Crew', crew)), boatList),
      h('section', { class: 'sec' }, h('h3', {}, 'Strecke'), h('div', { class: 'f2' }, L2('Distanz in sm', dist), L2('Dauer in h', hours)), rmEl,
        h('div', { class: 'row', style: 'margin-top:10px;gap:8px' }, rinfo, h('span', { class: 'sp' }),
          readonly ? null : [h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { route.pop(); redraw(); setRouteDistance(); } }, 'Letzter Punkt zurück'), h('button', { class: 'btn sm quiet', type: 'button', onclick: () => { route = []; redraw(); } }, 'Leeren'), h('button', { class: 'btn sm', type: 'button', onclick: () => gpx.click() }, ic('download'), 'GPX importieren'), gpx])),
      h('section', { class: 'sec' }, h('h3', {}, 'Wind'), h('div', { class: 'f3' }, L2('Ø in kn', wavg), L2('Böen in kn', wmax), L2('Richtung in °', wdir)), readonly ? null : h('div', { style: 'margin-top:12px' }, useWeather)),
      h('section', { class: 'sec' }, h('h3', {}, 'Notizen'), notes), err),
    h('footer', {}, !isNew && !readonly ? delBtn : null, h('span', { class: 'sp' }), h('button', { class: 'btn quiet', type: 'button', onclick: () => close() }, readonly ? 'Schließen' : 'Abbrechen'), readonly ? null : saveBtn));
  document.body.append(scrim, drawer);
  document.addEventListener('keydown', onKey);
  initMap(); setTimeout(() => { if (rmap && !closing) rmap.invalidateSize(); }, 480);
  setTimeout(() => (isNew ? title : drawer.querySelector('.iconbtn')).focus(), 460);
}
