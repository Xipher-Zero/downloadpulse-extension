// SPDX-License-Identifier: GPL-2.0-or-later
// Chromium smoke test (WS-E0 B7): the service worker starts and the popup
// renders its localized placeholder.
import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/chromium");

test("the Chromium package loads, starts its worker and renders the popup", async () => {
  const profile = await mkdtemp(join(tmpdir(), "dp-ext-smoke-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const id = new URL(worker.url()).host;
    const messages = JSON.parse(await readFile(join(EXT, "_locales/en/messages.json"), "utf8"));

    const popup = await context.newPage();
    const errors = [];
    popup.on("pageerror", (e) => errors.push(String(e)));
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await expect(popup.locator("h1")).toHaveText(messages.extName.message);
    await expect(popup.getByTestId("status")).toHaveText(messages.popupNotConnected.message);
    await expect(popup.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(popup).toHaveTitle(messages.extName.message);

    const options = await context.newPage();
    options.on("pageerror", (e) => errors.push(String(e)));
    await options.goto(`chrome-extension://${id}/options/options.html`);
    await expect(options.locator("h1")).toHaveText(messages.optionsTitle.message);
    await expect(options.getByText(messages.optionsNotConnected.message)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
