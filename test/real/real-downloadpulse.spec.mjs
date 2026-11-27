// SPDX-License-Identifier: GPL-2.0-or-later
// WS-E1 against a REAL DebridPulse on 127.0.0.1:8095 (not part of ``npm test``):
// the extension connects, the approval page signs in and approves in the
// real Connect a browser dialog, and the popup shows the verified connection.
// Run it where that DebridPulse is a disposable test instance only, with
// DP_REAL_USER / DP_REAL_PASSWORD for its Admin:
//   npx playwright test --config playwright.real.config.mjs
import {test, expect, chromium} from "@playwright/test";
import http from "node:http";
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
    await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
    await popup.getByRole("button", {name: "Agree and continue"}).click();
    await popup.getByRole("button", {name: "Connect", exact: true}).click();
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
    await expect(popup.getByTestId("server")).toHaveText("Locally installed instance");
    await expect(popup.getByTestId("reach")).toHaveAttribute("data-reach", "ok", {timeout: 15_000});
    await expect(popup.getByTestId("account")).toHaveText("Administrator");

    // WS-E2 against the real browser jobs API: the hover icon sends a link, and
    // DebridPulse records it as this person's request, carried by this browser.
    // A page on a real http origin (content scripts don't run on about:blank).
    const server = http.createServer((_, res) => {
      res.writeHead(200, {"Content-Type": "text/html"});
      res.end('<p style="margin:40px"><a id="dl" href="https://203.0.113.30/real/file.iso">file.iso</a></p>');
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const site = await context.newPage();
    await site.goto(`http://127.0.0.1:${server.address().port}/`);
    const box = await site.locator("#dl").boundingBox();
    await site.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
    await expect.poll(() => site.evaluate(() => document.querySelectorAll(":root > div[popover]:popover-open").length)).toBe(1);
    const layer = await site.evaluate(() => {
      const r = document.querySelector(":root > div[popover]:popover-open").getBoundingClientRect();
      return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    });
    await site.mouse.move(layer.x, layer.y, {steps: 3});
    await site.waitForTimeout(400);   // a press counts once the button has stood still, seen (1.0.8)
    await site.mouse.click(layer.x, layer.y);
    const requests = async () => page.evaluate(async () =>
      (await (await window.debridPulseAuth.fetch("/api/requests")).json()).requests);
    await expect.poll(async () => (await requests()).length, {timeout: 20_000}).toBe(1);
    const [recorded] = await requests();
    const session = await page.evaluate(async () => (await (await window.debridPulseAuth.fetch("/api/account/browsers")).json()));
    expect(recorded.credential_id).toBe(session.browsers.find((b) => b.label === "E2E-Chromium").id);
    server.close();

    // WS-E3 against the real list: the popup shows that download, by name, in a real state.
    const listed = popup.locator(".dp-job", {hasText: "file.iso"});
    await expect(listed).toHaveCount(1, {timeout: 20_000});
    await expect(listed.locator(".dp-job__state")).toHaveText(/^(Waiting|Preparing|Downloading|Failed|Needs attention in DownloadPulse)/);

    // WS-E4 against the real server: Disconnect revokes this browser there.
    const settings = await context.newPage();
    await settings.goto(popup.url().replace("popup/popup.html", "options/options.html"));
    await settings.getByRole("button", {name: "Disconnect"}).click();
    await expect(settings.getByTestId("connection-note")).toHaveText("Disconnected. DownloadPulse no longer accepts this browser.");
    const remaining = await page.evaluate(async () =>
      (await (await window.debridPulseAuth.fetch("/api/account/browsers")).json()).browsers.map((b) => b.label));
    expect(remaining).not.toContain("E2E-Chromium");
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});
