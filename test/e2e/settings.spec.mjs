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
  await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
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
  await expect(popup.getByRole("button", {name: "Connect to a DownloadPulse instance"})).toBeVisible();
  const secret = await popup.evaluate(() => new Promise((done) => {
    const open = indexedDB.open("downloadpulse");
    open.onsuccess = () => {
      const read = open.result.transaction("secrets").objectStore("secrets").get("token");
      read.onsuccess = () => done(read.result ?? null);
    };
  }));
  expect(secret).toBeNull();
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
  await popup.getByRole("button", {name: "Back"}).click();
  await expect(popup.getByRole("button", {name: "Open DownloadPulse"})).toBeVisible();
  await expect(popup.locator("[data-view='settings']")).toBeHidden();
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

test("a browser disconnected in DownloadPulse is told so and forgets its token", async () => {
  dp.state.revoked = true;            // as if removed under My Account › Connected browsers
  await popup.reload();               // the open popup polls the list: 401
  await expect(popup.getByTestId("failure")).toHaveText("DownloadPulse no longer accepts this browser. Connect it again.",
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
  await expect(popup.locator(`li[data-job-id="${id}"] .dp-job__status`)).toHaveText("Done");
  await popup.waitForTimeout(1500);
  expect(Object.keys(await popup.evaluate(() => new Promise((done) => chrome.notifications.getAll(done))))).toEqual([]);
  dp.setJob(id, {phase: "failed", reason: "acquisition_failed", actionability: "operator"});
  await expect.poll(async () => Object.keys(await popup.evaluate(() =>
    new Promise((done) => chrome.notifications.getAll(done))))).toEqual([`dp:${id}:failed`]);
});
