const { chromium } = require('playwright');
const path = require('node:path');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const output = 'C:\\Users\\vb732\\.codex\\visualizations\\2026\\09\\14\\01a0a17a-8968-78a2-b027-00d25c491487';
const baseUrl = process.env.UI_QA_URL || 'http://127.0.0.1:8081/';

const routes = [
  { name: 'home', path: '', ready: '.book-card' },
  { name: 'create', path: 'create.html', ready: '.opt' },
  { name: 'stories', path: 'stories.html', ready: '.story-row' },
  { name: 'game', path: 'game.html?book=wqd_xiaoshidi', ready: '#id-overlay:not([hidden])' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    for (const route of routes) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text());
      });
      await page.goto(new URL(route.path, baseUrl).href, { waitUntil: 'domcontentloaded' });
      if (route.name === 'home') {
        await page.evaluate(() => localStorage.setItem('cs_guide_seen', '1'));
        await page.reload({ waitUntil: 'networkidle' });
      }
      await page.locator(route.ready).first().waitFor({ timeout: 15000 });
      const metrics = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        loadedCovers: [...document.querySelectorAll('img')].filter(img => img.complete && img.naturalWidth > 0).length,
        imageElements: document.querySelectorAll('img').length,
        bookCards: document.querySelectorAll('.book-card').length,
        storyRows: document.querySelectorAll('.story-row').length,
        options: document.querySelectorAll('.opt').length,
        coverVariable: getComputedStyle(document.documentElement).getPropertyValue('--book-cover').trim(),
      }));
      await page.screenshot({ path: path.join(output, `chuanshu-ui-${route.name}-${viewport.name}.png`), fullPage: route.name !== 'game' });
      console.log(`${route.name}/${viewport.name}`, JSON.stringify({ ...metrics, consoleErrors: errors }));
      if (route.name === 'game') {
        await page.locator('.id-card').first().click();
        await page.locator('#prologue-overlay:not([hidden])').waitFor();
        await page.screenshot({ path: path.join(output, `chuanshu-ui-game-prologue-${viewport.name}.png`) });
        await page.locator('#btn-prologue-start').click();
        await page.locator('.stage').waitFor();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(output, `chuanshu-ui-game-stage-${viewport.name}.png`) });
        console.log(`game-flow/${viewport.name}`, JSON.stringify({
          prologueOpened: true,
          stageVisible: await page.locator('.stage').isVisible(),
          inputVisible: await page.locator('#input').isVisible(),
          consoleErrors: errors,
        }));
      }
      await page.close();
    }
  }
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
