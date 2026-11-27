// SPDX-License-Identifier: GPL-2.0-or-later
// WS-E3: the popup's list of this browser's downloads, its controls, the
// notifications, and the monitor's lifetime, against the fake DownloadPulse.
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

let dp, site, context, profile, popup;

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-downloads-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1000, height: 800},
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  // Newly connected: browser downloads are offered once (1.0.2); these tests send by hand.
  await popup.getByRole("button", {name: "Not now"}).click({timeout: 15_000});
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
});

test.afterEach(async () => {
  await context.close();
  await rm(profile, {recursive: true, force: true});
  await dp.close();
  await site.close();
});

/** Send the site's archive.zip through the hover icon (WS-E2), as a person would. */
async function sendArchive() {
  await hoverSend();
  await expect.poll(() => dp.state.views.size).toBe(1);
  return [...dp.state.views.keys()][0];
}

/** The hover-icon send itself (sendArchive, or the same send again). */
async function hoverSend() {
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  const box = await page.locator("#zip").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(":root > div[popover]:popover-open")].filter((h) => getComputedStyle(h).display !== "none").length)).toBe(1);
  const at = await page.evaluate(() => {
    const r = document.querySelector(":root > div[popover]:popover-open").getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  });
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.waitForTimeout(400);   // a press counts once the button has stood still, seen (1.0.8)
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  await page.close();
}

const row = (id) => popup.locator(`li[data-job-id="${id}"]`);
// The status line as read: the estimate's time is a left-to-right isolate (U+2066..U+2069).
const stateOf = (id) => row(id).locator("[data-testid='state']").evaluate((el) => el.textContent.replace(/[\u2066\u2069]/g, ""));
const colour = (locator) => locator.evaluate((el) => getComputedStyle(el).color);

test("a sent download: its name on one line, its status in DownloadPulse's colour, a compact estimate", async () => {
  const id = await sendArchive();
  await expect(row(id).locator(".dp-job__name")).toHaveText("archive.zip");
  await expect.poll(() => stateOf(id)).toBe("Waiting");
  await expect(row(id)).toHaveAttribute("data-tone", "queued");
  dp.setJob(id, {phase: "processing", reason: "downloading", progress: {percent: 10, effective: {percent: 42}},
    estimate: {seconds: 300, held: false, estimated: false, indeterminate: false}});
  await expect.poll(() => stateOf(id)).toBe("Downloading · ETA: 5:00");
  await expect(row(id)).toHaveAttribute("data-tone", "downloading");
  await expect.poll(() => colour(row(id).locator(".dp-job__status"))).toBe("rgb(0, 230, 118)");   // DownloadPulse's success green (Dark, as the person chose)
  await expect(row(id).getByTestId("percent")).toHaveText("42%");
  await expect(row(id).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  for (const [seconds, shown] of [[45, "0:45"], [1992, "33:12"], [3725, "1:02:05"]]) {
    dp.setJob(id, {estimate: {seconds, held: false, estimated: false, indeterminate: false}});
    await expect.poll(() => stateOf(id)).toBe(`Downloading · ETA: ${shown}`);
  }
  dp.setJob(id, {estimate: {seconds: null, held: false, estimated: true, indeterminate: true}});
  await expect.poll(() => stateOf(id)).toBe("Downloading · ETA: ∞");
  // The percent has a slot of its own, reserved: the bar keeps its length from no figure to 100%.
  const barWidth = () => row(id).getByRole("progressbar").evaluate((el) => el.getBoundingClientRect().width);
  const widths = [];
  for (const percent of [null, 1, 100]) {
    dp.setJob(id, {progress: {percent, effective: {percent}}});
    await expect(row(id).getByTestId("percent")).toHaveText(percent === null ? "" : `${percent}%`);
    widths.push(await barWidth());
  }
  expect(new Set(widths).size).toBe(1);
  // DownloadPulse resolves the title: the list follows it, on one line, cut, its whole name its tooltip.
  const title = "The Real Title Of A Rather Long Video Somebody Uploaded With 100% True Words [abc123].webm";
  dp.setJob(id, {name: title});
  await expect(row(id).locator(".dp-job__name")).toHaveText(title);
  await expect(row(id).locator(".dp-job__name")).toHaveAttribute("title", title);
  const name = await row(id).locator(".dp-job__name").evaluate((el) => ({
    lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
    cut: el.scrollWidth > el.clientWidth}));
  expect(name).toEqual({lines: 1, cut: true});
  // Paused: yellow; failed: red; done: no colour.
  dp.setJob(id, {reason: "paused", paused_by: "client"});
  await expect(row(id)).toHaveAttribute("data-tone", "paused");
  await expect.poll(() => colour(row(id).locator(".dp-job__status"))).toBe("rgb(255, 193, 61)");
  dp.setJob(id, {phase: "failed", reason: "acquisition_failed", actionability: "operator"});
  await expect(row(id)).toHaveAttribute("data-tone", "failed");
  await expect.poll(() => colour(row(id).locator(".dp-job__status"))).toBe("rgb(255, 82, 100)");
  // No controls once it failed: only Remove from list (this browser's list).
  await expect(row(id).getByRole("button")).toHaveCount(1);
  await expect(row(id).getByRole("button", {name: "Remove from list"})).toHaveCount(1);
  await expect(row(id).getByRole("progressbar")).toHaveCount(0);
  dp.setJob(id, {phase: "completed", reason: "completed", actionability: "none"});
  await expect(row(id)).toHaveAttribute("data-tone", "none");
  // Done, as DownloadPulse shows it: the bar full in its completion green, "Done" in green right of the bar.
  const bar = row(id).getByRole("progressbar");
  await expect(bar).toHaveAttribute("aria-valuenow", "100");
  const done = await row(id).evaluate((li) => {
    const bar = li.querySelector(".dp-job__bar").getBoundingClientRect();
    const fill = li.querySelector(".dp-job__fill");
    const word = li.querySelector("[data-testid='state']");
    const at = word.getBoundingClientRect();
    return {fill: getComputedStyle(fill).backgroundColor, full: Math.round(fill.getBoundingClientRect().width) === Math.round(bar.width),
      word: word.textContent, colour: getComputedStyle(word).color, right: at.left >= bar.right,
      middle: Math.abs((at.top + at.bottom) / 2 - (bar.top + bar.bottom) / 2) <= 2, line: li.querySelector(".dp-job__line") === null};
  });
  expect(done).toEqual({fill: "rgb(0, 230, 118)", full: true, word: "Done", colour: "rgb(0, 230, 118)", right: true, middle: true, line: true});
  dp.setJob(id, {phase: "failed", reason: "acquisition_failed", actionability: "operator"});
  // A failed download's status stands alone on its line, centred in the row.
  const centred = () => row(id).evaluate((li) => {
    const range = document.createRange();
    range.selectNodeContents(li.querySelector(".dp-job__status"));
    const text = range.getBoundingClientRect(), box = li.getBoundingClientRect();
    return Math.abs((text.left + text.right) / 2 - (box.left + box.right) / 2) <= 1.5;
  });
  await expect(row(id)).toHaveAttribute("data-tone", "failed");
  await expect.poll(centred).toBe(true);
});

test("pause and resume are this browser's own glyph buttons, on the status line; a declined pause says why", async () => {
  const id = await sendArchive();
  dp.setJob(id, {phase: "processing", reason: "downloading"});
  await expect.poll(() => stateOf(id)).toBe("Downloading");
  const line = row(id).locator(".dp-job__line");
  await expect(line.getByRole("button", {name: "Pause"}).locator("svg[data-glyph='pause']")).toHaveCount(1);
  await expect(line.getByRole("button", {name: "Remove"}).locator("svg[data-glyph='trash2']")).toHaveCount(1);
  await expect(line.getByRole("button", {name: "Remove"})).toHaveClass(/dp-glyph-btn--danger/);
  await line.getByRole("button", {name: "Pause"}).click();
  await expect.poll(() => stateOf(id)).toBe("Paused from this browser");
  await expect(line.getByRole("button", {name: "Resume"}).locator("svg[data-glyph='play']")).toHaveCount(1);
  await line.getByRole("button", {name: "Resume"}).click();
  await expect.poll(() => stateOf(id)).toBe("Downloading");
  expect(dp.state.controls.map((c) => c.kind)).toEqual(["pause", "resume"]);
  expect(new Set(dp.state.controls.map((c) => c.request_key)).size).toBe(2);
  dp.state.declineControl = "shared_interest";
  await row(id).getByRole("button", {name: "Pause"}).click();
  await expect(row(id).locator(".dp-job__note")).toHaveText("Other requests need this download, so it can't be paused from here.");
});

test("sent again while paused here, the one download resumes; paused in DownloadPulse, it goes as a new request", async () => {
  // Operator, 2026-11-22: the same send repeated within 10 minutes was a silent replay of a paused job.
  const id = await sendArchive();
  dp.setJob(id, {phase: "processing", reason: "downloading"});
  await expect.poll(() => stateOf(id)).toBe("Downloading");
  await row(id).locator(".dp-job__line").getByRole("button", {name: "Pause"}).click();
  await expect.poll(() => stateOf(id)).toBe("Paused from this browser");
  await hoverSend();
  await expect.poll(() => dp.state.controls.map((c) => c.kind)).toEqual(["pause", "resume"]);
  await expect.poll(() => stateOf(id)).toBe("Downloading");
  expect(dp.state.views.size).toBe(1);                       // the one download, never a second
  // Paused by someone in DownloadPulse (another person sharing it included): the person may
  // resume it from here, as in DownloadPulse -- the Resume button, and a send, resume it.
  dp.setJob(id, {phase: "processing", reason: "paused", paused_by: "operator"});
  await expect.poll(() => stateOf(id)).toBe("Paused in DownloadPulse");
  await row(id).locator(".dp-job__line").getByRole("button", {name: "Resume"}).click();
  await expect.poll(() => stateOf(id)).toBe("Downloading");
  dp.setJob(id, {phase: "processing", reason: "paused", paused_by: "operator"});
  await expect.poll(() => stateOf(id)).toBe("Paused in DownloadPulse");
  await hoverSend();
  await expect.poll(() => stateOf(id)).toBe("Downloading");
  expect(dp.state.controls.map((c) => c.kind)).toEqual(["pause", "resume", "resume", "resume"]);
  expect(dp.state.views.size).toBe(1);
  // Everything paused at once is not this browser's to lift: no Resume, and a send goes as a new
  // request, which DownloadPulse joins to the one download.
  dp.setJob(id, {phase: "processing", reason: "paused", paused_by: "administrator"});
  await expect.poll(() => stateOf(id)).toBe("Paused in DownloadPulse");
  await expect(row(id).locator(".dp-job__line").getByRole("button", {name: "Resume"})).toHaveCount(0);
  await hoverSend();
  await expect.poll(() => dp.state.views.size).toBe(2);
  expect(dp.state.controls).toHaveLength(4);
});

test("the connection's status: green while DownloadPulse answers, yellow while it can't be reached", async () => {
  const reach = popup.getByTestId("reach");
  await expect(reach).toHaveAttribute("data-reach", "ok", {timeout: 15_000});
  await expect(reach).toHaveText("Connected");
  await expect.poll(() => colour(reach)).toBe("rgb(0, 230, 118)");
  dp.state.down = true;
  await expect(reach).toHaveAttribute("data-reach", "unreachable", {timeout: 15_000});
  await expect(reach).toHaveText("Can't reach DownloadPulse");
  await expect.poll(() => colour(reach)).toBe("rgb(255, 193, 61)");
  await expect(popup.getByTestId("account")).toHaveText("Una");   // still connected: nothing forgotten
  dp.state.down = false;
  await expect(reach).toHaveAttribute("data-reach", "ok", {timeout: 15_000});
});

test("the icon breathes while a download is active, and stops while DownloadPulse can't be reached (1.0.3)", async () => {
  const worker = context.serviceWorkers()[0];
  // Count the toolbar icon's redraws (the breath is one every 125 ms).
  await worker.evaluate(() => {
    globalThis.__iconDraws = 0;
    const setIcon = chrome.action.setIcon.bind(chrome.action);
    chrome.action.setIcon = (details) => { globalThis.__iconDraws += 1; return setIcon(details); };
  });
  const draws = () => worker.evaluate(() => globalThis.__iconDraws);
  const id = await sendArchive();
  dp.setJob(id, {phase: "processing", reason: null, actionability: "wait"});
  await expect.poll(draws, {timeout: 15_000}).toBeGreaterThan(5);
  dp.state.down = true;
  await expect(popup.getByTestId("reach")).toHaveAttribute("data-reach", "unreachable", {timeout: 15_000});
  await popup.waitForTimeout(500);   // the frame in flight, then the icon at rest
  const resting = await draws();
  await popup.waitForTimeout(3000);
  expect(await draws()).toBe(resting);
  // Answering again: it breathes again.
  dp.state.down = false;
  await expect.poll(async () => (await draws()) - resting, {timeout: 15_000}).toBeGreaterThan(5);
});

test("Open DownloadPulse: a server opens in a tab; the desktop application comes forward instead", async () => {
  const open = popup.getByRole("button", {name: "Open DownloadPulse"});
  await expect(open).toHaveClass(/dp-btn--ghost/);
  // Visible as a button: DownloadPulse's ghost (.btn.btn-ghost) is drawn with the secondary edge and surface.
  const edge = await open.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(edge).not.toBe("rgba(0, 0, 0, 0)");
  expect(await open.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
  const url = popup.url();
  const tab = context.waitForEvent("page");
  await open.click();
  expect((await tab).url()).toBe("http://127.0.0.1:8095/");
  expect(dp.state.shows).toBe(0);
  // Having opened something, the dropdown closes itself, as a toolbar dropdown does.
  await expect.poll(() => popup.isClosed()).toBe(true);
  dp.state.desktop = true;
  const again = await context.newPage();
  await again.goto(url);
  const pages = context.pages().length;
  await again.getByRole("button", {name: "Open DownloadPulse"}).click();
  await expect.poll(() => dp.state.shows).toBe(1);
  await new Promise((done) => setTimeout(done, 1000));
  expect(context.pages().filter((page) => page.url() === "http://127.0.0.1:8095/").length).toBe(1);   // no second tab
  expect(context.pages().length).toBeLessThanOrEqual(pages);
});

test("the status is centred on its row; the footer holds Open DownloadPulse at its start and Clear at its end", async () => {
  const centre = (box) => box.x + box.width / 2;
  const [row, status, page] = await Promise.all([popup.locator(".dp-conn").boundingBox(),
    popup.locator(".dp-conn").evaluate((el) => {
      const kids = [...el.children].map((child) => child.getBoundingClientRect());
      return {left: Math.min(...kids.map((r) => r.left)), right: Math.max(...kids.map((r) => r.right))};
    }), popup.locator("main").boundingBox()]);
  expect(Math.abs((status.left + status.right) / 2 - centre(page))).toBeLessThanOrEqual(1.5);
  const foot = popup.locator("footer.dp-foot");
  const [open, clear, footer] = await Promise.all([foot.getByRole("button", {name: "Open DownloadPulse"}).boundingBox(),
    foot.getByRole("button", {name: "Clear finished downloads"}).boundingBox(), foot.boundingBox()]);
  expect(open.x).toBeLessThan(footer.x + 20);
  expect(clear.x + clear.width).toBeGreaterThan(footer.x + footer.width - 20);
  await expect(foot.getByRole("button", {name: "Clear finished downloads"}).locator("svg[data-glyph='trash2']")).toHaveCount(1);
  await expect(foot.getByRole("button", {name: "Clear finished downloads"})).toHaveClass(/dp-glyph-btn--danger/);
  expect(row).toBeTruthy();
});

test("Quick Add: above Sent Downloads, its Add inside the field; the result on the title row, nothing moving", async () => {
  const quick = popup.locator(".dp-quick");
  const field = popup.locator("#quick"), add = quick.getByRole("button", {name: "Add", exact: true});
  const [title, list, input, button] = await Promise.all([quick.getByRole("heading", {name: "Quick Add"}).boundingBox(),
    popup.getByRole("heading", {name: "Sent Downloads:"}).boundingBox(), field.boundingBox(), add.boundingBox()]);
  expect(title.y).toBeLessThan(input.y);
  expect(input.y + input.height).toBeLessThan(list.y);
  expect(title.x).toBeLessThanOrEqual(input.x + 1);                                        // left-aligned title
  expect(button.x + button.width).toBeGreaterThan(input.x + input.width - 8);              // Add at the field's end
  expect(button.x).toBeGreaterThan(input.x + input.width / 2);
  expect(Math.abs((button.y + button.height / 2) - (input.y + input.height / 2))).toBeLessThanOrEqual(1);   // centred
  await expect(add).toHaveClass(/dp-btn--primary/);                                          // DownloadPulse's primary Add
  const before = await quick.boundingBox();
  // Nothing to send: said on the title row, the text kept.
  await field.fill("just words");
  await add.click();
  await expect(popup.getByTestId("quick-result")).toHaveText("No link or magnet found");
  await expect(field).toHaveValue("just words");
  expect((await quick.boundingBox()).height).toBe(before.height);
  // A link: sent (DownloadPulse has it), said in green, the field emptied.
  const jobs = dp.state.jobs.length;
  await field.fill("https://example.com/files/quick.zip");
  await add.click();
  await expect(popup.getByTestId("quick-result")).toHaveText("Added to DownloadPulse");
  await expect(field).toHaveValue("");
  expect(dp.state.jobs.length).toBe(jobs + 1);
  expect(dp.state.jobs.at(-1).body.source).toEqual({kind: "links", links: ["https://example.com/files/quick.zip"]});
  expect(await colour(popup.getByTestId("quick-result"))).toBe(await popup.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--dp-state-success").trim() &&
    (() => { const probe = document.createElement("span"); probe.style.color = "var(--dp-state-success)"; document.body.append(probe);
      const value = getComputedStyle(probe).color; probe.remove(); return value; })()));
  expect((await quick.boundingBox()).height).toBe(before.height);
  // A pasted list (one address per line): its line breaks become spaces, never joined addresses (review, 2026-11-19).
  await field.fill("");
  await field.evaluate((input) => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://example.com/a.zip\nhttps://example.com/b.zip\r\nhttps://example.com/c.zip\n");
    input.focus();
    input.dispatchEvent(new ClipboardEvent("paste", {clipboardData: data, bubbles: true, cancelable: true}));
  });
  await expect(field).toHaveValue("https://example.com/a.zip https://example.com/b.zip https://example.com/c.zip");
  await add.click();
  await expect.poll(() => dp.state.jobs.length).toBe(jobs + 2);
  expect(dp.state.jobs.at(-1).body.source).toEqual({kind: "links", links:
    ["https://example.com/a.zip", "https://example.com/b.zip", "https://example.com/c.zip"]});
  await popup.screenshot({path: "test-results/quick-add.png"});
  await expect(popup.getByTestId("quick-result")).toHaveText("", {timeout: 6000});
});

test("Clear removes the finished downloads from this list only; active ones stay, and a later change lists one again", async () => {
  const clear = popup.getByRole("button", {name: "Clear finished downloads"});
  await expect(clear).toBeDisabled();                              // nothing finished yet
  const first = await sendArchive();
  dp.setJob(first, {phase: "processing", reason: "downloading"});
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  const box = await page.locator("#row").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(":root > div[popover]:popover-open")].filter((h) => getComputedStyle(h).display !== "none").length)).toBe(1);
  const at = await page.evaluate(() => {
    const r = document.querySelector(":root > div[popover]:popover-open").getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  });
  await page.waitForTimeout(400);   // a press counts once the button has stood still, seen (1.0.8)
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => dp.state.views.size).toBe(2);
  await page.close();
  const second = [...dp.state.views.keys()].find((id) => id !== first);
  dp.setJob(second, {phase: "completed", reason: "completed", actionability: "none"});
  await expect(row(second)).toBeVisible();
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(row(second)).toHaveCount(0);
  await expect(row(first)).toBeVisible();                           // still downloading: stays
  await expect(clear).toBeDisabled();
  expect(dp.state.views.has(second)).toBe(true);                    // DownloadPulse keeps it
  dp.setJob(second, {name: "renamed in DownloadPulse.zip"});         // changed afterwards: listed again
  await expect(row(second)).toBeVisible();
});

test("opened for a download, the dropdown shows that one", async () => {
  const id = await sendArchive();
  await expect(row(id)).toBeVisible();
  // As a notification click opens it where the browser opens no toolbar popup from code.
  await popup.goto(popup.url().split("?")[0] + `?job=${id}`);
  await expect(row(id)).toHaveClass(/dp-job--focus/);
});

test("Remove withdraws this browser's request", async () => {
  const id = await sendArchive();
  await row(id).getByRole("button", {name: "Remove"}).click();
  await expect.poll(() => stateOf(id)).toBe("Removed");
  // Settled: no controls, only Remove from list (this browser's list).
  await expect(row(id).getByRole("button")).toHaveCount(1);
  await expect(row(id).getByRole("button", {name: "Remove from list"})).toHaveCount(1);
});

test("Remove from list: a finished entry's trash, on its title line while hovered or focused, takes that one off this list only", async () => {
  const first = await sendArchive();
  dp.setJob(first, {phase: "completed", reason: "completed", actionability: "none"});
  await expect(row(first)).toBeVisible();
  const forget = row(first).getByRole("button", {name: "Remove from list"});
  const shown = () => forget.evaluate((el) => getComputedStyle(el).opacity);
  await popup.mouse.move(0, 0);
  await expect.poll(shown).toBe("0");                                 // hidden until the row is hovered
  await row(first).hover();
  await expect.poll(shown).toBe("1");
  // On the title line, at its end.
  const place = await row(first).evaluate((li) => {
    const b = li.querySelector(".dp-job__forget").getBoundingClientRect();
    const n = li.querySelector(".dp-job__name").getBoundingClientRect();
    const r = li.getBoundingClientRect();
    return {line: b.top < n.bottom && b.bottom > n.top, end: r.right - b.right <= 12};
  });
  expect(place).toEqual({line: true, end: true});
  await forget.click();
  await expect(row(first)).toHaveCount(0);
  expect(dp.state.views.has(first)).toBe(true);                       // DownloadPulse keeps it
  dp.setJob(first, {name: "renamed in DownloadPulse.zip"});            // changed afterwards: listed again
  await expect(row(first)).toBeVisible();
});

test("a failed entry takes no more room than a done one; neither keeps a controls line", async () => {
  const id = await sendArchive();
  dp.setJob(id, {phase: "completed", reason: "completed", actionability: "none"});
  await expect(row(id)).toHaveAttribute("data-phase", "completed");
  const height = () => row(id).evaluate((li) => li.getBoundingClientRect().height);
  const done = await height();
  dp.setJob(id, {phase: "failed", reason: "acquisition_failed", actionability: "operator"});
  await expect(row(id)).toHaveAttribute("data-phase", "failed");
  expect(await height()).toBeLessThanOrEqual(done);
});

test("completion and failure each raise one notification", async () => {
  const id = await sendArchive();
  dp.setJob(id, {phase: "processing", reason: "downloading"});
  await expect.poll(() => stateOf(id)).toBe("Downloading");
  dp.setJob(id, {phase: "completed", reason: "completed", actionability: "none"});
  await expect.poll(() => stateOf(id)).toBe("Done");
  const notifications = () => popup.evaluate(() => new Promise((done) => chrome.notifications.getAll(done)));
  await expect.poll(async () => Object.keys(await notifications())).toEqual([`dp:${id}:completed`]);
  dp.setJob(id, {reason: "completed"});   // another change of the same completed job: no second notice
  await popup.waitForTimeout(2500);
  expect(Object.keys(await notifications())).toEqual([`dp:${id}:completed`]);
});

test("the monitor polls while something is active and stops once everything settled", async () => {
  const id = await sendArchive();
  dp.setJob(id, {phase: "processing", reason: "downloading"});
  await popup.close();                      // no popup: only the active download keeps it going
  const before = dp.state.listPolls.length;
  await new Promise((done) => setTimeout(done, 5000));
  expect(dp.state.listPolls.length).toBeGreaterThan(before);   // still polling while active
  dp.setJob(id, {phase: "completed", reason: "completed", actionability: "none"});
  await new Promise((done) => setTimeout(done, 12_000));        // settled, popup closed: the loop ends
  const settledAt = dp.state.listPolls.length;
  await new Promise((done) => setTimeout(done, 6000));
  expect(dp.state.listPolls.length).toBe(settledAt);
});
