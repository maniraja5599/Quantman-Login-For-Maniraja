/**
 * Simple test to click the login button
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Opening Quantman...');
  await page.goto('https://www.quantman.trade/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  
  // Try clicking the login button directly
  console.log('Trying button.login-btn...');
  const btn = page.locator('button.login-btn');
  const isVisible = await btn.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('Button visible:', isVisible);
  
  if (isVisible) {
    await btn.click();
    console.log('Clicked login button!');
    await new Promise(r => setTimeout(r, 5000));
    
    // Check what opened
    console.log('Current URL:', page.url());
    const pages = await browser.contexts()[0].pages();
    console.log('Number of pages:', pages.length);
    
    // Look for broker search
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first();
    const searchVisible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
    console.log('Search input visible:', searchVisible);
    
    // Look for Kotak Neo
    const allText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log('Page text (first 2000 chars):', allText);
  }
  
  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
}

main().catch(console.error);
