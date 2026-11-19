// SPDX-License-Identifier: GPL-2.0-or-later
// WS-E4: the settings page (Disconnect, the in-page buttons globally and per
// site, notifications) and a token revoked in DownloadPulse, against the
// fake DownloadPulse and the fake site. Same port rule as onboarding.spec.mjs.
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

let dp, site, context, profile, base, popup;

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-settings-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1000, height: 800},
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  base = `chrome-extension://${new URL(worker.url()).host}`;
  popup = await context.newPage();
  await popup.goto(`${base}/popup/popup.html`);
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
});

test.afterEach(async () => {
  await context.close();
  await rm(profile, {recursive: true, force: true});
  await dp.close();
  await site.close();
});

const openLayers = (page) => page.evaluate(() => [...document.querySelectorAll("downloadpulse-layer:popover-open")].filter((h) => getComputedStyle(h).display !== "none").length);

async function hoverOffered(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await page.waitForTimeout(600);
  const count = await openLayers(page);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  return count;
}

async function options() {
  const page = await context.newPage();
  await page.goto(`${base}/options/options.html`);
  return page;
}

test("Disconnect revokes this browser on the server and forgets it here", async () => {
  const settings = await options();
  await expect(settings.getByTestId("account")).toHaveText("Una");
  await settings.getByRole("button", {name: "Disconnect"}).click();
  await expect(settings.getByTestId("connection-note")).toHaveText("Disconnected. DownloadPulse no longer accepts this browser.");
  expect(dp.state.disconnects).toBe(1);
  await expect(settings.getByText("This browser isn't connected to DownloadPulse.", {exact: false})).toBeVisible();
  await popup.reload();
  await expect(popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true})).toBeVisible();
  const secret = await popup.evaluate(() => new Promise((done) => {
    const open = indexedDB.open("downloadpulse");
    open.onsuccess = () => {
      const read = open.result.transaction("secrets").objectStore("secrets").get("token@http://127.0.0.1:8095");
      read.onsuccess = () => done(read.result ?? null);
    };
  }));
  expect(secret).toBeNull();
});

/** A secret slot in the extension's IndexedDB: read (value undefined) or written (null deletes). */
const slot = (page, name, value) => page.evaluate(([key, v, write]) => new Promise((done) => {
  const open = indexedDB.open("downloadpulse");
  open.onsuccess = () => {
    const store = open.result.transaction("secrets", write ? "readwrite" : "readonly").objectStore("secrets");
    const request = !write ? store.get(key) : v === null ? store.delete(key) : store.put(v, key);
    request.onsuccess = () => done(write ? true : (request.result ?? null));
  };
}), [name, value ?? null, value !== undefined]);

test("an earlier build's single connection and token are moved to their server's place, and keep working (multi-server preparation)", async () => {
  // As 29cf776 left them: one "connection", one "token" slot.
  const shown = await popup.evaluate(async () => {
    const {connections, activeServer} = await chrome.storage.local.get(["connections", "activeServer"]);
    return connections[activeServer];
  });
  // The secret first: the background moves the old layout as soon as it sees it.
  await slot(popup, "token", "dp_fake-token");
  await slot(popup, "token@http://127.0.0.1:8095", null);
  await popup.evaluate(async (value) => {
    await chrome.storage.local.remove(["connections", "activeServer"]);
    await chrome.storage.local.set({connection: value});
  }, shown);
  await popup.reload();
  await expect(popup.getByTestId("account")).toHaveText("Una");
  const stored = await popup.evaluate(() => chrome.storage.local.get(null));
  expect(stored.connection).toBeUndefined();
  expect(Object.keys(stored.connections)).toEqual(["http://127.0.0.1:8095"]);
  expect(stored.activeServer).toBe("http://127.0.0.1:8095");
  expect(await slot(popup, "token")).toBeNull();
  expect(await slot(popup, "token@http://127.0.0.1:8095")).toBe("dp_fake-token");
  const polls = dp.state.listPolls.length;
  await expect.poll(() => dp.state.listPolls.length, {timeout: 10_000}).toBeGreaterThan(polls);   // and it is used
});

test("forgetting one server keeps another's connection, token and downloads (multi-server preparation)", async () => {
  const other = "https://second.example.invalid";
  await popup.evaluate(async (server) => {
    const {connections} = await chrome.storage.local.get("connections");
    await chrome.storage.local.set({connections: {...connections,
      [server]: {server, tokenId: "tok-2", label: "Laptop-Chrome", account: "Ira"}}});
    await chrome.storage.session.set({[`jobs@${server}`]: {j1: {id: "j1"}}});
  }, other);
  await slot(popup, `token@${other}`, "dp_second-token");
  const settings = await options();
  await settings.getByRole("button", {name: "Disconnect"}).click();
  await expect(settings.getByTestId("connection-note")).toHaveText("Disconnected. DownloadPulse no longer accepts this browser.");
  const after = await popup.evaluate(async (server) => ({
    local: await chrome.storage.local.get(["connections", "activeServer"]),
    session: await chrome.storage.session.get(null),
  }), other);
  expect(Object.keys(after.local.connections)).toEqual([other]);
  expect(after.local.activeServer).toBe(other);
  expect(after.session[`jobs@${other}`]).toEqual({j1: {id: "j1"}});
  expect(Object.keys(after.session).some((key) => key.endsWith("@http://127.0.0.1:8095"))).toBe(false);
  expect(await slot(popup, `token@${other}`)).toBe("dp_second-token");
  expect(await slot(popup, "token@http://127.0.0.1:8095")).toBeNull();
});

test("the gear opens the settings inside the dropdown, and Back returns", async () => {
  const pages = context.pages().length;
  const gear = popup.locator("header").getByRole("button", {name: "Settings"});
  await expect(gear.locator("svg[data-glyph='settings']")).toHaveCount(1);
  // The gear is on the title's row, at its end.
  const [title, cog] = await Promise.all([popup.locator("h1").boundingBox(), gear.boundingBox()]);
  expect(Math.abs((title.y + title.height / 2) - (cog.y + cog.height / 2))).toBeLessThan(4);
  expect(cog.x).toBeGreaterThan(title.x);
  await gear.click();
  expect(context.pages().length).toBe(pages);            // nothing opened outside the dropdown
  await expect(popup.locator(".dp-settings__title")).toHaveText("Settings");
  await expect(popup.getByRole("button", {name: "Disconnect"})).toBeVisible();
  await expect(popup.getByTestId("settings-server")).toHaveText("Locally installed instance");
  await expect(popup.getByRole("button", {name: "Open DownloadPulse"})).toBeHidden();
  // The settings' layout (operator, 2026-11-18).
  const layout = await popup.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const main = box("main");
    const centre = (r) => Math.abs((r.left + r.right) / 2 - (main.left + main.right) / 2);
    const hint = document.querySelector(".dp-settings__connection .dp-settings__centred");
    return {
      backAtEnd: main.right - box("[data-action='back']").right < 20,
      titles: [...document.querySelectorAll(".dp-settings h3")].map((h) => getComputedStyle(h).textAlign),
      connection: document.querySelector("#connection-title").textContent,
      hintCentred: getComputedStyle(hint).textAlign,
      disconnectCentred: centre(box("[data-action='disconnect']")) < 2,
      rows: {factsToHint: hint.getBoundingClientRect().top - box(".dp-settings__connection .dp-facts").bottom,
        hintToButton: box("[data-action='disconnect']").top - hint.getBoundingClientRect().bottom,
        buttonToSeparator: box("section[aria-labelledby='page-title']").top - box("[data-action='disconnect']").bottom},
    };
  });
  expect(layout).toMatchObject({backAtEnd: true, titles: ["center", "center", "center"], connection: "Connection:",
    hintCentred: "center", disconnectCentred: true});
  for (const gap of Object.values(layout.rows)) expect(gap).toBeGreaterThanOrEqual(17);
  // No separator above Notifications, a blank row instead; the subsection title sits on its hint.
  const tail = await popup.evaluate(() => {
    const notify = document.querySelector("section[aria-labelledby='notify-title']");
    const h4 = document.querySelector(".dp-settings h4").getBoundingClientRect();
    const hint = document.querySelector(".dp-settings h4 + .dp-settings__centred").getBoundingClientRect();
    return {separator: getComputedStyle(notify).borderTopStyle, room: parseFloat(getComputedStyle(notify).paddingTop),
      titleToHint: hint.top - h4.bottom};
  });
  expect(tail.separator).toBe("none");
  expect(tail.room).toBeGreaterThanOrEqual(18);
  expect(tail.titleToHint).toBeLessThan(12);
  await popup.getByRole("button", {name: "Back"}).click();
  await expect(popup.getByRole("button", {name: "Open DownloadPulse"})).toBeVisible();
  await expect(popup.locator("[data-view='settings']")).toBeHidden();
});

test("the master switch governs every in-page button; off, what it governs is not shown, and its choices are kept", async () => {
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  expect(await hoverOffered(page, "#zip")).toBe(1);
  await popup.bringToFront();
  await popup.locator("header").getByRole("button", {name: "Settings"}).click();
  const master = popup.getByLabel("Display download button on web pages");
  await expect(master).toBeChecked();
  await expect(popup.getByTestId("in-page-options")).toBeVisible();
  // Add site: the field the whole width, its button inside it, at the end, vertically centred.
  const [field, add] = await Promise.all([popup.locator("#site").boundingBox(), popup.getByRole("button", {name: "Add site"}).boundingBox()]);
  expect(add.x + add.width).toBeLessThanOrEqual(field.x + field.width);
  expect(add.x).toBeGreaterThan(field.x + field.width / 2);
  expect(Math.abs((add.y + add.height / 2) - (field.y + field.height / 2))).toBeLessThanOrEqual(1);
  await popup.getByLabel("Show a download button on video players").uncheck();
  const separator = () => popup.locator("section[aria-labelledby='notify-title']").evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(await separator()).toBe("none");                 // on: Notifications follows without a separator
  await master.uncheck();
  await expect(popup.getByTestId("in-page-options")).toBeHidden();
  await expect.poll(separator).toBe("solid");             // off: the separator returns
  await expect(popup.getByLabel("Show a download button beside download links")).toBeHidden();
  await page.waitForTimeout(5500);                         // a frame's answer is kept for up to 5 s
  expect(await hoverOffered(page, "#zip")).toBe(0);        // off: nothing offered
  await master.check();
  await expect.poll(separator).toBe("none");
  await expect(popup.getByLabel("Show a download button on video players")).not.toBeChecked();   // kept
  await expect(popup.getByLabel("Show a download button beside download links")).toBeChecked();
  await page.waitForTimeout(5500);
  expect(await hoverOffered(page, "#zip")).toBe(1);
});

test("the per-site switch is in the settings, for the site of the current tab", async () => {
  await expect(popup.getByTestId("site-switch")).toBeHidden();   // not on the main view
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  await page.bringToFront();
  await popup.locator("header").getByRole("button", {name: "Settings"}).click();
  const host = `127.0.0.1`;
  await expect(popup.getByTestId("site-text")).toHaveText(`Download buttons on ${host}`);
  await expect(popup.getByTestId("site-on")).toBeChecked();
  await popup.getByTestId("site-on").uncheck();
  await expect(popup.getByTestId("off-sites")).toHaveText(new RegExp(host.replace(/\./g, "\\.")));
});

test("the dropdown and the settings page are drawn in the person's DownloadPulse theme", async () => {
  const root = popup.locator("html");
  const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // Paired: DownloadPulse said Dark, its native palette.
  await expect(root).toHaveAttribute("data-mode", "dark");
  await expect(root).toHaveAttribute("data-palette", "debridpulse-dark");
  expect(await background(popup)).toBe("rgb(5, 8, 20)");
  // The title is DownloadPulse's mark and two-tone wordmark, in Outfit, in the theme's colours.
  const brand = (page) => page.evaluate(async () => {
    await document.fonts.ready;
    const name = document.querySelector(".dp-brand__name");
    return {text: name.textContent, pulse: getComputedStyle(name.querySelector("span")).color,
      logo: getComputedStyle(document.querySelector(".dp-brand__logo .dp-logo-surface")).fill,
      hidden: document.querySelector(".dp-brand__logo").getAttribute("aria-hidden"),
      outfit: document.fonts.check('700 19px "Outfit"') && [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Outfit" && f.status === "loaded")};
  });
  await expect(popup.locator("h1")).toHaveText("DownloadPulse");
  expect(await brand(popup)).toEqual({text: "DownloadPulse", pulse: "rgb(164, 92, 255)", logo: "rgb(8, 11, 24)", hidden: "true", outfit: true});
  // Changed in DownloadPulse: the next opening follows it.
  dp.state.appearance = {mode: "light", dark_palette: "dracula", light_palette: "nord-light"};
  await popup.reload();
  await expect(root).toHaveAttribute("data-palette", "nord-light");
  await expect(root).toHaveAttribute("data-mode", "light");
  expect(await background(popup)).toBe("rgb(229, 233, 240)");   // Nord Light's own background
  // An alternative palette: the wordmark's accent and the mark's square come from it, as in DownloadPulse.
  expect(await brand(popup)).toMatchObject({pulse: "rgb(94, 129, 172)", logo: "rgb(236, 239, 244)"});
  await expect(popup.locator("html")).toHaveAttribute("data-palette-kind", "alternative");
  const settings = await options();
  await expect(settings.locator("html")).toHaveAttribute("data-palette", "nord-light");
  // Changed while the dropdown stays open: it follows within seconds, without reopening.
  // A palette this extension doesn't know is drawn as its mode's native one.
  dp.state.appearance = {mode: "dark", dark_palette: "a-future-palette", light_palette: "nord-light"};
  await expect(root).toHaveAttribute("data-palette", "debridpulse-dark", {timeout: 6_000});
  expect(await background(popup)).toBe("rgb(5, 8, 20)");
});

test("a saved connection without the agreement sends nothing until agreed; one over internet HTTP is forgotten", async () => {
  const before = await popup.evaluate(async () => (await chrome.storage.local.get("consent")).consent);
  expect(before).toBeTruthy();
  // As a connection paired by an earlier build (no agreement recorded).
  await popup.evaluate(() => chrome.storage.local.remove("consent"));
  await popup.reload();
  await expect(popup.getByText("Before you connect, here is what DownloadPulse receives from this browser.")).toBeVisible();
  await popup.waitForTimeout(2500);
  const polls = dp.state.listPolls.length, sessions = dp.state.sessionAuth.length;
  await popup.waitForTimeout(4500);
  expect(dp.state.listPolls.length).toBe(polls);        // held: no polling with the key
  expect(dp.state.sessionAuth.length).toBe(sessions);   // nor the theme refresh
  const pairings = dp.state.pairings.size;
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await expect(popup.getByTestId("account")).toHaveText("Una");   // the same connection, unlocked: no new pairing
  expect(dp.state.pairings.size).toBe(pairings);
  await expect.poll(() => dp.state.listPolls.length, {timeout: 10_000}).toBeGreaterThan(polls);
  // A connection to a server over plain HTTP across the internet (seeded): forgotten, refused, nothing sent.
  // (Seeded as the one in use, beside the real one, which is kept.)
  const real = await popup.evaluate(async () => (await chrome.storage.local.get("activeServer")).activeServer);
  await popup.evaluate(async () => {
    const {connections} = await chrome.storage.local.get("connections");
    const seeded = {...Object.values(connections)[0], server: "http://203.0.113.9:8095"};
    await chrome.storage.local.set({connections: {...connections, [seeded.server]: seeded}, activeServer: seeded.server});
  });
  await popup.reload();
  await expect(popup.getByTestId("failure")).toHaveText("This server must use HTTPS. Plain HTTP is only allowed on your own network.");
  // The refusal is shown first, then the connection forgotten (popup.ts): only that one.
  await expect.poll(async () => Object.keys((await popup.evaluate(async () =>
    chrome.storage.local.get("connections"))).connections)).toEqual([real]);
  expect((await popup.evaluate(async () => chrome.storage.local.get("activeServer"))).activeServer).toBe(real);
});

test("a browser disconnected in DownloadPulse is told so and forgets its token", async () => {
  dp.state.revoked = true;            // as if removed under My Account › Connected browsers
  await popup.reload();               // the open popup polls the list: 401
  await expect(popup.getByTestId("failure")).toHaveText("This browser was disconnected in DownloadPulse.",
    {timeout: 15_000});
});

test("the in-page buttons follow the settings, globally and per site", async () => {
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  expect(await hoverOffered(page, "#zip")).toBe(1);
  const settings = await options();
  await settings.getByLabel("Show a download button beside download links").uncheck();
  await page.waitForTimeout(5500);    // a frame's answer is kept for up to 5 s
  expect(await hoverOffered(page, "#zip")).toBe(0);
  expect(await hoverOffered(page, "#video")).toBe(1);   // the video button is its own setting
  await settings.getByLabel("Show a download button beside download links").check();
  await settings.getByPlaceholder("example.com", {exact: true}).fill(`http://127.0.0.1:${new URL(site.base).port}/page`);
  await settings.getByRole("button", {name: "Add site"}).click();
  await expect(settings.getByTestId("off-sites")).toHaveText(/127\.0\.0\.1/);
  await page.waitForTimeout(5500);
  expect(await hoverOffered(page, "#zip")).toBe(0);
  expect(await hoverOffered(page, "#video")).toBe(0);
  await settings.getByTestId("off-sites").getByRole("button", {name: "Remove"}).click();
  await page.waitForTimeout(5500);
  expect(await hoverOffered(page, "#zip")).toBe(1);
});

test("a notification kind switched off is not raised", async () => {
  const settings = await options();
  await settings.getByLabel("When a download finishes").uncheck();
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  const box = await page.locator("#zip").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(() => openLayers(page)).toBe(1);
  const at = await page.evaluate(() => {
    const r = document.querySelector("downloadpulse-layer:popover-open").getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  });
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => dp.state.views.size).toBe(1);
  const [id] = dp.state.views.keys();
  dp.setJob(id, {phase: "processing", reason: "downloading"});
  await expect(popup.locator(`li[data-job-id="${id}"] .dp-job__status`)).toHaveText("Downloading");
  dp.setJob(id, {phase: "completed", reason: "completed", actionability: "none"});
  await expect(popup.locator(`li[data-job-id="${id}"] [data-testid='state']`)).toHaveText("Done");
  await popup.waitForTimeout(1500);
  expect(Object.keys(await popup.evaluate(() => new Promise((done) => chrome.notifications.getAll(done))))).toEqual([]);
  dp.setJob(id, {phase: "failed", reason: "acquisition_failed", actionability: "operator"});
  await expect.poll(async () => Object.keys(await popup.evaluate(() =>
    new Promise((done) => chrome.notifications.getAll(done))))).toEqual([`dp:${id}:failed`]);
});
