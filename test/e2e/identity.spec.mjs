// SPDX-License-Identifier: GPL-2.0-or-later
// 1.0.8 (WS-A4): the connection's identity. A DownloadPulse that proves it issued this browser's
// token (BROWSER_CLIENT.md 2c) is asked to before the token goes to it, and before every send
// carrying a sign-in; whatever else listens at its address afterwards gets neither. A
// DownloadPulse before 1.0.8 keeps working, but no sign-in goes to it on this computer. And the
// approval tab opens only on the server itself (EXT-3). Same port rule as onboarding.spec.mjs:
// run in a private network namespace locally. Browser downloads (capture) are what carry a
// sign-in here, so the build is loaded with "downloads" granted, as in capture.spec.mjs.
import {test, expect, chromium} from "@playwright/test";
import net from "node:net";
import {createHash} from "node:crypto";
import {cp, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fakeDownloadPulse} from "./fake-downloadpulse.mjs";
import {fakeSite} from "./fake-site.mjs";

const BUILT = resolve(process.env.DP_EXT_DIR || "dist/chromium");
const LOCAL = "http://127.0.0.1:8095";
const identityDigest = createHash("sha256").update("dp_fake-token").digest("hex");

test.beforeAll(async () => {
  const free = await new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true))).listen(8095, "127.0.0.1");
  });
  if (!free) throw new Error("127.0.0.1:8095 is in use. Refusing to run where a real DownloadPulse may answer.");
});

let dp, site, context, profile, extension, popup, worker;

async function grantedCopy() {
  const copy = await mkdtemp(join(tmpdir(), "dp-ext-identity-build-"));
  await cp(BUILT, copy, {recursive: true});
  const manifest = JSON.parse(await readFile(join(copy, "manifest.json"), "utf8"));
  manifest.permissions = [...manifest.permissions, "downloads"];
  delete manifest.optional_permissions;
  await writeFile(join(copy, "manifest.json"), JSON.stringify(manifest));
  return copy;
}

async function start(options = {}) {
  dp = await fakeDownloadPulse({port: 8095, ...options});
  site = await fakeSite();
  profile = await mkdtemp(join(tmpdir(), "dp-ext-identity-"));
  extension = await grantedCopy();
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: {width: 1000, height: 800}, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
}

test.afterEach(async () => {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
  await rm(extension, {recursive: true, force: true});
  await dp?.close();
  await site?.close();
  context = dp = site = undefined;
});

/** Connect to the DownloadPulse on this computer, browser downloads sent to it. */
async function connect() {
  await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
  await popup.getByRole("button", {name: "Agree and continue"}).click();
  await popup.getByRole("button", {name: "Connect", exact: true}).click();
  await expect(popup.getByTestId("code")).toBeVisible();
  dp.answer("approved");
  await expect(popup.getByText("Send downloads to DownloadPulse?")).toBeVisible({timeout: 15_000});
  await popup.getByRole("button", {name: "Send them to DownloadPulse"}).click();
  await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
}

async function download(id) {
  const page = await context.newPage();
  await page.goto(`${site.base}/downloads`);
  await page.locator(`#${id}`).click();
  return page;
}

const signIn = () => context.addCookies([{name: "SESSION", value: "signed-in-as-una", domain: "127.0.0.1", path: "/"}]);
const reachOk = () => worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null))
  .find(([key]) => key.startsWith("reach@"))?.[1]?.ok);
/** Every request that carried the token or a sign-in. */
const carried = (server) => server.state.requests.filter((item) => item.authorization !== null || item.cookies > 0);

test("a DownloadPulse that proves itself gets the sign-in; an impostor at its address later gets no token and no sign-in", async () => {
  await start();
  await connect();
  // Proven at pairing, and known to prove itself from then on (kept with the token, not in chrome.storage).
  expect(dp.state.identityChecks.length).toBeGreaterThanOrEqual(1);
  expect(dp.state.identityChecks[0]).toMatchObject({token_id: "tok-1", origin: LOCAL});
  expect(dp.state.identityChecks[0].nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(dp.state.identityChecks.every((check) => !("token" in check))).toBe(true);
  const kept = await popup.evaluate((server) => new Promise((done) => {
    const open = indexedDB.open("downloadpulse");
    open.onsuccess = () => {
      const read = open.result.transaction("secrets").objectStore("secrets").get(`identity@${server}`);
      read.onsuccess = () => done(read.result ?? null);
    };
  }), LOCAL);
  // The token's digest (DownloadPulse's own record of it) and its ID; never the token itself.
  expect(JSON.parse(kept)).toEqual({digest: identityDigest, tokenId: "tok-1"});
  const shown = await worker.evaluate(async () => JSON.stringify([await chrome.storage.local.get(null),
    await chrome.storage.session.get(null)]));
  expect(shown).not.toContain(identityDigest);
  // A sign-in goes with a check made just before it.
  await signIn();
  const before = dp.state.identityChecks.length;
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  expect(dp.state.jobs[0].body.cookies.map((cookie) => cookie.name)).toEqual(["SESSION"]);
  expect(dp.state.identityChecks.length).toBeGreaterThan(before);
  const submit = dp.state.requests.findLastIndex((item) => item.path === "/api/browser/v1/jobs" && item.method === "POST");
  expect(dp.state.requests.slice(0, submit).findLast((item) => item.path !== "/api/browser/v1/jobs")?.path)
    .toBe("/api/browser/v1/identity");

  // DownloadPulse stops; something else takes its address: first one that does not know the key,
  // then one with no identity route at all (as an older DownloadPulse would answer).
  const real = dp;
  await real.close();
  await expect.poll(reachOk, {timeout: 20_000}).toBe(false);
  for (const options of [{identityToken: "dp_not-the-key"}, {identity: false}]) {
    dp = await fakeDownloadPulse({port: 8095, ...options});
    await popup.reload();                    // the open popup lists the downloads: a request with the token
    await download("big");                   // a browser download, with its sign-in
    await expect.poll(() => dp.state.identityChecks.length, {timeout: 15_000}).toBeGreaterThanOrEqual(1);
    await popup.waitForTimeout(3000);
    expect(carried(dp)).toEqual([]);
    expect(dp.state.jobs).toEqual([]);
    // Nothing was forgotten: it is only unreachable, as it would be stopped.
    await expect(popup.getByTestId("account")).toHaveText("Una");
    await dp.close();
  }
  // DownloadPulse is back: it proves itself and everything goes on.
  dp = await fakeDownloadPulse({port: 8095});
  await popup.reload();
  await expect.poll(reachOk, {timeout: 20_000}).toBe(true);
  expect(carried(dp).length).toBeGreaterThan(0);
  expect(dp.state.identityChecks.length).toBeGreaterThan(0);
});

test("a DownloadPulse before 1.0.8 keeps working, but a sign-in never goes to it on this computer", async () => {
  await start({identity: false});
  await connect();
  await signIn();
  await download("big");
  await expect.poll(() => dp.state.jobs.length, {timeout: 15_000}).toBe(1);
  expect(dp.state.jobs[0].body.source).toEqual({kind: "links", links: [`${site.base}/dl/big.bin`]});
  expect(dp.state.jobs[0].body.cookies ?? []).toEqual([]);
  expect(dp.state.requests.find((item) => item.path === "/api/browser/v1/jobs" && item.method === "POST")?.authorization)
    .toBe("Bearer dp_fake-token");
  // It said nothing of proving itself: it is never asked (an older one has no such route).
  expect(dp.state.identityChecks).toEqual([]);
});

for (const path of ["@evil.example/x", "//evil.example/x", "/\\evil.example/x", "https://evil.example/x"]) {
  test(`an approval page off the server (${path}) is never opened: the pairing fails`, async () => {
    await start({verificationPath: path});
    await popup.getByRole("button", {name: "Connect to DownloadPulse", exact: true}).click();
    await popup.getByRole("button", {name: "Agree and continue"}).click();
    await popup.getByRole("button", {name: "Connect", exact: true}).click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.session.get("pairing")).pairing),
      {timeout: 15_000}).toEqual({state: "failed", failure: "failed"});
    await expect(popup.getByTestId("failure")).toBeVisible();
    // No tab beyond the extension's own pages and the browser's initial blank one: no approval tab at all.
    expect(context.pages().map((page) => page.url())
      .filter((url) => !url.startsWith("chrome-extension://") && url !== "about:blank")).toEqual([]);
  });
}
