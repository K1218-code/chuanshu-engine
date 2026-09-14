const { chromium } = require('playwright');
const path = require('node:path');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const output = 'C:\\Users\\vb732\\.codex\\visualizations\\2026\\09\\14\\01a0a17a-8968-78a2-b027-00d25c491487';
const label = process.argv[2] || 'after';
const baseUrl = process.env.HOME_QA_URL || 'http://127.0.0.1:8081/';

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('cs_guide_seen', '1'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.book-card').first().waitFor();
    const metrics = await page.evaluate(() => ({
      books: document.querySelectorAll('.book-card').length,
      entries: document.querySelectorAll('.entry').length,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      loginVisible: !document.querySelector('#login-btn').hidden,
      guideAvailable: !!document.querySelector('#guide-overlay'),
    }));
    await page.screenshot({ path: path.join(output, `chuanshu-engine-home-${label}-${viewport.name}.png`), fullPage: true });
    console.log(viewport.name, JSON.stringify({ ...metrics, consoleErrors: errors }));
    await page.close();
  }
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
