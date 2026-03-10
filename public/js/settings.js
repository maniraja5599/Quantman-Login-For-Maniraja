const API = '/api';

function el(id) {
  return document.getElementById(id);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed ${res.status}`);
  if (text.trimStart().startsWith('<')) {
    throw new Error('Server returned HTML instead of JSON. Open the app via http://localhost:3333 (run: npm start).');
  }
  return JSON.parse(text);
}

async function fetchCredentials(broker) {
  return fetchJson(`${API}/credentials/${broker}`);
}

async function saveCredentials(broker, payload) {
  return fetchJson(`${API}/credentials/${broker}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function renderCredentials(broker, data) {
  if (broker === 'flattrade') {
    if (el('ft-client-id')) el('ft-client-id').placeholder = data.clientId || 'e.g. FT003862';
    if (el('ft-user-id')) el('ft-user-id').placeholder = data.userId || 'e.g. FT003862';
    if (el('ft-password')) el('ft-password').placeholder = data.password ? 'Existing password saved' : 'Leave blank to keep current';
    if (el('ft-totp')) el('ft-totp').placeholder = data.totp || 'e.g. 17111992';
  } else if (broker === 'kotakneo') {
    if (el('kn-client-id')) el('kn-client-id').placeholder = data.clientId || 'e.g. YXLLE';
    if (el('kn-user-id')) el('kn-user-id').placeholder = data.userId || 'e.g. 9159036301';
    if (el('kn-totp')) el('kn-totp').placeholder = data.totp ? 'Existing secret or code saved' : 'Base32 secret from QR or current 6-digit code';
    if (el('kn-mpin')) el('kn-mpin').placeholder = data.mpin ? 'Existing MPIN saved' : 'e.g. 265599';
  }
}

function buildPayload(form) {
  const fd = new FormData(form);
  const payload = {};
  for (const [key, value] of fd.entries()) {
    const cleaned = String(value).trim();
    if (cleaned) payload[key] = cleaned;
  }
  return payload;
}

function initForm(broker, formId, msgId) {
  const form = el(formId);
  const msg = el(msgId);
  if (!form) return;

  fetchCredentials(broker)
    .then((data) => renderCredentials(broker, data))
    .catch(() => renderCredentials(broker, {}));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (msg) {
      msg.textContent = '';
      msg.classList.remove('form__msg--error');
    }

    const payload = buildPayload(form);
    if (Object.keys(payload).length === 0) {
      if (msg) {
        msg.textContent = 'Enter at least one field to update.';
        msg.classList.add('form__msg--error');
      }
      return;
    }

    try {
      await saveCredentials(broker, payload);
      const latest = await fetchCredentials(broker);
      renderCredentials(broker, latest);
      form.reset();
      if (msg) msg.textContent = 'Credentials saved locally.';
    } catch (err) {
      if (msg) {
        msg.textContent = err.message || 'Failed to save credentials.';
        msg.classList.add('form__msg--error');
      }
    }
  });
}

async function initTelegram() {
  const msg = el('telegram-cred-msg');
  const form = el('telegram-credentials-form');
  const testBtn = el('tg-test-btn');
  if (!form) return;

  try {
    const data = await fetchJson(`${API}/credentials/telegram`);
    if (el('tg-bot-token')) el('tg-bot-token').placeholder = data.botToken || 'e.g. 123456:ABC...';
    if (el('tg-chat-id')) el('tg-chat-id').placeholder = data.chatId || 'e.g. -1001234567890';
    if (el('tg-enabled')) el('tg-enabled').checked = data.enabled !== false;
  } catch (_) {}

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (msg) { msg.textContent = ''; msg.className = 'form-msg'; }
    const payload = {};
    const token = el('tg-bot-token')?.value.trim();
    const chatId = el('tg-chat-id')?.value.trim();
    if (token) payload.botToken = token;
    if (chatId) payload.chatId = chatId;
    payload.enabled = !!el('tg-enabled')?.checked;

    try {
      await fetchJson(`${API}/credentials/telegram`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const latest = await fetchJson(`${API}/credentials/telegram`);
      if (el('tg-bot-token')) { el('tg-bot-token').placeholder = latest.botToken || ''; el('tg-bot-token').value = ''; }
      if (el('tg-chat-id')) { el('tg-chat-id').placeholder = latest.chatId || ''; el('tg-chat-id').value = ''; }
      if (msg) msg.textContent = 'Telegram settings saved.';
    } catch (err) {
      if (msg) { msg.textContent = err.message || 'Save failed.'; msg.className = 'form-msg form-msg--error'; }
    }
  });

  if (testBtn) testBtn.addEventListener('click', async () => {
    if (msg) { msg.textContent = 'Sending test...'; msg.className = 'form-msg'; }
    try {
      const r = await fetchJson(`${API}/telegram/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (msg) msg.textContent = r.ok ? 'Test sent! Check Telegram.' : ('Failed: ' + (r.description || r.reason || 'unknown'));
      if (!r.ok && msg) msg.className = 'form-msg form-msg--error';
    } catch (err) {
      if (msg) { msg.textContent = err.message; msg.className = 'form-msg form-msg--error'; }
    }
  });
}

function init() {
  initForm('flattrade', 'flattrade-credentials-form', 'flattrade-cred-msg');
  initForm('kotakneo', 'kotakneo-credentials-form', 'kotakneo-cred-msg');
  initTelegram();
}

init();
