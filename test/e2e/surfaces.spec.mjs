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
import {fakeSite, TORRENT, NZB} from "./fake-site.mjs";

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
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
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
  .filter((host) => (host.matches(":popover-open") && getComputedStyle(host).display !== "none")).map((host) => {
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

/** The link's rendered text on the line at ``y``: the glyphs' own boxes. */
const textLine = (page, selector, y) => page.evaluate(([sel, at]) => {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector(sel));
  const rects = [...range.getClientRects()].filter((r) => r.width && at >= r.top && at <= r.bottom);
  return {right: Math.max(...rects.map((r) => r.right)), middle: (rects[0].top + rects[0].bottom) / 2};
}, [selector, y]);

test("the hover icon sits a constant gap after the link's text, however wide the link's box", async () => {
  await connect();
  const page = await sitePage();
  for (const [selector, at] of [["#zip", "start"], ["#row", "start"], ["#wrapped", "second line"]]) {
    const box = await page.locator(selector).boundingBox();
    let y = box.y + box.height / 2;
    let x = box.x + 5;
    if (at === "second line") {
      const lines = await page.locator(selector).evaluate((el) => [...el.getClientRects()].map((r) => ({x: r.left, y: (r.top + r.bottom) / 2})));
      expect(lines.length).toBeGreaterThan(1);
      ({x, y} = {x: lines[1].x + 3, y: lines[1].y});
    }
    await page.mouse.move(1, 1);
    await page.waitForTimeout(500);
    await page.mouse.move(x, y, {steps: 3});
    await expect.poll(async () => (await openLayers(page)).length).toBe(1);
    const [layer] = await openLayers(page);
    const text = await textLine(page, selector, y);
    expect(Math.abs(layer.left - (text.right + 8)), `${selector} ${at}`).toBeLessThanOrEqual(1);   // 8 px after the text
    expect(Math.abs(layer.top + layer.height / 2 - text.middle), `${selector} ${at}`).toBeLessThanOrEqual(1.5);
  }
  // A stretched link's icon is by its text, nowhere near the far end of its box.
  const row = await page.locator("#row").boundingBox();
  const [layer] = await openLayers(page).then(async () => {
    await page.mouse.move(1, 1); await page.waitForTimeout(500);
    await page.mouse.move(row.x + 5, row.y + row.height / 2, {steps: 3});
    await expect.poll(async () => (await openLayers(page)).length).toBe(1);
    return openLayers(page);
  });
  expect(layer.left).toBeLessThan(row.x + row.width / 2);
});

test("the in-page surfaces are drawn in the person's DownloadPulse theme", async () => {
  const popup = await connect();
  const page = await sitePage();
  const button = async () => {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    const box = await page.locator("#zip").boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
    await expect.poll(async () => (await openLayers(page)).length).toBe(1);
    return page.evaluate(() => {
      const host = [...document.querySelectorAll("downloadpulse-layer")].find((h) => h.matches(":popover-open"));
      const style = getComputedStyle(host);
      return {primary: style.getPropertyValue("--dp-primary"), border: style.getPropertyValue("--dp-primary-border"),
        text: style.getPropertyValue("--dp-primary-text")};
    });
  };
  // DownloadPulse Dark: its primary button material.
  expect(await button()).toMatchObject({primary: expect.stringContaining("#8d48db"), border: "rgba(160,94,221,.78)", text: "#ffffff"});
  // Nord Light chosen in DownloadPulse: the dropdown learns it, and the page's next ask follows.
  dp.state.appearance = {mode: "light", dark_palette: "debridpulse-dark", light_palette: "nord-light"};
  await popup.reload();
  await expect(popup.locator("html")).toHaveAttribute("data-palette", "nord-light");
  await page.waitForTimeout(5500);   // a frame's answer is kept for up to 5 s
  expect(await button()).toEqual({primary: "linear-gradient(145deg, #5e81ac 0%, #5e81ac 100%)", border: "#5e81ac", text: "#eceff4"});
});

test("a link stretched across its row offers the icon only on its text; along the row it goes", async () => {
  await connect();
  const page = await sitePage();
  const box = await page.locator("#row").boundingBox();
  const text = await textLine(page, "#row", box.y + box.height / 2);
  expect(box.x + box.width - text.right).toBeGreaterThan(200);       // the box runs far past the text
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, {steps: 3});   // the box's empty end
  await page.waitForTimeout(500);
  expect(await openLayers(page)).toEqual([]);
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 6});               // on the text
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
  const [icon] = await openLayers(page);
  await page.mouse.move(icon.left + icon.width / 2, icon.top + icon.height / 2, {steps: 6});   // across to the icon: stays
  await page.waitForTimeout(500);
  expect((await openLayers(page)).length).toBe(1);
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, {steps: 10});  // along the row, off the text
  await expect.poll(async () => (await openLayers(page)).length, {timeout: 1500}).toBe(0);
});

test("the hover icon goes once the pointer moves off the link, withdrawn from the page entirely", async () => {
  await connect();
  const page = await sitePage();
  for (const selector of ["#zip", "#row"]) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
    await expect.poll(async () => (await openLayers(page)).length).toBe(1);
    await page.mouse.move(980, box.y + box.height / 2, {steps: 6});   // off the link, into empty space
    await expect.poll(async () => (await openLayers(page)).length, {timeout: 1500}).toBe(0);
    // Withdrawn entirely: nothing of the extension's is left in the page.
    expect(await page.evaluate(() => document.querySelectorAll("downloadpulse-layer").length)).toBe(0);
  }
});

test("the hover icon goes when the page scrolls or the pointer leaves the page", async () => {
  await connect();
  const page = await sitePage();
  const show = async () => {
    const box = await page.locator("#zip").boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
    await expect.poll(async () => (await openLayers(page)).length).toBe(1);
  };
  await show();
  await page.evaluate(() => scrollBy(0, 40));                        // the link moves; the icon would not
  await expect.poll(async () => (await openLayers(page)).length).toBe(0);
  await page.evaluate(() => scrollTo(0, 0));
  await show();
  await page.mouse.move(-5, -5);                                     // out of the page
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerout", {relatedTarget: null})));
  await expect.poll(async () => (await openLayers(page)).length).toBe(0);
});

/** The open layers other than the toast (which sits at the bottom corner). */
const buttonLayers = (page) => page.evaluate(() => [...document.querySelectorAll("downloadpulse-layer")]
  .filter((host) => (host.matches(":popover-open") && getComputedStyle(host).display !== "none") && host.style.bottom !== "16px").map((host) => {
    const r = host.getBoundingClientRect();
    return {left: r.left, top: r.top, width: r.width, height: r.height};
  }));

test("content moved with no scroll event (a page's own scroller): the icons leave it, the selection's comes back", async () => {
  await connect();
  const page = await sitePage();
  const move = (y) => page.evaluate((dy) => { document.querySelector("#mover").style.transform = `translateY(${dy}px)`; }, y);
  const box = await page.locator("#moverlink").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  await move(40);                                                   // no scroll event, no pointer move
  await expect.poll(async () => (await buttonLayers(page)).length, {timeout: 1000}).toBe(0);
  await page.mouse.move(1, 1);
  await move(0);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#movertext"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  await move(60);
  await expect.poll(async () => (await buttonLayers(page)).length, {timeout: 1000}).toBe(0);
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);   // back, where the selection now ends
  const [layer] = await buttonLayers(page);
  const end = await page.evaluate(() => {
    const rects = [...getSelection().getRangeAt(0).getClientRects()].filter((r) => r.width > 1);
    return {right: rects.at(-1).right, middle: (rects.at(-1).top + rects.at(-1).bottom) / 2};
  });
  expect(Math.abs(layer.left - (end.right + 8))).toBeLessThanOrEqual(1);
  expect(Math.abs(layer.top + layer.height / 2 - end.middle)).toBeLessThanOrEqual(1.5);
});

test("selected links get a send button with their count, which sends them as one batch", async () => {
  await connect();
  const page = await sitePage();
  const select = (selector) => page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, selector);
  await page.locator("#live").scrollIntoViewIfNeeded();
  // One ordinary web link selected: nothing offered.
  await select("#one");
  await page.waitForTimeout(700);
  expect(await buttonLayers(page)).toEqual([]);
  // Three links in the page's text.
  await select("#live");
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  const [layer] = await buttonLayers(page);
  const end = await page.evaluate(() => {
    const rects = [...getSelection().getRangeAt(0).getClientRects()].filter((r) => r.width > 1);
    return {right: rects.at(-1).right, middle: (rects.at(-1).top + rects.at(-1).bottom) / 2};
  });
  expect(Math.abs(layer.left - (end.right + 8))).toBeLessThanOrEqual(1);
  expect(Math.abs(layer.top + layer.height / 2 - end.middle)).toBeLessThanOrEqual(1.5);
  // Scrolling: gone at once; back by the selection's end once it settles; nowhere while that end is out of view.
  const at = () => page.evaluate(() => {
    const rects = [...getSelection().getRangeAt(0).getClientRects()].filter((r) => r.width > 1);
    return {right: rects.at(-1).right, middle: (rects.at(-1).top + rects.at(-1).bottom) / 2, bottom: rects.at(-1).bottom};
  });
  // Gone within the frame the scroll is handled in (before it could come back, 200 ms after it settles).
  expect(await page.evaluate(async () => {
    scrollBy(0, 60);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return [...document.querySelectorAll("downloadpulse-layer")]
      .filter((host) => (host.matches(":popover-open") && getComputedStyle(host).display !== "none") && host.style.bottom !== "16px").length;
  })).toBe(0);
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  const [moved] = await buttonLayers(page);
  const now = await at();
  expect(Math.abs(moved.left - (now.right + 8))).toBeLessThanOrEqual(1);
  expect(Math.abs(moved.top + moved.height / 2 - now.middle)).toBeLessThanOrEqual(1.5);
  await page.evaluate((bottom) => scrollBy(0, bottom + 50), now.bottom);   // its end above the window
  await page.waitForTimeout(700);
  expect(await buttonLayers(page)).toEqual([]);
  await page.locator("#live").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  const [back] = await buttonLayers(page);
  await page.mouse.click(back.left + 8, back.top + 8);
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "links", links: ["https://1fichier.com/?j93yc0n4g08jsox2nipk",
    "https://rapidgator.net/file/119ce5/GF161126-HITC-RN.rar.html", "https://gofile.io/d/AM5Js2xh"]});
  // Links in rows with a trailing empty block, the whole container selected: the button is after the last link's text,
  // not after the trailing block (a range's boxes include whole elements).
  await page.locator("#rows").scrollIntoViewIfNeeded();
  await select("#rows");
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  const [rowsLayer] = await buttonLayers(page);
  const lastText = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#rows").children[1].firstChild);
    const r = range.getClientRects()[0];
    return {right: r.right, middle: (r.top + r.bottom) / 2};
  });
  expect(Math.abs(rowsLayer.left - (lastText.right + 8))).toBeLessThanOrEqual(1);
  expect(Math.abs(rowsLayer.top + rowsLayer.height / 2 - lastText.middle)).toBeLessThanOrEqual(1.5);
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(0);
  // Two links selected in a text box.
  await page.locator("#box").evaluate((box) => { box.focus(); box.select(); });
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  const [boxed] = await buttonLayers(page);
  await page.mouse.click(boxed.left + 8, boxed.top + 8);
  await expect.poll(() => dp.state.jobs.length).toBe(2);
  expect(dp.state.jobs[1].body.source).toEqual({kind: "links", links: ["https://pixeldrain.com/u/a4J8buzm", "https://send.now/ijn6gxxf9bj8"]});
  // While a selection's batch button is up, hovering one of its links adds no second button.
  await page.locator("#box").evaluate((box) => box.blur());
  await page.locator("#rows").scrollIntoViewIfNeeded();
  await select("#rows");
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(1);
  const [only] = await buttonLayers(page);
  const first = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#rows").children[0].firstChild);
    const r = range.getClientRects()[0];
    return {x: r.left + 20, y: (r.top + r.bottom) / 2};
  });
  await page.mouse.move(first.x, first.y, {steps: 4});              // over a .rar link, inside the selection
  await page.waitForTimeout(700);
  expect(await buttonLayers(page)).toEqual([only]);                  // the batch button alone, where it was
  // Not rendered at all: the batch button is the only extension element in the page (besides a toast).
  expect(await page.evaluate(() => [...document.querySelectorAll("downloadpulse-layer")]
    .filter((host) => host.style.bottom !== "16px").length)).toBe(1);
  // Selection cleared: the button goes.
  await page.evaluate(() => { document.activeElement.blur(); getSelection().removeAllRanges(); });
  await expect.poll(async () => (await buttonLayers(page)).length).toBe(0);
});

test("a toast leaves on its own, and at once when clicked", async () => {
  await connect();
  const page = await sitePage();
  const send = async () => {
    const box = await page.locator("#zip").boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
    await expect.poll(async () => (await openLayers(page)).length).toBe(1);
    const [layer] = await openLayers(page);
    await page.mouse.click(layer.left + 8, layer.top + 8);
  };
  const toastOpen = () => page.evaluate(() => [...document.querySelectorAll("downloadpulse-layer")]
    .filter((host) => (host.matches(":popover-open") && getComputedStyle(host).display !== "none") && host.style.bottom === "16px").length);
  await send();
  await expect.poll(toastOpen).toBe(1);
  await expect.poll(toastOpen, {timeout: 6000}).toBe(0);
  await send();
  await expect.poll(toastOpen).toBe(1);
  const box = await page.evaluate(() => {
    const host = [...document.querySelectorAll("downloadpulse-layer")].find((h) => h.style.bottom === "16px");
    const r = host.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  });
  await page.mouse.click(box.x, box.y);
  await expect.poll(toastOpen, {timeout: 1500}).toBe(0);
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

test("an indexer's download link gets no hover button; sent by selection (as by right-click) it is captured as the NZB", async () => {
  await connect();
  const page = await sitePage();
  // No hover button: the indexer draws its own download icon; right-click and a selection send it.
  await page.locator("#indexer").scrollIntoViewIfNeeded();
  const box = await page.locator("#indexer").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.querySelectorAll("downloadpulse-layer").length)).toBe(0);
  // Sent: captured -- the indexer's name, or the NZB's own; the key never reaches DownloadPulse.
  await page.locator("#indexer-text").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#indexer-text"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
  const [layer] = await openLayers(page);
  await page.mouse.click(layer.left + 8, layer.top + 8);
  await expect.poll(() => dp.state.jobs.length).toBe(2);
  const sources = dp.state.jobs.map((job) => job.body.source);
  expect(sources.map((source) => source.kind)).toEqual(["nzb", "nzb"]);
  expect(sources.map((source) => source.filename)).toEqual(["The.Odyssey.2026.1080p.nzb", "The.Odyssey.2026.2160p.nzb"]);
  for (const source of sources) expect(Buffer.from(source.nzb_base64, "base64").equals(NZB)).toBe(true);
  // The indexer refusing (an <error> document, with 200): nothing is sent.
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#indexer-limit"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await expect.poll(async () => (await openLayers(page)).filter((l) => l.top < 700).length).toBeGreaterThan(0);
  const [limited] = (await openLayers(page)).filter((l) => l.top < 700);
  await page.mouse.click(limited.left + 8, limited.top + 8);
  await page.waitForTimeout(1500);
  expect(dp.state.jobs.length).toBe(2);
  expect(JSON.stringify(dp.state.jobs)).not.toContain("SECRETINDEXERKEY");
  expect(JSON.stringify(dp.state.jobs)).not.toContain("apikey");
});

test("captures follow no redirect and never use plain HTTP across the internet (store review)", async () => {
  await connect();
  const page = await sitePage();
  const toast = () => page.evaluate(() => [...document.querySelectorAll("downloadpulse-layer")].filter((h) => h.style.bottom === "16px").length);
  await hoverAndClick(page, "#redirecting");
  await expect.poll(toast).toBe(1);
  await page.waitForTimeout(800);
  // The redirect was answered, and its target never requested: nothing followed it.
  expect(site.state.requests.some((r) => r.path.startsWith("/files/redirecting.torrent"))).toBe(true);
  expect(site.state.requests.some((r) => r.path.startsWith("/files/redirect-target.torrent"))).toBe(false);
  expect(dp.state.jobs).toEqual([]);
  // A plain-HTTP link on the internet: refused before any request.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(4200);                    // the first toast leaves
  await hoverAndClick(page, "#public-http");
  await expect.poll(toast).toBe(1);
  await page.waitForTimeout(800);
  expect(dp.state.jobs).toEqual([]);
  expect(JSON.stringify(dp.state.jobs)).not.toContain("SECRETPUBLIC");
});

test("a held connection fetches nothing: a button still offered from a page's cached answer contacts no site (store review)", async () => {
  const popup = await connect();
  const page = await sitePage();
  await context.addCookies([{name: "site_session", value: "signed-in", url: site.base}]);
  const box = await page.locator("#torrent").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);   // offered while usable (cached up to 5 s)
  await popup.evaluate(() => chrome.storage.local.remove("consent"));        // now held
  const [layer] = await openLayers(page);
  await page.mouse.move(layer.left + layer.width / 2, layer.top + layer.height / 2, {steps: 2});
  await page.mouse.click(layer.left + layer.width / 2, layer.top + layer.height / 2);
  await page.waitForTimeout(1500);
  expect(site.state.requests.some((r) => r.path.startsWith("/files/private.torrent"))).toBe(false);   // the site was never asked
  expect(dp.state.jobs).toEqual([]);
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
  // Beside the frame, never over the picture: 8 px right of its top corner.
  expect(Math.abs(layer.left - (video.x + video.width + 8))).toBeLessThanOrEqual(1);
  expect(Math.abs(layer.top - video.y)).toBeLessThanOrEqual(1);
  await page.mouse.move(layer.left + 5, layer.top + 5, {steps: 6});   // across the gap: it stays
  expect((await openLayers(page)).length).toBe(1);
  await page.mouse.click(layer.left + layer.width / 2, layer.top + layer.height / 2);
  await expect.poll(() => dp.state.jobs.length).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "links", links: [`${site.base}/page`]});
  // A page's path ("page", YouTube's "watch") is no file name: none is sent.
  expect(dp.state.jobs[0].body.display_name).toBeUndefined();
});

test("the video button is not drawn fullscreen, nor where there is no room beside the frame", async () => {
  await connect();
  const page = await sitePage();
  const hoverVideo = async () => {
    const box = await page.locator("#video").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 3});
  };
  await hoverVideo();
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
  await page.click("#full");
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await hoverVideo();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.querySelectorAll("downloadpulse-layer").length)).toBe(0);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  // A frame spanning the window: no room to its right.
  await page.evaluate(() => { const v = document.querySelector("#video"); v.style.width = "100vw"; v.removeAttribute("width"); });
  await page.mouse.move(1, 1);
  await hoverVideo();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.querySelectorAll("downloadpulse-layer").length)).toBe(0);
});

test("a video preview (inside a link, or under one) gets no video button; the page's own video does", async () => {
  await connect();
  const page = await sitePage();
  for (const selector of ["#thumb video", "#overlaid video"]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(1, 1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 3});
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.querySelectorAll("downloadpulse-layer").length), selector).toBe(0);
  }
  await page.locator("#video").scrollIntoViewIfNeeded();
  const main = await page.locator("#video").boundingBox();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2, {steps: 3});
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
});

test("an SVG icon over the video (a player's play glyph) still finds the video (Chromium's shadow lookup refuses SVG)", async () => {
  await connect();
  const page = await sitePage();
  await page.locator("#video").scrollIntoViewIfNeeded();
  const icon = await page.locator("#play-icon").boundingBox();
  await page.mouse.move(1, 1);
  await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2, {steps: 3});
  await expect.poll(async () => (await openLayers(page)).length).toBe(1);
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
  // A WS-E1 connection has no agreement on record: it is held until the person agrees (store review).
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await expect(popup.getByTestId("account")).toHaveText("Una");
  expect(JSON.stringify(await popup.evaluate(() => chrome.storage.local.get(null)))).not.toContain("dp_fake-token");
  // And it still works: a send goes through with it.
  const page = await sitePage();
  await hoverAndClick(page, "#zip");
  await expect.poll(() => dp.state.jobs.length).toBe(1);
});
