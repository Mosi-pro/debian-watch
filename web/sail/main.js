'use strict';
let ctx = { cleanup: null };

async function boot() {
  clearTimers(); ctx.cleanup && ctx.cleanup(); ctx.cleanup = null;
  let st = {};
  try { st = await (await fetch('/api/state')).json(); } catch {}
  S.user = st.user || null; S.csrf = st.csrf || null; S.totp = !!st.totp_enabled;
  if (S.user) return shell();
  loginView(st.setup_needed);
}

function loginView(setup) {
  const err = h('div', { class: 'err', role: 'alert' });
  const u = h('input', { autocomplete: 'username', required: true, autofocus: true }), p = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true });
  const c = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '123456' });
  const cw = h('div', { hidden: true }, h('label', {}, '2FA-Code'), c);
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { await api(setup ? '/api/setup' : '/api/login', 'POST', { user: u.value, password: p.value, code: c.value }); boot(); }
    catch (x) { if (x.data && x.data.need_totp) { cw.hidden = false; c.focus(); } err.textContent = x.message; }
  } }, h('label', {}, 'Benutzer'), u, h('label', {}, setup ? 'Passwort (min. 10 Zeichen)' : 'Passwort'), p, cw, h('button', { class: 'btn pri' }, setup ? 'Admin anlegen' : 'Anmelden'), err);
  $app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card login' },
    h('div', { class: 'logo' }, icon('logo'), h('span', {}, 'Mosi', h('b', {}, 'Sail'))), h('p', { class: 'mut', style: 'margin:0 0 8px' }, setup ? 'Ersteinrichtung: lege den Admin-Benutzer an.' : 'Segel-Cockpit · Ammersee'), form)));
}

const VIEWS = [['cockpit', 'Cockpit', cockpitView], ['map', 'Karte', mapView], ['log', 'Logbuch', logbookView], ['season', 'Saison', seasonView]];
const main = h('main');
let nav;

function shell() {
  nav = h('nav', { class: 'tabs', 'aria-label': 'Bereiche' }, VIEWS.map(([k, l]) => h('button', { class: 'tab', 'data-v': k, onclick: () => { S.view = k; render(); } }, icon(k), h('span', {}, l))));
  const top = h('header', { class: 'top' }, h('div', { class: 'brand' }, icon('logo'), h('span', {}, 'Mosi', h('b', {}, 'Sail'))), nav,
    h('button', { class: 'userbtn', onclick: () => { S.view = 'account'; render(); } }, '👤 ' + S.user));
  $app.replaceChildren(top, main);
  render();
}

async function render() {
  clearTimers(); ctx.cleanup && ctx.cleanup(); ctx.cleanup = null;
  nav.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  main.replaceChildren(); main.style.padding = '';
  const v = VIEWS.find(x => x[0] === S.view);
  if (v) await v[2](main, ctx); else accountView(main);
}
boot();
