'use strict';

function accountView(root) {
  const msg = h('div', { class: 'err', role: 'status' });
  const say = (t, ok) => { msg.textContent = t; msg.className = 'err' + (ok ? ' okmsg' : ''); };
  const panel = (t, ...kids) => h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', {}, t)), h('div', { class: 'pb' }, ...kids));
  const old = h('input', { type: 'password', autocomplete: 'current-password', id: 'po' }), nw = h('input', { type: 'password', autocomplete: 'new-password', id: 'pn' });
  const pw = panel('Passwort ändern', h('label', { class: 'f', for: 'po' }, 'Aktuelles Passwort'), old, h('label', { class: 'f', for: 'pn' }, 'Neues Passwort (mindestens 10 Zeichen)'), nw,
    h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn pri', onclick: async () => {
      try { await api('/api/password', 'POST', { old: old.value, new: nw.value }); old.value = nw.value = ''; say('Passwort geändert. Andere Sitzungen wurden abgemeldet.', 1); } catch (e) { say(e.message); }
    } }, 'Passwort speichern')));

  const tot = h('section', { class: 'panel' });
  const drawTotp = () => {
    const head = h('div', { class: 'ph' }, h('h2', {}, 'Zwei-Faktor-Anmeldung'));
    if (S.totp) {
      const p = h('input', { type: 'password', placeholder: 'Passwort zur Bestätigung', autocomplete: 'current-password' });
      tot.replaceChildren(head, h('div', { class: 'pb' }, h('p', { class: 'okmsg', style: 'margin-bottom:10px' }, '2FA ist aktiv.'), p, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn danger', onclick: async () => {
        try { await api('/api/totp/disable', 'POST', { password: p.value }); S.totp = false; drawTotp(); } catch (e) { say(e.message); } } }, '2FA deaktivieren'))));
    } else tot.replaceChildren(head, h('div', { class: 'pb' }, h('p', { class: 'mut', style: 'margin-bottom:14px' }, 'Mit einer Authenticator-App (Aegis, 2FAS, Google Authenticator) wird die Anmeldung zusätzlich gesichert.'), h('button', { class: 'btn', onclick: async () => {
      try {
        const r = await api('/api/totp/start', 'POST'), code = h('input', { inputmode: 'numeric', maxlength: 6, placeholder: '6-stelliger Code' });
        tot.replaceChildren(head, h('div', { class: 'pb' }, h('p', { class: 'mut' }, 'Trage diesen Schlüssel in der App ein (zeitbasiert, SHA-1, 6 Stellen):'), h('code', { class: 'sec' }, r.secret), h('p', { class: 'mut small' }, 'Oder als otpauth-Adresse:'), h('code', { class: 'sec' }, r.uri), h('label', { class: 'f' }, 'Code aus der App'), code,
          h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn pri', onclick: async () => { try { await api('/api/totp/enable', 'POST', { code: code.value }); S.totp = true; drawTotp(); say('2FA aktiviert.', 1); } catch (e) { say(e.message); } } }, 'Bestätigen und aktivieren'))));
      } catch (e) { say(e.message); }
    } }, '2FA einrichten')));
  };
  drawTotp();

  const users = h('section', { class: 'panel' });
  const drawUsers = async () => {
    const list = await api('/api/users').catch(() => []);
    const nu = h('input', { placeholder: 'Benutzername', autocomplete: 'off' }), np = h('input', { type: 'password', placeholder: 'Passwort (mindestens 10 Zeichen)', autocomplete: 'new-password' });
    users.replaceChildren(h('div', { class: 'ph' }, h('h2', {}, 'Benutzer')), h('div', { class: 'pb' },
      ...list.map(u => h('div', { class: 'urow' }, h('span', {}, u.name, u.totp ? ' (2FA aktiv)' : ''), u.name === S.user ? h('span', { class: 'mut small' }, 'du') : h('button', { class: 'btn sm danger', onclick: async () => {
        if (!await confirmDialog(`Benutzer ${u.name} löschen?`, 'Der Zugang wird sofort gesperrt.', 'Löschen', true)) return; try { await api('/api/users/' + encodeURIComponent(u.name), 'DELETE'); drawUsers(); } catch (e) { say(e.message); } } }, 'Löschen'))),
      h('label', { class: 'f' }, 'Neuer Benutzer'), nu, np, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: async () => { try { await api('/api/users', 'POST', { user: nu.value, password: np.value }); drawUsers(); } catch (e) { say(e.message); } } }, 'Benutzer anlegen'))));
  };
  drawUsers();

  const log = h('pre', { class: 'log' }, 'lädt …');
  api('/api/audit').then(l => { log.textContent = (l || []).reverse().join('\n') || '(leer)'; }).catch(() => {});
  root.append(msg, h('div', { class: 'cols2', style: 'margin-top:0;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))' },
    h('div', { style: 'display:grid;gap:24px;align-content:start' }, pw, tot), h('div', { style: 'display:grid;gap:24px;align-content:start' }, users, panel('Protokoll', log))),
    h('div', { style: 'margin-top:24px' }, h('button', { class: 'btn', onclick: async () => { await api('/api/logout', 'POST').catch(() => {}); boot(); } }, 'Abmelden')));
}
