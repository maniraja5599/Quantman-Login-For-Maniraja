/**
 * Quantman – Flattrade broker login automation
 * 1. Open Flattrade directly at http://qubit.flattrade.in/
 * 2. Fill username (name), password (name), and TOTP
 * 3. Click Login
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const FLATTRADE_URL = 'http://qubit.flattrade.in/';
const AUTH_TIMEOUT_MS = 60000;
const DEFAULT_WAIT_MS = 5000;

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}. Copy .env.example to .env and set values.`);
  return v;
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

export async function runFlattradeLogin(options = {}) {
  const headed = options.headed ?? (process.env.HEADED === '1');
  const clientId = options.clientId ?? getEnv('FLATTRADE_CLIENT_ID');
  const userId = options.userId ?? getEnv('FLATTRADE_USER_ID') ?? 'name';
  const password = options.password ?? getEnv('FLATTRADE_PASSWORD') ?? 'name';
  const totp = options.totp ?? getEnv('FLATTRADE_TOTP');

  const status = { success: false, step: null, error: null };

  const browser = await chromium.launch({
    headless: !headed,
    args: headed ? [] : ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(AUTH_TIMEOUT_MS);

    // Step 1: Open Flattrade directly
    status.step = 'open_flattrade';
    log('Opening Flattrade...');
    await page.goto(FLATTRADE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    // Step 2: Fill username (name)
    status.step = 'fill_username';
    log('Filling username...');
    const usernameSelectors = [
      'input[placeholder*="User" i]',
      'input[name*="user" i]',
      'input[name*="username" i]',
      'input[id*="user" i]',
      'input[type="text"]',
    ];
    let usernameFilled = false;
    for (const sel of usernameSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill(userId);
          usernameFilled = true;
          log('Filled username.');
          break;
        }
      } catch (_) {}
    }
    if (!usernameFilled) {
      const anyInput = page.locator('input[type="text"]').first();
      if (await anyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await anyInput.fill(userId);
        usernameFilled = true;
      }
    }

    // Step 3: Fill password (name)
    status.step = 'fill_password';
    log('Filling password...');
    const passwordInput = page.locator('input[type="password"]').first();
    if (await passwordInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await passwordInput.fill(password);
      log('Filled password.');
    }

    // Step 4: Fill TOTP/OTP if available
    status.step = 'fill_totp';
    log('Filling TOTP...');
    const totpSelectors = [
      'input[placeholder*="OTP" i]',
      'input[placeholder*="TOTP" i]',
      'input[name*="otp" i]',
      'input[name*="totp" i]',
    ];
    let totpFilled = false;
    for (const sel of totpSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill(totp);
          totpFilled = true;
          log('Filled TOTP.');
          break;
        }
      } catch (_) {}
    }

    // Step 5: Click Login button
    status.step = 'click_login';
    log('Clicking Login...');
    const loginSelectors = [
      'button:has-text("Login")',
      'button:has-text("Log In")',
      'input[type="submit"]',
      'button[type="submit"]',
    ];
    let loginClicked = false;
    for (const sel of loginSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          loginClicked = true;
          log('Clicked Login button.');
          break;
        }
      } catch (_) {}
    }
    if (!loginClicked) {
      throw new Error('Could not find Login button');
    }

    // Wait for redirect/success
    await new Promise((r) => setTimeout(r, 5000));
    const authUrl = page.url();
    const hasError = await page.getByText(/invalid|error|failed|incorrect/i).isVisible({ timeout: 3000 }).catch(() => false);
    if (hasError) {
      throw new Error('Flattrade login showed an error message');
    }

    status.step = 'done';
    status.success = true;
    log('Flattrade login flow completed.');
  } catch (err) {
    status.error = err.message || String(err);
    log(`Error: ${status.error}`);
  } finally {
    await context.close();
    await browser.close();
  }

  return status;
}

async function main() {
  try {
    const status = await runFlattradeLogin();
    console.log(JSON.stringify(status, null, 2));
    process.exit(status.success ? 0 : 1);
  } catch (err) {
    console.error(err);
    console.log(JSON.stringify({ success: false, step: null, error: err.message }, null, 2));
    process.exit(1);
  }
}

// Only run main when executed directly (not when imported by server)
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) main();
