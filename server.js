/**
 * FiFTO broker login dashboard + daily automation
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3333;
const LOGIN_TIMEOUT_MS = 120000;
const AUTOMATION_TICK_MS = 30000;
const CREDENTIALS_PATH = path.join(__dirname, 'config', 'credentials.json');
const AUTOMATION_PATH = path.join(__dirname, 'config', 'automation.json');
const ACTIVITY_LOG_PATH = path.join(__dirname, 'config', 'activity-log.json');
const MAX_LOG_ENTRIES = 500;

const statusStore = {
  flattrade: null,
  kotakNeo: null,
};

const runRuntime = {
  isRunning: false,
  source: null,
};

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/* ── Activity Log ───────────────────────────────────── */

let activityLog = readJsonFile(ACTIVITY_LOG_PATH, []);
if (!Array.isArray(activityLog)) activityLog = [];

function logActivity(type, title, message) {
  const entry = {
    ts: new Date().toISOString(),
    type: type || 'info',
    title: title || '',
    message: message || '',
  };
  activityLog.unshift(entry);
  activityLog = activityLog.slice(0, MAX_LOG_ENTRIES);
  writeJsonFile(ACTIVITY_LOG_PATH, activityLog);
  return entry;
}

function loadCredentials() {
  return readJsonFile(CREDENTIALS_PATH, {});
}

function saveCredentials(data) {
  writeJsonFile(CREDENTIALS_PATH, data);
}

function defaultAutomationState() {
  return {
    enabled: false,
    state: 'stopped',
    runAt: '09:15',
    brokers: {
      flattrade: true,
      kotakNeo: true,
    },
    pauseUntil: null,
    lastAttemptDate: null,
    lastAttemptAt: null,
    lastCompletedAt: null,
    lastSummary: null,
  };
}

function normalizeAutomationState(raw = {}) {
  const base = defaultAutomationState();
  return {
    ...base,
    ...raw,
    enabled: raw.enabled ?? base.enabled,
    state: ['running', 'paused', 'stopped'].includes(raw.state) ? raw.state : base.state,
    runAt: /^\d{2}:\d{2}$/.test(String(raw.runAt || '')) ? String(raw.runAt) : base.runAt,
    brokers: {
      flattrade: raw.brokers?.flattrade ?? base.brokers.flattrade,
      kotakNeo: raw.brokers?.kotakNeo ?? base.brokers.kotakNeo,
    },
    pauseUntil: raw.pauseUntil || null,
    lastAttemptDate: raw.lastAttemptDate || null,
    lastAttemptAt: raw.lastAttemptAt || null,
    lastCompletedAt: raw.lastCompletedAt || null,
    lastSummary: raw.lastSummary || null,
  };
}

let automationStore = normalizeAutomationState(readJsonFile(AUTOMATION_PATH, defaultAutomationState()));

function saveAutomation() {
  writeJsonFile(AUTOMATION_PATH, automationStore);
}

function updateAutomation(patch = {}) {
  automationStore = normalizeAutomationState({
    ...automationStore,
    ...patch,
    brokers: {
      ...automationStore.brokers,
      ...(patch.brokers || {}),
    },
  });
  saveAutomation();
  return automationStore;
}

/* ── Telegram ───────────────────────────────────────── */

function getTelegramConfig() {
  const creds = loadCredentials();
  const tg = creds.telegram || {};
  return {
    botToken: tg.botToken || process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: tg.chatId || process.env.TELEGRAM_CHAT_ID || '',
    enabled: tg.enabled !== undefined ? tg.enabled : true,
    controlEnabled:
      tg.controlEnabled !== undefined
        ? !!tg.controlEnabled
        : String(process.env.TELEGRAM_CONTROL_ENABLED || '').toLowerCase() === '1' ||
          String(process.env.TELEGRAM_CONTROL_ENABLED || '').toLowerCase() === 'true',
  };
}

async function sendTelegram(title, message) {
  const cfg = getTelegramConfig();
  if (!cfg.enabled || !cfg.botToken || !cfg.chatId) return { ok: false, reason: 'not configured or disabled' };
  const text = `*${escapeMarkdown(title)}*\n${escapeMarkdown(message)}`;
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'MarkdownV2' }),
    });
    const data = await res.json();
    return { ok: data.ok, description: data.description };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function escapeMarkdown(str) {
  return String(str || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function fmtDateLocal(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dd}-${mm}-${yyyy}, ${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
}

function brokerLabel(key) {
  return key === 'flattrade' ? 'Flattrade' : key === 'kotakNeo' ? 'Kotak Neo' : key;
}

function getBrokerClientId(brokerKey) {
  if (brokerKey === 'flattrade') return getFlattradeEnv().FLATTRADE_CLIENT_ID || '-';
  if (brokerKey === 'kotakNeo') return getKotakNeoEnv().KOTAKNEO_CLIENT_ID || '-';
  return '-';
}

function buildBrokerLine(brokerKey, result) {
  const name = brokerLabel(brokerKey);
  const clientId = getBrokerClientId(brokerKey);
  const status = result.success ? 'Success' : 'Failed';
  const icon = result.success ? '\u2705' : '\u274C';
  const lines = [];
  lines.push(`${icon} \u{1F3E6} ${name}`);
  lines.push(`   \u{1F194} Client: ${clientId}`);
  lines.push(`   \u{1F4CB} Status: ${status}`);
  if (result.error) lines.push(`   \u26A0\uFE0F Error: ${result.error}`);
  if (result.step && !result.success) lines.push(`   \u{1F527} Step: ${result.step}`);
  if (result.lastRun) lines.push(`   \u{1F552} Time: ${fmtDateLocal(result.lastRun)}`);
  return lines.join('\n');
}

function buildBatchMessage(summary) {
  const lines = [];
  const overallIcon = summary.success ? '\u2705' : '\u274C';
  lines.push(`${overallIcon} Batch: ${summary.success ? 'ALL SUCCESS' : 'HAS FAILURES'}`);
  lines.push(`\u{1F4E1} Source: ${summary.source || 'manual'}`);
  lines.push(`\u{1F551} Started: ${fmtDateLocal(summary.startedAt)}`);
  lines.push(`\u{1F3C1} Completed: ${fmtDateLocal(summary.completedAt)}`);
  lines.push('');

  const brokerKeys = Object.keys(summary.brokers || {});
  if (brokerKeys.length === 0) {
    lines.push('\u{1F6AB} No brokers were selected.');
  } else {
    lines.push(`\u{1F4CA} Broker Results (${brokerKeys.length}):`);
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    for (const key of brokerKeys) {
      lines.push('');
      lines.push(buildBrokerLine(key, summary.brokers[key]));
    }
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  }

  lines.push('');
  const snap = getAutomationSnapshot();
  lines.push(`\u{1F4C5} Next run: ${snap.nextRunAt ? fmtDateLocal(snap.nextRunAt) : 'Not scheduled'}`);
  lines.push(`\u23F0 Schedule: ${snap.runAt} daily`);
  const modeIcon = snap.state === 'running' ? '\u25B6\uFE0F' : snap.state === 'paused' ? '\u23F8\uFE0F' : '\u23F9\uFE0F';
  lines.push(`${modeIcon} Mode: ${snap.state === 'running' ? 'Active' : snap.state === 'paused' ? 'Paused' : 'Stopped'}`);

  return lines.join('\n');
}

function buildScheduleMessage(snap) {
  const enabledBrokers = [];
  if (snap.brokers?.flattrade) enabledBrokers.push(`\u{1F3E6} Flattrade (${getBrokerClientId('flattrade')})`);
  if (snap.brokers?.kotakNeo) enabledBrokers.push(`\u{1F3E6} Kotak Neo (${getBrokerClientId('kotakNeo')})`);
  const modeIcon = snap.state === 'running' ? '\u25B6\uFE0F' : snap.state === 'paused' ? '\u23F8\uFE0F' : '\u23F9\uFE0F';
  const lines = [];
  lines.push(`\u23F0 Daily time: ${snap.runAt}`);
  lines.push(`\u{1F4CB} Brokers: ${enabledBrokers.length ? enabledBrokers.join(', ') : 'None'}`);
  lines.push(`${modeIcon} Mode: ${snap.state === 'running' ? 'Active' : snap.state === 'paused' ? 'Paused' : 'Stopped'}`);
  lines.push(`\u{1F4C5} Next run: ${snap.nextRunAt ? fmtDateLocal(snap.nextRunAt) : 'Not scheduled'}`);
  if (snap.pauseUntil) lines.push(`\u23F3 Paused until: ${fmtDateLocal(snap.pauseUntil)}`);
  return lines.join('\n');
}

function tgNotify(title, message) {
  sendTelegram(title, message).catch(() => {});
}

/* ── Telegram Control (remote commands) ───────────────── */

async function sendTelegramToChat(chatId, title, message) {
  const cfg = getTelegramConfig();
  if (!cfg.enabled || !cfg.botToken || !chatId) return { ok: false, reason: 'not configured or disabled' };
  const text = `*${escapeMarkdown(title)}*\n${escapeMarkdown(message)}`;
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'MarkdownV2' }),
    });
    const data = await res.json();
    return { ok: data.ok, description: data.description };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function telegramHelpText() {
  return [
    'Commands:',
    '/status  - show automation state',
    '/start   - start/resume automation',
    '/stop    - stop automation',
    '/pause 1 - pause for N days (example: /pause 3)',
    '/run     - run all selected brokers now',
    '/schedule HH:MM - change daily time (example: /schedule 08:45)',
  ].join('\n');
}

function isAllowedTelegramChat(chatId) {
  const cfg = getTelegramConfig();
  return String(chatId) === String(cfg.chatId);
}

async function handleTelegramCommand(textRaw, fromChatId) {
  const text = String(textRaw || '').trim();
  if (!text) return;

  const snapBefore = getAutomationSnapshot();
  const words = text.split(/\s+/);
  const cmd = String(words[0] || '').toLowerCase();

  if (cmd === '/help' || cmd === '/start@' || cmd === '/help@') {
    await sendTelegramToChat(fromChatId, 'FiFTO Control', telegramHelpText());
    return;
  }

  if (cmd === '/status') {
    const snap = getAutomationSnapshot();
    await sendTelegramToChat(fromChatId, 'FiFTO Status', buildScheduleMessage(snap));
    return;
  }

  if (cmd === '/start' || cmd === '/resume') {
    updateAutomation({ enabled: true, state: 'running', pauseUntil: null });
    setTimeout(() => automationTick().catch(() => {}), 150);
    const snap = getAutomationSnapshot();
    logActivity('info', 'Automation started (Telegram)', `Next run: ${snap.nextRunAt ? fmtDateLocal(snap.nextRunAt) : '-'}`);
    await sendTelegramToChat(fromChatId, '▶️ Automation Started', buildScheduleMessage(snap));
    return;
  }

  if (cmd === '/stop') {
    updateAutomation({ enabled: false, state: 'stopped', pauseUntil: null });
    const snap = getAutomationSnapshot();
    logActivity('warn', 'Automation stopped (Telegram)', 'Daily logins disabled');
    await sendTelegramToChat(fromChatId, '⏹️ Automation Stopped', buildScheduleMessage(snap));
    return;
  }

  if (cmd === '/pause') {
    const days = Math.max(1, Number(words[1] || 1));
    const pauseUntil = new Date();
    pauseUntil.setDate(pauseUntil.getDate() + days);
    updateAutomation({ enabled: true, state: 'paused', pauseUntil: pauseUntil.toISOString() });
    const snap = getAutomationSnapshot();
    logActivity('warn', 'Automation paused (Telegram)', `Paused for ${days} day${days === 1 ? '' : 's'} until ${fmtDateLocal(pauseUntil.toISOString())}`);
    await sendTelegramToChat(fromChatId, '⏸️ Automation Paused', buildScheduleMessage(snap));
    return;
  }

  if (cmd === '/run') {
    const result = await withRunLock('telegram:run-now', async () => {
      return runSelectedBrokers({
        headed: false,
        brokers: automationStore.brokers,
        source: 'telegram',
      });
    });
    updateAutomation({
      lastCompletedAt: new Date().toISOString(),
      lastSummary: result,
    });
    await sendTelegramToChat(
      fromChatId,
      result.success ? '✅ Run Completed' : '⚠️ Run Completed with Failures',
      buildBatchMessage(result),
    );
    return;
  }

  if (cmd === '/schedule') {
    const time = String(words[1] || '').trim();
    if (!/^\d{2}:\d{2}$/.test(time)) {
      await sendTelegramToChat(fromChatId, 'Invalid time', 'Use: /schedule HH:MM (example: /schedule 08:45)');
      return;
    }
    const oldRunAt = automationStore.runAt;
    const runAtChanged = time !== oldRunAt;
    updateAutomation({
      runAt: time,
      ...(runAtChanged ? { lastAttemptDate: null, lastAttemptAt: null } : {}),
    });
    const snap = getAutomationSnapshot();
    logActivity('info', 'Schedule updated (Telegram)', runAtChanged ? `Time: ${oldRunAt} → ${time}` : `Saved (${time})`);
    tgNotify(
      '\u{1F4C5} Schedule Updated',
      (runAtChanged ? `Time changed: ${oldRunAt} \u2192 ${time}\n` : '') + buildScheduleMessage(snap),
    );
    await sendTelegramToChat(fromChatId, '📅 Schedule Updated', buildScheduleMessage(snap));
    return;
  }

  // Unknown command -> help
  if (text.startsWith('/')) {
    await sendTelegramToChat(fromChatId, 'FiFTO Control', telegramHelpText());
    return;
  }

  // Not a command: ignore
  void snapBefore;
}

async function telegramGetUpdates(offset) {
  const cfg = getTelegramConfig();
  const url = `https://api.telegram.org/bot${cfg.botToken}/getUpdates?timeout=0&offset=${offset}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'getUpdates failed');
  return data.result || [];
}

function startTelegramControl() {
  const cfg = getTelegramConfig();
  if (!cfg.controlEnabled) return;
  if (!cfg.botToken || !cfg.chatId) return;

  let offset = 0;
  let started = false;

  async function tick() {
    try {
      const updates = await telegramGetUpdates(offset);
      if (!started) {
        // On first tick: skip backlog (mark as seen)
        const last = updates.length ? updates[updates.length - 1].update_id : null;
        if (last !== null && last !== undefined) offset = last + 1;
        started = true;
        return;
      }

      for (const u of updates) {
        offset = Math.max(offset, (u.update_id || 0) + 1);
        const msg = u.message || u.edited_message;
        if (!msg) continue;
        const chatId = msg.chat?.id;
        const text = msg.text;
        if (!chatId || !text) continue;
        if (!isAllowedTelegramChat(chatId)) continue;
        await handleTelegramCommand(text, chatId);
      }
    } catch (_) {
      // ignore
    } finally {
      setTimeout(tick, 2500);
    }
  }

  // kick off loop
  setTimeout(tick, 1500);
}

function maskValue(val, showStart = 2, showEnd = 2) {
  if (!val || typeof val !== 'string') return '';
  if (val.length <= showStart + showEnd) return '•••';
  return val.slice(0, showStart) + '•••' + val.slice(-showEnd);
}

function getFlattradeEnv() {
  const creds = loadCredentials();
  const ft = creds.flattrade || {};
  return {
    FLATTRADE_CLIENT_ID: ft.clientId || process.env.FLATTRADE_CLIENT_ID,
    FLATTRADE_USER_ID: ft.userId || process.env.FLATTRADE_USER_ID,
    FLATTRADE_PASSWORD: ft.password || process.env.FLATTRADE_PASSWORD,
    FLATTRADE_TOTP: ft.totp || process.env.FLATTRADE_TOTP,
  };
}

function getKotakNeoEnv() {
  const creds = loadCredentials();
  const kn = creds.kotakNeo || {};
  return {
    KOTAKNEO_CLIENT_ID: kn.clientId || process.env.KOTAKNEO_CLIENT_ID,
    KOTAKNEO_USER_ID: kn.userId || process.env.KOTAKNEO_USER_ID,
    KOTAKNEO_PASSWORD: kn.password || process.env.KOTAKNEO_PASSWORD,
    KOTAKNEO_TOTP: kn.totp || process.env.KOTAKNEO_TOTP,
    KOTAKNEO_MPIN: kn.mpin || process.env.KOTAKNEO_MPIN,
  };
}

function buildFlattradeCredentialsResponse() {
  const env = getFlattradeEnv();
  const hasClientId = !!env.FLATTRADE_CLIENT_ID;
  const hasUserId = !!env.FLATTRADE_USER_ID;
  const hasPassword = !!env.FLATTRADE_PASSWORD;
  const hasTotp = !!env.FLATTRADE_TOTP;
  return {
    configured: hasClientId && hasUserId && hasPassword && hasTotp,
    clientId: maskValue(env.FLATTRADE_CLIENT_ID),
    userId: maskValue(env.FLATTRADE_USER_ID),
    password: env.FLATTRADE_PASSWORD ? '••••••••' : '',
    totp: maskValue(env.FLATTRADE_TOTP, 0, 2),
  };
}

function buildKotakCredentialsResponse() {
  const env = getKotakNeoEnv();
  const hasClientId = !!env.KOTAKNEO_CLIENT_ID;
  const hasUserId = !!env.KOTAKNEO_USER_ID;
  const hasTotp = !!env.KOTAKNEO_TOTP;
  const hasMpin = !!env.KOTAKNEO_MPIN;
  return {
    configured: hasClientId && hasUserId && hasTotp && hasMpin,
    clientId: maskValue(env.KOTAKNEO_CLIENT_ID),
    userId: maskValue(env.KOTAKNEO_USER_ID),
    totp: env.KOTAKNEO_TOTP
      ? (String(env.KOTAKNEO_TOTP).length <= 6 ? '••••••' : maskValue(env.KOTAKNEO_TOTP, 0, 2))
      : '',
    mpin: env.KOTAKNEO_MPIN ? '••••••' : '',
  };
}

function runScriptSubprocess({ scriptName, env, timeoutMessage }) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'scripts', scriptName);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: __dirname,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        step: 'timeout',
        error: timeoutMessage,
        lastRun: new Date().toISOString(),
      });
    }, LOGIN_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const trimmed = stdout.trim();
      const jsonStart = trimmed.startsWith('{') ? 0 : trimmed.lastIndexOf('\n{');
      const jsonStr = jsonStart >= 0 ? trimmed.slice(jsonStart === 0 ? 0 : jsonStart + 1) : trimmed;
      let result;
      try {
        result = JSON.parse(jsonStr);
      } catch (_) {
        result = {
          success: false,
          step: 'error',
          error: code !== 0 ? (stderr || `Process exited ${code}`).trim() || `Exit code ${code}` : 'No status output',
          lastRun: new Date().toISOString(),
        };
      }
      result.lastRun = result.lastRun || new Date().toISOString();
      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        step: 'error',
        error: err.message || String(err),
        lastRun: new Date().toISOString(),
      });
    });
  });
}

function runFlattradeLoginSubprocess(headed = false) {
  return runScriptSubprocess({
    scriptName: 'flattrade-login.js',
    env: {
      ...process.env,
      ...getFlattradeEnv(),
      ...(headed ? { HEADED: '1' } : {}),
    },
    timeoutMessage: 'Login timed out after 2 minutes. Try again or run: npm run flattrade',
  });
}

function runKotakNeoLoginSubprocess(headed = false) {
  return runScriptSubprocess({
    scriptName: 'kotak-neo-login.js',
    env: {
      ...process.env,
      ...getKotakNeoEnv(),
      ...(headed ? { HEADED: '1' } : {}),
    },
    timeoutMessage: 'Login timed out after 2 minutes. Try again or run: npm run kotakneo',
  });
}

async function withRunLock(source, work) {
  if (runRuntime.isRunning) {
    return {
      success: false,
      step: 'busy',
      error: `Another login run is already in progress (${runRuntime.source}).`,
      lastRun: new Date().toISOString(),
    };
  }
  runRuntime.isRunning = true;
  runRuntime.source = source;
  try {
    return await work();
  } finally {
    runRuntime.isRunning = false;
    runRuntime.source = null;
  }
}

async function runSelectedBrokers({ headed = false, brokers = automationStore.brokers, source = 'manual' } = {}) {
  const summary = {
    success: true,
    source,
    startedAt: new Date().toISOString(),
    brokers: {},
  };

  if (brokers.flattrade) {
    const result = await runFlattradeLoginSubprocess(headed);
    statusStore.flattrade = result;
    summary.brokers.flattrade = result;
    summary.success = summary.success && !!result.success;
    const ftId = getBrokerClientId('flattrade');
    logActivity(
      result.success ? 'success' : 'error',
      `Flattrade (${ftId})`,
      result.success ? 'Login successful' : `Failed: ${result.error || result.step || 'unknown'}`,
    );
    if (!result.success) {
      tgNotify('\u274C Flattrade Login Failed', buildBrokerLine('flattrade', result));
    }
  }

  if (brokers.kotakNeo) {
    const result = await runKotakNeoLoginSubprocess(headed);
    statusStore.kotakNeo = result;
    summary.brokers.kotakNeo = result;
    summary.success = summary.success && !!result.success;
    const knId = getBrokerClientId('kotakNeo');
    logActivity(
      result.success ? 'success' : 'error',
      `Kotak Neo (${knId})`,
      result.success ? 'Login successful' : `Failed: ${result.error || result.step || 'unknown'}`,
    );
    if (!result.success) {
      tgNotify('\u274C Kotak Neo Login Failed', buildBrokerLine('kotakNeo', result));
    }
  }

  summary.completedAt = new Date().toISOString();

  logActivity(
    summary.success ? 'success' : 'error',
    `Batch ${summary.success ? 'completed' : 'completed with failures'}`,
    `Source: ${source} | Brokers: ${Object.keys(summary.brokers).map(k => brokerLabel(k)).join(', ')}`,
  );

  tgNotify(
    summary.success ? '\u2705 Login Run Completed' : '\u26A0\uFE0F Login Run Completed with Failures',
    buildBatchMessage(summary),
  );

  return summary;
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getScheduledDate(date = new Date(), runAt = automationStore.runAt) {
  const [hours, minutes] = String(runAt).split(':').map(Number);
  const scheduled = new Date(date);
  scheduled.setHours(hours, minutes, 0, 0);
  return scheduled;
}

function maybeResumeExpiredPause(now = new Date()) {
  if (
    automationStore.state === 'paused' &&
    automationStore.pauseUntil &&
    new Date(automationStore.pauseUntil).getTime() <= now.getTime()
  ) {
    updateAutomation({
      enabled: true,
      state: 'running',
      pauseUntil: null,
    });
  }
}

function computeNextRunAt(now = new Date()) {
  if (automationStore.state === 'paused' && automationStore.pauseUntil) {
    const pauseUntil = new Date(automationStore.pauseUntil);
    if (pauseUntil.getTime() > now.getTime()) {
      return pauseUntil.toISOString();
    }
  }

  if (!automationStore.enabled || automationStore.state !== 'running') {
    return null;
  }

  if (!automationStore.brokers.flattrade && !automationStore.brokers.kotakNeo) {
    return null;
  }

  const todayKey = getLocalDateKey(now);
  const scheduled = getScheduledDate(now, automationStore.runAt);

  if (automationStore.lastAttemptDate !== todayKey && now.getTime() < scheduled.getTime()) {
    return scheduled.toISOString();
  }

  scheduled.setDate(scheduled.getDate() + 1);
  return scheduled.toISOString();
}

function getAutomationSnapshot() {
  const now = new Date();
  return {
    ...automationStore,
    nextRunAt: computeNextRunAt(now),
    isRunning: runRuntime.isRunning && runRuntime.source === 'automation',
    currentRunSource: runRuntime.source,
  };
}

async function automationTick() {
  maybeResumeExpiredPause();

  if (!automationStore.enabled || automationStore.state !== 'running') return;
  if (runRuntime.isRunning) return;
  if (!automationStore.brokers.flattrade && !automationStore.brokers.kotakNeo) return;

  const now = new Date();
  const scheduled = getScheduledDate(now, automationStore.runAt);
  const todayKey = getLocalDateKey(now);

  if (now.getTime() < scheduled.getTime()) return;
  if (automationStore.lastAttemptDate === todayKey) return;

  updateAutomation({
    lastAttemptDate: todayKey,
    lastAttemptAt: now.toISOString(),
  });

  const summary = await withRunLock('automation', async () => {
    return runSelectedBrokers({
      headed: false,
      brokers: automationStore.brokers,
      source: 'automation',
    });
  });

  updateAutomation({
    lastCompletedAt: new Date().toISOString(),
    lastSummary: summary,
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    flattrade: statusStore.flattrade,
    kotakNeo: statusStore.kotakNeo ?? { configured: false, message: 'Not set up yet' },
    automation: getAutomationSnapshot(),
  });
});

app.get('/api/credentials/flattrade', (req, res) => {
  res.json(buildFlattradeCredentialsResponse());
});

app.put('/api/credentials/flattrade', (req, res) => {
  const { clientId, userId, password, totp } = req.body || {};
  const creds = loadCredentials();
  creds.flattrade = creds.flattrade || {};
  if (clientId !== undefined) creds.flattrade.clientId = String(clientId).trim();
  if (userId !== undefined) creds.flattrade.userId = String(userId).trim();
  if (password !== undefined) creds.flattrade.password = String(password);
  if (totp !== undefined) creds.flattrade.totp = String(totp).trim();
  saveCredentials(creds);
  res.json({ ok: true, message: 'Flattrade credentials updated' });
});

app.get('/api/credentials/kotakneo', (req, res) => {
  res.json(buildKotakCredentialsResponse());
});

app.put('/api/credentials/kotakneo', (req, res) => {
  const { clientId, userId, password, totp, mpin } = req.body || {};
  const creds = loadCredentials();
  creds.kotakNeo = creds.kotakNeo || {};
  if (clientId !== undefined) creds.kotakNeo.clientId = String(clientId).trim();
  if (userId !== undefined) creds.kotakNeo.userId = String(userId).trim();
  if (password !== undefined) creds.kotakNeo.password = String(password);
  if (totp !== undefined) creds.kotakNeo.totp = String(totp).trim();
  if (mpin !== undefined) creds.kotakNeo.mpin = String(mpin).trim();
  saveCredentials(creds);
  res.json({ ok: true, message: 'Kotak Neo credentials updated' });
});

app.post('/api/flattrade/login', async (req, res) => {
  const headed = req.body?.headed === true;
  const result = await withRunLock('manual:flattrade', async () => {
    const run = await runFlattradeLoginSubprocess(headed);
    statusStore.flattrade = run;
    return run;
  });
  if (result.step === 'busy') {
    statusStore.flattrade = result;
  }
  tgNotify(
    result.success ? '\u2705 Flattrade Login' : '\u274C Flattrade Login',
    buildBrokerLine('flattrade', result),
  );
  res.json(result);
});

app.post('/api/kotakneo/login', async (req, res) => {
  const headed = req.body?.headed === true;
  const result = await withRunLock('manual:kotakneo', async () => {
    const run = await runKotakNeoLoginSubprocess(headed);
    statusStore.kotakNeo = run;
    return run;
  });
  if (result.step === 'busy') {
    statusStore.kotakNeo = result;
  }
  tgNotify(
    result.success ? '\u2705 Kotak Neo Login' : '\u274C Kotak Neo Login',
    buildBrokerLine('kotakNeo', result),
  );
  res.json(result);
});

/* ── Telegram API ───────────────────────────────────── */

app.get('/api/credentials/telegram', (req, res) => {
  const cfg = getTelegramConfig();
  res.json({
    configured: !!(cfg.botToken && cfg.chatId),
    botToken: cfg.botToken ? maskValue(cfg.botToken, 4, 4) : '',
    chatId: cfg.chatId ? maskValue(String(cfg.chatId), 3, 3) : '',
    enabled: cfg.enabled,
  });
});

app.put('/api/credentials/telegram', (req, res) => {
  const { botToken, chatId, enabled } = req.body || {};
  const creds = loadCredentials();
  creds.telegram = creds.telegram || {};
  if (botToken !== undefined) creds.telegram.botToken = String(botToken).trim();
  if (chatId !== undefined) creds.telegram.chatId = String(chatId).trim();
  if (enabled !== undefined) creds.telegram.enabled = enabled === true;
  saveCredentials(creds);
  res.json({ ok: true, message: 'Telegram settings updated' });
});

app.post('/api/telegram/send', async (req, res) => {
  const { title, message } = req.body || {};
  if (!title && !message) return res.status(400).json({ ok: false, error: 'title and message required' });
  const result = await sendTelegram(title || 'FiFTO', message || '');
  res.json(result);
});

app.post('/api/telegram/test', async (req, res) => {
  const result = await sendTelegram('FiFTO Test', 'Telegram notification is working!');
  res.json(result);
});

app.get('/api/activity-log', (req, res) => {
  res.json(activityLog);
});

app.get('/api/automation', (req, res) => {
  res.json(getAutomationSnapshot());
});

app.put('/api/automation', (req, res) => {
  const runAt = typeof req.body?.runAt === 'string' ? req.body.runAt.trim() : automationStore.runAt;
  const brokers = {
    flattrade: req.body?.brokers?.flattrade !== undefined ? req.body.brokers.flattrade === true : automationStore.brokers.flattrade,
    kotakNeo: req.body?.brokers?.kotakNeo !== undefined ? req.body.brokers.kotakNeo === true : automationStore.brokers.kotakNeo,
  };

  if (!/^\d{2}:\d{2}$/.test(runAt)) {
    return res.status(400).json({
      ok: false,
      error: 'Time must be in HH:MM format.',
    });
  }

  const oldRunAt = automationStore.runAt;
  const runAtChanged = runAt !== oldRunAt;
  updateAutomation({
    runAt,
    brokers,
    ...(runAtChanged ? { lastAttemptDate: null, lastAttemptAt: null } : {}),
  });
  const snap = getAutomationSnapshot();
  logActivity('info', 'Schedule updated', runAtChanged ? `Time: ${oldRunAt} → ${runAt}` : `Saved (${runAt})`);
  tgNotify(
    '\u{1F4C5} Schedule Updated',
    (runAtChanged ? `Time changed: ${oldRunAt} \u2192 ${runAt}\n` : '') + buildScheduleMessage(snap),
  );
  return res.json({
    ok: true,
    message: 'Automation schedule updated',
    automation: snap,
  });
});

app.post('/api/automation/start', (req, res) => {
  updateAutomation({ enabled: true, state: 'running', pauseUntil: null });
  setTimeout(() => automationTick().catch(() => {}), 150);
  const snap = getAutomationSnapshot();
  logActivity('info', 'Automation started', `Next run: ${snap.nextRunAt ? fmtDateLocal(snap.nextRunAt) : '-'}`);
  res.json({ ok: true, message: 'Daily automation started', automation: snap });
});

app.post('/api/automation/resume', (req, res) => {
  updateAutomation({ enabled: true, state: 'running', pauseUntil: null });
  setTimeout(() => automationTick().catch(() => {}), 150);
  const snap = getAutomationSnapshot();
  logActivity('info', 'Automation resumed', `Next run: ${snap.nextRunAt ? fmtDateLocal(snap.nextRunAt) : '-'}`);
  res.json({ ok: true, message: 'Automation resumed', automation: snap });
});

app.post('/api/automation/stop', (req, res) => {
  updateAutomation({ enabled: false, state: 'stopped', pauseUntil: null });
  const snap = getAutomationSnapshot();
  logActivity('warn', 'Automation stopped', 'Daily logins disabled');
  res.json({ ok: true, message: 'Automation stopped', automation: snap });
});

app.post('/api/automation/pause', (req, res) => {
  const days = Math.max(1, Number(req.body?.days || 1));
  const pauseUntil = new Date();
  pauseUntil.setDate(pauseUntil.getDate() + days);
  updateAutomation({ enabled: true, state: 'paused', pauseUntil: pauseUntil.toISOString() });
  const snap = getAutomationSnapshot();
  logActivity('warn', 'Automation paused', `Paused for ${days} day${days === 1 ? '' : 's'} until ${fmtDateLocal(pauseUntil.toISOString())}`);
  res.json({ ok: true, message: `Automation paused for ${days} day${days === 1 ? '' : 's'}`, automation: snap });
});

app.post('/api/automation/run-now', async (req, res) => {
  const result = await withRunLock('manual:automation', async () => {
    return runSelectedBrokers({
      headed: false,
      brokers: automationStore.brokers,
      source: 'run-now',
    });
  });

  updateAutomation({
    lastCompletedAt: new Date().toISOString(),
    lastSummary: result,
  });

  res.json({
    ok: result.step !== 'busy',
    message: result.step === 'busy' ? result.error : 'Run started for selected brokers',
    summary: result,
    automation: getAutomationSnapshot(),
  });
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.get('/automation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'automation.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

setInterval(() => {
  automationTick().catch((err) => {
    console.error('Automation tick failed:', err);
  });
}, AUTOMATION_TICK_MS);

setTimeout(() => {
  automationTick().catch((err) => {
    console.error('Initial automation tick failed:', err);
  });
}, 2000);

startTelegramControl();

app.listen(PORT, () => {
  console.log(`Quantman Login Dashboard: http://localhost:${PORT}`);
});
