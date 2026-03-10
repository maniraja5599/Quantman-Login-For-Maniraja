const API = '/api';

function el(id) {
  return document.getElementById(id);
}

function formatDateTime(value) {
  if (!value) return '-';
  var d = new Date(value);
  var pad = function(n) { return n < 10 ? '0' + n : String(n); };
  var dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
  var h = d.getHours(), ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return dd + '-' + mm + '-' + yyyy + ', ' + pad(h) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ampm;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed ${res.status}`);
  if (text.trimStart().startsWith('<')) {
    throw new Error('Server returned HTML instead of JSON. Open the app via http://localhost:3333 (run: npm start).');
  }
  return JSON.parse(text);
}

function renderMetric(idPrefix, result, emptyText) {
  const stateEl = el(`${idPrefix}-state`);
  const metaEl = el(`${idPrefix}-meta`);

  if (!result) {
    if (stateEl) stateEl.textContent = emptyText;
    if (metaEl) metaEl.textContent = '-';
    return;
  }

  if (result.configured === false) {
    if (stateEl) stateEl.textContent = 'Not configured';
    if (metaEl) metaEl.textContent = result.message || emptyText;
    return;
  }

  if (stateEl) stateEl.textContent = result.success ? 'Success' : (result.error ? 'Failed' : emptyText);
  if (metaEl) metaEl.textContent = `${formatDateTime(result.lastRun)}${result.step ? ` | ${result.step}` : ''}${result.error ? ` | ${result.error}` : ''}`;
}

function renderAutomation(automation) {
  if (!automation) return;
  const stateEl = el('status-automation-state');
  const nextEl = el('status-automation-next');
  const currentEl = el('status-current-run');
  const summaryEl = el('status-last-summary');

  if (stateEl) {
    stateEl.textContent = automation.isRunning
      ? 'Running now'
      : automation.state === 'running'
        ? 'Daily active'
        : automation.state === 'paused'
          ? 'Paused'
          : 'Stopped';
  }

  if (nextEl) {
    nextEl.textContent = automation.nextRunAt
      ? `Next: ${formatDateTime(automation.nextRunAt)}`
      : 'No next run scheduled';
  }

  if (currentEl) {
    currentEl.textContent = automation.currentRunSource || 'Idle';
  }

  if (summaryEl) {
    if (automation.lastSummary?.completedAt) {
      summaryEl.textContent = `${automation.lastSummary.success ? 'Last run success' : 'Last run failed'} | ${formatDateTime(automation.lastSummary.completedAt)}`;
    } else {
      summaryEl.textContent = 'No automation summary yet';
    }
  }
}

var typeIcons = {
  success: '<span class="log-icon log-icon--success">&#10003;</span>',
  error: '<span class="log-icon log-icon--error">&#10007;</span>',
  warn: '<span class="log-icon log-icon--warn">!</span>',
  info: '<span class="log-icon log-icon--info">i</span>',
};

function renderLog(entries) {
  var wrap = el('activity-log');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (!entries || !entries.length) {
    wrap.innerHTML = '<div class="activity-log__empty">No activity yet.</div>';
    return;
  }

  entries.forEach(function (e) {
    var row = document.createElement('div');
    row.className = 'log-entry log-entry--' + (e.type || 'info');
    var icon = typeIcons[e.type] || typeIcons.info;
    row.innerHTML =
      '<div class="log-entry__left">' +
        icon +
        '<div class="log-entry__body">' +
          '<span class="log-entry__title"></span>' +
          '<span class="log-entry__msg"></span>' +
        '</div>' +
      '</div>' +
      '<span class="log-entry__time"></span>';
    row.querySelector('.log-entry__title').textContent = e.title || 'Event';
    row.querySelector('.log-entry__msg').textContent = e.message || '';
    row.querySelector('.log-entry__time').textContent = formatDateTime(e.ts);
    wrap.appendChild(row);
  });
}

async function refresh() {
  try {
    var data = await fetchJson(`${API}/status`);
    renderMetric('status-flattrade', data.flattrade, 'No run yet');
    renderMetric('status-kotak', data.kotakNeo, 'No run yet');
    renderAutomation(data.automation);
  } catch (_) {}

  try {
    var log = await fetchJson(`${API}/activity-log`);
    renderLog(log);
  } catch (_) {}
}

refresh();
setInterval(function () { refresh(); }, 5000);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) refresh();
});
