// SPDX-License-Identifier: GPL-2.0-or-later
// WS-E5: the extension speaks the browser's language, and right to left
// where that language is (Arabic): the popup's words come from that locale's
// catalog, never English.
import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/chromium");

for (const [lang, folder, dir] of [["de", "de", "ltr"], ["ar", "ar", "rtl"], ["zh-CN", "zh_CN", "ltr"], ["pt-BR", "pt_BR", "ltr"]]) {
  test(`the popup in ${lang}`, async () => {
    const profile = await mkdtemp(join(tmpdir(), "dp-ext-locale-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, locale: lang,
      args: [`--lang=${lang}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    try {
      const catalog = JSON.parse(await readFile(join(EXT, "_locales", folder, "messages.json"), "utf8"));
      const english = JSON.parse(await readFile(join(EXT, "_locales", "en", "messages.json"), "utf8"));
      const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup/popup.html`);
      await expect(popup.getByTestId("status")).toHaveText(catalog.popupNotConnected.message);
      expect(catalog.popupNotConnected.message).not.toBe(english.popupNotConnected.message);
      // The connect tile: its two lines in the language, its accessible name the whole phrase.
      const tile = popup.locator("button[data-action='connect-local']").first();
      await expect(tile).toHaveAttribute("aria-label", catalog.popupConnect.message);
      await expect(tile).toContainText(catalog.connectTileBottom.message);
      // The right-click way quotes the menu item exactly as the menu says it.
      await expect(popup.getByTestId("welcome-right-click")).toContainText(catalog.menuSend.message);
      await expect(popup.locator("html")).toHaveAttribute("dir", dir);
    } finally {
      await context.close();
      await rm(profile, {recursive: true, force: true});
    }
  });
}
