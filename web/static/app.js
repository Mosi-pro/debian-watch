'use strict';
const $app = document.getElementById('app');
let S = {};            // server state (user, csrf, ...)
let es = null;         // EventSource for metrics
let sessionTerms = []; // open terminal tabs
const enc = new TextEncoder();

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

async function api(path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (method !== 'GET') opt.headers['X-CSRF-Token'] = S.csrf || '';
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.user) { S = {}; boot(); }
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.data = j; throw e; }
  return j;
}

const fmtB = n => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(n < 10 && i ? 1 : 0) + ' ' + u[i]; };
const fmtUp = s => { const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + hh + 'h ' + m + 'm'; };

async function boot() {
  if (es) { es.close(); es = null; }
  try { S = await (await fetch('/api/state')).json(); } catch { S = {}; }
  if (S.user) return shell();
  loginView();
}

function loginView() {
  const setup = S.setup_needed;
  let needTotp = false;
  const err = h('div', { class: 'err', role: 'alert' });
  const u = h('input', { autocomplete: 'username', required: true, autofocus: true });
  const p = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true });
  const c = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '123456' });
  const cWrap = h('div', { hidden: true }, h('label', {}, '2FA-Code'), c);
  const form = h('form', { onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try {
      await api(setup ? '/api/setup' : '/api/login', 'POST', { user: u.value, password: p.value, code: c.value });
      boot();
    } catch (x) {
      if (x.data && x.data.need_totp) { cWrap.hidden = false; c.focus(); }
      err.textContent = x.message;
    }
  } },
    h('label', {}, 'Benutzer'), u, h('label', {}, setup ? 'Passwort (min. 10 Zeichen)' : 'Passwort'), p, cWrap,
    h('button', { class: 'primary' }, setup ? 'Admin anlegen' : 'Anmelden'), err);
  $app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card login' },
    h('h1', {}, 'Mosi', h('span', { style: 'color:var(--acc)' }, 'Deck')),
    h('p', {}, setup ? 'Ersteinrichtung: lege den Admin-Benutzer an.' : 'Homelab-Cockpit'), form)));
}

// ---------- shell ----------
let view = 'dash';
function shell() {
  const nav = h('nav');
  const main = h('main');
  const tabs = [['dash', 'Dashboard'], ['term', 'Terminal'], ['set', 'Einstellungen']];
  const go = v => { view = v; nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); render(); };
  tabs.forEach(([k, l]) => nav.append(h('button', { 'data-v': k, onclick: () => go(k) }, l)));
  const hdr = h('header', {}, h('div', { class: 'brand' }, 'Mosi', h('span', {}, 'Deck')), nav,
    h('span', { class: 'who' }, S.user),
    h('button', { onclick: async () => { await api('/api/logout', 'POST').catch(() => {}); sessionTerms = []; boot(); } }, 'Abmelden'));
  $app.replaceChildren(hdr, main);
  function render() {
    // keep terminal DOM alive across tab switches
    if (view !== 'term') { termHost.remove(); }
    if (es && view !== 'dash') { es.close(); es = null; }
    main.replaceChildren();
    if (view === 'dash') dashboard(main);
    else if (view === 'term') terminal(main);
    else settings(main);
  }
  go(view);
}

// ---------- dashboard ----------
function dashboard(root) {
  const tiles = {};
  const hist = { cpu: [], mem: [], rx: [], tx: [], temp: [] };
  const mk = (id, title, spark = true) => {
    const t = { big: h('div', { class: 'big' }, '–'), sub: h('div', { class: 'sub' }), bar: h('div', { class: 'bar' }, h('i')), cv: h('canvas') };
    tiles[id] = t;
    return h('div', { class: 'tile' }, h('h3', {}, title), t.big, t.sub, spark ? t.cv : t.bar);
  };
  const procs = h('tbody');
  const info = h('div', { class: 'sub' });
  root.append(h('div', { class: 'sub', style: 'margin-bottom:8px' }, h('span', { class: 'dot', id: 'live' }), info),
    h('div', { class: 'grid' },
      mk('cpu', 'CPU'), mk('mem', 'RAM'), mk('disk', 'Festplatte /', false), mk('net', 'Netzwerk'), mk('temp', 'Temperatur'), mk('up', 'Uptime / Load', false),
      h('div', { class: 'tile wide' }, h('h3', {}, 'Top-Prozesse'),
        h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'PID'), h('th', {}, 'Name'), h('th', { class: 'n' }, 'CPU %'), h('th', { class: 'n' }, 'RAM %'))), procs))));
  api('/api/info').then(i => info.textContent = `${i.info.hostname} · ${i.info.os} · ${i.info.cores} Kerne · ${i.info.cpu_model} · MosiDeck ${i.version}`).catch(() => {});

  const push = (k, v) => { hist[k].push(v); if (hist[k].length > 900) hist[k].shift(); };
  const spark = (cv, data, color, max) => {
    const dpr = devicePixelRatio || 1, w = cv.clientWidth, hgt = cv.clientHeight;
    cv.width = w * dpr; cv.height = hgt * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, hgt);
    if (data.length < 2) return;
    const m = max || Math.max(1, ...data) * 1.1;
    g.beginPath();
    data.forEach((v, i) => { const x = i / (data.length - 1) * w, y = hgt - Math.min(v / m, 1) * (hgt - 2) - 1; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = color; g.lineWidth = 1.6; g.stroke();
    g.lineTo(w, hgt); g.lineTo(0, hgt); g.closePath(); g.globalAlpha = .12; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
  };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const draw = s => {
    const pct = (a, b) => b ? a / b * 100 : 0;
    const t = tiles;
    t.cpu.big.textContent = s.cpu.toFixed(0) + ' %'; t.cpu.sub.textContent = `Load ${s.load1.toFixed(2)} / ${s.load5.toFixed(2)} / ${s.load15.toFixed(2)}`;
    const mp = pct(s.mem_used, s.mem_total);
    t.mem.big.textContent = mp.toFixed(0) + ' %'; t.mem.sub.textContent = `${fmtB(s.mem_used)} von ${fmtB(s.mem_total)}` + (s.swap_total ? ` · Swap ${fmtB(s.swap_used)}` : '');
    const dp = pct(s.disk_used, s.disk_total);
    t.disk.big.textContent = dp.toFixed(0) + ' %'; t.disk.sub.textContent = `${fmtB(s.disk_used)} von ${fmtB(s.disk_total)}`;
    t.disk.bar.firstChild.style.width = dp + '%'; t.disk.bar.firstChild.style.background = dp > 90 ? css('--bad') : dp > 75 ? css('--warn') : css('--acc');
    t.net.big.textContent = '↓ ' + fmtB(s.net_rx) + '/s'; t.net.sub.textContent = '↑ ' + fmtB(s.net_tx) + '/s';
    t.temp.big.textContent = s.temp ? s.temp.toFixed(0) + ' °C' : 'n/v'; t.temp.sub.textContent = s.temp ? '' : 'kein Sensor gefunden';
    t.up.big.textContent = fmtUp(s.uptime); t.up.sub.textContent = 'seit letztem Neustart';
    t.up.bar.style.display = 'none';
    spark(t.cpu.cv, hist.cpu, css('--acc'), 100); spark(t.mem.cv, hist.mem, css('--blue'), 100);
    spark(t.net.cv, hist.rx, css('--acc')); spark(t.temp.cv, hist.temp, css('--warn'), 100);
    if (s.procs) procs.replaceChildren(...s.procs.map(p => h('tr', {}, h('td', {}, p.pid), h('td', {}, p.name), h('td', { class: 'n' }, p.cpu.toFixed(1)), h('td', { class: 'n' }, p.mem.toFixed(1)))));
  };
  const feed = s => { push('cpu', s.cpu); push('mem', s.mem_total ? s.mem_used / s.mem_total * 100 : 0); push('rx', s.net_rx); push('tx', s.net_tx); push('temp', s.temp); };
  api('/api/metrics/history').then(hs => { hs.forEach(feed); if (hs.length) draw(hs[hs.length - 1]); }).catch(() => {}).finally(() => {
    es = new EventSource('/api/metrics/stream');
    es.onopen = () => document.getElementById('live')?.classList.add('live');
    es.onerror = () => document.getElementById('live')?.classList.remove('live');
    es.onmessage = e => { const s = JSON.parse(e.data); feed(s); draw(s); };
  });
}

// ---------- terminal ----------
const termHost = h('div', { id: 'terms' });
const tabBar = h('div', { class: 'tabs' });
let activeTerm = null, termCount = 0;

function terminal(root) {
  root.append(tabBar, termHost);
  if (!sessionTerms.length) newTerm(); else { renderTabs(); activeTerm?.fit(); activeTerm?.term.focus(); }
}
function renderTabs() {
  tabBar.replaceChildren(...sessionTerms.map(t => h('div', { class: 't' + (t === activeTerm ? ' on' : ''), onclick: () => select(t) },
    t.title, h('b', { title: 'Schließen', onclick: e => { e.stopPropagation(); closeTerm(t); } }, '×'))),
    h('button', { onclick: newTerm }, '+ Neu'));
}
function select(t) {
  activeTerm = t; sessionTerms.forEach(x => x.el.classList.toggle('on', x === t)); renderTabs(); t.fit(); t.term.focus();
}
function closeTerm(t) {
  t.ws.close(); t.term.dispose(); t.el.remove(); sessionTerms = sessionTerms.filter(x => x !== t);
  if (!sessionTerms.length) newTerm(); else select(sessionTerms[sessionTerms.length - 1]);
}
function newTerm() {
  const el = h('div', { class: 'term' }); termHost.append(el);
  const term = new Terminal({ cursorBlink: true, fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 14, scrollback: 5000 });
  const fitA = new FitAddon.FitAddon(); term.loadAddon(fitA); term.open(el);
  const t = { el, term, title: 'Shell ' + (++termCount), ws: null, fit: () => { try { fitA.fit(); } catch {} } };
  sessionTerms.push(t); select(t);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/term?cols=${term.cols}&rows=${term.rows}`);
  ws.binaryType = 'arraybuffer'; t.ws = ws;
  ws.onmessage = e => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
  ws.onclose = () => term.write('\r\n\x1b[33m[Verbindung beendet — Tab schließen oder neu öffnen]\x1b[0m\r\n');
  term.onData(d => ws.readyState === 1 && ws.send(enc.encode(d)));
  term.onResize(({ cols, rows }) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'resize', cols, rows })));
  new ResizeObserver(() => { if (el.classList.contains('on')) t.fit(); }).observe(el);
  addEventListener('resize', () => t.fit());
}

// ---------- settings ----------
function settings(root) {
  const msg = h('div', { class: 'err' });
  const say = (t, ok) => { msg.textContent = t; msg.className = 'err' + (ok ? ' ok' : ''); };
  const old = h('input', { type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password' });
  const pw = h('div', { class: 'card' }, h('h2', {}, 'Passwort ändern'),
    h('label', {}, 'Aktuelles Passwort'), old, h('label', {}, 'Neues Passwort (min. 10 Zeichen)'), nw,
    h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: async () => {
      try { await api('/api/password', 'POST', { old: old.value, new: nw.value }); old.value = nw.value = ''; say('Passwort geändert. Andere Sitzungen wurden abgemeldet.', 1); } catch (e) { say(e.message); }
    } }, 'Speichern')));

  const tot = h('div', { class: 'card' });
  const drawTotp = () => {
    tot.replaceChildren(h('h2', {}, 'Zwei-Faktor (TOTP)'));
    if (S.totp_enabled) {
      const p = h('input', { type: 'password', placeholder: 'Passwort zur Bestätigung' });
      tot.append(h('p', { class: 'ok' }, '2FA ist aktiv.'), p, h('div', { class: 'btnrow' }, h('button', { class: 'danger', onclick: async () => {
        try { await api('/api/totp/disable', 'POST', { password: p.value }); S.totp_enabled = false; drawTotp(); } catch (e) { say(e.message); }
      } }, '2FA deaktivieren')));
    } else {
      tot.append(h('p', { class: 'sub' }, 'Authenticator-App (Aegis, 2FAS, Google Authenticator …) verwenden.'),
        h('div', { class: 'btnrow' }, h('button', { onclick: async () => {
          try {
            const r = await api('/api/totp/start', 'POST');
            const code = h('input', { inputmode: 'numeric', maxlength: 6, placeholder: '6-stelliger Code' });
            tot.replaceChildren(h('h2', {}, 'Zwei-Faktor (TOTP)'), h('p', { class: 'sub' }, 'Schlüssel manuell in der App eintragen (Zeitbasiert, SHA-1, 6 Stellen):'),
              h('code', { class: 'sec' }, r.secret), h('p', { class: 'sub' }, 'Oder otpauth-URI:'), h('code', { class: 'sec' }, r.uri), code,
              h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: async () => {
                try { await api('/api/totp/enable', 'POST', { code: code.value }); S.totp_enabled = true; drawTotp(); say('2FA aktiviert.', 1); } catch (e) { say(e.message); }
              } }, 'Bestätigen und aktivieren')));
          } catch (e) { say(e.message); }
        } }, '2FA einrichten')));
    }
  };
  drawTotp();

  const users = h('div', { class: 'card' });
  const drawUsers = async () => {
    const list = await api('/api/users').catch(() => []);
    const nu = h('input', { placeholder: 'Benutzername', autocomplete: 'off' }), np = h('input', { type: 'password', placeholder: 'Passwort (min. 10 Zeichen)', autocomplete: 'new-password' });
    users.replaceChildren(h('h2', {}, 'Benutzer'),
      ...list.map(u => h('div', { class: 'row' }, h('span', {}, u.name, u.totp ? ' · 2FA' : ''),
        u.name === S.user ? h('span', { class: 'sub' }, 'du') : h('button', { class: 'danger', onclick: async () => {
          if (!confirm(`Benutzer ${u.name} löschen?`)) return;
          try { await api('/api/users/' + encodeURIComponent(u.name), 'DELETE'); drawUsers(); } catch (e) { say(e.message); }
        } }, 'Löschen'))),
      h('label', {}, 'Neuer Benutzer'), nu, np,
      h('div', { class: 'btnrow' }, h('button', { onclick: async () => {
        try { await api('/api/users', 'POST', { user: nu.value, password: np.value }); drawUsers(); } catch (e) { say(e.message); }
      } }, 'Anlegen')));
  };
  drawUsers();

  const log = h('pre', { class: 'log' }, 'lädt …');
  api('/api/audit').then(l => { log.textContent = (l || []).reverse().join('\n') || '(leer)'; }).catch(() => {});
  root.append(h('div', { class: 'stack' }, msg, pw, tot, users, h('div', { class: 'card' }, h('h2', {}, 'Audit-Log (letzte 200)'), log),
    h('div', { class: 'sub' }, 'Update: auf dem Server „sudo mosideck update && sudo systemctl restart mosideck“.')));
}

boot();
