/**
 * Quantman – Kotak Neo broker login automation
 * Flow: Quantman → select Kotak Neo → Client ID + Login → popup:
 *   1. Registered Mobile + Client ID → Validate
 *   2. TOTP → Validate TOTP
 *   3. MPIN → Validate MPIN → done
 *
 * ENHANCED VERSION: Comprehensive debugging, robust selectors, and flexible detection
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

/** Aggressively close any modal/popup/banner on the page */
async function closePopups(page) {
  const selectors = [
    /* Existing selectors */
    '.tips-modal .close', '.tips-modal .close-btn',
    '.tips-modal button:has-text("Close")', '.tips-modal button:has-text("Got it")',
    '.tips-modal button:has-text("OK")',
    '.modal .close', '.modal .close-btn', '.modal-close', '.close-button',
    '[class*="modal"] .close', '[class*="modal"] .close-btn',
    '[class*="modal"] button:has-text("Close")',
    '[class*="modal"] button:has-text("Got it")',
    '[class*="modal"] button:has-text("OK")',
    '.overlay', '.backdrop',
    'button[aria-label="Close"]', '[aria-label="Close"]',
    '.dismiss-button', '.dismiss-btn',
    /* Enhanced selectors */
    '.tips-modal:not([hidden])',
    '.modal:not(.hidden):not(.d-none)',
    '[role="dialog"]:not([aria-hidden="true"])',
    '.overlay:not([style*="display: none"])',
    'button:has-text("Close")', 'button:has-text("Got it")', 'button:has-text("OK")',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ force: true, timeout: 1000 });
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (_) {}
  }
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  try {
    const body = page.locator('body');
    await body.click({ position: { x: 5, y: 5 }, force: true, timeout: 500 }).catch(() => {});
  } catch (_) {}
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

/** Enhanced button click with fallback */
async function clickKotakOtpFormButton(form, expectedText) {
  // Primary selector
  const primaryButton = form.locator('button.main-button[form="kotak_neo-otp-form"]').first();
  if (await primaryButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await primaryButton.click({ force: true });
    return;
  }
  
  // Fallback selectors
  const fallbackSelectors = [
    '#kotak_neo-otp-form button.main-button',
    '#kotak_neo-form button.main-button',
    'button.main-button',
    'button:has-text("Validate")',
    'button:has-text("Continue")',
    'button:has-text("Submit")',
    'button[type="submit"]',
  ];
  
  for (const selector of fallbackSelectors) {
    try {
      const button = form.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
        await button.click({ force: true });
        log(`Clicked button using fallback selector: ${selector}`);
        return;
      }
    } catch (_) {}
  }
  
  throw new Error(`Could not find Kotak button for "${expectedText}" step`);
}

/** Enhanced login button detection */
async function findAndClickLoginButton(page) {
  const loginSelectors = [
    /* Existing selectors */
    'button.login-btn',
    'button:has-text("Login With Broker")',
    'button:has-text("Signup / Login")',
    'button:has-text("Login")',
    'a:has-text("Signup / Login")',
    'a:has-text("Login")',
    'button:has-text("Sign In")',
    'a[href*="login"]',
    '[data-testid*="login"]',
    '.login-btn',
    '#login-btn',
    /* Enhanced selectors */
    '.login-button',
    '.signin-button',
    'button[onclick*="login"]',
    'button[onclick*="signin"]',
    '[data-login="true"]',
    '[data-control="login"]',
  ];
  
  let loginClicked = false;
  for (const sel of loginSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click({ force: true });
        loginClicked = true;
        log(`Clicked login entry using selector: ${sel}`);
        break;
      }
    } catch (_) {}
  }
  
  if (!loginClicked) {
    // Try clicking any visible login-like element
    const allLinks = await page.locator('a, button').all();
    for (const el of allLinks) {
      try {
        const text = await el.textContent();
        if (/login|sign\s*in|signin/i.test(text) && await el.isVisible().catch(() => false)) {
          await el.click({ force: true });
          loginClicked = true;
          log('Clicked login by text content (enhanced).');
          break;
        }
      } catch (_) {}
    }
  }
  
  if (!loginClicked) throw new Error('Could not find Login button');
  return loginClicked;
}

/** Enhanced form field detection */
async function findInputElement(form, fieldType) {
  const mobileSelectors = [
    '#kotak_neo-mobile-number',
    'input[name*="mobile"]',
    'input[placeholder*="Mobile" i]',
    'input[type="tel"]',
    '[data-field="mobile"]',
    'input[form="kotak_neo-otp-form"][name*="mobile"]',
  ];
  
  const clientIdSelectors = [
    '#kotak_neo-client-id',
    'input[name*="client"]',
    'input[placeholder*="Client" i]',
    'input[placeholder*="Customer" i]',
    '[data-field="client_id"]',
    'input[form="kotak_neo-otp-form"][name*="client"]',
  ];
  
  const totpSelectors = [
    '#kotak_neo-totp',
    'input[name*="totp"]',
    'input[placeholder*="TOTP" i]',
    'input[type="number"]',
    'input[maxlength="6"]',
    '[data-field="totp"]',
    'input[form="kotak_neo-otp-form"][name*="totp"]',
  ];
  
  const mpinSelectors = [
    '#kotak_neo-mpin',
    'input[name*="mpin"]',
    'input[placeholder*="MPIN" i]',
    'input[type="password"]:not([placeholder*="Password"])',
    'input[maxlength="4"]',
    '[data-field="mpin"]',
    'input[form="kotak_neo-otp-form"][name*="mpin"]',
  ];
  
  let selectors;
  switch (fieldType) {
    case 'mobile': selectors = mobileSelectors; break;
    case 'clientId': selectors = clientIdSelectors; break;
    case 'totp': selectors = totpSelectors; break;
    case 'mpin': selectors = mpinSelectors; break;
    default: return null;
  }
  
  for (const selector of selectors) {
    try {
      const input = form.locator(selector).first();
      if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
        log(`Found ${fieldType} input using selector: ${selector}`);
        return input;
      }
    } catch (_) {}
  }
  
  log(`No visible ${fieldType} input found with any selectors`);
  return null;
}

/** Enhanced popup detection */
async function findKotakPopup(context, page, deadline) {
  log('Starting enhanced popup detection...');
  let form = page;
  
  while (Date.now() < deadline) {
    const pages = context.pages();
    const kotakPage = pages.find((p) => p !== page && /kotak|neo\.kotak|kotaksecurities/i.test(p.url()));
    if (kotakPage) {
      await kotakPage.waitForLoadState('domcontentloaded').catch(() => {});
      form = kotakPage;
      log('Kotak auth in new tab (enhanced detection).');
      return { form, detected: 'new_tab' };
    }
    
    const kotakFrame = page.frameLocator('iframe[src*="kotak"], iframe[src*="neo"]').first();
    if (await kotakFrame.locator('input, button').first().isVisible({ timeout: 1500 }).catch(() => false)) {
      form = kotakFrame;
      log('Kotak auth in iframe (enhanced detection).');
      return { form, detected: 'iframe' };
    }
    
    // Quick page detection - check text on key elements only
    const textCheck = await page.locator('text=/Registered Mobile|Validate|Client ID|Validate TOTP|Validate MPIN/i').first().isVisible({ timeout: 1500 }).catch(() => false);
    if (textCheck) {
      form = page;
      log('Kotak auth detected on page (enhanced detection).');
      return { form, detected: 'page' };
    }
    
    await new Promise((r) => setTimeout(r, 1000));
  }
  
  log('No Kotak popup detected within timeout');
  return { form: page, detected: 'none' };
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

    // Step 2: Close any popups, then Click Login
    status.step = 'close_popups';
    log('Checking for blocking modals...');
    await closePopups(page);
    
    status.step = 'click_login';
    log('Looking for Login button...');
    await findAndClickLoginButton(page);
    await new Promise((r) => setTimeout(r, 2000));
    await closePopups(page);

    // Step 3: Search and select Kotak Neo using CTRL+K
    status.step = 'select_kotak_neo';
    log('Opening search with CTRL+K...');
    await page.keyboard.press('Control+k');
    await new Promise((r) => setTimeout(r, 1000));

    // Type "kotak neo" in the search
    log('Typing "kotak neo" in search...');
    await page.keyboard.type('kotak neo', { delay: 50 });
    await new Promise((r) => setTimeout(r, 2000));

    // Try to find and click Kotak Neo from search results
    const kotakSelectors = [
      '[id*="kotak"]',
      '.broker-item:has-text("Kotak Neo")',
      '.broker-card:has-text("Kotak Neo")',
      '.search-result:has-text("Kotak Neo")',
      'article:has-text("Kotak Neo")',
      'li:has-text("Kotak Neo")',
      'div:has-text("Kotak Neo")',
    ];

    let kotakFound = false;
    for (const selector of kotakSelectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          await el.click({ force: true });
          kotakFound = true;
          log(`Selected Kotak Neo using selector: ${selector}`);
          break;
        }
      } catch (_) {}
    }

    // Fallback: find any element with "Kotak Neo" text
    if (!kotakFound) {
      log('Fallback: searching for any element with "Kotak Neo" text...');
      const allVisible = page.locator('text=/Kotak.*Neo/i').first();
      if (await allVisible.isVisible({ timeout: 3000 }).catch(() => false)) {
        await allVisible.click({ force: true });
        kotakFound = true;
        log('Selected Kotak Neo using text fallback.');
      }
    }

    if (!kotakFound) {
      throw new Error('Could not find Kotak Neo in search results. Please verify: Open Quantman, press CTRL+K, search "kotak neo", check the results.');
    }
    await new Promise((r) => setTimeout(r, 2000));

    // Step 4: Fill Client ID on Quantman form and click Login
    status.step = 'client_id_and_login';
    const clientInput = await findInputElement(page, 'clientId');
    if (clientInput) {
      await clientInput.fill(clientId);
    }
    
    // Try multiple methods to find and click the login button
    const clicked = await page.evaluate(() => {
      const selectors = [
        'button.main-button[form="kotak_neo-otp-form"]',
        '#kotak_neo-otp-form button.main-button',
        '#kotak_neo-form button.main-button',
        'button.main-button',
        'button:has-text("Login")',
        'button:has-text("Submit")',
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

    // Step 5: Enhanced popup detection
    status.step = 'kotak_popup';
    const { form, detected } = await findKotakPopup(context, page, Date.now() + POPUP_WAIT_MS);
    if (detected === 'none') {
      throw new Error('Could not detect Kotak authentication popup after ' + POPUP_WAIT_MS + 'ms');
    }

    // Step 5a: Mobile + Client ID → Validate
    status.step = 'kotak_mobile';
    const mobileInput = await findInputElement(form, 'mobile');
    if (mobileInput) {
      await mobileInput.fill(mobile);
      log('Filled Registered Mobile Number.');
    }
    const clientIdPopup = await findInputElement(form, 'clientId');
    if (clientIdPopup) {
      await clientIdPopup.fill(clientId);
      log('Filled Client ID in popup.');
    }
    await clickKotakOtpFormButton(form, 'Validate');
    log('Clicked Validate.');
    await new Promise((r) => setTimeout(r, 3000));

    // Step 5b: TOTP → Validate TOTP
    status.step = 'validate_totp';
    const totpCode = await getTotpCode(totpRaw);
    const totpInput = await findInputElement(form, 'totp');
    const totpDeadline = Date.now() + 15000;
    while (Date.now() < totpDeadline) {
      if (totpInput && await totpInput.isVisible({ timeout: 2000 }).catch(() => false)) {
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
    const mpinInput = await findInputElement(form, 'mpin');
    const mpinDeadline = Date.now() + 15000;
    while (Date.now() < mpinDeadline) {
      if (mpinInput && await mpinInput.isVisible({ timeout: 2000 }).catch(() => false)) {
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
