/**
 * Quantman – Flattrade broker login automation
 * 1. Open Quantman → login with broker → select Flattrade
 * 2. Enter Client ID, click Login
 * 3. In auth popup: fill User ID, Password, OTP/TOTP (DOB), click Log In
 * 4. Return login status
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const QUANTMAN_URL = 'https://www.quantman.trade/';
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
  const userId = options.userId ?? getEnv('FLATTRADE_USER_ID');
  const password = options.password ?? getEnv('FLATTRADE_PASSWORD');
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

    // Step 1: Open Quantman
    status.step = 'open_quantman';
    log('Opening Quantman...');
    await page.goto(QUANTMAN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Step 2: Click Signup/Login or "Login" to start broker login
    status.step = 'click_login';
    log('Looking for Login / Signup Login...');
    const loginSelectors = [
      'a:has-text("Signup / Login")',
      'a:has-text("Login")',
      'button:has-text("Login")',
      '[data-testid*="login"]',
      'a[href*="login"]',
    ];
    let loginClicked = false;
    for (const sel of loginSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          loginClicked = true;
          log('Clicked login entry.');
          break;
        }
      } catch (_) {}
    }
    if (!loginClicked) {
      throw new Error('Could not find Login / Signup Login button');
    }
    await new Promise((r) => setTimeout(r, 2000));

    // Step 3: Search for Flattrade and select it
    status.step = 'select_flattrade';
    log('Searching for Flattrade broker...');
    const searchSelectors = [
      'input[placeholder*="search" i]',
      'input[type="search"]',
      'input[aria-label*="search" i]',
      'input',
    ];
    let searchFilled = false;
    for (const sel of searchSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill('flattrade');
          searchFilled = true;
          log('Entered "flattrade" in search.');
          break;
        }
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 1500));

    // Quantman shows a broker list item first; the Client ID form only appears after selecting it.
    const flattradeOption = page.locator('#broker-flattrade, [id="broker-flattrade"], .broker-list-view').filter({ has: page.getByText(/flattrade/i) }).first();
    if (await flattradeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await flattradeOption.click();
      log('Selected Flattrade broker entry.');
    } else {
      throw new Error('Could not find Flattrade in broker list');
    }
    await new Promise((r) => setTimeout(r, 2000));

    // Step 4: Client ID (ss-1): fill and click Login
    status.step = 'client_id_and_login';
    log('Filling Client ID and clicking Login...');
    const clientIdSelectors = [
      '#flattrade-client-id',
      'input[placeholder*="Client" i]',
      'label:has-text("Client ID") + input',
      'input[name*="client" i]',
      'input[id*="client" i]',
    ];
    let clientIdFilled = false;
    for (const sel of clientIdSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill(clientId);
          clientIdFilled = true;
          log('Filled Client ID.');
          break;
        }
      } catch (_) {}
    }
    if (!clientIdFilled) {
      const anyInput = page.locator('input').first();
      if (await anyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await anyInput.fill(clientId);
        clientIdFilled = true;
      }
    }

    // Step 5: Click the Flattrade form Login and wait for auth page.
    status.step = 'auth_popup';
    const AUTH_WAIT_MS = 60000;
    const POLL_MS = 2000;
    const isAuthUrl = (url) => /auth\.flattrade|flattrade\.in/.test(String(url || ''));

    const clickedFlattradeLogin = await page.evaluate(() => {
      const selectors = [
        'button.main-button[form="flattrade-form"]',
        '#flattrade-form button.main-button',
        '#flattrade-form button[type="submit"]',
      ];
      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button instanceof HTMLElement) {
          button.click();
          return true;
        }
      }
      return false;
    });
    if (!clickedFlattradeLogin) {
      throw new Error('Could not find the Flattrade Login button for #flattrade-form');
    }
    log('Clicked Login (Quantman). Waiting for auth page (polling)...');

    let authPage = page;
    let useIframe = false;
    const deadline = Date.now() + AUTH_WAIT_MS;
    while (Date.now() < deadline) {
      const pages = context.pages();
      const newPage = pages.find((p) => p !== page && isAuthUrl(p.url()));
      if (newPage) {
        authPage = newPage;
        await authPage.waitForLoadState('domcontentloaded').catch(() => {});
        log('Auth opened in new tab.');
        break;
      }
      if (isAuthUrl(page.url())) {
        authPage = page;
        log('Auth opened in same tab.');
        break;
      }
      const frame = page.frameLocator('iframe[src*="flattrade"]').first();
      if (await frame.locator('input').first().isVisible({ timeout: 500 }).catch(() => false)) {
        useIframe = true;
        log('Auth opened in iframe.');
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (!isAuthUrl(authPage.url()) && !useIframe) {
      const hasNew = context.pages().some((p) => p !== page && isAuthUrl(p.url()));
      if (!hasNew) {
        status.error = 'Auth page did not open in 60s. Use "Login (visible)" to see the flow, or check Quantman/Flattrade.';
        log(`Error: ${status.error}`);
        return status;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));

    let authForm = authPage;
    const authFrame = authPage.frameLocator('iframe[src*="flattrade"]').first();
    if (useIframe || (await authPage.locator('iframe[src*="flattrade"]').first().isVisible({ timeout: 2000 }).catch(() => false))) {
      authForm = authFrame;
    }
    const isAuthPage = isAuthUrl(authPage.url()) || await authForm.locator('text=Log In').isVisible({ timeout: 5000 }).catch(() => false);
    if (!isAuthPage) {
      throw new Error('Auth page did not load (expected Flattrade Log In form)');
    }
    log('Auth page opened.');

    // Fill User ID, Password, OTP/TOTP on auth page (or inside iframe)
    const userInput = authForm.locator('input[placeholder*="User" i], input[name*="user" i], label:has-text("User ID") + input, input').first();
    await userInput.fill(userId);

    const passwordInputs = await authForm.locator('input[type="password"]').all();
    if (passwordInputs.length >= 1) {
      await passwordInputs[0].fill(password);
    }
    if (passwordInputs.length >= 2) {
      await passwordInputs[1].fill(totp);
    } else {
      const totpInput = authForm.locator('input[placeholder*="OTP" i], input[placeholder*="TOTP" i], input[name*="otp" i]').first();
      if (await totpInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await totpInput.fill(totp);
      }
    }
    log('Filled User ID, Password, OTP/TOTP.');

    const authLoginBtn = authForm.locator('button:has-text("Log In"), input[type="submit"][value*="Log" i]').first();
    await authLoginBtn.click();
    log('Clicked Log In on Flattrade auth.');

    // Wait for redirect/success (auth window may close or redirect)
    await new Promise((r) => setTimeout(r, 5000));
    const authUrl = authPage.url();
    const hasError = await authForm.getByText(/invalid|error|failed|incorrect/i).isVisible({ timeout: 3000 }).catch(() => false);
    if (hasError) {
      throw new Error('Flattrade auth showed an error message');
    }
    if (authUrl.includes('auth.flattrade') && !authUrl.includes('callback') && !authUrl.includes('success')) {
      await new Promise((r) => setTimeout(r, 5000));
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
