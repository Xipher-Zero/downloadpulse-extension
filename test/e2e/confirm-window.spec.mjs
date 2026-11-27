// SPDX-License-Identifier: GPL-2.0-or-later
// 1.0.8 (WS-A3): in Firefox, a press on an in-page button never sends by itself: DownloadPulse's
// own small window shows the site and the links, and only Send there sends (background/confirm.ts).
// Driven here in Chromium, with a test build that confirms in every browser
// (DP_CONFIRM_EVERYWHERE=1 -> dist/test-confirm, built below). Same port rule as onboarding.spec.mjs.
import {test, expect, chromium} from "@playwright/test";
import net from "node:net";
import {execFileSync} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fakeDownloadPulse} from "./fake-downloadpulse.mjs";
import {fakeSite} from "./fake-site.mjs";

const EXT = resolve("dist/test-confirm/chromium");

test.beforeAll(async () => {
  const free = await new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true))).listen(8095, "127.0.0.1");
  });
  if (!free) throw new Error("127.0.0.1:8095 is in use. Refusing to run where a real DownloadPulse may answer.");
  execFileSync(process.execPath, ["scripts/build.mjs"], {env: {...process.env, DP_CONFIRM_EVERYWHERE: "1"}, stdio: "ignore"});
});

let dp, site, context, profile, extensionId;

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-confirm-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1100, height: 800},
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
});

test.afterEach(async () => {
  await context.close();
  await rm(profile, {recursive: true, force: true});
  await dp.close();
  await site.close();
});

async function connect() {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  await popup.getByRole("button", {name: "Not now"}).click({timeout: 15_000});
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
  await popup.close();
}

async function open(path) {
  const page = await context.newPage();
  await page.goto(`${site.base}${path}`);
  await page.waitForTimeout(300);
  return page;
}

const buttons = (page) => page.evaluate(() => [...document.documentElement.children]
  .filter((host) => host.localName === "div" && host.matches(":popover-open") && host.style.bottom !== "16px").map((host) => {
    const r = host.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  }));
const confirmations = () => context.pages().filter((page) => page.url().includes("/confirm/confirm.html"));

/** The person's hover and press on a link's button: answered by a confirmation window. */
async function press(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(async () => (await buttons(page)).length).toBe(1);
  const [at] = await buttons(page);
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(400);
  await page.mouse.click(at.x, at.y);
}

test("a press opens DownloadPulse's window with the site and the link; only Send there sends", async () => {
  await connect();
  const page = await open("/page");
  const asked = context.waitForEvent("page");
  await press(page, "#magnet");
  const window = await asked;
  await window.waitForLoadState();
  // Send waits a moment before it answers (a window that comes up under a press already on its way can't catch it).
  const send = window.getByRole("button", {name: "Send", exact: true});
  await expect(send).toBeDisabled({timeout: 300});
  await expect(window.getByRole("heading", {name: "Send to DownloadPulse?"})).toBeVisible();
  await expect(window.getByTestId("site")).toHaveText(`Site: ${new URL(site.base).host}`);
  await expect(window.getByTestId("count")).toHaveText("Links: 1");
  await expect(window.getByTestId("links")).toHaveText(`magnet:?xt=urn:btih:${"d".repeat(40)}&dn=thing`);
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);                                 // nothing sent by the press itself
  await expect(send).toBeEnabled();
  const closed = window.waitForEvent("close");
  await send.click();
  await closed;
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "magnet", magnet: `magnet:?xt=urn:btih:${"d".repeat(40)}&dn=thing`});
});

test("Cancel, or closing the window, sends nothing; one window at a time per tab", async () => {
  await connect();
  const page = await open("/page");
  let asked = context.waitForEvent("page");
  await press(page, "#zip");
  let window = await asked;
  await window.waitForLoadState();
  // Pressed again while the tab's window is open: no second window.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  await press(page, "#magnet");
  await page.waitForTimeout(1000);
  expect(confirmations().length).toBe(1);
  let closed = window.waitForEvent("close");
  await window.getByRole("button", {name: "Cancel"}).click();
  await closed;
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);
  // Closed without an answer.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  asked = context.waitForEvent("page");
  await press(page, "#zip");
  window = await asked;
  await window.waitForLoadState();
  await window.close();
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);
  // The next press asks again (the closed one is forgotten).
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  asked = context.waitForEvent("page");
  await press(page, "#zip");
  window = await asked;
  await window.waitForLoadState();
  await expect(window.getByTestId("count")).toHaveText("Links: 1");
});

test("a selection's batch is confirmed with its links listed", async () => {
  await connect();
  const page = await open("/page");
  await page.locator("#live").scrollIntoViewIfNeeded();
  const live = await page.locator("#live").boundingBox();
  await page.mouse.move(live.x + 1, live.y + 4);
  await page.mouse.down();
  await page.mouse.move(live.x + live.width - 2, live.y + live.height - 4, {steps: 10});
  await page.mouse.up();
  await page.waitForTimeout(600);
  await expect.poll(async () => (await buttons(page)).length).toBe(1);
  const [at] = await buttons(page);
  const asked = context.waitForEvent("page");
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(300);
  await page.mouse.click(at.x, at.y);
  const window = await asked;
  await window.waitForLoadState();
  await expect(window.getByTestId("count")).toHaveText("Links: 3");
  await expect(window.getByTestId("links").locator("li")).toHaveText(["https://1fichier.com/?j93yc0n4g08jsox2nipk",
    "https://rapidgator.net/file/119ce5/GF161126-HITC-RN.rar.html", "https://gofile.io/d/AM5Js2xh"]);
  expect(dp.state.jobs).toEqual([]);
  const send = window.getByRole("button", {name: "Send", exact: true});
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source.links.length).toBe(3);
});

test("the audit's hostile page opens no window and sends nothing", async () => {
  await connect();
  const page = await open("/hostile");
  await page.evaluate(() => window.attack());
  await page.waitForTimeout(1500);
  expect(confirmations()).toEqual([]);
  expect(dp.state.jobs).toEqual([]);
});

test("with two servers (WS-X1), the window names the one chosen in the page's list, and it goes there only", async () => {
  test.setTimeout(90_000);
  await connect();
  const second = await fakeDownloadPulse();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.getByTestId("add-server").click();
    await expect(popup.locator('section[data-state="not_found"]')).toBeVisible({timeout: 10_000});
    await popup.getByLabel("Server address").filter({visible: true}).fill(`http://localhost:${second.port}`);
    await popup.getByRole("button", {name: "Connect to this server"}).click();
    await expect(popup.getByTestId("code")).toBeVisible();
    second.answer("approved");
    await expect(popup.locator('section[data-state="connected"]')).toBeVisible({timeout: 15_000});
    await popup.close();
    const page = await open("/page");
    const box = await page.locator("#magnet").boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
    const layer = () => page.evaluate(() => {
      const host = [...document.documentElement.children].find((item) => item.localName === "div" && item.matches(":popover-open"));
      const r = host.getBoundingClientRect();
      return {left: r.left, top: r.top, height: r.height};
    });
    await expect.poll(async () => (await buttons(page)).length).toBe(1);
    let at = await layer();
    await page.mouse.move(at.left + 29, at.top + 11, {steps: 3});
    await page.waitForTimeout(400);
    await page.mouse.click(at.left + 29, at.top + 11);                  // ▾
    await expect.poll(async () => (await layer()).height).toBeGreaterThan(70);
    at = await layer();
    const asked = context.waitForEvent("page");
    await page.mouse.move(at.left + 40, at.top + 70, {steps: 2});
    await page.waitForTimeout(400);
    await page.mouse.click(at.left + 40, at.top + 70);                  // the second server
    const window = await asked;
    await window.waitForLoadState();
    await expect(window.getByTestId("to")).toHaveText("To: localhost 2");
    await page.waitForTimeout(800);
    const closed = window.waitForEvent("close");
    await window.getByRole("button", {name: "Send", exact: true}).click();
    await closed;
    await expect.poll(() => second.state.jobs.length).toBe(1);
    expect(dp.state.jobs).toEqual([]);
  } finally {
    await second.close();
  }
});
