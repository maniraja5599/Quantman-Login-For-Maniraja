const API = '/api';

function el(id) {
  return document.getElementById(id);
}

function formatDateTime(value) {
  if (!value) return '-';
  var d = new Date(value);
  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
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

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed ${res.status}`);
  if (text.trimStart().startsWith('<')) throw new Error('Server returned HTML instead of JSON.');
  return JSON.parse(text);
}

function classifyBrokerEntry(e) {
  if (!e || !e.title) return null;
  if (e.title.startsWith('Flattrade (')) return 'flattrade';
  if (e.title.startsWith('Kotak Neo (')) return 'kotakNeo';
  return null;
}

function isSuccessType(e) {
  return (e.type || '').toLowerCase() === 'success';
}

function isErrorType(e) {
  return (e.type || '').toLowerCase() === 'error';
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function withinDays(date, days) {
  var now = new Date();
  var diff = now.getTime() - date.getTime();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function computeAnalytics(logEntries) {
  const now = new Date();
  const today = now;
  const limit = 30;
  const recent = (logEntries || []).slice(0, limit);

  let todayTotal = 0, todaySuccess = 0;
  let weekTotal = 0, weekSuccess = 0;

  const brokers = {
    flattrade: { success: 0, error: 0, lastSuccess: null },
    kotakNeo: { success: 0, error: 0, lastSuccess: null },
  };

  (logEntries || []).forEach(function (e) {
    if (!e.ts) return;
    var dt = new Date(e.ts);
    if (sameDay(dt, today)) {
      if (isSuccessType(e) || isErrorType(e)) {
        todayTotal++;
        if (isSuccessType(e)) todaySuccess++;
      }
    }
    if (withinDays(dt, 7)) {
      if (isSuccessType(e) || isErrorType(e)) {
        weekTotal++;
        if (isSuccessType(e)) weekSuccess++;
      }
    }
  });

  recent.forEach(function (e) {
    const key = classifyBrokerEntry(e);
    if (!key || !brokers[key]) return;
    if (isSuccessType(e)) {
      brokers[key].success++;
      if (!brokers[key].lastSuccess) brokers[key].lastSuccess = e.ts;
    } else if (isErrorType(e)) {
      brokers[key].error++;
    }
  });

  return {
    todayTotal,
    todaySuccess,
    weekTotal,
    weekSuccess,
    brokers,
    recent,
  };
}

function pct(success, total) {
  if (!total) return '0%';
  return Math.round((success / total) * 100) + '%';
}

function renderOverview(automation, analytics) {
  const a = analytics;
  if (el('dash-today-total')) {
    el('dash-today-total').textContent = a.todayTotal || 0;
  }
  if (el('dash-today-success')) {
    el('dash-today-success').textContent =
      a.todayTotal ? `${a.todaySuccess}/${a.todayTotal} successful (${pct(a.todaySuccess, a.todayTotal)})` : 'No runs today';
  }
  if (el('dash-7d-total')) {
    el('dash-7d-total').textContent = a.weekTotal || 0;
  }
  if (el('dash-7d-success')) {
    el('dash-7d-success').textContent =
      a.weekTotal ? `${a.weekSuccess}/${a.weekTotal} successful (${pct(a.weekSuccess, a.weekTotal)})` : 'No runs last 7 days';
  }

  if (automation) {
    // Warning banner
    const warn = el('dash-automation-warning');
    const warnText = el('dash-automation-warning-text');
    if (warn && warnText) {
      if (automation.state === 'stopped') {
        warn.style.display = '';
        warn.className = 'alert-banner alert-banner--error';
        warnText.textContent = 'Automation is stopped. No automatic logins will run.';
      } else if (automation.state === 'paused') {
        warn.style.display = '';
        warn.className = 'alert-banner alert-banner--warn';
        warnText.textContent = automation.pauseUntil
          ? ('Automation is paused until ' + formatDateTime(automation.pauseUntil) + '.')
          : 'Automation is paused.';
      } else {
        warn.style.display = 'none';
      }
    }

    if (el('dash-auto-state')) {
      const isNow = !!automation.isRunning;
      const mode = automation.state;
      el('dash-auto-state').textContent = isNow ? 'Running now' : (mode === 'running' ? 'Active' : mode === 'paused' ? 'Paused' : 'Stopped');

      const pill = el('dash-auto-pill');
      if (pill) {
        pill.className = 'state-pill ' + (isNow || mode === 'running'
          ? 'state-pill--running'
          : mode === 'paused'
            ? 'state-pill--paused'
            : 'state-pill--stopped');
      }
    }
    if (el('dash-auto-next')) {
      el('dash-auto-next').textContent = automation.nextRunAt
        ? `⏰ Next: ${formatDateTime(automation.nextRunAt)}`
        : 'No next run scheduled';
    }
    const last = automation.lastSummary;
    if (el('dash-last-batch')) {
      el('dash-last-batch').textContent = last
        ? (last.success ? 'Success' : 'Failed')
        : 'No batch yet';
    }
    if (el('dash-last-batch-time')) {
      el('dash-last-batch-time').textContent = last?.completedAt
        ? formatDateTime(last.completedAt)
        : '-';
    }
  }
}

function initBannerActions() {
  const btn = el('dash-automation-warning-start');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await postJson(`${API}/automation/start`, {});
      refresh();
    } catch (_) {}
  });
}

function renderBrokerCard(prefix, stats) {
  const total = stats.success + stats.error;
  const rate = total ? Math.round((stats.success / total) * 100) : 0;
  if (el(prefix + '-rate')) {
    el(prefix + '-rate').textContent = total ? rate + '%' : '0%';
  }
  if (el(prefix + '-counts')) {
    el(prefix + '-counts').textContent = total ? `${stats.success} success / ${stats.error} failed` : 'No recent runs';
  }
  const successWidth = total ? (stats.success / total) * 100 : 0;
  const errorWidth = total ? (stats.error / total) * 100 : 0;
  if (el(prefix + '-bar-success')) {
    el(prefix + '-bar-success').style.width = successWidth + '%';
  }
  if (el(prefix + '-bar-error')) {
    el(prefix + '-bar-error').style.width = errorWidth + '%';
  }
  if (el(prefix + '-last-success')) {
    el(prefix + '-last-success').textContent = stats.lastSuccess ? formatDateTime(stats.lastSuccess) : 'No recent success';
  }
}

function renderActivity(entries) {
  var wrap = el('dash-activity');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!entries || !entries.length) {
    wrap.innerHTML = '<div class="activity-log__empty">No activity yet.</div>';
    return;
  }
  entries.slice(0, 15).forEach(function (e) {
    var row = document.createElement('div');
    row.className = 'log-entry log-entry--' + (e.type || 'info');
    row.innerHTML =
      '<div class="log-entry__left">' +
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
    const [status, log] = await Promise.all([
      fetchJson(`${API}/status`),
      fetchJson(`${API}/activity-log`),
    ]);
    const analytics = computeAnalytics(log);
    renderOverview(status.automation, analytics);
    renderBrokerCard('dash-ft', analytics.brokers.flattrade);
    renderBrokerCard('dash-kn', analytics.brokers.kotakNeo);
    renderActivity(analytics.recent);
  } catch (err) {
    // silent; dashboard will show placeholders
  }
}

refresh();
initBannerActions();
setInterval(refresh, 7000);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) refresh();
});

