const API = '/api';

function el(id) { return document.getElementById(id); }
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
  if (text.trimStart().startsWith('<')) throw new Error('Server returned HTML. Run: npm start');
  return JSON.parse(text);
}

function setMsg(id, msg, isErr) {
  const n = el(id);
  if (!n) return;
  n.textContent = msg || '';
  n.className = isErr ? 'action-msg action-msg--error' : 'action-msg';
  if (id === 'automation-settings-msg') n.className = isErr ? 'form-msg form-msg--error' : 'form-msg';
}

function render(d) {
  if (!d) return;
  const s = el('automation-state');
  if (s) s.textContent = d.isRunning ? 'Running now' : d.state === 'running' ? 'Active' : d.state === 'paused' ? 'Paused' : 'Stopped';

  const m = el('automation-message');
  if (m) {
    const times = d.runAt2 ? `${d.runAt}, ${d.runAt2}` : d.runAt;
    m.textContent = d.enabled
      ? `${times} | ${d.brokers.flattrade ? 'Flattrade ' : ''}${d.brokers.kotakNeo ? 'Kotak Neo' : ''}`.trim()
      : 'Disabled';
  }

  if (el('automation-next-run')) el('automation-next-run').textContent = d.nextRunAt ? fmtDate(d.nextRunAt) : '-';
  if (el('automation-pause-until')) el('automation-pause-until').textContent = d.pauseUntil ? fmtDate(d.pauseUntil) : '-';
  if (el('automation-current-run')) el('automation-current-run').textContent = d.currentRunSource || 'Idle';
  if (el('automation-last-summary')) el('automation-last-summary').textContent = d.lastSummary?.completedAt
    ? `${d.lastSummary.success ? 'Success' : 'Failed'} | ${fmtDate(d.lastSummary.completedAt)}` : '-';

  const formEl = el('automation-settings-form');
  const formHasFocus = formEl && formEl.contains(document.activeElement);
  if (!formHasFocus) {
    if (el('automation-runAt')) el('automation-runAt').value = d.runAt || '09:15';
    if (el('automation-runAt2')) el('automation-runAt2').value = d.runAt2 || '';
    if (el('automation-broker-flattrade')) el('automation-broker-flattrade').checked = !!d.brokers?.flattrade;
    if (el('automation-broker-kotak')) el('automation-broker-kotak').checked = !!d.brokers?.kotakNeo;
  }

  const warn = el('automation-warning');
  const warnText = el('automation-warning-text');
  if (warn && warnText) {
    if (d.state === 'stopped') {
      warn.style.display = '';
      warn.className = 'alert-banner alert-banner--error';
      warnText.textContent = 'Automation is stopped. Click "Start / Resume" to enable daily logins.';
    } else if (d.state === 'paused') {
      warn.style.display = '';
      warn.className = 'alert-banner alert-banner--warn';
      warnText.textContent = d.pauseUntil
        ? 'Automation is paused until ' + fmtDate(d.pauseUntil) + '.'
        : 'Automation is paused.';
    } else {
      warn.style.display = 'none';
    }
  }
}

async function refresh() { render(await fetchJson(`${API}/automation`)); }

async function post(path, body = {}, msgId = 'automation-action-msg') {
  try {
    const r = await fetchJson(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setMsg(msgId, r.message || 'Done.', false);
    if (window.FiFTO && typeof window.FiFTO.notify === 'function') {
      window.FiFTO.notify('info', 'Automation', r.message || 'Done.');
    }
    await refresh();
  } catch (err) { setMsg(msgId, err.message, true); }
}

function init() {
  const form = el('automation-settings-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const runAt2Val = el('automation-runAt2')?.value?.trim();
      const r = await fetchJson(`${API}/automation`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runAt: el('automation-runAt')?.value || '09:15',
          runAt2: runAt2Val || null,
          brokers: { flattrade: !!el('automation-broker-flattrade')?.checked, kotakNeo: !!el('automation-broker-kotak')?.checked },
        }),
      });
      setMsg('automation-settings-msg', r.message || 'Saved.', false);
      if (window.FiFTO && typeof window.FiFTO.notify === 'function') {
        window.FiFTO.notify('success', 'Schedule saved', 'Daily run time and brokers updated.');
      }
      await refresh();
    } catch (err) { setMsg('automation-settings-msg', err.message, true); }
  });

  [['automation-start', '/automation/start', {}],
   ['automation-stop', '/automation/stop', {}],
   ['automation-pause-1', '/automation/pause', { days: 1 }],
   ['automation-pause-3', '/automation/pause', { days: 3 }],
   ['automation-run-now', '/automation/run-now', {}],
  ].forEach(([id, path, body]) => {
    el(id)?.addEventListener('click', () => post(path, body));
  });

  el('automation-pause-custom')?.addEventListener('click', () => {
    const days = Math.max(1, Number(el('automation-pause-days')?.value || 1));
    post('/automation/pause', { days });
  });

  // Top quick-run button
  el('automation-run-now-top')?.addEventListener('click', () => post('/automation/run-now', {}));

  // Warning banner start button
  el('automation-warning-start')?.addEventListener('click', () => post('/automation/start', {}));

  // Live auto-refresh so next-run/current-run update automatically
  refresh().catch(err => setMsg('automation-action-msg', err.message, true));
  setInterval(() => refresh().catch(() => {}), 4000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh().catch(() => {});
  });
}

init();
