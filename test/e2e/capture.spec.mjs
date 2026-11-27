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
async function download(id, base = site.base) {
  const page = await context.newPage();
  await page.goto(`${base}/downloads`);
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

test("a download another site's page started goes without the site's SameSite=Strict cookies (1.0.8, WS-A5)", async () => {
  await connect("Send them to DownloadPulse");
  await context.addCookies([
    {name: "STRICT", value: "strict-una", domain: "127.0.0.1", path: "/", sameSite: "Strict"},
    {name: "LAX", value: "lax-una", domain: "127.0.0.1", path: "/", sameSite: "Lax"},
  ]);
  // The page is on localhost, the file on 127.0.0.1: two sites. The browser's own request would
  // carry the Lax cookie and not the Strict one, and so does DownloadPulse's.
  await download("big-127", site.base.replace("127.0.0.1", "localhost"));
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  const {body} = dp.state.jobs[0];
  expect(body.source).toEqual({kind: "links", links: [`${site.base}/dl/big.bin`]});
  expect(body.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual([["LAX", "lax-una"]]);
});

test("a download its own site's page started goes with every cookie, Strict too (1.0.8, WS-A5)", async () => {
  await connect("Send them to DownloadPulse");
  await context.addCookies([
    {name: "STRICT", value: "strict-una", domain: "127.0.0.1", path: "/", sameSite: "Strict"},
    {name: "LAX", value: "lax-una", domain: "127.0.0.1", path: "/", sameSite: "Lax"},
  ]);
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  expect(dp.state.jobs[0].body.cookies.map((cookie) => cookie.name).sort()).toEqual(["LAX", "STRICT"]);
});

test("\"Send my sign-in\" off: a download goes without it, and the browser's copy is never cancelled (1.0.4)", async () => {
  await connect("Send them to DownloadPulse");
  // Switched off in Settings (stored as the popup's switch stores it, as surfaces.spec.mjs does).
  await worker.evaluate(async () => {
    const {settings} = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({settings: {...(settings ?? {}), videoCookies: false}});
  });
  await context.addCookies([{name: "SESSION", value: "signed-in-as-una", domain: "127.0.0.1", path: "/"}]);
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  // The switch covers browser downloads as it does videos: no cookie goes.
  expect(dp.state.jobs[0].body.cookies ?? []).toEqual([]);
  // A sign-in existed but did not go: DownloadPulse may get a sign-in page, so the browser's own
  // copy is neither held nor cancelled -- not even when DownloadPulse says it is done.
  expect(Object.keys(await held())).toHaveLength(0);
  dp.setJob("job_1", {phase: "completed", reason: null, actionability: "none"});
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
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
  await download("small");   // 64 KiB, under the 10 MB default
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
  // 1.0.8 (WS-X1): confirmed in the dialog.
  await popup.getByTestId("dialog-confirm").click();
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

/** What this browser keeps about its held downloads (PRIVACY.md), keyed by the browser's download id. */
const held = () => worker.evaluate(async () => (await chrome.storage.local.get("heldDownloads")).heldDownloads ?? {});

test("disconnected while held: the held list is cleared too", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => Object.keys(await held()).length, {timeout: 15_000}).toBe(1);
  await popup.getByRole("button", {name: "Settings"}).click();
  await popup.getByRole("button", {name: "Disconnect"}).click();
  // 1.0.8 (WS-X1): confirmed in the dialog.
  await popup.getByTestId("dialog-confirm").click();
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
  expect(await held()).toEqual({});
});

test("turned off while held: the browser carries on with its own copy, and the held list is cleared", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  await expect.poll(async () => Object.keys(await held()).length, {timeout: 15_000}).toBe(1);
  await popup.getByTestId("capture-main").uncheck();
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
  expect(await held()).toEqual({});
});

test("the permission taken back while held: nothing can resume it here, so the held list is cleared", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  await expect.poll(async () => Object.keys(await held()).length, {timeout: 15_000}).toBe(1);
  // This copy holds "downloads" as a required permission (see the header), which cannot be
  // taken back: the background is told it is gone the way the browser would say so.
  await worker.evaluate(async () => {
    chrome.permissions.contains = async () => false;
    const {settings} = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({settings: {...settings, capture: false}});
  });
  await expect.poll(held, {timeout: 15_000}).toEqual({});
  // Left as it was in the browser's list (never erased), for the person to resume.
  expect((await bigInBrowser())?.paused).toBe(true);
});

test("a held job fallen out of the monitor's newest 100: its outcome unknown, the browser carries on", async () => {
  await connect("Send them to DownloadPulse");
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  // Listed once in the cache, at its cursor.
  await expect.poll(async () => Object.values(await held())[0]?.seen, {timeout: 15_000}).toBeGreaterThan(0);
  // A hundred later changes push it out of the cache (it keeps the newest 100).
  await worker.evaluate(async () => {
    const [entry] = Object.values((await chrome.storage.local.get("heldDownloads")).heldDownloads);
    const key = `jobs@${entry.server}`;
    const jobs = Object.fromEntries(Array.from({length: 100}, (_, i) => [`other_${i}`, {
      id: `other_${i}`, cursor: entry.seen + 1000 + i, submitted_at: null, display_name: `other ${i}`, source: {},
      phase: "completed", reason: null, actionability: "none", paused_by: null, progress: null, estimate: null}]));
    await chrome.storage.session.set({[key]: jobs});
  });
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
  expect(await held()).toEqual({});
});

test("a held job while the cache is empty (as after a restart) is waited for, not resumed", async () => {
  await connect("Send them to DownloadPulse");
  // Closed: no popup keeps the monitor polling, and the cache is emptied as after a restart.
  await popup.close();
  await download("big");
  await expect.poll(async () => Object.keys(await held()).length, {timeout: 15_000}).toBe(1);
  await worker.evaluate(async () => {
    const keys = Object.keys(await chrome.storage.session.get(null)).filter((key) => key.startsWith("jobs@"));
    await chrome.storage.session.remove(keys);
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.paused).toBe(true);
  expect(Object.keys(await held())).toHaveLength(1);
});

test("1.0.4: a download of a size the browser does not know stays in the browser, unless every size goes", async () => {
  await connect("Send them to DownloadPulse");
  await download("unsized");   // sent without its length: it may be a small file
  await expect.poll(async () => (await browserDownloads()).find((item) => item.url.endsWith("/dl/unsized.bin"))?.state,
    {timeout: 30_000}).toBe("complete");
  expect(dp.state.jobs).toHaveLength(0);
  // A minimum of 0 (stored as the popup's field stores it): every size goes, a size not known too.
  await worker.evaluate(async () => {
    const {settings} = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({settings: {...settings, captureMinMB: 0}});
  });
  await download("unsized");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  expect(dp.state.jobs[0].body.source.links).toEqual([`${site.base}/dl/unsized.bin`]);
});

/** The toasts the background says, recorded as it sends them to a tab. */
const recordToasts = () => worker.evaluate(() => {
  globalThis.toasts = [];
  const send = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = (tab, value, options) => {
    if (value?.type === "dp-toast") globalThis.toasts.push(value.text);
    return send(tab, value, options);
  };
});
const toasts = () => worker.evaluate(() => globalThis.toasts);
const NO_PROGRESS = "DownloadPulse made no progress with that download for a while, so the browser carried on with it.";

/**
 * The held downloads' 10-minute limit, passed: their clocks set 11 minutes back (as a held
 * download waiting that long would have them), and the background woken as its alarm would.
 */
const pastTheLimit = () => worker.evaluate(async () => {
  const {heldDownloads} = await chrome.storage.local.get("heldDownloads");
  for (const entry of Object.values(heldDownloads)) entry.progressAt -= 11 * 60_000;
  await chrome.storage.local.set({heldDownloads});
  await chrome.alarms.create("dp-held", {when: Date.now()});
});

test("1.0.4: a held job never listed by DownloadPulse: after the limit the browser carries on, and says so", async () => {
  await connect("Send them to DownloadPulse");
  await recordToasts();
  dp.state.unlisted = true;
  await download("big");
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  await expect.poll(async () => Object.keys(await held()).length, {timeout: 15_000}).toBe(1);
  // Within the limit it waits.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.paused).toBe(true);
  await pastTheLimit();
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
  expect(await held()).toEqual({});
  expect(await toasts()).toContain(NO_PROGRESS);
});

test("1.0.4: a held job still queued in DownloadPulse after the limit: the browser carries on, and says so", async () => {
  await connect("Send them to DownloadPulse");
  await recordToasts();
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  dp.setJob("job_1", {phase: "queued", reason: "queued", actionability: "wait"});
  await expect.poll(async () => Object.values(await held())[0]?.seen, {timeout: 15_000}).toBeGreaterThan(0);
  expect((await bigInBrowser())?.paused).toBe(true);
  await pastTheLimit();
  await expect.poll(async () => (await bigInBrowser())?.state, {timeout: 30_000}).toBe("complete");
  expect(await held()).toEqual({});
  expect(await toasts()).toContain(NO_PROGRESS);
});

test("1.0.4: a held job paused in DownloadPulse stays held past the limit, and is still dropped once completed", async () => {
  await connect("Send them to DownloadPulse");
  await recordToasts();
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  // Paused (as DownloadPulse projects it: phase "processing", reason "paused"), by the person here.
  dp.setJob("job_1", {phase: "processing", reason: "paused", actionability: "wait", paused_by: "client"});
  await expect.poll(async () => Object.values(await held())[0]?.seen, {timeout: 15_000}).toBeGreaterThan(0);
  await pastTheLimit();
  // Its clock starts again (seen paused): it stays paused in DownloadPulse, never handed back.
  await expect.poll(async () => Date.now() - Object.values(await held())[0]?.progressAt, {timeout: 15_000})
    .toBeLessThan(60_000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.paused).toBe(true);
  expect(Object.keys(await held())).toHaveLength(1);
  expect(await toasts()).not.toContain(NO_PROGRESS);
  dp.setJob("job_1", {phase: "completed", reason: "completed", actionability: "none", paused_by: null});
  await expect.poll(async () => (await bigInBrowser()) === undefined, {timeout: 15_000}).toBe(true);
});

test("1.0.4: a held job paused in DownloadPulse stays held past the limit while DownloadPulse cannot be reached", async () => {
  await connect("Send them to DownloadPulse");
  await recordToasts();
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  dp.setJob("job_1", {phase: "processing", reason: "paused", actionability: "wait", paused_by: "client"});
  await expect.poll(async () => Object.values(await held())[0]?.seen, {timeout: 15_000}).toBeGreaterThan(0);
  // DownloadPulse down: the monitor's next listing fails, and says so.
  dp.state.down = true;
  await expect.poll(() => worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null))
    .find(([key]) => key.startsWith("reach@"))?.[1]?.ok), {timeout: 15_000}).toBe(false);
  await pastTheLimit();
  // Last seen paused in this session: its clock starts again, and it stays paused, held.
  await expect.poll(async () => Date.now() - Object.values(await held())[0]?.progressAt, {timeout: 15_000})
    .toBeLessThan(60_000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.paused).toBe(true);
  expect(Object.keys(await held())).toHaveLength(1);
  expect(await toasts()).not.toContain(NO_PROGRESS);
});

test("1.0.4: a held job DownloadPulse is downloading is never cut off by the limit", async () => {
  await connect("Send them to DownloadPulse");
  await recordToasts();
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  dp.setJob("job_1", {phase: "processing", reason: "downloading", actionability: "wait"});
  await expect.poll(async () => Object.values(await held())[0]?.seen, {timeout: 15_000}).toBeGreaterThan(0);
  await pastTheLimit();
  // Its clock starts again (seen downloading), and it stays held.
  await expect.poll(async () => Date.now() - Object.values(await held())[0]?.progressAt, {timeout: 15_000})
    .toBeLessThan(60_000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.paused).toBe(true);
  expect(Object.keys(await held())).toHaveLength(1);
  expect(await toasts()).not.toContain(NO_PROGRESS);
  // And still settled as before once DownloadPulse has it.
  dp.setJob("job_1", {phase: "completed", reason: "completed", actionability: "none"});
  await expect.poll(async () => (await bigInBrowser()) === undefined, {timeout: 15_000}).toBe(true);
});

test("1.0.4: after a restart longer than the limit, a held download's clock starts again, not resumed", async () => {
  await connect("Send them to DownloadPulse");
  await recordToasts();
  await download("big");
  await expect.poll(async () => Object.keys(await held()).length, {timeout: 15_000}).toBe(1);
  await expect.poll(async () => (await bigInBrowser())?.paused, {timeout: 15_000}).toBe(true);
  // As after a restart longer than the limit: the held clock is old, and the session's state is
  // gone (its job cache, reach, and that this session started the held clocks). Back to back, so
  // no settling pass runs between the two; the cache's removal itself wakes one, as does the alarm.
  await worker.evaluate(async () => {
    const {heldDownloads} = await chrome.storage.local.get("heldDownloads");
    for (const entry of Object.values(heldDownloads)) entry.progressAt -= 11 * 60_000;
    await chrome.storage.local.set({heldDownloads});
    await chrome.storage.session.remove(Object.keys(await chrome.storage.session.get(null))
      .filter((key) => key.startsWith("jobs@") || key.startsWith("reach@") || key === "heldClocksStarted"));
    await chrome.alarms.create("dp-held", {when: Date.now()});
  });
  // Its clock starts again instead (nothing is known yet of the job in this session).
  await expect.poll(async () => Date.now() - Object.values(await held())[0]?.progressAt, {timeout: 15_000})
    .toBeLessThan(60_000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  expect((await bigInBrowser())?.paused).toBe(true);
  expect(Object.keys(await held())).toHaveLength(1);
  expect(await toasts()).not.toContain(NO_PROGRESS);
});
