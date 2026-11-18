// Loads the extension, then moves a real pointer over each fixture of the 127.0.0.1 page.
const {chromium} = require('playwright');
(async () => {
  const [ext, dir, port] = process.argv.slice(2);
  const ctx = await chromium.launchPersistentContext(dir, {channel: 'chromium', headless: true,
    viewport: {width: 1440, height: 900}, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]});
  await new Promise(r => setTimeout(r, 6000));
  const page = ctx.pages().find(p => p.url().startsWith(`http://127.0.0.1:${port}`)) || await ctx.newPage();
  if (!page.url().startsWith(`http://127.0.0.1:${port}`)) await page.goto(`http://127.0.0.1:${port}/`);
  await page.bringToFront(); await page.waitForTimeout(3000);
  for (const box of await page.locator('[data-fx]').all()) {
    const b = await box.boundingBox(); await page.mouse.move(b.x + 10, b.y + b.height - 10);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {steps: 4}); await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1500); await ctx.close();
})();
