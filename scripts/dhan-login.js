/**
 * Quantman – Dhan broker login automation
 * Flow: Quantman /auth/dhan → Dhan login page (new tab or redirect):
 *   1. Mobile number → Proceed
 *   2. TOTP (6-digit boxes) → Proceed/Verify
 *   3. PIN  (6-digit boxes) → Continue/Submit → redirects back to Quantman
 *
 * NOTE: Dhan uses href="/auth/dhan" (external OAuth redirect), unlike Kotak NEO
 * which is self-authenticated inline. We navigate directly to /auth/dhan to bypass
 * the broker-selection modal (which gets dismissed by Escape in the popup-close logic).
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { generate } from 'otplib';

const QUANTMAN_URL     = 'https://www.quantman.trade/';
const DHAN_AUTH_URL    = 'https://www.quantman.trade/auth/dhan';
const AUTH_TIMEOUT_MS  = 120000;
const POPUP_WAIT_MS    = 30000;

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

/**
 * Fill a 6-digit code into individual OTP digit boxes or a single input.
 * Works on a page or frameLocator.
 */
async function fillOtpDigits(form, code) {
  const digits = String(code).replace(/\s/g, '').split('');

  // Try numeric inputmode boxes first
  const numericInputs = form.locator('input[inputmode="numeric"]');
  const numericCount  = await numericInputs.count();
  if (numericCount >= 6) {
    for (let i = 0; i < Math.min(digits.length, numericCount); i++) {
      await numericInputs.nth(i).fill(digits[i]);
    }
    return;
  }

  // Try single-character inputs (maxlength=1 or otp class)
  const singleInputs = form.locator('input[maxlength="1"], input.otp-input, input[class*="otp"], input[class*="digit"]');
  const singleCount  = await singleInputs.count();
  if (singleCount >= 6) {
    for (let i = 0; i < Math.min(digits.length, singleCount); i++) {
      await singleInputs.nth(i).fill(digits[i]);
    }
    return;
  }

  // Dhan uses bare input[type="tel"] boxes with NO other attributes (no id/name/class/inputmode)
  const telInputs = form.locator('input[type="tel"]');
  const telCount  = await telInputs.count();
  if (telCount >= 6) {
    for (let i = 0; i < Math.min(digits.length, telCount); i++) {
      await telInputs.nth(i).fill(digits[i]);
    }
    return;
  }

  // Fallback: single input field (fill entire code in one field)
  const singleField = form.locator('input[type="tel"], input[type="text"], input[type="number"]').first();
  if (await singleField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await singleField.fill(code);
  }
}

/** Click the first visible button that matches any of the text options. */
async function clickDhanButton(form, ...textOptions) {
  for (const text of textOptions) {
    try {
      const btn = form.locator(`button:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click({ force: true });
        return true;
      }
    } catch (_) {}
  }
  // Fallback: submit button
  try {
    const submitBtn = form.locator('button[type="submit"]').first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click({ force: true });
      return true;
    }
  } catch (_) {}
  return false;
}

export async function runDhanLogin(options = {}) {
  const headed  = options.headed ?? (process.env.HEADED === '1');
  const mobile  = options.mobile ?? options.userId ?? getEnv('DHAN_USER_ID');
  const totpRaw = options.totp ?? getEnv('DHAN_TOTP');
  const pin     = options.mpin ?? options.pin ?? getEnv('DHAN_MPIN');

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

    // Step 1: Navigate directly to Quantman's Dhan auth URL.
    // This bypasses the broker-selection modal (which gets closed by Escape
    // in the popup-close helpers) and goes straight to the Dhan OAuth redirect.
    status.step = 'open_dhan_auth';
    log('Navigating to Quantman Dhan auth URL...');
    await page.goto(DHAN_AUTH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    log(`Current URL: ${page.url()}`);

    // Step 2: Wait for redirect to Dhan's login page
    // Quantman /auth/dhan redirects to Dhan's partner/auth page.
    status.step = 'dhan_redirect';
    log('Waiting for Dhan login page...');
    let form = page;
    let onDhanPage = false;
    const deadline = Date.now() + POPUP_WAIT_MS;

    while (Date.now() < deadline) {
      const currentUrl = page.url().toLowerCase();
      log(`Checking URL: ${currentUrl}`);

      // Check if we're on Dhan's login page
      if (/dhan/i.test(currentUrl) && !currentUrl.includes('quantman.trade/auth/dhan')) {
        onDhanPage = true;
        form = page;
        log(`On Dhan login page: ${page.url()}`);
        break;
      }

      // Check new tab opened by Quantman
      const pages = context.pages();
      const dhanPage = pages.find((p) => p !== page && /dhan/i.test(p.url()));
      if (dhanPage) {
        await dhanPage.waitForLoadState('domcontentloaded').catch(() => {});
        form = dhanPage;
        onDhanPage = true;
        log(`Dhan auth in new tab: ${dhanPage.url()}`);
        break;
      }

      // Check if mobile input is visible (Dhan login page loaded)
      const mobileVisible = await page.locator(
        'input[type="tel"], input[placeholder*="Mobile" i], input[placeholder*="mobile" i], input[name*="mobile" i]'
      ).first().isVisible({ timeout: 1500 }).catch(() => false);
      if (mobileVisible) {
        onDhanPage = true;
        form = page;
        log(`Dhan mobile input visible at: ${page.url()}`);
        break;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!onDhanPage) {
      log(`Final URL: ${page.url()}`);
      // If we're still on Quantman, it might need Quantman login first
      // Try navigating to base Quantman page, log in with broker approach
      throw new Error(`Did not reach Dhan login page. Stuck at: ${page.url()}`);
    }

    await new Promise((r) => setTimeout(r, 1500));

    // Step 3: Fill mobile number → Proceed
    status.step = 'dhan_mobile';
    log('Filling mobile number...');
    const mobileInput = form.locator(
      'input[type="tel"], input[placeholder*="Mobile" i], input[name*="mobile" i], input[id*="mobile" i], input[placeholder*="phone" i]'
    ).first();
    const mobileDeadline = Date.now() + 15000;
    let mobileFilled = false;
    while (Date.now() < mobileDeadline) {
      if (await mobileInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mobileInput.fill(mobile);
        mobileFilled = true;
        log('Filled mobile number.');
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!mobileFilled) throw new Error('Could not find mobile number input');

    await new Promise((r) => setTimeout(r, 500));
    const proceedClicked = await clickDhanButton(form, 'Proceed', 'Next', 'Continue', 'Submit');
    if (!proceedClicked) throw new Error('Could not click Proceed on mobile step');
    log('Clicked Proceed (mobile).');
    await new Promise((r) => setTimeout(r, 2500));

    // Step 4: TOTP → Proceed/Verify
    status.step = 'dhan_totp';
    log('Waiting for TOTP field...');
    const totpCode = await getTotpCode(totpRaw);
    const totpDeadline = Date.now() + 20000;
    let totpFilled = false;
    while (Date.now() < totpDeadline) {
      const numericCount = await form.locator('input[inputmode="numeric"]').count();
      const singleCount  = await form.locator('input[maxlength="1"], input.otp-input, input[class*="otp"]').count();
      // Dhan uses bare input[type="tel"] boxes (no attributes)
      const telCount     = await form.locator('input[type="tel"]').count();
      if (numericCount >= 6 || singleCount >= 6 || telCount >= 6) {
        await fillOtpDigits(form, totpCode);
        totpFilled = true;
        log(`Filled TOTP (boxes: numeric=${numericCount} single=${singleCount} tel=${telCount}).`);
        break;
      }
      // Single TOTP field
      const singleTotp = form.locator(
        'input[placeholder*="TOTP" i], input[name*="totp" i], input[id*="totp" i]'
      ).first();
      if (await singleTotp.isVisible({ timeout: 1000 }).catch(() => false)) {
        await singleTotp.fill(totpCode);
        totpFilled = true;
        log('Filled TOTP (single field).');
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!totpFilled) throw new Error('Could not find TOTP input fields');
    await new Promise((r) => setTimeout(r, 500));
    const totpProceed = await clickDhanButton(form, 'Proceed', 'Verify', 'Continue', 'Submit', 'Next');
    if (!totpProceed) throw new Error('Could not click Proceed on TOTP step');
    log('Clicked Proceed (TOTP).');
    await new Promise((r) => setTimeout(r, 2500));

    // Step 5: PIN → Continue/Submit
    status.step = 'dhan_pin';
    log('Waiting for PIN field...');
    const pinDeadline = Date.now() + 20000;
    let pinFilled = false;
    while (Date.now() < pinDeadline) {
      const numericCount = await form.locator('input[inputmode="numeric"]').count();
      const singleCount  = await form.locator('input[maxlength="1"], input[type="password"], input.otp-input').count();
      // Dhan uses bare input[type="tel"] boxes (no attributes)
      const telCount     = await form.locator('input[type="tel"]').count();
      if (numericCount >= 4 || singleCount >= 4 || telCount >= 4) {
        await fillOtpDigits(form, pin);
        pinFilled = true;
        log(`Filled PIN (boxes: numeric=${numericCount} single=${singleCount} tel=${telCount}).`);
        break;
      }
      // Single PIN field
      const singlePin = form.locator(
        'input[placeholder*="PIN" i], input[name*="pin" i], input[id*="pin" i]'
      ).first();
      if (await singlePin.isVisible({ timeout: 1000 }).catch(() => false)) {
        await singlePin.fill(pin);
        pinFilled = true;
        log('Filled PIN (single field).');
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!pinFilled) throw new Error('Could not find PIN input fields');

    // Dhan auto-submits the PIN when the last digit is entered.
    // Wait briefly for the navigation/submission to happen.
    await new Promise((r) => setTimeout(r, 1500));

    // Only click Continue if still on the Dhan partner login page
    const stillOnDhan = /dhan/i.test(page.url()) && !/quantman/i.test(page.url());
    if (stillOnDhan) {
      const pinContinue = await clickDhanButton(form, 'Proceed', 'Continue', 'Submit', 'Login', 'Next');
      if (pinContinue) {
        log('Clicked Continue (PIN).');
      } else {
        log('No PIN button found — form may have auto-submitted.');
      }
    } else {
      log('PIN auto-submitted — already navigated away from Dhan.');
    }

    // Step 6: Wait for redirect back to Quantman
    status.step = 'dhan_redirect_back';
    log('Waiting for redirect back to Quantman...');
    const redirectDeadline = Date.now() + 30000;
    while (Date.now() < redirectDeadline) {
      const currentUrl = (form === page ? page : form).url().toLowerCase();
      if (/quantman/i.test(currentUrl)) {
        log('Redirected back to Quantman.');
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Step 7: Check for errors
    const checkPage = form === page ? page : page;
    const hasError = await checkPage
      .getByText(/invalid|error|failed|incorrect/i)
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (hasError) throw new Error('Dhan login showed an error message');

    status.step   = 'done';
    status.success = true;
    log('Dhan login completed.');
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
    const status = await runDhanLogin();
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
