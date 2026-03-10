(function () {
  var API = '/api';
  var STORAGE_KEY = 'fifto_notifications_v1';
  var MAX_ITEMS = 200;

  function nowIso() {
    return new Date().toISOString();
  }

  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      var pad = function(n) { return n < 10 ? '0' + n : String(n); };
      var dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
      var h = d.getHours(), ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return dd + '-' + mm + '-' + yyyy + ', ' + pad(h) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ampm;
    } catch (_) { return ''; }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var items = raw ? JSON.parse(raw) : [];
      return Array.isArray(items) ? items : [];
    } catch (_) {
      return [];
    }
  }

  function save(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    } catch (_) {}
  }

  function uid() {
    return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
  }

  function ensureToastWrap() {
    var wrap = document.querySelector('.toast-wrap');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
    return wrap;
  }

  function toast(type, title, msg) {
    var wrap = ensureToastWrap();
    var t = document.createElement('div');
    t.className = 'toast toast--' + (type || 'info');
    t.innerHTML =
      '<div class=\"toast__title\"></div>' +
      '<div class=\"toast__msg\"></div>';
    t.querySelector('.toast__title').textContent = title || 'Notification';
    t.querySelector('.toast__msg').textContent = msg || '';
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity 200ms';
      setTimeout(function () { t.remove(); }, 220);
    }, 4000);
  }

  function updateBadge(unreadCount) {
    var badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (unreadCount > 0) {
      badge.textContent = String(unreadCount > 99 ? '99+' : unreadCount);
      badge.classList.add('bell__badge--show');
    } else {
      badge.textContent = '';
      badge.classList.remove('bell__badge--show');
    }
  }

  function renderPanel(items) {
    var panel = document.getElementById('notif-panel');
    var list = document.getElementById('notif-list');
    if (!panel || !list) return;
    list.innerHTML = '';

    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'notif-empty';
      empty.textContent = 'No notifications yet.';
      list.appendChild(empty);
      return;
    }

    items.forEach(function (n) {
      var row = document.createElement('div');
      row.className = 'notif-item' + (n.read ? '' : ' notif-item--unread');
      row.innerHTML =
        '<div class=\"notif-item__row\">' +
          '<div class=\"notif-item__title\"></div>' +
          '<div class=\"notif-item__time\"></div>' +
        '</div>' +
        '<div class=\"notif-item__msg\"></div>' +
        '<div class=\"notif-item__meta\">' +
          '<span class=\"notif-unread-dot\"></span>' +
          '<button class=\"link-btn\" type=\"button\"></button>' +
        '</div>';
      row.querySelector('.notif-item__title').textContent = n.title || 'Notification';
      row.querySelector('.notif-item__time').textContent = fmtTime(n.ts);
      row.querySelector('.notif-item__msg').textContent = n.msg || '';
      var btn = row.querySelector('button.link-btn');
      btn.textContent = n.read ? 'Mark unread' : 'Mark read';
      btn.addEventListener('click', function () {
        n.read = !n.read;
        persistAndRender();
      });
      list.appendChild(row);
    });
  }

  function persistAndRender() {
    var items = state.items;
    save(items);
    var unread = items.filter(function (n) { return !n.read; }).length;
    updateBadge(unread);
    renderPanel(items);
  }

  function openPanel() {
    var panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.add('notif-panel--show');
  }

  function closePanel() {
    var panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.remove('notif-panel--show');
  }

  function togglePanel() {
    var panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.toggle('notif-panel--show');
  }

  function pushNotification(type, title, msg, opts) {
    opts = opts || {};
    var items = state.items;
    var n = {
      id: uid(),
      ts: nowIso(),
      type: type || 'info',
      title: title || 'Notification',
      msg: msg || '',
      read: !!opts.read,
    };
    items.unshift(n);
    state.items = items.slice(0, MAX_ITEMS);
    persistAndRender();
    if (!opts.silent) toast(type, title, msg);
    if (opts.system) maybeSystemNotify(title, msg);
    return n;
  }

  function maybeSystemNotify(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body: body }); } catch (_) {}
      return;
    }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(function (perm) {
        if (perm === 'granted') {
          try { new Notification(title, { body: body }); } catch (_) {}
        }
      });
    }
  }

  async function fetchJson(url) {
    var res = await fetch(url);
    var text = await res.text();
    if (!res.ok) throw new Error(text || ('Request failed ' + res.status));
    if (text.trimStart().startsWith('<')) throw new Error('Server returned HTML. Run: npm start');
    return JSON.parse(text);
  }

  function setRunIndicator(source) {
    var pill = document.getElementById('topbar-run');
    var text = document.getElementById('topbar-run-text');
    if (!pill || !text) return;
    if (source) {
      text.textContent = source;
      pill.classList.add('run-pill--show');
    } else {
      pill.classList.remove('run-pill--show');
    }
  }

  function summarizeBroker(name, obj) {
    if (!obj) return null;
    if (obj.configured === false) return null;
    if (obj.success) return { ok: true, err: null, step: obj.step, lastRun: obj.lastRun };
    if (obj.error) return { ok: false, err: obj.error, step: obj.step, lastRun: obj.lastRun };
    return null;
  }

  function diffAndNotify(prev, next) {
    if (!next) return;

    var prevRun = prev && prev.automation ? prev.automation.currentRunSource : null;
    var nextRun = next.automation ? next.automation.currentRunSource : null;
    setRunIndicator(nextRun);

    if (prevRun && !nextRun) {
      // run ended – emit summary if available
      var s = next.automation && next.automation.lastSummary;
      if (s && s.completedAt && (!prev.automation || !prev.automation.lastSummary || prev.automation.lastSummary.completedAt !== s.completedAt)) {
        var ok = !!s.success;
        pushNotification(ok ? 'success' : 'error', 'Automation run finished', ok ? 'All selected brokers completed.' : 'One or more brokers failed.', { system: true });
      }
    }

    var prevState = prev && prev.automation ? prev.automation.state : null;
    var nextState = next.automation ? next.automation.state : null;
    if (prevState && nextState && prevState !== nextState) {
      pushNotification('info', 'Automation state changed', prevState + ' → ' + nextState, { system: true });
    }

    var ftPrev = summarizeBroker('Flattrade', prev && prev.flattrade);
    var ftNext = summarizeBroker('Flattrade', next.flattrade);
    if (ftPrev && ftNext && ftPrev.lastRun !== ftNext.lastRun) {
      pushNotification(ftNext.ok ? 'success' : 'error', 'Flattrade login', ftNext.ok ? 'Success' : ('Failed: ' + (ftNext.err || 'error')), { system: true });
    }

    var knPrev = summarizeBroker('Kotak Neo', prev && prev.kotakNeo);
    var knNext = summarizeBroker('Kotak Neo', next.kotakNeo);
    if (knPrev && knNext && knPrev.lastRun !== knNext.lastRun) {
      pushNotification(knNext.ok ? 'success' : 'error', 'Kotak Neo login', knNext.ok ? 'Success' : ('Failed: ' + (knNext.err || 'error')), { system: true });
    }
  }

  async function poll() {
    try {
      var next = await fetchJson(API + '/status');
      diffAndNotify(state.lastStatus || {}, next);
      state.lastStatus = next;
    } catch (_) {}
  }

  function initUi() {
    var bell = document.getElementById('notif-bell');
    var panel = document.getElementById('notif-panel');
    var markAll = document.getElementById('notif-mark-all');
    var clear = document.getElementById('notif-clear');

    if (bell) bell.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });

    document.addEventListener('click', function (e) {
      if (!panel) return;
      if (panel.classList.contains('notif-panel--show')) {
        var withinPanel = panel.contains(e.target);
        var withinBell = bell && bell.contains(e.target);
        if (!withinPanel && !withinBell) closePanel();
      }
    });

    if (markAll) markAll.addEventListener('click', function () {
      state.items.forEach(function (n) { n.read = true; });
      persistAndRender();
    });

    if (clear) clear.addEventListener('click', function () {
      state.items = [];
      persistAndRender();
    });
  }

  var state = {
    items: load(),
    lastStatus: null,
  };

  // Public API for other page scripts
  window.FiFTO = window.FiFTO || {};
  window.FiFTO.notify = pushNotification;

  function boot() {
    initUi();
    persistAndRender();
    poll();
    setInterval(poll, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

