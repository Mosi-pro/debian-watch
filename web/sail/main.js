'use strict';
let ctx = { cleanup: null };
let liveTimer = null;

async function boot() {
  clearTimers(); clearInterval(liveTimer); ctx.cleanup && ctx.cleanup(); ctx.cleanup = null;
  let st = {};
  try { st = await (await fetch('/api/state')).json(); } catch {}
  S.user = st.user || null; S.csrf = st.csrf || null; S.totp = !!st.totp_enabled;
  if (S.user) return shell();
  gateView(st.setup_needed);
}

// ---- Anmeldung ----
function gateView(setup) {
  const err = h('div', { class: 'err', role: 'alert' });
  const u = h('input', { autocomplete: 'username', required: true, autofocus: true, id: 'u' }), p = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, id: 'p' });
  const c = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '123456', id: 'c' });
  const cw = h('div', { hidden: true }, h('label', { class: 'f', for: 'c' }, 'Code aus der Authenticator-App'), c);
  const btn = h('button', { class: 'btn pri' }, setup ? 'Konto anlegen' : 'Anmelden');
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await api(setup ? '/api/setup' : '/api/login', 'POST', { user: u.value, password: p.value, code: c.value }); boot(); }
    catch (x) { btn.disabled = false; if (x.data && x.data.need_totp) { cw.hidden = false; c.focus(); } err.textContent = x.message; }
  } }, h('label', { class: 'f', for: 'u' }, 'Benutzer'), u, h('label', { class: 'f', for: 'p' }, setup ? 'Passwort (mindestens 10 Zeichen)' : 'Passwort'), p, cw, btn, err);
  const rose = roseSvg(225);
  requestAnimationFrame(() => requestAnimationFrame(() => { rose.querySelector('#needle').style.transform = 'rotate(215deg)'; }));
  $app.replaceChildren(h('div', { class: 'gate' },
    h('div', { class: 'art' }, rose, h('span', { class: 'cap' }, 'Ammersee 47°59′ N 11°08′ O')),
    h('div', { class: 'form' }, h('div', { class: 'logo' }, logo(), h('span', {}, 'Mosi', h('i', {}, 'Sail'))), h('p', { class: 'lead' }, setup ? 'Willkommen an Bord. Lege dein Konto an, um zu starten.' : 'Wind, Karte und Logbuch für den Ammersee.'), form,
      location.protocol === 'https:' ? h('p', { class: 'small mut', style: 'margin-top:22px' }, 'Zertifikatswarnung im Browser? ', h('a', { href: '/ca.crt', style: 'color:var(--mag)' }, 'Zertifikat herunterladen'), ' und auf dem Gerät installieren.') : null)));
}

// ---- Gerüst ----
const VIEWS = [['cockpit', 'Cockpit', 'compass', cockpitView], ['map', 'Karte', 'chart', mapView], ['log', 'Logbuch', 'book', logbookView], ['season', 'Saison', 'flag', seasonView]];
const TITLES = { cockpit: 'Cockpit', map: 'Windkarte', log: 'Logbuch', season: 'Saison', account: 'Konto' };
let nav, title, main, liveBtn, themeBtn;

function shell() {
  const item = (k, l, i, fn) => h('button', { class: 'nv', 'data-v': k, onclick: fn || (() => { S.view = k; render(); }) }, ic(i), h('span', {}, l));
  themeBtn = h('button', { class: 'nv theme', onclick: () => setTheme(prefersDark() ? 'light' : 'dark'), 'aria-label': 'Design wechseln' });
  const paintTheme = () => themeBtn.replaceChildren(ic(prefersDark() ? 'sun' : 'moon'), h('span', {}, prefersDark() ? 'Hell' : 'Dunkel'));
  paintTheme(); document.addEventListener('themechange', paintTheme);
  nav = h('nav', { 'aria-label': 'Bereiche' }, VIEWS.map(([k, l, i]) => item(k, l, i)));
  const rail = h('aside', { class: 'rail' }, h('div', { class: 'mark' }, logo()), nav, h('div', { class: 'foot' }, themeBtn, item('account', 'Konto', 'user')));
  title = h('h1', {}, '');
  liveBtn = h('button', { class: 'live', 'aria-label': 'Aktueller Wind, zum Cockpit', onclick: () => { S.view = 'cockpit'; render(); } });
  const bar = h('header', { class: 'bar' }, title, h('span', { class: 'where' }, 'Ammersee'), h('span', { class: 'sp' }), liveBtn);
  main = h('main');
  $app.replaceChildren(h('div', { class: 'app' }, rail, h('div', { class: 'stage' }, bar, main)));
  Live.subs = []; Live.on(paintLive); Live.load(); clearInterval(liveTimer); liveTimer = setInterval(() => Live.load(), 120e3);
  render();
}

function paintLive(c, err) {
  if (!c) { liveBtn.replaceChildren(h('span', { class: 'g' }, err ? 'Wind: keine Daten' : '…')); return; }
  const st = c.station, col = windColor(st.wind_kn ?? 0), age = st.time ? (Date.now() - new Date(st.time)) / 60000 : 0;
  liveBtn.replaceChildren(
    h('div', { class: 'nm' }, h('span', { class: 'dot' + (age > 45 || c.stale ? ' off' : '') }), 'Herrsching', h('br'), st.time ? hhmm(st.time) + ' Uhr' : ''),
    st.wind_dir != null ? windArrow(st.wind_dir, col, 26) : null,
    h('div', { class: 'v num' }, f0(st.wind_kn), h('small', {}, 'kn')),
    h('div', { class: 'g' }, `Böen ${f0(st.gust_kn)}`, h('br'), dirText(st.wind_dir)));
}

async function render() {
  clearTimers(); ctx.cleanup && ctx.cleanup(); ctx.cleanup = null;
  document.querySelectorAll('.nv[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  title.textContent = TITLES[S.view] || '';
  main.replaceChildren(); window.scrollTo(0, 0);
  const holder = h('div', { class: 'view' }); main.append(holder);
  const v = VIEWS.find(x => x[0] === S.view);
  if (v) await v[3](holder, ctx); else accountView(holder);
}
window.render = render;
boot();
