// SPDX-License-Identifier: GPL-2.0-or-later
// WS-E1 onboarding against a fake DownloadPulse, in Chromium with the
// extension loaded. The local cases need 127.0.0.1:8095 to themselves: if
// anything else holds that port (a real DownloadPulse on this computer), the
// suite refuses to run rather than pair with it. Locally, run it in a private
// network namespace: ``unshare -rn sh -c 'ip link set lo up && npm run test:e2e'``.
import {test, expect, chromium} from "@playwright/test";
import net from "node:net";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fakeDownloadPulse} from "./fake-downloadpulse.mjs";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/chromium");

async function portFree(port) {
  return new Promise((done) => {
    const probe = net.createServer().once("error", () => done(false))
      .once("listening", () => probe.close(() => done(true))).listen(port, "127.0.0.1");
  });
}

test.beforeAll(async () => {
  if (!(await portFree(8095))) {
    throw new Error("127.0.0.1:8095 is in use. Refusing to run onboarding tests where a real DownloadPulse may answer; "
      + "run them in a private network namespace (see this file's header).");
  }
});

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), "dp-ext-e2e-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  return {context, popup, close: async () => { await context.close(); await rm(profile, {recursive: true, force: true}); }};
}

test("found on this computer: paired on approval, verified, and shown connected", async () => {
  const fake = await fakeDownloadPulse({port: 8095});
  const {context, popup, close} = await launch();
  try {
    // A signed-in DownloadPulse session in this browser: it must never ride along (credentials omitted).
    await context.addCookies([{name: "dp_session", value: "a-real-session", domain: "127.0.0.1", path: "/"}]);
    await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
    await expect(popup.getByTestId("code")).toHaveText("ABCD-0001");
    // The approval page opened on that server, at its own path.
    await expect.poll(() => context.pages().map((page) => page.url())).toContain("http://127.0.0.1:8095/?connect-browser=ABCD-0001");
    expect(fake.state.lastClientName).toMatch(/^Chrom\w* on \w+/);
    fake.answer("approved");
    await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
    await expect(popup.getByTestId("server")).toHaveText("http://127.0.0.1:8095");
    await expect(popup.getByTestId("label")).toHaveText("Laptop-Chrome");
    // The token was verified with the session route, with no cookie alongside it.
    expect(fake.state.sessionAuth.at(-1)).toEqual({authorization: "Bearer dp_fake-token", cookie: null});
  } finally {
    await close();
    await fake.close();
  }
});

test("nothing on this computer: Check again, then a named server", async () => {
  const {popup, close} = await launch();
  const fake = await fakeDownloadPulse();
  try {
    await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
    await expect(popup.getByRole("button", {name: "Check again"})).toBeVisible();
    await popup.getByRole("button", {name: "Check again"}).click();
    await expect(popup.getByRole("button", {name: "Check again"})).toBeVisible();
    await popup.getByLabel("Server address").fill(`http://localhost:${fake.port}`);
    await popup.getByRole("button", {name: "Connect to this server"}).click();
    await expect(popup.getByTestId("code")).toHaveText("ABCD-0001");
    fake.answer("approved");
    await expect(popup.getByTestId("server")).toHaveText(`http://localhost:${fake.port}`, {timeout: 15_000});
  } finally {
    await close();
    await fake.close();
  }
});

for (const [mode, answer, text] of [
  ["current", "denied", "The connection was denied in DownloadPulse."],
  ["current", "expired", "The connection request expired. Start again."],
  ["too-old", null, "This DownloadPulse is too old to connect browsers. Update it, then connect again."],
  ["forbidden-origin", null, "This DownloadPulse is too old to connect browsers. Update it, then connect again."],
  ["wrong-protocol", "approved", "This DownloadPulse is too old to connect browsers. Update it, then connect again."],
  ["not-downloadpulse", null, "Something answered at that address, but it isn't DownloadPulse."],
]) {
  test(`a server that is ${mode}${answer ? `, answered ${answer}` : ""}: said plainly, with a way back`, async () => {
    const fake = await fakeDownloadPulse({mode});
    const {popup, close} = await launch();
    try {
      await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
      await popup.getByLabel("Server address").fill(`http://localhost:${fake.port}`);
      await popup.getByRole("button", {name: "Connect to this server"}).click();
      if (answer) {
        await expect(popup.getByTestId("code")).toBeVisible();
        fake.answer(answer);
      }
      await expect(popup.getByTestId("failure")).toHaveText(text, {timeout: 15_000});
      await popup.getByRole("button", {name: "Start again"}).click();
      await expect(popup.getByRole("button", {name: "Connect to a DownloadPulse instance"})).toBeVisible();
    } finally {
      await close();
      await fake.close();
    }
  });
}

test("an older DownloadPulse on this computer says so, and a server can still be chosen from there", async () => {
  const old = await fakeDownloadPulse({port: 8095, mode: "forbidden-origin"});
  const current = await fakeDownloadPulse();
  const {popup, close} = await launch();
  try {
    await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
    await expect(popup.getByTestId("failure")).toHaveText("This DownloadPulse is too old to connect browsers. Update it, then connect again.");
    await popup.getByLabel("Or connect to a DownloadPulse server:").fill(`http://localhost:${current.port}`);
    await popup.locator('section[data-state="failed"]').getByRole("button", {name: "Connect to this server"}).click();
    await expect(popup.getByTestId("code")).toHaveText("ABCD-0001");
    current.answer("approved");
    await expect(popup.getByTestId("server")).toHaveText(`http://localhost:${current.port}`, {timeout: 15_000});
  } finally {
    await close();
    await old.close();
    await current.close();
  }
});
