// SPDX-License-Identifier: GPL-2.0-or-later
// WS-X1 part 2 (1.0.8): on web pages with more than one DownloadPulse -- the hover, video and
// selection buttons become [↓|▾]; ↓ sends to the default, ▾ lists the servers in the same closed
// layer (an unreachable one can't be chosen; keyboard; a press counts only once the list has stood
// still, as the button's does). Against fake DownloadPulses on 8095 and random ports and the fake
// site. Same port rule as onboarding.spec.mjs: run in a private network namespace locally.
import {test, expect, chromium} from "@playwright/test";
import net from "node:net";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fakeDownloadPulse} from "./fake-downloadpulse.mjs";
import {fakeSite} from "./fake-site.mjs";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/chromium");

test.beforeAll(async () => {
  const free = await new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true))).listen(8095, "127.0.0.1");
  });
  if (!free) throw new Error("127.0.0.1:8095 is in use. Refusing to run where a real DownloadPulse may answer.");
});

let dp, others, site, context, profile, worker, popup;

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  others = [];
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-servers-page-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1100, height: 800},
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  await popup.getByRole("button", {name: "Not now"}).click({timeout: 15_000});
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
});

test.afterEach(async () => {
  await context.close();
  await rm(profile, {recursive: true, force: true});
  await dp.close();
  for (const fake of others) await fake.close();
  await site.close();
});

async function addServer() {
  const fake = await fakeDownloadPulse();
  others.push(fake);
  await popup.getByTestId("add-server").click();
  await expect(popup.locator('section[data-state="not_found"]')).toBeVisible({timeout: 10_000});
  await popup.getByLabel("Server address").filter({visible: true}).fill(`http://localhost:${fake.port}`);
  await popup.getByRole("button", {name: "Connect to this server"}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  fake.answer("approved");
  await expect(popup.locator('section[data-state="connected"]')).toBeVisible({timeout: 15_000});
  return fake;
}

const layers = (page) => page.evaluate(() => [...document.querySelectorAll(":root > div[popover]")]
  .filter((host) => host.matches(":popover-open") && host.style.bottom !== "16px").map((host) => {
    const r = host.getBoundingClientRect();
    return {left: r.left, top: r.top, width: r.width, height: r.height};
  }));
const recordToasts = () => worker.evaluate(() => {
  globalThis.toasts = [];
  const send = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = (tab, value, options) => {
    if (value?.type === "dp-toast") globalThis.toasts.push(value.text);
    return send(tab, value, options);
  };
});

async function sitePage() {
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  await page.waitForTimeout(300);
  return page;
}

/** Hover a link until its layer is up; the layer's box. */
async function hoverLink(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(async () => (await layers(page)).length).toBe(1);
  return (await layers(page))[0];
}

// The layer's parts: ↓ (22 px), ▾ (14 px) beside it; the list under them, one 26 px line per server.
const down = (layer) => ({x: layer.left + 11, y: layer.top + 11});
const more = (layer) => ({x: layer.left + 29, y: layer.top + 11});
const entry = (layer, index) => ({x: layer.left + 40, y: layer.top + 44 + 26 * index});

async function press(page, at, wait = 400) {
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(wait);
  await page.mouse.click(at.x, at.y);
}

test("one server: the button as before; two: [↓|▾], ↓ to the default, the list choosing another", async () => {
  test.setTimeout(90_000);
  let page = await sitePage();
  expect((await hoverLink(page, "#zip")).width).toBeLessThan(24);         // one server: the plain button
  await page.close();
  const b = await addServer();
  await recordToasts();
  page = await sitePage();
  let layer = await hoverLink(page, "#zip");
  expect(Math.round(layer.width)).toBe(36);                              // [↓|▾]
  // ↓: the default.
  await press(page, down(layer));
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(b.state.jobs.length).toBe(0);
  await expect.poll(() => worker.evaluate(() => globalThis.toasts)).toContain("Sent to localhost.");
  // ▾: the list, in the same layer.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  layer = await hoverLink(page, "#zip");
  await press(page, more(layer));
  await expect.poll(async () => (await layers(page))[0]?.height ?? 0).toBeGreaterThan(70);
  layer = (await layers(page))[0];
  // A press as soon as the list opens doesn't count: it must have stood still to be seen.
  await press(page, entry(layer, 1), 400);
  await expect.poll(() => b.state.jobs.length).toBe(1);
  expect(b.state.jobs[0].body.source).toEqual({kind: "links", links: [`${site.base}/files/archive.zip`]});
  expect(dp.state.jobs.length).toBe(1);
  await expect.poll(() => worker.evaluate(() => globalThis.toasts)).toContain("Sent to localhost 2.");
});

test("a list entry pressed too soon after the list opened does nothing; an unreachable server can't be chosen", async () => {
  test.setTimeout(90_000);
  const b = await addServer();
  const c = await addServer();
  let page = await sitePage();
  let layer = await hoverLink(page, "#zip");
  await press(page, more(layer));
  await expect.poll(async () => (await layers(page))[0]?.height ?? 0).toBeGreaterThan(90);
  layer = (await layers(page))[0];
  await page.mouse.click(entry(layer, 1).x, entry(layer, 1).y);         // at once: too soon
  await page.waitForTimeout(800);
  expect(b.state.jobs.length).toBe(0);
  // Stopped: shown in the list, but it can't be chosen.
  await c.close();
  await page.close();
  await expect(popup.getByTestId("reach-text")).toHaveText("2 of 3 connected", {timeout: 20_000});
  await popup.waitForTimeout(5500);                                     // a frame's answer is kept 5 s
  page = await sitePage();
  layer = await hoverLink(page, "#zip");
  await press(page, more(layer));
  await expect.poll(async () => (await layers(page))[0]?.height ?? 0).toBeGreaterThan(90);
  layer = (await layers(page))[0];
  await press(page, entry(layer, 2));
  await page.waitForTimeout(800);
  expect([dp.state.jobs.length, b.state.jobs.length]).toEqual([0, 0]);
  expect((await layers(page)).length).toBe(1);                          // still open: nothing happened
});

test("the list with the keyboard: the first server has the focus, arrows move, Enter sends, Esc closes", async () => {
  test.setTimeout(90_000);
  const b = await addServer();
  const page = await sitePage();
  let layer = await hoverLink(page, "#zip");
  await press(page, more(layer));
  await expect.poll(async () => (await layers(page))[0]?.height ?? 0).toBeGreaterThan(70);
  await page.keyboard.press("Escape");
  await expect.poll(async () => Math.round((await layers(page))[0]?.height ?? 0)).toBe(22);
  layer = (await layers(page))[0];
  await press(page, more(layer));
  await expect.poll(async () => (await layers(page))[0]?.height ?? 0).toBeGreaterThan(70);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await expect.poll(() => b.state.jobs.length).toBe(1);
  expect(dp.state.jobs.length).toBe(0);
});

test("the selection's button and the video's get [↓|▾] too", async () => {
  test.setTimeout(90_000);
  const b = await addServer();
  const page = await sitePage();
  // A selection of links, made by the person (their key after it).
  await page.locator("#live").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#live"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press("Shift");
  await expect.poll(async () => (await layers(page)).length).toBe(1);
  let layer = (await layers(page))[0];
  expect(Math.round(layer.width)).toBe(36);
  await press(page, more(layer));
  await expect.poll(async () => (await layers(page))[0]?.height ?? 0).toBeGreaterThan(70);
  layer = (await layers(page))[0];
  await press(page, entry(layer, 1));
  await expect.poll(() => b.state.jobs.length).toBe(1);
  expect(b.state.jobs[0].body.source.kind).toBe("links");
  expect(b.state.jobs[0].body.source.links.length).toBeGreaterThan(1);
  expect(dp.state.jobs.length).toBe(0);
  // The video's button.
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator("#video").scrollIntoViewIfNeeded();
  const box = await page.locator("#video").boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40, {steps: 3});
  await expect.poll(async () => (await layers(page)).length).toBe(1);
  layer = (await layers(page))[0];
  expect(Math.round(layer.width)).toBe(36);
  await page.mouse.move(layer.left - 2, layer.top + 11, {steps: 2});
  await press(page, more(layer));
  await expect.poll(async () => (await layers(page))[0]?.height ?? 0).toBeGreaterThan(70);
  layer = (await layers(page))[0];
  await press(page, entry(layer, 1));
  await expect.poll(() => b.state.jobs.length).toBe(2);
  expect(b.state.jobs[1].body.source).toEqual({kind: "links", links: [`${site.base}/page`]});
});
