/**
 * Debug script to see what's on the Quantman login page
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Opening Quantman...');
  await page.goto('https://www.quantman.trade/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  
  // Get all clickable elements with text
  const elements = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, button, [role="button"]'));
    return all
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim()?.substring(0, 50),
        href: el.href || null,
        id: el.id || null,
        classes: el.className?.substring(0, 100),
      }))
      .filter(el => el.text && el.text.length > 0);
  });
  
  console.log('\n=== Clickable elements found: ===');
  elements.forEach((el, i) => {
    console.log(`${i + 1}. <${el.tag}> "${el.text}"`);
    if (el.href) console.log(`   href: ${el.href}`);
    if (el.id) console.log(`   id: ${el.id}`);
    if (el.classes) console.log(`   class: ${el.classes}`);
  });
  
  // Look for login-related elements
  const loginElements = elements.filter(el => /login|sign\s*in|signin/i.test(el.text || ''));
  console.log('\n=== Login-related elements: ===');
  console.log(JSON.stringify(loginElements, null, 2));
  
  // Take screenshot
  await page.screenshot({ path: 'quantman-debug.png' });
  console.log('\nScreenshot saved to quantman-debug.png');
  
  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
}

main().catch(console.error);
