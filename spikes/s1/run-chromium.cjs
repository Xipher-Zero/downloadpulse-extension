const {chromium} = require('playwright');
(async () => {
  const ext = process.argv[2], dir = process.argv[3];
  const ctx = await chromium.launchPersistentContext(dir, {channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]});
  await new Promise(r => setTimeout(r, 12000));
  await ctx.close();
})();
