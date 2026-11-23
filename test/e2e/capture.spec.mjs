// SPDX-License-Identifier: GPL-2.0-or-later
// 1.0.2: browser downloads sent to DownloadPulse instead, against the fake DownloadPulse and a
// fake site. The "downloads" permission is optional in the real extension (asked from the
// person's own click, which a test cannot answer: it is the browser's own prompt), so these
// tests load a copy of the build where it is granted at load; everything else is the build.
// Same port rule as onboarding.spec.mjs: run in a private network namespace locally.
import {test, expect, chromium} from "@playwright/test";
import net from "node:net";
import {cp, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fakeDownloadPulse} from "./fake-downloadpulse.mjs";
import {fakeSite} from "./fake-site.mjs";

const BUILT = resolve(process.env.DP_EXT_DIR || "dist/chromium");

test.beforeAll(async () => {
  const free = await new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true))).listen(8095, "127.0.0.1");
  });
  if (!free) throw new Error("127.0.0.1:8095 is in use. Refusing to run where a real DownloadPulse may answer.");
});

let dp, site, context, profile, extension, popup, worker;

/** The build, with "downloads" granted at load (see the header). */
async function grantedCopy() {
  const copy = await mkdtemp(join(tmpdir(), "dp-ext-capture-build-"));
  await cp(BUILT, copy, {recursive: true});
  const manifest = JSON.parse(await readFile(join(copy, "manifest.json"), "utf8"));
  manifest.permissions = [...manifest.permissions, "downloads"];
  delete manifest.optional_permissions;
  await writeFile(join(copy, "manifest.json"), JSON.stringify(manifest));
  return copy;
}

async function connect(answer) {
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  await expect(popup.getByText("Send downloads to DownloadPulse?")).toBeVisible({timeout: 15_000});
  await popup.getByRole("button", {name: answer}).click();
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
}

/** The browser's own list of downloads, as the extension sees it. */
const browserDownloads = () => worker.evaluate(() => chrome.downloads.search({}).then((items) =>
  items.map(({url, state, paused}) => ({url, state, paused}))));

/** The browser's own copy of big.bin, if it is still in its list. */
const bigInBrowser = async () => (await browserDownloads()).find((item) => item.url.endsWith("/dl/big.bin"));

/** Start a download the way a person does: a click on an attachment link on a page. */
async function download(id) {
  const page = await context.newPage();
  await page.goto(`${site.base}/downloads`);
  await page.locator(`#${id}`).click();
  return page;
}

test.beforeEach(async () => {
  dp = await fakeDownloadPulse({port: 8095});
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-capture-"));
  extension = await grantedCopy();
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1000, height: 800}, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
});

test.afterEach(async () => {
  await context.close();
  await rm(profile, {recursive: true, force: true});
  await rm(extension, {recursive: true, force: true});
  await dp.close();
  await site.close();
});

test("turned on during setup, a download goes to DownloadPulse with its sign-in and page, and leaves the browser", async () => {
  await connect("Send them to DownloadPulse");
  await expect(popup.getByTestId("capture-main")).toBeChecked();
  await context.addCookies([{name: "SESSION", value: "signed-in-as-una", domain: "127.0.0.1", path: "/"}]);
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  const {body} = dp.state.jobs[0];
  expect(body.source).toEqual({kind: "links", links: [`${site.base}/dl/big.bin`]});
  expect(body.referrer).toBe(`${site.base}/downloads`);
  // This DownloadPulse is on this computer (plain HTTP allowed there): the sign-in goes with it.
  expect(body.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([["SESSION", "signed-in-as-una"]]);
  // Accepted is not yet downloaded (1.0.3): the browser's copy is held, paused, in its list ...
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 10_000}).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.paused).toBe(true);
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  // ... until DownloadPulse has it: then it is cancelled and off the browser's list.
  dp.setJob("job_1", {phase: "completed", reason: null, actionability: "none"});
  await expect.poll(async () => (await bigInBrowser()) === undefined, {timeout: 15_000}).toBe(true);
});

test("accepted, then failed in DownloadPulse: the browser carries on with its own copy", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  dp.setJob("job_1", {phase: "failed", reason: "source_failed", actionability: "operator"});
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
});

test("failed before its answer arrived: the browser still carries on with its own copy", async () => {
  await connect("Send them to DownloadPulse");
  dp.state.settleAs = {phase: "failed", reason: "source_failed", actionability: "operator"};
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
});

test("removed here, the browser's held copy goes too", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  dp.setJob("job_1", {phase: "withdrawn", reason: "withdrawn_by_client", actionability: "none"});
  await expect.poll(async () => (await bigInBrowser()) === undefined, {timeout: 15_000}).toBe(true);
});

test("the disclosure no longer agreed to while held: the browser carries on", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  await worker.evaluate(() => chrome.storage.local.remove("consent"));
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
  // The job was never settled in DownloadPulse: nothing more happens to the browser's copy.
  dp.setJob("job_1", {phase: "completed", reason: null, actionability: "none"});
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.state).toBe("complete");
});

test("small files and listed file types stay in the browser", async () => {
  await connect("Send them to DownloadPulse");
  await popup.getByRole("button", {name: "Settings"}).click();
  await popup.locator("[data-capture-types]").fill("PDF, .exe");
  await popup.locator("[data-capture-types]").press("Tab");
  await expect(popup.locator("[data-capture-types]")).toHaveValue("exe, pdf");
  await download("small");   // 64 KiB, under the 1 MB default
  await download("pdf");
  await expect.poll(async () => (await browserDownloads()).filter((item) => item.state === "complete").length,
    {timeout: 15_000}).toBe(2);
  expect(dp.state.jobs).toHaveLength(0);
});

test("refused by DownloadPulse, the browser keeps downloading it", async () => {
  await connect("Send them to DownloadPulse");
  dp.state.refuse = "source_refused";
  await download("big");
  await expect.poll(async () => (await browserDownloads()).find((item) => item.url.endsWith("/dl/big.bin"))?.state,
    {timeout: 30_000}).toBe("complete");
  expect(dp.state.jobs).toHaveLength(0);
});

test("refused with its sign-in and page: what DownloadPulse takes is read again with the next send", async () => {
  await connect("Send them to DownloadPulse");
  // Closed, so no appearance refresh reads the session meanwhile: only sends do.
  await popup.close();
  const kept = () => worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null))
    .find(([key]) => key.startsWith("capabilities@"))?.[1] ?? null);
  expect(await kept()).toEqual({videoCookies: true, referrer: true});
  dp.state.refuse = "source_refused";
  await download("big");
  await expect.poll(kept, {timeout: 15_000}).toBe(null);
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
  dp.state.refuse = null;
  const reads = dp.state.sessionAuth.length;
  await download("pdf");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  expect(dp.state.sessionAuth.length).toBe(reads + 1);
  expect(await kept()).toEqual({videoCookies: true, referrer: true});
});

test("'Not now' leaves downloads in the browser; the switch turns it on later", async () => {
  await connect("Not now");
  await expect(popup.getByTestId("capture-main")).not.toBeChecked();
  await download("big");
  await expect.poll(async () => (await browserDownloads()).find((item) => item.url.endsWith("/dl/big.bin"))?.state,
    {timeout: 30_000}).toBe("complete");
  expect(dp.state.jobs).toHaveLength(0);
  // Turned on from the popup's own switch: the next download goes to DownloadPulse.
  await popup.getByTestId("capture-main").check();
  await expect(popup.getByTestId("capture-main")).toBeChecked();
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
});

test("disconnected while held: the browser carries on with its own copy, never erased", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  await popup.getByRole("button", {name: "Settings"}).click();
  await popup.getByRole("button", {name: "Disconnect"}).click();
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
});

test("what DownloadPulse takes is read once, not on every download held while it is sent", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  const reads = dp.state.sessionAuth.length;
  await download("pdf");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(2);
  // The second download's sign-in and page still go: the capabilities were read once, and kept.
  expect(dp.state.jobs[1].body.referrer).toBe(`${site.base}/downloads`);
  expect(dp.state.sessionAuth.length).toBe(reads);
});
