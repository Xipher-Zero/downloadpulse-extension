// SPDX-License-Identifier: GPL-2.0-or-later
// WS-E2 submission surfaces in Chromium with the extension loaded, against a
// fake DownloadPulse (on 127.0.0.1:8095) and a fake website. Same port rule
// as onboarding.spec.mjs: run in a private network namespace locally.
import {test, expect, chromium} from "@playwright/test";
import net from "node:net";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fakeDownloadPulse} from "./fake-downloadpulse.mjs";
import {fakeSite, TORRENT} from "./fake-site.mjs";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/chromium");

test.beforeAll(async () => {
  const free = await new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true))).listen(8095, "127.0.0.1");
  });
  if (!free) throw new Error("127.0.0.1:8095 is in use. Refusing to run where a real DownloadPulse may answer.");
});

let dp, site, context, profile, extensionId;

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-surfaces-"));
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
  await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
  return popup;
}

async function sitePage() {
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  await page.waitForTimeout(300);
  return page;
}

/** The extension's open in-page layers (light-DOM hosts; their content is a closed shadow root). */
const openLayers = (page) => page.evaluate(() => [...document.querySelectorAll("downloadpulse-layer")]
  .filter((host) => host.matches(":popover-open")).map((host) => {
    const r = host.getBoundingClientRect();
    return {left: r.left, top: r.top, width: r.width, height: r.height};
  }));

async function hoverAndClick(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
  const [layer] = await openLayers(page);
  expect(layer.left).toBeGreaterThanOrEqual(box.x + box.width);   // beside the link, never over it
  await page.mouse.move(layer.left + layer.width / 2, layer.top + layer.height / 2, {steps: 3});
  await page.mouse.click(layer.left + layer.width / 2, layer.top + layer.height / 2);
}

test("the hover icon appears only beside download links and sends them", async () => {
  await connect();
  const page = await sitePage();
  const about = await page.locator("#about").boundingBox();
  await page.mouse.move(about.x + 5, about.y + about.height / 2, {steps: 3});
  await page.waitForTimeout(400);
  expect(await openLayers(page)).toEqual([]);                      // not a download: nothing offered
  await hoverAndClick(page, "#zip");
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "links", links: [`${site.base}/files/archive.zip`]});
  expect(dp.state.jobs[0].body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  await hoverAndClick(page, "#magnet");
  await expect.poll(() => dp.state.jobs.length).toBe(2);
  expect(dp.state.jobs[1].body.source).toEqual({kind: "magnet", magnet: `magnet:?xt=urn:btih:${"d".repeat(40)}&dn=thing`});
});

test("a .torrent behind a sign-in is captured with the site's cookie; its URL is never sent", async () => {
  await connect();
  const page = await sitePage();
  await context.addCookies([{name: "site_session", value: "signed-in", url: site.base}]);
  await hoverAndClick(page, "#torrent");
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  const {source} = dp.state.jobs[0].body;
  expect(source.kind).toBe("torrent");
  expect(source.filename).toBe("private.torrent");
  expect(Buffer.from(source.torrent_base64, "base64").equals(TORRENT)).toBe(true);
  expect(site.state.requests.find((r) => r.path.startsWith("/files/private.torrent")).cookie).toContain("site_session=signed-in");
  expect(JSON.stringify(dp.state.jobs)).not.toContain("SECRETPASSKEY");
  expect(dp.state.jobs[0].cookie).toBeNull();                       // DownloadPulse never gets the site's cookie
});

test("a sign-in page answering for a .torrent is refused, not sent", async () => {
  await connect();
  const page = await sitePage();
  await hoverAndClick(page, "#login");
  await expect.poll(() => site.state.requests.some((r) => r.path === "/files/needs-login.torrent")).toBe(true);
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);
});

test("a plain-text URL gets the icon beside it", async () => {
  await connect();
  const page = await sitePage();
  const text = await page.locator("#text").boundingBox();
  // Over the URL within the sentence ("Mirror: " is 8 characters in).
  await page.mouse.move(text.x + 120, text.y + text.height / 2, {steps: 3});
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
  const [layer] = await openLayers(page);
  await page.mouse.move(layer.left + 5, layer.top + 5, {steps: 3});
  await page.mouse.click(layer.left + layer.width / 2, layer.top + layer.height / 2);
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "links", links: ["https://203.0.113.20/releases/disc.iso"]});
});

test("the video button sends the page's own address", async () => {
  await connect();
  const page = await sitePage();
  const video = await page.locator("#video").boundingBox();
  await page.mouse.move(video.x + video.width / 2, video.y + video.height / 2, {steps: 3});
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
  const [layer] = await openLayers(page);
  expect(layer.left + layer.width).toBeLessThanOrEqual(video.x + video.width);   // inside the player's corner
  await page.mouse.move(layer.left + 5, layer.top + 5, {steps: 3});
  await page.mouse.click(layer.left + layer.width / 2, layer.top + layer.height / 2);
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "links", links: [`${site.base}/page`]});
  // A page's path ("page", YouTube's "watch") is no file name: none is sent.
  expect(dp.state.jobs[0].body.display_name).toBeUndefined();
});

test("not connected: nothing is offered on any page", async () => {
  const page = await sitePage();
  for (const selector of ["#zip", "#magnet", "#video"]) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  }
  await page.waitForTimeout(500);
  expect(await openLayers(page)).toEqual([]);
});

test("the token is in the extension's own storage, never where a content script can read it", async () => {
  const popup = await connect();
  const exposed = await popup.evaluate(async () => JSON.stringify([
    await chrome.storage.local.get(null), await chrome.storage.session.get(null)]));
  expect(exposed).not.toContain("dp_fake-token");
  const secret = await popup.evaluate(() => new Promise((done) => {
    const open = indexedDB.open("downloadpulse");
    open.onsuccess = () => {
      const read = open.result.transaction("secrets").objectStore("secrets").get("token");
      read.onsuccess = () => done(read.result);
    };
  }));
  expect(secret).toBe("dp_fake-token");
});

test("a WS-E1 token in storage is moved out on first read", async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.evaluate(() => chrome.storage.local.set({connection: {server: "http://127.0.0.1:8095", token: "dp_fake-token",
    tokenId: "tok-1", label: "Laptop-Chrome", account: "Una"}}));
  await popup.reload();
  await expect(popup.getByTestId("account")).toHaveText("Una");
  expect(JSON.stringify(await popup.evaluate(() => chrome.storage.local.get(null)))).not.toContain("dp_fake-token");
  // And it still works: a send goes through with it.
  const page = await sitePage();
  await hoverAndClick(page, "#zip");
  await expect.poll(() => dp.state.jobs.length).toBe(1);
});
