// SPDX-License-Identifier: GPL-2.0-or-later
// WS-X1 (1.0.8): more than one DownloadPulse server, against two or three fake DownloadPulses on
// different ports (the first on 8095, as "this computer"), one of them stopped or never
// answering for the unreachable paths. The page split buttons and the right-click submenu are
// part 2. Same port rule as onboarding.spec.mjs: run in a private network namespace locally.
//
// DP_BASELINE_EXT (optional): an unpacked 1.0.7 Chromium build; with it, one server's popup
// and settings are compared with 1.0.7's.
import {test, expect, chromium} from "@playwright/test";
import net from "node:net";
import {cp, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fakeDownloadPulse} from "./fake-downloadpulse.mjs";
import {fakeSite} from "./fake-site.mjs";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/chromium");
const BASELINE = process.env.DP_BASELINE_EXT ? resolve(process.env.DP_BASELINE_EXT) : null;
const A = "http://127.0.0.1:8095";

test.beforeAll(async () => {
  const free = await new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true))).listen(8095, "127.0.0.1");
  });
  if (!free) throw new Error("127.0.0.1:8095 is in use. Refusing to run where a real DownloadPulse may answer.");
});

let dp, others, site, context, profile, worker, base, popup, copies;

async function launch(extension, {granted = false} = {}) {
  let dir = extension;
  if (granted) {
    // As capture.spec.mjs: "downloads" granted at load (the browser's own prompt can't be answered).
    dir = await mkdtemp(join(tmpdir(), "dp-ext-servers-build-"));
    copies.push(dir);
    await cp(extension, dir, {recursive: true});
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    manifest.permissions = [...manifest.permissions, "downloads"];
    delete manifest.optional_permissions;
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  }
  profile = await mkdtemp(join(tmpdir(), "dp-ext-servers-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1000, height: 800}, acceptDownloads: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  base = `chrome-extension://${new URL(worker.url()).host}`;
  popup = await context.newPage();
  await popup.goto(`${base}/popup/popup.html`);
}

/** The first server, as a person connects one: this computer's (the fake on 8095). */
async function connectFirst(offer = "Not now") {
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  await popup.getByRole("button", {name: offer}).click({timeout: 15_000});
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
}

/** One more server through [+]: discovery (this computer's is connected already), then its address. */
async function addServer(fake) {
  await popup.getByTestId("add-server").click();
  await expect(popup.locator('section[data-state="not_found"]')).toBeVisible({timeout: 10_000});
  await popup.getByLabel("Server address").filter({visible: true}).fill(`http://localhost:${fake.port}`);
  await popup.getByRole("button", {name: "Connect to this server"}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  fake.answer("approved");
  await expect(popup.locator('section[data-state="connected"]')).toBeVisible({timeout: 15_000});
}

async function withServers(count, options = {}) {
  await launch(EXT, options);
  await connectFirst(options.offer);
  for (let index = 1; index < count; index++) {
    const fake = await fakeDownloadPulse();
    others.push(fake);
    await addServer(fake);
  }
  await expect(popup.getByTestId("dots").locator(".dp-conn__dot")).toHaveCount(count);
}

const origin = (fake) => `http://localhost:${fake.port}`;
const stored = (keys) => popup.evaluate((names) => chrome.storage.local.get(names), keys);
const expand = async () => {
  const toggle = popup.getByRole("button", {name: "Connection details"});
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
};
const block = (server) => popup.locator(`li.dp-server[data-server="${server}"]`);
const blockNames = () => popup.locator("li.dp-server .dp-server__name").allTextContents();
const tokenSlot = (server) => popup.evaluate((name) => new Promise((done) => {
  const open = indexedDB.open("downloadpulse");
  open.onsuccess = () => {
    const read = open.result.transaction("secrets").objectStore("secrets").get(`token@${name}`);
    read.onsuccess = () => done(read.result ?? null);
  };
}), server);

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  others = [];
  copies = [];
  site = await fakeSite();
});

test.afterEach(async () => {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
  for (const dir of copies) await rm(dir, {recursive: true, force: true});
  await dp.close();
  for (const fake of others) await fake.close();
  await site.close();
});

test("one server: the main view and the settings as 1.0.7, apart from [+]", async () => {
  await launch(EXT);
  await connectFirst();
  const add = popup.getByTestId("add-server");
  await expect(add).toBeVisible();
  await expect(add).toHaveAttribute("aria-disabled", "false");
  await expect(add).toHaveAttribute("title", "Connect another DownloadPulse");
  await expect(add.locator("svg[data-glyph='plus']")).toHaveCount(1);
  await expect(popup.getByTestId("dots").locator(".dp-conn__dot")).toHaveCount(1);
  await expect(popup.getByTestId("reach-text")).toHaveText("Connected", {timeout: 15_000});
  await expect(popup.getByTestId("quick-more")).toBeHidden();
  await expect(popup.getByTestId("open-server")).not.toHaveAttribute("aria-haspopup", "menu");
  await expect(popup.getByTestId("capture-main-label")).toHaveText("Send browser downloads to DownloadPulse");
  await expand();
  await expect(popup.locator("#facts")).toBeVisible();
  await expect(popup.getByTestId("servers")).toBeHidden();
  await popup.locator("#quick").fill("https://example.com/one.iso");
  await popup.getByRole("button", {name: "Add", exact: true}).click();
  await expect(popup.getByTestId("quick-result")).toHaveText("Added to DownloadPulse");
  await expect(popup.locator("li[data-job-id]")).toHaveCount(1, {timeout: 10_000});
  await expect(popup.getByTestId("job-server")).toHaveCount(0);
  await popup.getByRole("button", {name: "Settings"}).click();
  await expect(popup.locator("#connection-title")).toHaveText("Connection:");
  await expect(popup.locator("[data-connection='multi']")).toBeHidden();
  await expect(popup.getByTestId("settings-server")).toHaveText("Locally installed instance");
  // The upgrade's storage (WS-X1): the one server named after its host, first, the default.
  await expect.poll(async () => (await stored(["serverOrder", "activeServer"]))).toEqual({serverOrder: [A], activeServer: A});
});

test("one server compared with 1.0.7: the same popup and settings, apart from [+]", async () => {
  test.skip(!BASELINE, "DP_BASELINE_EXT (a 1.0.7 build) not given");
  const capture = async () => {
    await connectFirst();
    await expect(popup.getByTestId("reach-text")).toHaveText("Connected", {timeout: 15_000});
    await popup.getByRole("button", {name: "Connection details"}).click();
    const boxes = await popup.evaluate(() => Object.fromEntries(["[data-testid='reach']", "[data-action='details']", "#facts", "#quick",
      "form[data-action='quick-add'] button", "[data-testid='capture-main']", "[data-testid='open-server']", "[data-testid='clear-list']"]
      .map((selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return [selector, [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]];
      })));
    await popup.getByRole("button", {name: "Settings"}).click();
    await expect(popup.locator('[data-notify="completed"]')).toBeEnabled();
    await expect(popup.getByTestId("site-switch")).toBeVisible().catch(() => undefined);
    const settingsAria = await popup.locator("[data-view='settings']").ariaSnapshot();
    await popup.getByRole("button", {name: "Back"}).click();
    await expect(popup.locator("#facts")).toBeVisible();
    // The main view less what 1.0.8 adds: [+] and the (empty) announcement region.
    const mainAria = (await popup.locator('section[data-state="connected"]').ariaSnapshot())
      .split("\n").filter((line) => !/button "Connect another DownloadPulse"/.test(line)).join("\n");
    // Blank lines dropped: the visually hidden announcement region adds one, and shows nothing.
    const main = await popup.evaluate(() => document.querySelector('section[data-state="connected"]').innerText
      .split("\n").filter((line) => line.trim()).join("\n"));
    return {main, mainAria, boxes, settingsAria};
  };
  await launch(BASELINE);
  const before = await capture();
  await context.close();
  await rm(profile, {recursive: true, force: true});
  await dp.close();
  dp = await fakeDownloadPulse({port: 8095});
  await launch(EXT);
  const after = await capture();
  expect(after.main).toBe(before.main);
  // The announcement region (empty, for the list's moves) is the one status line 1.0.7 has not.
  expect(after.mainAria.replace(/^\s*- status\n/m, "")).toBe(before.mainAria);
  expect(after.boxes).toEqual(before.boxes);
  expect(after.settingsAria).toBe(before.settingsAria);
});

test("[+] starts at discovery, skips a server already connected, and Cancel goes back", async () => {
  await launch(EXT);
  await connectFirst();
  await popup.getByTestId("add-server").click();
  // Already agreed to: no welcome, no disclosure; this computer's DownloadPulse is not offered again.
  await expect(popup.locator('section[data-state="not_found"]')).toBeVisible({timeout: 10_000});
  await expect(popup.getByRole("button", {name: "Agree and continue"})).toBeHidden();
  await expect(popup.locator('section[data-state="found"]')).toBeHidden();
  await popup.locator('section[data-state="not_found"]').getByRole("button", {name: "Cancel"}).click();
  await expect(popup.locator('section[data-state="connected"]')).toBeVisible();
  await expect(popup.getByTestId("dots").locator(".dp-conn__dot")).toHaveCount(1);
  const second = await fakeDownloadPulse();
  others.push(second);
  await addServer(second);
  await expect(popup.getByTestId("reach-text")).toHaveText("Connected", {timeout: 15_000});
  await expect(popup.getByTestId("quick-more")).toBeVisible();
  // Joined at the end, named after its host; the first stays the default.
  expect(await stored(["serverOrder", "activeServer", "serverNames"])).toEqual({serverOrder: [A, origin(second)], activeServer: A,
    serverNames: {[A]: "localhost", [origin(second)]: "localhost 2"}});
});

test("three servers: a dot each, the summary, the list; [+] disabled at 3 and a fourth refused by the background", async () => {
  test.setTimeout(90_000);
  await withServers(3);
  const [b, c] = others;
  await expect(popup.getByTestId("reach-text")).toHaveText("Connected", {timeout: 15_000});
  const add = popup.getByTestId("add-server");
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await expect(add).toHaveAttribute("title", "Up to 3 servers");
  await add.click({force: true});                                   // aria-disabled: nothing happens
  await expect(popup.locator('section[data-state="connected"]')).toBeVisible();
  await c.close();
  await expect(popup.getByTestId("reach-text")).toHaveText("2 of 3 connected", {timeout: 20_000});
  await expect(popup.getByTestId("reach")).toHaveAttribute("data-reach", "partial");
  expect(await popup.getByTestId("dots").locator(".dp-conn__dot").evaluateAll((dots) => dots.map((dot) => dot.dataset.reach)))
    .toEqual(["ok", "ok", "unreachable"]);
  await expand();
  expect(await blockNames()).toEqual(["localhost", "localhost 2", "localhost 3"]);
  await expect(block(A).locator(".dp-server__handle")).toBeVisible();
  await expect(block(A).getByRole("button", {name: "Default"})).toHaveAttribute("aria-pressed", "true");
  await expect(block(origin(b)).getByRole("button", {name: "Make default"})).toHaveAttribute("aria-pressed", "false");
  await expect(block(A)).toContainText("Locally installed instance");
  // Every server on this computer (any loopback port) is named as 1.0.7 names it.
  await expect(block(origin(b))).toContainText("Locally installed instance");
  await expect(block(origin(b))).toContainText("Account Una · Browser Laptop-Chrome");
  await expect(block(origin(c)).locator(".dp-server__unreachable")).toBeVisible();
  await expect(block(origin(b)).locator(".dp-server__unreachable")).toBeHidden();
  await expect(popup.getByRole("button", {name: "Disconnect"})).toHaveCount(0);      // no Disconnect in this list
  // A fourth, asked of the background directly: refused before DownloadPulse is asked to pair.
  const fourth = await fakeDownloadPulse();
  others.push(fourth);
  await popup.evaluate((address) => chrome.runtime.sendMessage({type: "connect-remote", address}), origin(fourth));
  await expect(popup.getByTestId("failure")).toHaveText(
    "This browser is already connected to 3 DownloadPulse servers, the most it can be. Disconnect one in Settings first.");
  expect(fourth.state.pairings.size).toBe(0);
  expect(Object.keys((await stored("connections")).connections)).toHaveLength(3);
  await popup.locator('section[data-state="failed"]').getByRole("button", {name: "Cancel"}).click();
  await expect(popup.locator('section[data-state="connected"]')).toBeVisible();
});

/** The toasts the background says, recorded as it sends them to a tab (as capture.spec.mjs). */
const recordToasts = () => worker.evaluate(() => {
  globalThis.toasts = [];
  const send = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = (tab, value, options) => {
    if (value?.type === "dp-toast") globalThis.toasts.push(value.text);
    return send(tab, value, options);
  };
});

async function hoverSend() {
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  const box = await page.locator("#zip").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(":root > div[popover]:popover-open")]
    .filter((h) => getComputedStyle(h).display !== "none").length)).toBe(1);
  const at = await page.evaluate(() => {
    const r = document.querySelector(":root > div[popover]:popover-open").getBoundingClientRect();
    return {x: r.left + 11, y: r.top + r.height / 2};
  });
  // The ↓ (with two or more servers the layer is [↓|▾]: its first 22 px), once it has stood still, seen (1.0.8).
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(400);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  await page.close();
}

test("the default: ★ moves it; Add, a page's send and the capture label go to it; ▾ chooses another, never an unreachable one", async () => {
  test.setTimeout(90_000);
  await withServers(3);
  const [b, c] = others;
  await expand();
  await block(origin(b)).getByRole("button", {name: "Make default"}).click();
  await expect(block(origin(b)).getByRole("button", {name: "Default"})).toHaveAttribute("aria-pressed", "true");
  await expect(block(A).getByRole("button", {name: "Make default"})).toBeVisible();
  // The order is not the default's: it stays as it was.
  expect(await blockNames()).toEqual(["localhost", "localhost 2", "localhost 3"]);
  await expect(popup.getByTestId("capture-main-label")).toHaveText("Send browser downloads to DownloadPulse (localhost 2)");
  await popup.locator("#quick").fill("https://example.com/to-default.iso");
  await popup.getByRole("button", {name: "Add", exact: true}).click();
  await expect(popup.getByTestId("quick-result")).toHaveText("Added to localhost 2");
  expect([dp.state.jobs.length, b.state.jobs.length, c.state.jobs.length]).toEqual([0, 1, 0]);
  // A page's send names no server: the default, and the toast says which.
  await recordToasts();
  await hoverSend();
  await expect.poll(() => b.state.jobs.length).toBe(2);
  expect(dp.state.jobs.length).toBe(0);
  await expect.poll(() => worker.evaluate(() => globalThis.toasts)).toContain("Sent to localhost 2.");
  // ▾: the servers in display order, ★ on the default; choosing one sends there only.
  await popup.locator("#quick").fill("https://example.com/to-first.iso");
  await popup.getByTestId("quick-more").click();
  const menu = popup.getByTestId("quick-menu");
  await expect(menu).toBeVisible();
  expect(await menu.getByRole("menuitem").evaluateAll((items) => items.map((item) => item.dataset.server)))
    .toEqual([A, origin(b), origin(c)]);
  await expect(menu.getByRole("menuitem").nth(1).locator("svg[data-glyph='star']")).toHaveCount(1);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await popup.keyboard.press("Enter");
  await expect(popup.getByTestId("quick-result")).toHaveText("Added to localhost");
  expect([dp.state.jobs.length, b.state.jobs.length]).toEqual([1, 2]);
  // An unreachable server can't be chosen.
  await c.close();
  await expect(block(origin(c)).locator(".dp-server__unreachable")).toBeVisible({timeout: 20_000});
  await popup.locator("#quick").fill("https://example.com/nowhere.iso");
  await popup.getByTestId("quick-more").click();
  const away = menu.getByRole("menuitem").nth(2);
  await expect(away).toHaveAttribute("aria-disabled", "true");
  await away.click({force: true});
  await expect(menu).toBeVisible();
  await expect(popup.locator("#quick")).toHaveValue("https://example.com/nowhere.iso");
  await popup.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(popup.getByTestId("quick-more")).toBeFocused();
});

test("the default receives browser downloads", async () => {
  test.setTimeout(90_000);
  await withServers(2, {granted: true, offer: "Send them to DownloadPulse"});
  const [b] = others;
  await expand();
  await block(origin(b)).getByRole("button", {name: "Make default"}).click();
  await expect(popup.getByTestId("capture-main")).toBeChecked();
  const page = await context.newPage();
  await page.goto(`${site.base}/downloads`);
  await page.locator("#big").click();
  await expect.poll(() => b.state.jobs.length, {timeout: 15_000}).toBe(1);
  expect(dp.state.jobs.length).toBe(0);
});

test("the order: drag and Alt+↑/↓ change one order, announced, used everywhere; the default never moves", async () => {
  test.setTimeout(90_000);
  await withServers(3);
  const [b, c] = others;
  await expand();
  const handle = (server) => block(server).locator(".dp-server__handle");
  await expect(handle(origin(c))).toHaveAttribute("aria-label", "Move localhost 3. Drag, or press Alt+Up or Alt+Down.");
  await handle(origin(c)).focus();
  await popup.keyboard.press("Alt+ArrowUp");
  await expect(popup.getByTestId("announce")).toHaveText("localhost 3 moved to position 2 of 3");
  await expect(handle(origin(c))).toBeFocused();
  await popup.keyboard.press("Alt+ArrowUp");
  await expect(popup.getByTestId("announce")).toHaveText("localhost 3 moved to position 1 of 3");
  expect(await blockNames()).toEqual(["localhost 3", "localhost", "localhost 2"]);
  await popup.keyboard.press("Alt+ArrowUp");                       // already first: nothing moves
  expect((await stored("serverOrder")).serverOrder).toEqual([origin(c), A, origin(b)]);
  // Drag: the first server's handle below the last block.
  const from = await handle(A).boundingBox();
  const last = await block(origin(b)).boundingBox();
  await popup.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await popup.mouse.down();
  await popup.mouse.move(from.x + from.width / 2, last.y + last.height - 4, {steps: 8});
  await popup.mouse.up();
  await expect(popup.getByTestId("announce")).toHaveText("localhost moved to position 3 of 3");
  await expect.poll(async () => (await stored("serverOrder")).serverOrder).toEqual([origin(c), origin(b), A]);
  expect((await stored("activeServer")).activeServer).toBe(A);
  await expect(block(A).getByRole("button", {name: "Default"})).toHaveAttribute("aria-pressed", "true");
  // The same order everywhere: the dots, the ▾ lists, the settings.
  expect(await popup.getByTestId("dots").locator(".dp-conn__dot").count()).toBe(3);
  await popup.getByTestId("quick-more").click();
  expect(await popup.getByTestId("quick-menu").getByRole("menuitem").evaluateAll((items) => items.map((item) => item.dataset.server)))
    .toEqual([origin(c), origin(b), A]);
  await popup.keyboard.press("Escape");
  await popup.getByTestId("open-server").click();
  expect(await popup.getByTestId("open-menu").getByRole("menuitem").evaluateAll((items) => items.map((item) => item.dataset.server)))
    .toEqual([origin(c), origin(b), A]);
  await popup.keyboard.press("Escape");
  await popup.getByRole("button", {name: "Settings"}).click();
  await expect.poll(() => popup.locator(".dp-settings__server").evaluateAll((items) => items.map((item) => item.dataset.server)))
    .toEqual([origin(c), origin(b), A]);
});

test("rename: in place, at most 24 characters, never blank, never another's, kept only in this browser", async () => {
  test.setTimeout(90_000);
  await withServers(2);
  const [b] = others;
  await expand();
  await block(origin(b)).getByRole("button", {name: "Rename localhost 2"}).click();
  const field = popup.getByRole("textbox", {name: "Server name"});
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("localhost 2");
  await field.fill("   ");
  await field.press("Enter");
  await expect(popup.getByTestId("rename-problem")).toHaveText("Enter a name.");
  await expect(field).toBeFocused();
  await field.fill("LOCALHOST");
  await field.press("Enter");
  await expect(popup.getByTestId("rename-problem")).toHaveText("Another server already has this name.");
  await field.press("Escape");
  await expect(block(origin(b)).locator(".dp-server__name")).toHaveText("localhost 2");
  await block(origin(b)).getByRole("button", {name: "Rename localhost 2"}).click();
  await field.fill("");
  await field.pressSequentially("A seedbox with a very long name indeed");
  await expect(field).toHaveValue("A seedbox with a very lo");          // 24 characters
  await field.fill("Seedbox");
  await field.press("Enter");
  await expect(block(origin(b)).locator(".dp-server__name")).toHaveText("Seedbox");
  await expect(block(origin(b)).getByRole("button", {name: "Rename Seedbox"})).toBeFocused();
  expect((await stored("serverNames")).serverNames[origin(b)]).toBe("Seedbox");
  expect(await popup.evaluate(() => chrome.storage.sync.get(null))).toEqual({});
  // Never sent anywhere: no request to either server carries it.
  expect(JSON.stringify([dp.state.jobs, b.state.jobs, dp.state.controls, b.state.controls])).not.toContain("Seedbox");
  await popup.getByRole("button", {name: "Settings"}).click();
  await expect(popup.locator(`.dp-settings__server[data-server="${origin(b)}"] .dp-settings__server-title`)).toHaveText("Seedbox");
});

test("the merged list: each row names its server, its controls reach that server, Clear clears every server", async () => {
  test.setTimeout(90_000);
  await withServers(2);
  const [b] = others;
  await popup.locator("#quick").fill("https://example.com/home.iso");
  await popup.getByRole("button", {name: "Add", exact: true}).click();
  await expect(popup.getByTestId("quick-result")).toHaveText("Added to localhost");
  await popup.locator("#quick").fill("https://example.com/seed.iso");
  await popup.getByTestId("quick-more").click();
  await popup.getByTestId("quick-menu").getByRole("menuitem").nth(1).click();
  await expect(popup.getByTestId("quick-result")).toHaveText("Added to localhost 2");
  // Both servers call their job "job_1": the rows are told apart by their server.
  const row = (server) => popup.locator(`li[data-job-id="job_1"][data-server="${server}"]`);
  await expect(row(A)).toBeVisible({timeout: 10_000});
  await expect(row(origin(b))).toBeVisible({timeout: 10_000});
  await expect(row(A).getByTestId("job-server")).toHaveText("localhost");
  await expect(row(origin(b)).getByTestId("job-server")).toHaveText("localhost 2");
  dp.setJob("job_1", {phase: "processing", reason: "downloading"});
  b.setJob("job_1", {phase: "processing", reason: "downloading"});
  await row(origin(b)).getByRole("button", {name: "Pause"}).click();
  await expect.poll(() => b.state.controls.length).toBe(1);
  expect(dp.state.controls.length).toBe(0);
  await row(A).getByRole("button", {name: "Remove"}).click();
  await expect.poll(() => dp.state.views.get("job_1").phase).toBe("withdrawn");
  expect(b.state.views.get("job_1").phase).toBe("processing");
  // Notifications name the server with two or more.
  b.setJob("job_1", {phase: "completed", reason: null, actionability: "none", paused_by: null});
  const notifications = () => popup.evaluate(() => new Promise((done) => chrome.notifications.getAll(done)));
  await expect.poll(async () => Object.keys(await notifications()), {timeout: 15_000})
    .toContain(`dp:job_1:completed:${encodeURIComponent(origin(b))}`);
  await expect(row(A)).toHaveAttribute("data-phase", "withdrawn");
  await expect(row(origin(b))).toHaveAttribute("data-phase", "completed");
  await popup.getByTestId("clear-list").click();
  await expect(popup.locator("li[data-job-id]")).toHaveCount(0);
  expect(dp.state.views.size + b.state.views.size).toBe(2);            // each DownloadPulse keeps them
});

test("[Open ▾] lists the servers and opens the one chosen", async () => {
  test.setTimeout(90_000);
  await withServers(2);
  const [b] = others;
  const open = popup.getByTestId("open-server");
  await expect(open).toHaveAttribute("aria-haspopup", "menu");
  await expect(open.locator("svg[data-glyph='chevronDown']")).toBeVisible();
  await open.click();
  const menu = popup.getByTestId("open-menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  const opened = context.waitForEvent("page", (page) => page.url().startsWith(`${origin(b)}/`));
  await menu.getByRole("menuitem").nth(1).click();
  await opened;
});

async function openSettings() {
  await popup.getByRole("button", {name: "Settings"}).click();
  await expect(popup.locator("#connection-title")).toBeVisible();
}

test("Settings with more than one: Connections, a block each; Disconnect confirmed, the default handed over, focus and Esc", async () => {
  test.setTimeout(90_000);
  await withServers(3);
  const [b, c] = others;
  await openSettings();
  await expect(popup.locator("#connection-title")).toHaveText("Connections:");
  await expect(popup.locator(".dp-settings__server")).toHaveCount(3);
  await expect(popup.locator(`.dp-settings__server[data-server="${A}"] .dp-settings__server-title`)).toHaveText("localhost");
  await expect(popup.locator(`.dp-settings__server[data-server="${A}"]`).getByRole("img", {name: "Default"})).toHaveCount(1);
  await expect(popup.locator(`.dp-settings__server[data-server="${origin(b)}"]`).getByRole("img", {name: "Default"})).toHaveCount(0);
  const trash = (server) => popup.locator(`.dp-settings__server[data-server="${server}"] [data-action="disconnect"]`);
  await expect(trash(A)).toHaveAttribute("aria-label", "Disconnect localhost");
  await expect(trash(A)).toHaveAttribute("title", "Disconnect localhost");
  await expect(trash(A).locator("svg[data-glyph='trash2']")).toHaveCount(1);
  await expect(trash(A)).toHaveClass(/dp-glyph-btn--danger/);
  // The hint stays below the blocks.
  const hint = popup.locator("[data-connection='multi'] .dp-settings__centred");
  await expect(hint).toHaveText("Disconnecting removes this browser from your DownloadPulse account. Downloads already sent are kept.");
  expect((await hint.boundingBox()).y).toBeGreaterThan((await trash(origin(c)).boundingBox()).y);
  // The dialog: Cancel has the focus, Esc closes it, nothing changes.
  await trash(A).click();
  const dialog = popup.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", {name: "Cancel"})).toBeFocused();
  await expect(popup.getByTestId("dialog-title")).toHaveText("Disconnect from localhost?");
  await expect(popup.getByTestId("dialog-account")).toHaveText("This browser will be removed from the account Una on 127.0.0.1:8095.");
  await expect(popup.getByTestId("dialog-after")).toHaveText("Downloads already sent keep going there. localhost will no longer be "
    + "offered on pages or in the right-click menu. To use it again, you will need to connect it again.");
  await expect(popup.getByTestId("dialog-default")).toHaveText("localhost is your default server. localhost 2 will become your default.");
  const layout = await popup.evaluate(() => {
    const align = (id) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)).textAlign;
    const box = (id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
    return {title: align("dialog-title"), account: align("dialog-account"), after: align("dialog-after"), note: align("dialog-default"),
      cancelLeft: box("dialog-cancel").right < box("dialog-confirm").left, modal: document.querySelector("dialog").matches(":modal"),
      dimmed: getComputedStyle(document.querySelector("dialog"), "::backdrop").backgroundColor !== "rgba(0, 0, 0, 0)"};
  });
  expect(layout).toEqual({title: "start", account: "center", after: "center", note: "start", cancelLeft: true, modal: true, dimmed: true});
  // The rest of the popup is inert while it is open.
  await popup.keyboard.press("Tab");
  expect(await popup.evaluate(() => document.activeElement?.dataset.testid)).toBe("dialog-confirm");
  await popup.keyboard.press("Shift+Tab");
  await expect(popup.getByTestId("dialog-confirm")).toHaveText("Disconnect");
  await expect(popup.getByTestId("dialog-confirm")).toHaveClass(/dp-btn--danger/);
  await popup.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trash(A)).toBeFocused();
  expect(dp.state.disconnects ?? 0).toBe(0);
  // Disconnect: revoked there, then removed here; the next in display order becomes the default.
  await trash(A).click();
  await popup.getByTestId("dialog-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(popup.getByTestId("connection-note")).toHaveText(
    "Disconnected from localhost. It no longer accepts this browser. localhost 2 is now your default server.");
  expect(dp.state.disconnects).toBe(1);
  expect(dp.state.revoked).toBe(true);
  expect(await tokenSlot(A)).toBeNull();
  await expect(popup.locator(".dp-settings__server")).toHaveCount(2);
  expect((await stored("activeServer")).activeServer).toBe(origin(b));
  await expect(trash(origin(b))).toBeFocused();                       // the next block's
  // Already removed there (DownloadPulse refuses the token): done all the same.
  b.state.removedThere = true;
  await trash(origin(b)).click();
  await expect(popup.getByTestId("dialog-default")).toHaveText("localhost 2 is your default server. localhost 3 will become your default.");
  await popup.getByTestId("dialog-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(popup.getByTestId("connection-note")).toHaveText(
    "Disconnected from localhost 2. It no longer accepts this browser. localhost 3 is now your default server.");
  // Down to one: the single-server layout again.
  await expect(popup.locator("#connection-title")).toHaveText("Connection:");
  await expect(popup.locator("[data-connection='connected']").getByRole("button", {name: "Disconnect"})).toBeVisible();
  expect(Object.keys((await stored("connections")).connections)).toEqual([origin(c)]);
});

test("Disconnect when the server can't be reached: Disconnecting…, then Cancel keeps it, or Remove anyway", async () => {
  test.setTimeout(120_000);
  await withServers(2);
  const [b] = others;
  await openSettings();
  const trash = popup.locator(`.dp-settings__server[data-server="${origin(b)}"] [data-action="disconnect"]`);
  // An address that takes the connection and never answers: the dialog waits, then says so.
  b.state.hang = true;
  await trash.click();
  await expect(popup.getByTestId("dialog-default")).toBeHidden();       // not the default
  await popup.getByTestId("dialog-confirm").click();
  await expect(popup.getByTestId("dialog-confirm")).toHaveText("Disconnecting…");
  await expect(popup.getByTestId("dialog-confirm")).toBeDisabled();
  await expect(popup.getByTestId("dialog-cancel")).toBeDisabled();
  await popup.keyboard.press("Escape");
  await expect(popup.getByRole("dialog")).toBeVisible();               // not while it disconnects
  await expect(popup.getByTestId("dialog-title")).toHaveText("localhost 2 can't be reached", {timeout: 15_000});
  await expect(popup.getByTestId("dialog-account")).toHaveText(
    `This browser could not be removed from the account Una on localhost:${b.port}.`);
  await expect(popup.getByTestId("dialog-after")).toHaveText("You can remove localhost 2 from this browser anyway. It will still list "
    + "this browser until you remove it there, in My Account › Connected browsers.");
  await expect(popup.getByTestId("dialog-confirm")).toHaveText("Remove anyway");
  await expect(popup.getByTestId("dialog-cancel")).toBeFocused();
  // Cancel: exactly as it was.
  await popup.getByTestId("dialog-cancel").click();
  await expect(popup.getByRole("dialog")).toBeHidden();
  await expect(trash).toBeFocused();
  expect(Object.keys((await stored("connections")).connections)).toEqual([A, origin(b)]);
  expect(await tokenSlot(origin(b))).toBe("dp_fake-token");
  // Stopped altogether: refused at once, then Remove anyway removes it here only.
  await b.close();
  await trash.click();
  await popup.getByTestId("dialog-confirm").click();
  await expect(popup.getByTestId("dialog-confirm")).toHaveText("Remove anyway", {timeout: 15_000});
  await popup.getByTestId("dialog-confirm").click();
  await expect(popup.getByRole("dialog")).toBeHidden();
  await expect(popup.getByTestId("connection-note")).toHaveText("Removed from this browser. localhost 2 still lists it.");
  expect(Object.keys((await stored("connections")).connections)).toEqual([A]);
  expect(await tokenSlot(origin(b))).toBeNull();
  expect(b.state.revoked ?? false).toBe(false);
});

test("one server: Disconnect goes through the same dialog, and removing the last returns to the welcome screen", async () => {
  test.setTimeout(90_000);
  await launch(EXT);
  await connectFirst();
  await openSettings();
  await popup.getByRole("button", {name: "Disconnect"}).click();
  await expect(popup.getByTestId("dialog-title")).toHaveText("Disconnect from DownloadPulse?");
  await expect(popup.getByTestId("dialog-account")).toHaveText("This browser will be removed from the account Una on 127.0.0.1:8095.");
  await expect(popup.getByTestId("dialog-default")).toBeHidden();
  await expect(popup.getByTestId("dialog-cancel")).toBeFocused();
  await dp.close();
  await popup.getByTestId("dialog-confirm").click();
  await expect(popup.getByTestId("dialog-title")).toHaveText("DownloadPulse can't be reached", {timeout: 15_000});
  await popup.getByTestId("dialog-cancel").click();
  await expect(popup.getByTestId("settings-account")).toHaveText("Una");
  await popup.getByRole("button", {name: "Disconnect"}).click();
  await popup.getByTestId("dialog-confirm").click();
  await expect(popup.getByTestId("dialog-confirm")).toHaveText("Remove anyway", {timeout: 15_000});
  await popup.getByTestId("dialog-confirm").click();
  await expect(popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true})).toBeVisible();
  expect(await tokenSlot(A)).toBeNull();
  dp = await fakeDownloadPulse({port: 8095});                           // for afterEach
});

test("EXT-6: a connection held for the disclosure is still revoked on the server when disconnected", async () => {
  await launch(EXT);
  await connectFirst();
  // The disclosure changed since it was agreed to: the connection is held, nothing is sent ...
  await popup.evaluate(() => chrome.storage.local.set({consent: {version: 1, deviceName: false, at: Date.now()}}));
  await expect(popup.getByRole("button", {name: "Agree and continue"})).toBeVisible();
  // ... yet Disconnect revokes it there with the stored token.
  await openSettings();
  await popup.getByRole("button", {name: "Disconnect"}).click();
  await popup.getByTestId("dialog-confirm").click();
  await expect.poll(() => dp.state.disconnects).toBe(1);
  expect(dp.state.revoked).toBe(true);
});

test("upgrade: 1.0.7's storage moves over with nothing visible changing", async () => {
  await launch(EXT);
  // As 1.0.7 left it: one connection, the server in use, the agreement, the token in its slot.
  await popup.evaluate(async (server) => {
    const consent = {version: 3, deviceName: false, at: Date.now()};
    await chrome.storage.local.set({connections: {[server]: {server, tokenId: "tok-1", label: "Laptop-Chrome", account: "Una"}},
      activeServer: server, consent});
    await new Promise((done) => {
      const open = indexedDB.open("downloadpulse", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("secrets");
      open.onsuccess = () => {
        const tx = open.result.transaction("secrets", "readwrite");
        tx.objectStore("secrets").put("dp_fake-token", `token@${server}`);
        tx.oncomplete = done;
      };
    });
  }, A);
  // Opened after the update. (The writes the update makes on install -- names, IDs, order -- are
  // proven in test/unit/servers.test.ts; Playwright can't restart an extension as an update does.)
  await popup.reload();
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
  await expect(popup.getByTestId("reach-text")).toHaveText("Connected", {timeout: 15_000});
  await expect(popup.getByTestId("dots").locator(".dp-conn__dot")).toHaveCount(1);
  await expect(popup.getByTestId("quick-more")).toBeHidden();
  await expand();
  await expect(popup.locator("#facts")).toBeVisible();
  await expect(popup.getByTestId("servers")).toBeHidden();
  expect((await stored("activeServer")).activeServer).toBe(A);
});
