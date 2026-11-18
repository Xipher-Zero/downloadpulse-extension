// SPDX-License-Identifier: GPL-2.0-or-later
// WS-E1 against a REAL DebridPulse on 127.0.0.1:8095 (not part of ``npm test``):
// the extension connects, the approval page signs in and approves in the
// real Connect a browser dialog, and the popup shows the verified connection.
// Run it where that DebridPulse is a disposable test instance only, with
// DP_REAL_USER / DP_REAL_PASSWORD for its Admin:
//   npx playwright test --config playwright.real.config.mjs
import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/chromium");

test("connect to a real DownloadPulse: sign in, approve, verified", async () => {
  test.setTimeout(120_000);
  const profile = await mkdtemp(join(tmpdir(), "dp-ext-real-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
    const approval = context.waitForEvent("page");
    await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
    await expect(popup.getByTestId("code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, {timeout: 15_000});
    const code = await popup.getByTestId("code").textContent();
    const page = await approval;
    await page.waitForURL(/\/login/);
    await page.locator("#username").fill(process.env.DP_REAL_USER || "");
    await page.locator("#password").fill(process.env.DP_REAL_PASSWORD || "");
    await page.locator('button[type="submit"]').click();
    const dialog = page.locator(".dp-browser-pairing-dialog");
    await expect(dialog.locator("[data-pairing-code]")).toHaveText(String(code));
    await dialog.locator("[data-pairing-name]").fill("E2E-Chromium");
    await dialog.getByRole("button", {name: "Connect", exact: true}).click();
    await expect(popup.getByTestId("label")).toHaveText("E2E-Chromium", {timeout: 20_000});
    await expect(popup.getByTestId("server")).toHaveText("http://127.0.0.1:8095");
    await expect(popup.getByTestId("account")).toHaveText("Administrator");
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});
