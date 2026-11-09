'use strict';

function accountView(root) {
  const msg = h('div', { class: 'err' });
  const say = (t, ok) => { msg.textContent = t; msg.className = 'err' + (ok ? ' okmsg' : ''); };
  const old = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' });
  const pw = h('div', { class: 'card' }, h('h3', {}, 'Passwort ändern'), h('label', {}, 'Aktuelles Passwort'), old, h('label', {}, 'Neues Passwort (min. 10 Zeichen)'), nw,
    h('div', { class: 'btns', style: 'display:flex;margin-top:14px' }, h('button', { class: 'btn pri', onclick: async () => {
      try { await api('/api/password', 'POST', { old: old.value, new: nw.value }); old.value = nw.value = ''; say('Passwort geändert. Andere Sitzungen wurden abgemeldet.', 1); } catch (e) { say(e.message); }
    } }, 'Speichern')));

  const tot = h('div', { class: 'card' });
  const drawTotp = () => {
    tot.replaceChildren(h('h3', {}, 'Zwei-Faktor (TOTP)'));
    if (S.totp) {
      const p = h('input', { type: 'password', placeholder: 'Passwort zur Bestätigung' });
      tot.append(h('p', { class: 'okmsg' }, '2FA ist aktiv.'), p, h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn danger', onclick: async () => {
        try { await api('/api/totp/disable', 'POST', { password: p.value }); S.totp = false; drawTotp(); } catch (e) { say(e.message); }
      } }, '2FA deaktivieren')));
    } else tot.append(h('p', { class: 'mut small' }, 'Authenticator-App (Aegis, 2FAS, Google Authenticator …).'), h('button', { class: 'btn', onclick: async () => {
      try {
        const r = await api('/api/totp/start', 'POST'), code = h('input', { inputmode: 'numeric', maxlength: 6, placeholder: '6-stelliger Code' });
        tot.replaceChildren(h('h3', {}, 'Zwei-Faktor (TOTP)'), h('p', { class: 'mut small' }, 'Schlüssel manuell in der App eintragen (zeitbasiert, SHA-1, 6 Stellen):'), h('code', { class: 'sec' }, r.secret), h('p', { class: 'mut small' }, 'Oder otpauth-URI:'), h('code', { class: 'sec' }, r.uri), code,
          h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn pri', onclick: async () => { try { await api('/api/totp/enable', 'POST', { code: code.value }); S.totp = true; drawTotp(); say('2FA aktiviert.', 1); } catch (e) { say(e.message); } } }, 'Bestätigen und aktivieren')));
      } catch (e) { say(e.message); }
    } }, '2FA einrichten'));
  };
  drawTotp();

  const users = h('div', { class: 'card' });
  const drawUsers = async () => {
    const list = await api('/api/users').catch(() => []);
    const nu = h('input', { placeholder: 'Benutzername', autocomplete: 'off' }), np = h('input', { type: 'password', placeholder: 'Passwort (min. 10 Zeichen)', autocomplete: 'new-password' });
    users.replaceChildren(h('h3', {}, 'Benutzer'),
      ...list.map(u => h('div', { class: 'urow' }, h('span', {}, u.name, u.totp ? ' · 2FA' : ''), u.name === S.user ? h('span', { class: 'mut small' }, 'du') : h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm(`Benutzer ${u.name} löschen?`)) return; try { await api('/api/users/' + encodeURIComponent(u.name), 'DELETE'); drawUsers(); } catch (e) { say(e.message); } } }, 'Löschen'))),
      h('label', {}, 'Neuer Benutzer'), nu, np, h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: async () => { try { await api('/api/users', 'POST', { user: nu.value, password: np.value }); drawUsers(); } catch (e) { say(e.message); } } }, 'Anlegen')));
  };
  drawUsers();

  const log = h('pre', { class: 'log' }, 'lädt …');
  api('/api/audit').then(l => { log.textContent = (l || []).reverse().join('\n') || '(leer)'; }).catch(() => {});
  root.append(h('div', { class: 'head' }, h('h2', {}, 'Konto')),
    h('div', { class: 'grid g2' }, h('div', { class: 'grid' }, msg, pw, tot), h('div', { class: 'grid' }, users, h('div', { class: 'card' }, h('h3', {}, 'Audit-Log'), log))),
    h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn danger', onclick: async () => { await api('/api/logout', 'POST').catch(() => {}); boot(); } }, 'Abmelden')));
}
