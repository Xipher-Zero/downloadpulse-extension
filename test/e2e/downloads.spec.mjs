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

test("a sent download is listed by name with its state, progress and labelled estimate", async () => {
  const id = await sendArchive();
  await expect(row(id).locator(".dp-job__name")).toHaveText("archive.zip");
  await expect(row(id).locator(".dp-job__state")).toHaveText("Waiting");
  dp.setJob(id, {phase: "processing", reason: "downloading", progress: {percent: 10, effective: {percent: 42}},
    estimate: {seconds: 300, held: false, estimated: false, indeterminate: false}});
  await expect(row(id).locator(".dp-job__state")).toHaveText("Downloading · 42% · about 5 min left");
  await expect(row(id).locator("progress")).toHaveAttribute("value", "42");
  dp.setJob(id, {estimate: {seconds: null, held: false, estimated: true, indeterminate: true}});
  await expect(row(id).locator(".dp-job__state")).toHaveText("Downloading · 42% · estimating time left");
  // DownloadPulse resolves the title: the list follows it.
  dp.setJob(id, {name: "The Real Title [abc123].webm"});
  await expect(row(id).locator(".dp-job__name")).toHaveText("The Real Title [abc123].webm");
});

test("pause and resume are this browser's own; a declined pause says why", async () => {
  const id = await sendArchive();
  dp.setJob(id, {phase: "processing", reason: "downloading"});
  await expect(row(id).locator(".dp-job__state")).toHaveText("Downloading");
  await row(id).getByRole("button", {name: "Pause"}).click();
  await expect(row(id).locator(".dp-job__state")).toHaveText("Paused from this browser");
  await row(id).getByRole("button", {name: "Resume"}).click();
  await expect(row(id).locator(".dp-job__state")).toHaveText("Downloading");
  expect(dp.state.controls.map((c) => c.kind)).toEqual(["pause", "resume"]);
  expect(new Set(dp.state.controls.map((c) => c.request_key)).size).toBe(2);
  dp.state.declineControl = "shared_interest";
  await row(id).getByRole("button", {name: "Pause"}).click();
  await expect(row(id).locator(".dp-job__note")).toHaveText("Other requests need this download, so it can't be paused from here.");
});

test("the popup links to DownloadPulse, and opened for a download it shows that one", async () => {
  await expect(popup.getByRole("link", {name: "Open DownloadPulse"})).toHaveAttribute("href", "http://127.0.0.1:8095/");
  const id = await sendArchive();
  await expect(row(id)).toBeVisible();
  // As a notification click opens it where the browser opens no toolbar popup from code.
  await popup.goto(popup.url().split("?")[0] + `?job=${id}`);
  await expect(row(id)).toHaveClass(/dp-job--focus/);
});

test("Remove withdraws this browser's request", async () => {
  const id = await sendArchive();
  await row(id).getByRole("button", {name: "Remove"}).click();
  await expect(row(id).locator(".dp-job__state")).toHaveText("Removed");
  await expect(row(id).getByRole("button")).toHaveCount(0);
});

test("completion and failure each raise one notification", async () => {
  const id = await sendArchive();
  dp.setJob(id, {phase: "processing", reason: "downloading"});
  await expect(row(id).locator(".dp-job__state")).toHaveText("Downloading");
  dp.setJob(id, {phase: "completed", reason: "completed", actionability: "none"});
  await expect(row(id).locator(".dp-job__state")).toHaveText("Done");
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
