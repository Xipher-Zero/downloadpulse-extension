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

test("found on this computer: offered first, then paired on approval, verified, and shown connected", async () => {
  const fake = await fakeDownloadPulse({port: 8095});
  const {context, popup, close} = await launch();
  try {
    // A signed-in DownloadPulse session in this browser: it must never ride along (credentials omitted).
    await context.addCookies([{name: "dp_session", value: "a-real-session", domain: "127.0.0.1", path: "/"}]);
    await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
    // Found, and asked: nothing is paired until the person chooses it.
    const pages = context.pages().length;
    await expect(popup.getByText("DownloadPulse is running on this computer.", {exact: true})).toBeVisible();
    await popup.waitForTimeout(500);
    expect(fake.state.pairings.size).toBe(0);
    expect(context.pages()).toHaveLength(pages);   // no approval tab yet
    await popup.getByRole("button", {name: "Connect to DownloadPulse on this computer"}).click();
    await expect(popup.getByTestId("code")).toHaveText("ABCD-0001");
    // The approval page opened on that server, at its own path.
    await expect.poll(() => context.pages().map((page) => page.url())).toContain("http://127.0.0.1:8095/?connect-browser=ABCD-0001");
    expect(fake.state.lastClientName).toMatch(/^Chrom\w* on \w+/);
    fake.answer("approved");
    await expect(popup.getByTestId("account")).toHaveText("Una", {timeout: 15_000});
    // The details are behind the chevron; DownloadPulse on this computer is named, never its loopback address.
    await expect(popup.getByTestId("server")).toBeHidden();
    // Collapsed, the chevron points right; open, down.
    const chevron = popup.getByRole("button", {name: "Connection details"}).locator("svg");
    // Lucide chevron-right points along +x; where its drawn transform sends +x is where it points.
    const pointing = () => chevron.evaluate((svg) => {
      const m = new DOMMatrix(getComputedStyle(svg).transform === "none" ? undefined : getComputedStyle(svg).transform);
      const [x, y] = [m.a, m.b];
      return Math.abs(y) > Math.abs(x) ? (y > 0 ? "down" : "up") : (x > 0 ? "right" : "left");
    });
    await expect(chevron).toHaveAttribute("data-glyph", "chevronRight");
    expect(await pointing()).toBe("right");
    await popup.getByRole("button", {name: "Connection details"}).click();
    await expect.poll(pointing).toBe("down");
    await popup.getByRole("button", {name: "Connection details"}).click();
    await expect.poll(pointing).toBe("right");
    await popup.getByRole("button", {name: "Connection details"}).click();
    await expect(popup.getByRole("button", {name: "Connection details"})).toHaveAttribute("aria-expanded", "true");
    await expect(popup.getByTestId("server")).toHaveText("Locally installed instance");
    await expect(popup.getByTestId("label")).toHaveText("Laptop-Chrome");
    await expect(popup.locator("body")).not.toContainText("127.0.0.1");
    // The token was verified with the session route, with no cookie alongside it.
    expect(fake.state.sessionAuth.at(-1)).toEqual({authorization: "Bearer dp_fake-token", cookie: null});
  } finally {
    await close();
    await fake.close();
  }
});

test("found on this computer, a different DownloadPulse can be chosen instead", async () => {
  const local = await fakeDownloadPulse({port: 8095});
  const remote = await fakeDownloadPulse();
  const {popup, close} = await launch();
  try {
    await popup.getByRole("button", {name: "Connect to a DownloadPulse instance"}).click();
    await expect(popup.getByLabel("Server address").filter({visible: true})).toHaveCount(0);
    await popup.getByRole("button", {name: "Connect to a different DownloadPulse"}).click();
    await popup.getByLabel("Server address").filter({visible: true}).fill(`http://localhost:${remote.port}`);
    await popup.getByRole("button", {name: "Connect to this server"}).click();
    await expect(popup.getByTestId("code")).toHaveText("ABCD-0001");
    remote.answer("approved");
    // localhost, on any port, is this computer: named so; the connection is that server's own.
    await expect(popup.getByTestId("server")).toHaveText("Locally installed instance", {timeout: 15_000});
    expect(remote.state.sessionAuth.length).toBeGreaterThan(0);
    expect(local.state.pairings.size).toBe(0);   // the one on this computer was never asked
  } finally {
    await close();
    await local.close();
    await remote.close();
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
    await popup.getByLabel("Server address").filter({visible: true}).fill(`http://localhost:${fake.port}`);
    await popup.getByRole("button", {name: "Connect to this server"}).click();
    await expect(popup.getByTestId("code")).toHaveText("ABCD-0001");
    fake.answer("approved");
    // localhost, on any port, is this computer: named so; the connection is that server's own.
    await expect(popup.getByTestId("server")).toHaveText("Locally installed instance", {timeout: 15_000});
    expect(fake.state.sessionAuth.length).toBeGreaterThan(0);
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
      await popup.getByLabel("Server address").filter({visible: true}).fill(`http://localhost:${fake.port}`);
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
    await popup.getByRole("button", {name: "Connect to DownloadPulse on this computer"}).click();
    await expect(popup.getByTestId("failure")).toHaveText("This DownloadPulse is too old to connect browsers. Update it, then connect again.");
    await popup.getByLabel("Or connect to a DownloadPulse server:").fill(`http://localhost:${current.port}`);
    await popup.locator('section[data-state="failed"]').getByRole("button", {name: "Connect to this server"}).click();
    await expect(popup.getByTestId("code")).toHaveText("ABCD-0001");
    current.answer("approved");
    // localhost, on any port, is this computer: named so; the connection is that server's own.
    await expect(popup.getByTestId("server")).toHaveText("Locally installed instance", {timeout: 15_000});
    expect(current.state.sessionAuth.length).toBeGreaterThan(0);
  } finally {
    await close();
    await old.close();
    await current.close();
  }
});
