// SPDX-License-Identifier: GPL-2.0-or-later
// 1.0.8 (WS-A3): the page the person is on can't drive the extension. A page that defines the
// custom element the extension's layer once was, restyles it, fakes the person's input and
// presses whatever it can reach sends nothing; the person's own hover and press still do, on
// that page too; and the background sends nothing a page's button is not offered for now.
// Same port rule as onboarding.spec.mjs: run in a private network namespace locally.
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

let dp, site, context, profile, extensionId, worker;

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-hostile-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1100, height: 800},
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
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
  return popup;
}

async function open(path) {
  const page = await context.newPage();
  await page.goto(`${site.base}${path}`);
  await page.waitForTimeout(300);
  return page;
}

/** The layers the extension shows: its hosts in the top layer, as drawn. */
const shownLayers = (page) => page.evaluate(() => [...document.documentElement.children]
  .filter((host) => host.matches(":popover-open") && host.id !== "decoy" && host.style.bottom !== "16px").map((host) => {   // not the toast
    const r = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    return {left: r.left, top: r.top, width: r.width, height: r.height, tag: host.localName, opacity: style.opacity,
      visibility: style.visibility, transform: style.transform, scale: style.scale, filter: style.filter,
      clipPath: style.clipPath, zoom: style.zoom, pointerEvents: style.pointerEvents, display: style.display,
      primary: style.getPropertyValue("--dp-primary"), before: getComputedStyle(host, "::before").content};
  }));

/** The person's own pointer onto a link, until its button is up. */
async function hover(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(async () => (await shownLayers(page)).length).toBe(1);
  const [layer] = await shownLayers(page);
  return {x: layer.left + layer.width / 2, y: layer.top + layer.height / 2, layer};
}

test("a page that fakes the person's hover, selection and presses sends nothing (the audit's repro)", async () => {
  await connect();
  const page = await open("/hostile");
  const report = await page.evaluate(() => window.attack());
  await page.waitForTimeout(1500);
  expect(dp.state.jobs).toEqual([]);
  expect(site.state.requests.filter((r) => r.path.startsWith("/files/"))).toEqual([]);   // nothing fetched with the person's cookies
  // Nothing of the extension's was ever made where the page could reach it: no custom element, no layer.
  expect(report.internals).toBe(0);
  expect(report.hosts).toBe(0);
});

test("on that page, the person's own hover and press still send, and its styles can't hide, scale or blank the button", async () => {
  await connect();
  const page = await open("/hostile?tamper=inline");
  const {x, y, layer} = await hover(page, "#magnet");
  expect(layer).toMatchObject({tag: "div", opacity: "1", visibility: "visible", transform: "none", scale: "none",
    filter: "none", clipPath: "none", pointerEvents: "auto", display: "block", before: "none"});
  expect(["1", ""]).toContain(layer.zoom);
  expect(layer.width).toBe(22);
  expect(layer.height).toBe(22);
  expect(layer.primary).toContain("#8d48db");
  await page.mouse.move(x, y, {steps: 3});
  await page.waitForTimeout(400);
  await page.mouse.click(x, y);
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "magnet", magnet: `magnet:?xt=urn:btih:${"a".repeat(40)}&dn=attacker`});
  // A selection the person makes (their own pointer, dragged across it) gets its button and sends.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  const sel = await page.locator("#sel").boundingBox();
  await page.mouse.move(sel.x + 1, sel.y + sel.height / 2);
  await page.mouse.down();
  await page.mouse.move(sel.x + sel.width - 1, sel.y + sel.height / 2, {steps: 8});
  await page.mouse.up();
  await page.waitForTimeout(600);   // the selection's button replaces any hover icon met on the way
  await expect.poll(async () => (await shownLayers(page)).length).toBe(1);
  const [batch] = await shownLayers(page);
  await page.waitForTimeout(400);
  await page.mouse.click(batch.left + batch.width / 2, batch.top + batch.height / 2);
  await expect.poll(() => dp.state.jobs.length).toBe(3);   // the two links as one batch, the magnet on its own
  expect(dp.state.jobs[1].body.source).toEqual({kind: "links", links: ["https://evil.example/a.zip", "https://evil.example/b.zip"]});
});

test("a press too soon after the button appears, or on a button the page moved or covered, does nothing", async () => {
  await connect();
  // Too soon: the button came up under a pointer already on its way (a page can put a link there).
  let page = await open("/hostile");
  let at = await hover(page, "#magnet");
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);
  await page.mouse.click(at.x, at.y);   // stood still, seen: the person's second press counts
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  await page.close();
  // Moved by the page's script to where it wants a press.
  page = await open("/hostile?tamper=move");
  at = await hover(page, "#magnet");
  const placed = await page.evaluate(() => window.__placedLeft);   // where the extension put it
  await page.mouse.move(at.x, at.y, {steps: 3});   // onto the button, as moved
  await page.waitForTimeout(400);
  const [moved] = await shownLayers(page);
  expect(moved.left).toBeCloseTo(placed + 6, 0);
  await page.mouse.click(moved.left + moved.width / 2, moved.top + moved.height / 2);
  await page.waitForTimeout(800);
  expect(dp.state.jobs.length).toBe(1);
  await page.close();
  // Covered by the page's own top-layer element, which lets the press through to the button.
  page = await open("/hostile?tamper=cover");
  at = await hover(page, "#magnet");
  await expect.poll(() => page.evaluate(() => document.getElementById("decoy").matches(":popover-open"))).toBe(true);
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(400);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(800);
  expect(dp.state.jobs.length).toBe(1);
});

test("the background sends nothing for a button not offered now: hover off, or the site turned off", async () => {
  await connect();
  const set = (value) => worker.evaluate((v) => chrome.storage.local.set({settings: v}), value);
  // Shown while offered; the setting changes before the press (the page's answer is kept for 5 s).
  for (const [value, what] of [[{hover: false}, "hover off"], [{offSites: ["127.0.0.1"]}, "site off"], [{inPage: false}, "in-page off"]]) {
    await set({});
    const page = await open("/page");
    const at = await hover(page, "#zip");
    await set(value);
    await page.mouse.move(at.x, at.y, {steps: 3});
    await page.waitForTimeout(400);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(1000);
    expect(dp.state.jobs, what).toEqual([]);
    await page.close();
  }
  // A selection's button, the same.
  await set({});
  let page = await open("/page");
  await page.locator("#live").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#live"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press("Shift");
  await expect.poll(async () => (await shownLayers(page)).length).toBe(1);
  const [batch] = await shownLayers(page);
  await set({offSites: ["127.0.0.1"]});
  await page.waitForTimeout(400);
  await page.mouse.click(batch.left + batch.width / 2, batch.top + batch.height / 2);
  await page.waitForTimeout(1000);
  expect(dp.state.jobs).toEqual([]);
  await page.close();
  // Offered again: the same press sends.
  await set({});
  page = await open("/page");
  const at = await hover(page, "#zip");
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(400);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => dp.state.jobs.length).toBe(1);
});

test("one selection sends at most 100 magnets, and a tab's pages no more than 300 in a minute", async () => {
  test.setTimeout(180_000);
  await connect();
  const page = await open("/magnets");
  const sendAll = async (submits) => {
    await page.evaluate(() => document.querySelector("#all").scrollIntoView({block: "end"}));
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#all"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.keyboard.press("Shift");
    await expect.poll(async () => (await shownLayers(page)).length).toBe(1);
    const [batch] = await shownLayers(page);
    await page.waitForTimeout(400);
    await page.mouse.click(batch.left + batch.width / 2, batch.top + batch.height / 2);
    await expect.poll(() => dp.state.submits, {timeout: 40_000}).toBe(submits);
    await page.waitForTimeout(1000);
    expect(dp.state.submits).toBe(submits);   // 100 of the 101, not one more
  };
  await sendAll(100);
  expect(dp.state.jobs.length).toBe(100);
  expect(dp.state.jobs.every((job) => job.body.source.kind === "magnet")).toBe(true);
  await sendAll(200);
  await sendAll(300);
  // The tab's minute is spent (300 separate jobs): one more magnet from its page is refused, not sent.
  await page.evaluate(() => { getSelection().removeAllRanges(); scrollTo(0, 0); });
  await page.waitForTimeout(500);
  const at = await hover(page, "#one");
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(400);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(1000);
  expect(dp.state.submits).toBe(300);
});

test("a cover flicked over the button (bare one frame in six) never lets a press through", async () => {
  await connect();
  const page = await open("/hostile?tamper=flicker");
  const at = await hover(page, "#magnet");
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(500);
  for (let press = 0; press < 12; press += 1) {
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150 + press * 23);
  }
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);
});

test("CSS anchor positioning can't carry the button onto the page's own box", async () => {
  await connect();
  const page = await open("/hostile?tamper=anchor");
  const at = await hover(page, "#magnet");
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(1000);
  // The page switches its anchor rule on (as the reviewer's page did) and the person presses where it wanted the button.
  await page.evaluate(() => document.documentElement.classList.add("go"));
  await page.waitForTimeout(60);
  const [after] = await shownLayers(page);
  expect(Math.abs(after.left - at.layer.left)).toBeLessThanOrEqual(1);   // not moved
  expect(Math.abs(after.top - at.layer.top)).toBeLessThanOrEqual(1);
  const ok = await page.locator("#ok").boundingBox();
  await page.mouse.click(ok.x + ok.width / 2, ok.y + ok.height / 2);
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);
});

test("a selection the person makes gets its button and sends, however they make it", async () => {
  test.setTimeout(120_000);
  await connect();
  const page = await open("/select");
  const text = (selector) => page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    return [...range.getClientRects()].filter((r) => r.width > 1).map((r) => ({left: r.left, right: r.right, y: (r.top + r.bottom) / 2}));
  }, selector);
  const clear = async () => {
    const blank = await page.locator("#blank").boundingBox();
    await page.mouse.click(blank.x + 300, blank.y + 60);
    await page.evaluate(() => getSelection().removeAllRanges());
    await expect.poll(async () => (await shownLayers(page)).length).toBe(0);
  };
  const sends = async (how) => {
    await page.waitForTimeout(600);   // settled; the selection's button stands alone
    await expect.poll(async () => (await shownLayers(page)).length, {message: how}).toBe(1);
    const [batch] = await shownLayers(page);
    const before = dp.state.submits;
    await page.mouse.move(batch.left + batch.width / 2, batch.top + batch.height / 2, {steps: 4});
    await page.waitForTimeout(300);
    await page.mouse.click(batch.left + batch.width / 2, batch.top + batch.height / 2);
    await expect.poll(() => dp.state.submits, {message: how}).toBe(before + 1);
    await clear();
  };
  const block = await text("#block");
  // Dragged across with the mouse.
  await page.mouse.move(block[0].left + 1, block[0].y);
  await page.mouse.down();
  await page.mouse.move(block.at(-1).right + 2, block.at(-1).y, {steps: 10});
  await page.mouse.up();
  await sends("drag");
  // Double-clicked (a block a site lets select whole, user-select: all).
  const all = await text("#all");
  await page.mouse.dblclick(all[0].left + 20, all[0].y);
  await sends("double-click");
  // Triple-clicked: the paragraph.
  const para = await text("#para");
  await page.mouse.click(para[0].left + 20, para[0].y, {clickCount: 3});
  await sends("triple-click");
  // Shift+click: from one click to another.
  await page.mouse.click(block[0].left + 1, block[0].y);
  await page.keyboard.down("Shift");
  await page.mouse.click(block.at(-1).right - 1, block.at(-1).y);
  await page.keyboard.up("Shift");
  await sends("shift+click");
  // Shift+arrows: from a click, a line at a time.
  await page.mouse.click(block[0].left + 1, block[0].y);
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  await sends("shift+arrows");
  // Ctrl+A: the whole page (Cmd+A on a Mac is the same keydown/keyup and selectionchange).
  await page.keyboard.press("Control+a");
  await sends("ctrl+a");
  // The page's own "Select all" button, clicked: the page's script selects, right after the person's click.
  await page.getByRole("button", {name: "Select all links"}).click();
  await sends("select-all button");
  // A selection a script makes with no input from the person: nothing.
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("block"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForTimeout(1000);
  expect(await shownLayers(page)).toEqual([]);
});

test("the button works from the keyboard (Tab, then Enter or Space); a page's synthetic key does nothing", async () => {
  await connect();
  for (const key of ["Enter", " "]) {
    const page = await open("/kbd");
    await hover(page, "#magnet");
    await page.keyboard.press("Tab");   // the link
    await page.keyboard.press("Tab");   // the button (the layer is the page's last element)
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches(":popover-open") ?? false)).toBe(true);
    const before = dp.state.submits;
    // The page's own keys on what has focus: nothing.
    await page.evaluate((k) => {
      for (const type of ["keydown", "keypress", "keyup"]) {
        document.activeElement.dispatchEvent(new KeyboardEvent(type, {key: k, code: k === " " ? "Space" : k, bubbles: true, composed: true}));
      }
    }, key);
    await page.waitForTimeout(800);
    expect(dp.state.submits, `synthetic ${JSON.stringify(key)}`).toBe(before);
    await page.keyboard.press(key === " " ? "Space" : key);
    await expect.poll(() => dp.state.submits, {message: JSON.stringify(key)}).toBe(before + 1);
    await page.close();
  }
});
