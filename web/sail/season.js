'use strict';

function confirmDialog(title, text, ok, danger) {
  return new Promise(res => {
    const scrim = h('div', { class: 'scrim' });
    const end = v => { document.removeEventListener('keydown', onKey); scrim.remove(); dlg.remove(); res(v); };
    const onKey = e => e.key === 'Escape' && end(false);
    const dlg = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' }, h('h2', {}, title), h('p', { class: 'mut' }, text),
      h('div', { class: 'btns' }, h('button', { class: 'btn quiet', onclick: () => end(false) }, 'Abbrechen'), h('button', { class: 'btn ' + (danger ? 'danger' : 'pri'), onclick: () => end(true) }, ok)));
    scrim.onclick = () => end(false);
    document.body.append(scrim, dlg); document.addEventListener('keydown', onKey); dlg.querySelector('.btn:last-child').focus();
  });
}

async function seasonView(root, ctx, opts = {}) {
  const reload = o => { ctx.cleanup && ctx.cleanup(); ctx.cleanup = null; root.replaceChildren(); return seasonView(root, ctx, o); };
  let d;
  try { d = await loadYear(S.year); } catch (e) { root.append(h('div', { class: 'err' }, e.message)); return; }
  const st = d.stats, closed = d.closed, se = d.season, view = h('div', { class: 'report' });

  put(view, h('div', { class: 'pagehead noprint' }, yearTabs(d.years, y => { S.year = y; reload(); }),
    h('a', { class: 'btn sm quiet', href: `/api/export?year=${d.year}&format=csv`, download: '' }, ic('download'), 'CSV'),
    h('a', { class: 'btn sm quiet', href: `/api/export?year=${d.year}&format=json`, download: '' }, ic('download'), 'JSON'),
    st.trips ? h('button', { class: 'btn sm quiet', onclick: () => print() }, ic('print'), 'Drucken') : null,
    closed ? h('button', { class: 'btn sm danger', onclick: reopen }, 'Saison wieder öffnen') : (st.trips ? h('button', { class: 'btn pri', onclick: () => closeDialog(d, reload) }, ic('flag'), 'Saison abschließen') : null)));
  if (!st.trips) {
    put(view, h('div', { class: 'empty' }, ic('flag'), h('h3', {}, `Keine Daten für ${d.year}`), h('p', {}, 'Sobald du Törns im Logbuch einträgst, entsteht hier deine Saison.'),
      h('button', { class: 'btn pri', style: 'margin-top:16px', onclick: () => { S.view = 'log'; render(); } }, 'Zum Logbuch')));
    root.append(view); return;
  }
  const fmtD = s => new Date(s + 'T12:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  put(view, h('div', { class: 'title' }, h('h2', {}, `Saison ${d.year}`), h('div', { style: 'padding-bottom:6px' }, h('div', { style: 'font:600 22px var(--f-ui)' }, `${st.trips} ${st.trips === 1 ? 'Törn' : 'Törns'} an ${st.days} ${st.days === 1 ? 'Tag' : 'Tagen'}`), h('div', { class: 'mut' }, `${fmtD(st.first)} bis ${fmtD(st.last)}`)), h('span', { class: 'sp' }), closed ? stampSvg(d.year, opts.slam) : null));
  if (closed && se.note) put(view, h('div', { class: 'note' }, se.note));
  const dly = opts.slam ? 500 : 0;
  const F = (k, to, dec, unit) => { const n = h('span', { class: 'num' }, '0'); setTimeout(() => countUp(n, to, dec, 1200), dly); return h('div', { class: 'fig' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, n, unit ? h('small', {}, unit) : null)); };
  put(view, h('div', { class: 'figs', style: 'margin:8px 0 24px' }, F('Seemeilen', st.nm, 1, 'sm'), F('Stunden auf dem Wasser', st.hours, 1, 'h'), F('Ø Geschwindigkeit', st.avg_speed, 1, 'kn'), F('Ø Wind', st.wind_avg, 1, 'kn'), F('Stärkste Böe', st.wind_max, 0, 'kn')));

  const maxM = Math.max(1, ...st.by_month_nm);
  put(view, h('div', { class: 'cols2' },
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', {}, 'Seemeilen pro Monat')), h('div', { class: 'pb' },
      h('div', { class: 'bars' }, st.by_month_nm.map((v, i) => h('div', { class: 'b' + (v ? '' : ' z'), title: `${MONTHS[i]}: ${f1(v)} sm in ${st.by_month_trips[i]} Törns` }, h('em', { class: 'num' }, v ? f0(v) : ''), h('i', { style: `height:${v ? Math.max(v / maxM * 100, 3) : 1}%;--i:${i}` })))),
      h('div', { class: 'mlab' }, MONTHS.map(m => h('span', {}, m))))),
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', {}, 'Höhepunkte')), h('div', { class: 'pb hl' },
      st.longest ? h('div', {}, h('div', { class: 'k' }, 'Längster Törn'), h('b', {}, `${f1(st.longest.distance)} sm`), ` ${st.longest.title}`, h('span', { class: 'mut' }, `, ${fmtD(st.longest.date)}`)) : null,
      st.windiest && st.wind_max ? h('div', {}, h('div', { class: 'k' }, 'Windigster Törn'), h('b', {}, `Böen bis ${f0(st.windiest.wind_max)} kn`), ` ${st.windiest.title}`, h('span', { class: 'mut' }, `, ${fmtD(st.windiest.date)}`)) : null,
      st.crew[0] ? h('div', {}, h('div', { class: 'k' }, 'Meiste Törns zusammen'), h('b', {}, st.crew[0].name), h('span', { class: 'mut' }, `, ${st.crew[0].count} Törns`)) : null))));

  const board = (title, arr) => {
    const mx = Math.max(1, ...arr.map(x => x.nm));
    return h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', {}, title)), h('div', { class: 'pb' }, arr.length ? h('div', { class: 'lb' }, arr.map((x, i) => h('div', { class: 'r' }, h('span', { class: 'nm' }, x.name), h('span', { class: 'm' }, `${x.count}× · ${f1(x.nm)} sm`), h('div', { class: 'bar2' }, h('i', { style: `width:${x.nm / mx * 100}%;animation-delay:${i * 80}ms` }))))) : h('p', { class: 'mut' }, 'Keine Angaben')));
  };
  put(view, h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;margin-top:24px' }, board('Crew', st.crew), board('Art der Törns', st.by_type), board('Boote', st.boats)));

  const withRoutes = d.entries.filter(e => e.route && e.route.length > 1);
  if (withRoutes.length) {
    const mp = h('div', { id: 'seasonmap', style: 'height:380px' });
    put(view, h('section', { class: 'panel', style: 'margin-top:24px' }, h('div', { class: 'ph' }, h('h2', {}, 'Routen der Saison')), h('div', { class: 'pb' }, mp)));
    root.append(view);
    const map = L.map(mp, { zoomSnap: .5 }); let tl = tileLayer(prefersDark()).addTo(map);
    const onTheme = () => { map.removeLayer(tl); tl = tileLayer(prefersDark()).addTo(map); }; document.addEventListener('themechange', onTheme);
    const g = L.featureGroup(withRoutes.map(e => L.polyline(e.route, { color: '#b0245f', weight: 3, opacity: .85 }).bindPopup(h('div', {}, h('b', {}, e.title), h('br'), `${e.date} · ${f1(e.distance)} sm`)))).addTo(map);
    map.fitBounds(g.getBounds().pad(.15));
    ctx.cleanup = () => { document.removeEventListener('themechange', onTheme); map.remove(); };
  } else root.append(view);

  async function reopen() {
    if (!await confirmDialog(`Saison ${d.year} wieder öffnen?`, 'Der Abschlussbericht mit deiner Notiz geht dabei verloren. Die Törns bleiben erhalten und lassen sich wieder bearbeiten.', 'Saison öffnen', true)) return;
    try { await api('/api/seasons/' + d.year, 'DELETE'); toast('Saison geöffnet'); reload(); } catch (e) { toast(e.message); }
  }
}

function closeDialog(d, done) {
  const st = d.stats, note = h('textarea', { placeholder: 'Rückblick: Highlights, Lehren, Pläne für nächstes Jahr …', maxlength: 4000, style: 'margin-top:6px' });
  const err = h('div', { class: 'err' }), scrim = h('div', { class: 'scrim' });
  const end = () => { document.removeEventListener('keydown', onKey); scrim.remove(); dlg.remove(); };
  const onKey = e => e.key === 'Escape' && end();
  const go = h('button', { class: 'btn pri', onclick: async () => {
    go.disabled = true;
    try { await api(`/api/seasons/${d.year}/close`, 'POST', { note: note.value }); end(); toast(`Saison ${d.year} abgeschlossen`); done({ slam: true }); } catch (x) { go.disabled = false; err.textContent = x.message; }
  } }, ic('flag'), 'Jetzt abschließen');
  const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, `Saison ${d.year} abschließen`),
    h('p', { class: 'mut' }, `${st.trips} Törns, ${f1(st.nm)} sm, ${f1(st.hours)} Stunden. Beim Abschluss werden die Zahlen eingefroren und die Einträge dieses Jahres schreibgeschützt. Du kannst die Saison später wieder öffnen.`),
    h('label', { class: 'f' }, 'Notiz zur Saison (optional)'), note, err, h('div', { class: 'btns' }, h('button', { class: 'btn quiet', onclick: end }, 'Abbrechen'), go));
  scrim.onclick = end; document.body.append(scrim, dlg); document.addEventListener('keydown', onKey); note.focus();
}
