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
  await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
  await popup.getByRole("button", {name: "Connect to DownloadPulse on this computer"}).click();
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

/** Send the site's archive.zip through the hover icon (WS-E2), as a person would. */
async function sendArchive() {
  const page = await context.newPage();
  await page.goto(`${site.base}/page`);
  const box = await page.locator("#zip").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2, {steps: 3});
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("downloadpulse-layer:popover-open").length)).toBe(1);
  const at = await page.evaluate(() => {
    const r = document.querySelector("downloadpulse-layer:popover-open").getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  });
  await page.mouse.move(at.x, at.y, {steps: 3});
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => dp.state.views.size).toBe(1);
  await page.close();
  return [...dp.state.views.keys()][0];
}

const row = (id) => popup.locator(`li[data-job-id="${id}"]`);
// The status line as read: the estimate's time is a left-to-right isolate (U+2066..U+2069).
const stateOf = (id) => row(id).locator(".dp-job__state").evaluate((el) => el.textContent.replace(/[\u2066\u2069]/g, ""));
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
  expect(await colour(row(id).locator(".dp-job__status"))).toBe("rgb(0, 230, 118)");   // DownloadPulse's success green (Dark, as the person chose)
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
  expect(await colour(row(id).locator(".dp-job__status"))).toBe("rgb(255, 193, 61)");
  dp.setJob(id, {phase: "failed", reason: "acquisition_failed", actionability: "operator"});
  await expect(row(id)).toHaveAttribute("data-tone", "failed");
  expect(await colour(row(id).locator(".dp-job__status"))).toBe("rgb(255, 82, 100)");
  await expect(row(id).getByRole("button")).toHaveCount(0);
  await expect(row(id).getByRole("progressbar")).toHaveCount(0);
  dp.setJob(id, {phase: "completed", reason: "completed", actionability: "none"});
  await expect(row(id)).toHaveAttribute("data-tone", "none");
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

test("the connection's status: green while DownloadPulse answers, yellow while it can't be reached", async () => {
  const reach = popup.getByTestId("reach");
  await expect(reach).toHaveAttribute("data-reach", "ok", {timeout: 15_000});
  await expect(reach).toHaveText("Connected");
  expect(await colour(reach)).toBe("rgb(0, 230, 118)");
  dp.state.down = true;
  await expect(reach).toHaveAttribute("data-reach", "unreachable", {timeout: 15_000});
  await expect(reach).toHaveText("Can't reach DownloadPulse");
  expect(await colour(reach)).toBe("rgb(255, 193, 61)");
  await expect(popup.getByTestId("account")).toHaveText("Una");   // still connected: nothing forgotten
  dp.state.down = false;
  await expect(reach).toHaveAttribute("data-reach", "ok", {timeout: 15_000});
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
  await expect(row(id).getByRole("button")).toHaveCount(0);
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
