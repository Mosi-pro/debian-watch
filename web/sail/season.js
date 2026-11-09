'use strict';

async function seasonView(root, ctx) {
  const rerender = async () => { ctx.cleanup && ctx.cleanup(); ctx.cleanup = null; root.replaceChildren(); await seasonView(root, ctx); };
  let d;
  try { d = await loadYear(S.year); } catch (e) { root.append(h('div', { class: 'err' }, e.message)); return; }
  const st = d.stats, closed = d.closed, se = d.season;

  root.append(h('div', { class: 'head' }, h('h2', {}, 'Saison'), yearChips(d.years, y => { S.year = y; rerender(); }), h('span', { class: 'sp' }),
    h('div', { class: 'row noprint' },
      h('a', { class: 'btn', href: `/api/export?year=${d.year}&format=csv`, download: '' }, 'CSV'),
      h('a', { class: 'btn', href: `/api/export?year=${d.year}&format=json`, download: '' }, 'JSON'),
      st.trips ? h('button', { class: 'btn', onclick: () => print() }, '🖨 Drucken / PDF') : null,
      closed ? h('button', { class: 'btn danger', onclick: reopen }, 'Saison wieder öffnen') : (st.trips ? h('button', { class: 'btn pri', onclick: () => closeModal(d, rerender) }, '🏁 Saison abschließen') : null))));

  if (!st.trips) { root.append(h('div', { class: 'card empty' }, icon('season'), h('h3', { style: 'margin:10px 0 4px' }, `Keine Daten für ${d.year}`), h('div', {}, 'Sobald du Törns im Logbuch einträgst, erscheint hier deine Saison.'))); return; }

  if (closed) root.append(h('div', { class: 'card', style: 'margin-bottom:14px;background:var(--hero)' },
    h('div', { class: 'row' }, h('span', { style: 'font-size:28px' }, '🏁'), h('div', {}, h('h3', { style: 'margin:0;color:var(--acc)' }, `Saisonabschluss ${d.year}`), h('div', { class: 'small mut' }, `abgeschlossen am ${new Date(se.closed).toLocaleDateString('de-DE')} von ${se.by}`))),
    se.note ? h('p', { style: 'white-space:pre-wrap;margin:12px 0 0' }, se.note) : null));

  const K = (k, v, u) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v num' }, v, u ? h('small', {}, ' ' + u) : null));
  root.append(h('div', { class: 'kpis' }, K('Seemeilen', f1(st.nm), 'sm'), K('Törns', f0(st.trips)), K('Segeltage', f0(st.days)), K('Stunden auf dem Wasser', f1(st.hours), 'h'), K('Ø Geschwindigkeit', f1(st.avg_speed), 'kn'), K('Ø Wind', f1(st.wind_avg), 'kn'), K('Max. Böe', f1(st.wind_max), 'kn')));

  // Monatsdiagramm
  const maxM = Math.max(1, ...st.by_month_nm);
  root.append(h('div', { class: 'grid g2', style: 'margin-top:14px' },
    h('div', { class: 'card' }, h('h3', {}, 'Seemeilen pro Monat'), h('div', { class: 'bars' }, st.by_month_nm.map((v, i) => h('div', { class: 'b', title: `${MONTHS[i]}: ${f1(v)} sm, ${st.by_month_trips[i]} Törns` }, h('em', { class: 'num' }, v ? f0(v) : ''), h('i', { style: `height:${v / maxM * 100}%;${v ? '' : 'opacity:.18'}` }), h('span', {}, MONTHS[i]))))),
    h('div', { class: 'card' }, h('h3', {}, 'Highlights'),
      h('div', { class: 'lb' },
        st.longest ? h('div', {}, h('div', { class: 'mut small' }, 'Längster Törn'), h('b', {}, `${f1(st.longest.distance)} sm`), ' · ', st.longest.title, h('span', { class: 'mut small' }, ` (${st.longest.date})`)) : null,
        st.windiest ? h('div', {}, h('div', { class: 'mut small' }, 'Windigster Törn'), h('b', {}, `Böen ${f1(st.windiest.wind_max)} kn`), ' · ', st.windiest.title, h('span', { class: 'mut small' }, ` (${st.windiest.date})`)) : null,
        h('div', {}, h('div', { class: 'mut small' }, 'Saisonzeitraum'), h('b', {}, `${new Date(st.first + 'T12:00').toLocaleDateString('de-DE')} – ${new Date(st.last + 'T12:00').toLocaleDateString('de-DE')}`))))));

  const board = (title, arr, unit) => {
    const mx = Math.max(1, ...arr.map(x => x.nm));
    return h('div', { class: 'card' }, h('h3', {}, title), arr.length ? h('div', { class: 'lb' }, arr.map(x => h('div', { class: 'r' }, h('span', {}, x.name), h('span', { class: 'num mut' }, `${x.count}× · ${f1(x.nm)} sm`), h('div', { class: 'bar' }, h('i', { style: `width:${x.nm / mx * 100}%` }))))) : h('div', { class: 'mut' }, 'Keine Angaben'));
  };
  root.append(h('div', { class: 'grid g2', style: 'margin-top:14px' }, board('Crew', st.crew), board('Art der Törns', st.by_type), board('Boote', st.boats)));

  // Routenkarte
  const withRoutes = d.entries.filter(e => e.route && e.route.length > 1);
  if (withRoutes.length) {
    const mp = h('div', { id: 'seasonmap', style: 'height:360px;border-radius:14px;overflow:hidden' });
    root.append(h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', {}, 'Routen der Saison'), mp));
    const map = L.map(mp, { zoomSnap: .5 }); tileLayer(prefersDark()).addTo(map);
    const g = L.featureGroup(withRoutes.map((e, i) => L.polyline(e.route, { color: ['#ff8a3d', '#33d6ff', '#2dd4a5', '#f0436b', '#d4e157', '#b388ff'][i % 6], weight: 3.5, opacity: .9 }).bindPopup(`<b>${e.title.replace(/[<>&]/g, '')}</b><br>${e.date} · ${e.distance} sm`))).addTo(map);
    map.fitBounds(g.getBounds().pad(.15));
    ctx.cleanup = () => map.remove();
  }

  async function reopen() {
    if (!confirm(`Saison ${d.year} wieder öffnen? Der Abschluss-Bericht (Notiz, eingefrorene Zahlen) geht dabei verloren.`)) return;
    try { await api('/api/seasons/' + d.year, 'DELETE'); toast('Saison geöffnet'); rerender(); } catch (e) { toast(e.message); }
  }
}

function closeModal(d, done) {
  const st = d.stats, note = h('textarea', { placeholder: 'Rückblick: Highlights, Lehren, Pläne für nächstes Jahr …', maxlength: 4000 });
  const err = h('div', { class: 'err' }), close = () => ov.remove();
  const ov = h('div', { class: 'ov', onmousedown: e => e.target === ov && close() }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h2', {}, `Saison ${d.year} abschließen`),
    h('p', { class: 'mut' }, `${st.trips} Törns · ${f1(st.nm)} sm · ${f1(st.hours)} h. Beim Abschluss werden die Zahlen eingefroren und die Einträge des Jahres schreibgeschützt. Du kannst die Saison jederzeit wieder öffnen.`),
    h('label', {}, 'Saison-Notiz (optional)'), note, err,
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: close }, 'Abbrechen'), h('button', { class: 'btn pri', onclick: async () => {
      try { await api(`/api/seasons/${d.year}/close`, 'POST', { note: note.value }); close(); toast(`Saison ${d.year} abgeschlossen 🏁`); done(); } catch (x) { err.textContent = x.message; }
    } }, '🏁 Jetzt abschließen'))));
  document.body.append(ov); note.focus();
}
