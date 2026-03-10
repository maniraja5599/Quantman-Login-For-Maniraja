const API = '/api';
const LOGIN_TIMEOUT_MS = 150000;

function el(id) {
  return document.getElementById(id);
}

function fmtDate(v) {
  if (!v) return '-';
  var d = new Date(v);
  var pad = function(n) { return n < 10 ? '0' + n : String(n); };
  var dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
  var h = d.getHours(), ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return dd + '-' + mm + '-' + yyyy + ', ' + pad(h) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ampm;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed ${res.status}`);
  if (text.trimStart().startsWith('<')) throw new Error('Server returned HTML. Run: npm start and open http://localhost:3333');
  return JSON.parse(text);
}

function setBadge(broker, status) {
  const b = el(`${broker}-badge`);
  if (!b) return;
  b.className = 'badge';
  if (status === 'success') { b.textContent = 'Success'; b.classList.add('badge--success'); }
  else if (status === 'error') { b.textContent = 'Failed'; b.classList.add('badge--error'); }
  else if (status === 'running') { b.textContent = 'Running'; b.classList.add('badge--running'); }
  else { b.textContent = '-'; }
}

function setMeta(broker, text) {
  const m = el(`${broker}-meta`);
  if (m) m.textContent = text;
}

function setLog(broker, text) {
  const l = el(`${broker}-log`);
  if (l) l.textContent = text;
}

function setEditVisible(broker, show) {
  const link = el(broker === 'flattrade' ? 'flattrade-config-edit' : 'kotak-config-edit');
  if (link) link.style.display = show ? '' : 'none';
}

function renderCreds(broker, data) {
  const v = el(broker === 'flattrade' ? 'flattrade-config-values' : 'kotak-config-values');
  if (!v) return;
  setEditVisible(broker, !data.configured);
  if (!data.configured) { v.textContent = 'Not configured. Go to Settings.'; return; }
  const parts = broker === 'flattrade'
    ? [data.clientId && `Client ${data.clientId}`, data.userId && `User ${data.userId}`, data.password && 'Pass ******', data.totp && `OTP ${data.totp}`].filter(Boolean)
    : [data.clientId && `Client ${data.clientId}`, data.userId && `Mobile ${data.userId}`, data.totp && 'TOTP ******', data.mpin && 'MPIN ******'].filter(Boolean);
  v.textContent = parts.join(' | ');
}

function renderAutoMini(a) {
  if (!a) return;
  const s = el('automation-mini-state');
  const n = el('automation-mini-next');
  if (s) s.textContent = a.isRunning ? 'Running' : a.state === 'running' ? 'Active' : a.state === 'paused' ? 'Paused' : 'Stopped';
  if (n) n.textContent = a.nextRunAt ? fmtDate(a.nextRunAt) : '-';

  const warn = el('automation-warning');
  const warnText = el('automation-warning-text');
  if (warn && warnText) {
    if (a.state === 'stopped') {
      warn.style.display = '';
      warn.className = 'alert-banner alert-banner--error';
      warnText.textContent = 'Automation is stopped. Brokers will not login automatically.';
    } else if (a.state === 'paused') {
      warn.style.display = '';
      warn.className = 'alert-banner alert-banner--warn';
      warnText.textContent = a.pauseUntil
        ? 'Automation is paused until ' + fmtDate(a.pauseUntil) + '. No automatic logins until then.'
        : 'Automation is paused. No automatic logins until resumed.';
    } else {
      warn.style.display = 'none';
    }
  }
}

function renderStatus(data) {
  const ft = data.flattrade;
  if (ft) {
    setBadge('flattrade', ft.success ? 'success' : (ft.error ? 'error' : null));
    setMeta('flattrade', `${fmtDate(ft.lastRun)}${ft.step ? ` | ${ft.step}` : ''}${ft.error ? ` | ${ft.error}` : ''}`);
  } else { setBadge('flattrade', null); setMeta('flattrade', 'No run yet.'); }

  const kn = data.kotakNeo;
  if (kn) {
    if (kn.configured === false) { setBadge('kotak', null); setMeta('kotak', kn.message || 'Not configured.'); }
    else { setBadge('kotak', kn.success ? 'success' : (kn.error ? 'error' : null)); setMeta('kotak', `${fmtDate(kn.lastRun)}${kn.step ? ` | ${kn.step}` : ''}${kn.error ? ` | ${kn.error}` : ''}`); }
  } else { setBadge('kotak', null); setMeta('kotak', 'No run yet.'); }

  renderAutoMini(data.automation);
}

async function runBroker(broker, headed) {
  const key = broker === 'flattrade' ? 'flattrade' : 'kotak';
  const btn = el(broker === 'flattrade' ? 'flattrade-login' : 'kotak-login');
  const btn2 = el(broker === 'flattrade' ? 'flattrade-login-headed' : 'kotak-login-headed');
  setBadge(key, 'running');
  setMeta(key, 'Running... up to 2 minutes.');
  setLog(key, 'Triggering login...');
  if (window.FiFTO && typeof window.FiFTO.notify === 'function') {
    window.FiFTO.notify('info', 'Login started', (broker === 'flattrade' ? 'Flattrade' : 'Kotak Neo') + (headed ? ' (visible)' : ''), { silent: true });
  }
  [btn, btn2].forEach(b => { if (b) b.disabled = true; });

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), LOGIN_TIMEOUT_MS);

  try {
    const r = await fetchJson(`${API}/${broker}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headed }), signal: ac.signal,
    });
    clearTimeout(tid);
    setBadge(key, r.success ? 'success' : 'error');
    setMeta(key, r.success ? `Success | ${fmtDate(r.lastRun)}` : `${fmtDate(r.lastRun)} | ${r.step || 'error'}${r.error ? ` | ${r.error}` : ''}`);
    setLog(key, r.success ? 'Login completed.' : `Failed: ${r.error || r.step || 'Unknown'}`);
    if (window.FiFTO && typeof window.FiFTO.notify === 'function') {
      window.FiFTO.notify(r.success ? 'success' : 'error', (broker === 'flattrade' ? 'Flattrade' : 'Kotak Neo') + ' login', r.success ? 'Success' : ('Failed: ' + (r.error || r.step || 'error')), { system: true });
    }
    await refresh();
  } catch (err) {
    clearTimeout(tid);
    const msg = err.name === 'AbortError' ? 'Timed out. Try visible mode.' : (err.message || 'Request failed.');
    setBadge(key, 'error'); setMeta(key, msg); setLog(key, msg);
    if (window.FiFTO && typeof window.FiFTO.notify === 'function') {
      window.FiFTO.notify('error', (broker === 'flattrade' ? 'Flattrade' : 'Kotak Neo') + ' login', msg, { system: true });
    }
  } finally {
    [btn, btn2].forEach(b => { if (b) b.disabled = false; });
  }
}

async function refresh() {
  const [status, ft, kn] = await Promise.all([
    fetchJson(`${API}/status`),
    fetchJson(`${API}/credentials/flattrade`).catch(() => ({})),
    fetchJson(`${API}/credentials/kotakneo`).catch(() => ({})),
  ]);
  renderStatus(status);
  renderCreds('flattrade', ft);
  renderCreds('kotak', kn);
}

async function init() {
  try { await refresh(); } catch (err) { setMeta('flattrade', err.message); setMeta('kotak', err.message); }
  el('flattrade-login')?.addEventListener('click', () => runBroker('flattrade', false));
  el('flattrade-login-headed')?.addEventListener('click', () => runBroker('flattrade', true));
  el('kotak-login')?.addEventListener('click', () => runBroker('kotakneo', false));
  el('kotak-login-headed')?.addEventListener('click', () => runBroker('kotakneo', true));

  el('automation-warning-start')?.addEventListener('click', async () => {
    try {
      await fetchJson(`${API}/automation/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await refresh();
    } catch (_) {}
  });
}

init();
