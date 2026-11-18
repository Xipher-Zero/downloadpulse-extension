const {chromium} = require('playwright');
(async () => {
  const [ext, dir, ms] = process.argv.slice(2);
  const ctx = await chromium.launchPersistentContext(dir, {channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]});
  await new Promise(r => setTimeout(r, Number(ms)));
  await ctx.close();
})();
