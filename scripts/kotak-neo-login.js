/**
 * Quantman – Kotak Neo broker login automation
 * Flow: Quantman → select Kotak Neo → Client ID + Login → popup:
 *   1. Registered Mobile + Client ID → Validate
 *   2. TOTP → Validate TOTP
 *   3. MPIN → Validate MPIN → done
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { generate } from 'otplib';

const QUANTMAN_URL = 'https://www.quantman.trade/';
const AUTH_TIMEOUT_MS = 60000;
const POPUP_WAIT_MS = 60000;

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}. Set in .env or Settings.`);
  return v;
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

/** If totp is a base32 secret (e.g. from QR), generate current 6-digit code; else use as-is. */
async function getTotpCode(totp) {
  const s = String(totp).trim().replace(/\s/g, '');
  if (/^\d{6}$/.test(s)) return s;
  try {
    return await generate({ secret: s });
  } catch (_) {
    return s;
  }
}

async function clickKotakOtpFormButton(form, expectedText) {
  const button = form.locator('button.main-button[form="kotak_neo-otp-form"]').first();
  if (!(await button.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error(`Could not find Kotak button for "${expectedText}" step`);
  }
  await button.click({ force: true });
}

export async function runKotakNeoLogin(options = {}) {
  const headed = options.headed ?? (process.env.HEADED === '1');
  const clientId = options.clientId ?? getEnv('KOTAKNEO_CLIENT_ID');
  const mobile = options.mobile ?? options.userId ?? getEnv('KOTAKNEO_USER_ID');
  const totpRaw = options.totp ?? getEnv('KOTAKNEO_TOTP');
  const mpin = options.mpin ?? getEnv('KOTAKNEO_MPIN');

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

    // Step 2: Click Login
    status.step = 'click_login';
    const loginSelectors = ['a:has-text("Signup / Login")', 'a:has-text("Login")', 'button:has-text("Login")', 'a[href*="login"]'];
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
    if (!loginClicked) throw new Error('Could not find Login button');
    await new Promise((r) => setTimeout(r, 2000));

    // Step 3: Search and select Kotak Neo
    status.step = 'select_kotak_neo';
    log('Searching for Kotak Neo...');
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"], input').first();
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('kotak neo');
    }
    await new Promise((r) => setTimeout(r, 1500));

    const kotakOption = page.locator('#broker-kotak-neo, [id*="kotak"], .broker-list-view, article[data-broker*="kotak"]').filter({ has: page.getByText(/kotak/i) }).first();
    if (!(await kotakOption.isVisible({ timeout: 5000 }).catch(() => false))) {
      throw new Error('Could not find Kotak Neo in broker list');
    }
    await kotakOption.click();
    log('Selected Kotak Neo.');
    await new Promise((r) => setTimeout(r, 2000));

    // Step 4: Fill Client ID on Quantman form and click Login
    status.step = 'client_id_and_login';
    const clientInput = page.locator('#kotak_neo-client-id, #kotak-client-id, input[placeholder*="Client" i], input[placeholder*="Customer" i], label:has-text("Client ID") + input, input').first();
    if (await clientInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clientInput.fill(clientId);
    }
    const clicked = await page.evaluate(() => {
      const selectors = [
        'button.main-button[form="kotak_neo-otp-form"]',
        '#kotak_neo-otp-form button.main-button',
        '#kotak_neo-form button.main-button',
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
    if (!clicked) throw new Error('Could not find Kotak Neo Login button');
    log('Clicked Login. Waiting for Kotak popup...');

    // Step 5: Wait for Kotak popup (new tab, iframe, or modal)
    status.step = 'kotak_popup';
    let form = page;
    const deadline = Date.now() + POPUP_WAIT_MS;
    while (Date.now() < deadline) {
      const pages = context.pages();
      const kotakPage = pages.find((p) => p !== page && /kotak|neo\.kotak|kotaksecurities/i.test(p.url()));
      if (kotakPage) {
        await kotakPage.waitForLoadState('domcontentloaded').catch(() => {});
        form = kotakPage;
        log('Kotak auth in new tab.');
        break;
      }
      const kotakFrame = page.frameLocator('iframe[src*="kotak"], iframe[src*="neo"]').first();
      if (await kotakFrame.locator('input, button').first().isVisible({ timeout: 1500 }).catch(() => false)) {
        form = kotakFrame;
        log('Kotak auth in iframe.');
        break;
      }
      if (await page.getByText(/Registered Mobile Number|Validate|Client ID|Validate TOTP|Validate MPIN/i).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        form = page;
        log('Kotak auth on page.');
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Step 5a: Mobile + Client ID → Validate
    const mobileInput = form.locator('#kotak_neo-mobile-number, input[placeholder*="Mobile" i], input[name*="mobile" i], label:has-text("Registered Mobile") + input, label:has-text("Mobile") + input').first();
    if (await mobileInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await mobileInput.fill(mobile);
      log('Filled Registered Mobile Number.');
    }
    const clientIdPopup = form.locator('#kotak_neo-client-id, input[placeholder*="Client" i], input[name*="client" i], label:has-text("Client ID") + input').first();
    if (await clientIdPopup.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clientIdPopup.fill(clientId);
      log('Filled Client ID in popup.');
    }
    await clickKotakOtpFormButton(form, 'Validate');
    log('Clicked Validate.');
    await new Promise((r) => setTimeout(r, 3000));

    // Step 5b: TOTP → Validate TOTP
    status.step = 'validate_totp';
    const totpCode = await getTotpCode(totpRaw);
    const totpInput = form.locator('#kotak_neo-totp, input[placeholder*="TOTP" i], input[name*="totp" i], label:has-text("TOTP") + input').first();
    const totpDeadline = Date.now() + 15000;
    while (Date.now() < totpDeadline) {
      if (await totpInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await totpInput.fill(totpCode);
        log('Filled TOTP.');
        await clickKotakOtpFormButton(form, 'Validate TOTP');
        log('Clicked Validate TOTP.');
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 3000));

    // Step 5c: MPIN → Validate MPIN
    status.step = 'validate_mpin';
    const mpinInput = form.locator('#kotak_neo-mpin, input[placeholder*="MPIN" i], input[name*="mpin" i], label:has-text("MPIN") + input').first();
    const mpinDeadline = Date.now() + 15000;
    while (Date.now() < mpinDeadline) {
      if (await mpinInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mpinInput.fill(mpin);
        log('Filled MPIN.');
        await clickKotakOtpFormButton(form, 'Validate MPIN');
        log('Clicked Validate MPIN.');
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    await new Promise((r) => setTimeout(r, 5000));
    const hasError = await form.getByText(/invalid|error|failed|incorrect/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (hasError) {
      throw new Error('Kotak Neo auth showed an error message');
    }

    status.step = 'done';
    status.success = true;
    log('Kotak Neo login completed.');
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
    const status = await runKotakNeoLogin();
    console.log(JSON.stringify(status, null, 2));
    process.exit(status.success ? 0 : 1);
  } catch (err) {
    console.error(err);
    console.log(JSON.stringify({ success: false, step: null, error: err.message }, null, 2));
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) main();
