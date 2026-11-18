// SPDX-License-Identifier: GPL-2.0-or-later
// The one manifest definition (WS-E0 B2): both browsers share everything
// except how the background is declared and Firefox's own settings.

// INPUT REQUIRED (PLAN D6): the store add-on ID. This development ID is the
// only one to replace before the first Firefox store submission.
export const FIREFOX_ADDON_ID = "downloadpulse-dev@downloadpulse.invalid";

/** @param {"chromium" | "firefox"} browser @param {string} version */
export function manifest(browser, version) {
  const shared = {
    manifest_version: 3,
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    version,
    default_locale: "en",
    icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
    action: {
      default_title: "__MSG_actionTitle__",
      default_popup: "popup/popup.html",
      default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" },
    },
    options_ui: { page: "options/options.html", open_in_tab: true },
    permissions: ["storage", "contextMenus"],
    // Every site (WS-E2 B9): a .torrent/.nzb/.meta4 is captured from whatever
    // site serves it, with the person's own login there (spike S1); the
    // in-page surfaces run everywhere. This includes a DownloadPulse on this
    // computer (WS-E1 B2) and any server the person names (L20).
    host_permissions: ["<all_urls>"],
    content_scripts: [{matches: ["<all_urls>"], js: ["content.js"], all_frames: true, run_at: "document_idle"}],
  };
  if (browser === "chromium") {
    return { ...shared, background: { service_worker: "background.js" }, minimum_chrome_version: "120" };
  }
  return {
    ...shared,
    background: { scripts: ["background.js"] },
    // The URL-bar icon, shown on a page whose content script saw a video (WS-E2 B4).
    page_action: { default_title: "__MSG_pageActionSend__", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
    browser_specific_settings: {
      gecko: { id: FIREFOX_ADDON_ID, strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
    },
  };
}
