// SPDX-License-Identifier: GPL-2.0-or-later
// The one manifest definition (WS-E0 B2): both browsers share everything
// except how the background is declared and Firefox's own settings.

// The permanent Firefox add-on ID (PLAN D6, operator 2026-11-19). AMO ties the
// listing and every update to it: it must never change.
export const FIREFOX_ADDON_ID = "downloadpulse@downloadpulse.net";

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
    // cookies: a video's sign-in on its site, for DownloadPulse's video downloader (operator,
    // 2026-11-19; docs/store/PERMISSIONS.md), only for a video send, switchable in the settings.
    permissions: ["storage", "contextMenus", "notifications", "alarms", "cookies"],
    // Web pages only, http and https (store review, 2026-11-18; docs/store/PERMISSIONS.md):
    // the in-page buttons run on whatever page the person browses, in its frames too
    // (a video player is often embedded in one); a .torrent/.nzb/indexer link is
    // captured from whatever site serves it, with the person's own sign-in there
    // (spike S1); the DownloadPulse on this computer, or the server the person names.
    host_permissions: ["http://*/*", "https://*/*"],
    content_scripts: [{matches: ["http://*/*", "https://*/*"], js: ["content.js"], all_frames: true, run_at: "document_idle"}],
    // Never in private windows: a private session's downloads would land in DownloadPulse's lasting queue.
    incognito: "not_allowed",
  };
  if (browser === "chromium") {
    return { ...shared, background: { service_worker: "background.js" }, minimum_chrome_version: "120" };
  }
  return {
    ...shared,
    // dns: a server or file-link name that resolves only to private addresses (split DNS) counts as
    // the person's network (operator, 2026-11-19; docs/store/PERMISSIONS.md). Firefox only: Chromium has no such API.
    permissions: [...shared.permissions, "dns"],
    background: { scripts: ["background.js"] },
    // The URL-bar icon, shown on a page whose content script saw a video (WS-E2 B4).
    page_action: { default_title: "__MSG_pageActionSend__", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ADDON_ID, strict_min_version: "140.0",
        // What the extension handles (PRIVACY.md): the links and pages the person sends (browsing
        // activity), a captured file (website content), the DownloadPulse connection key it
        // receives, stores and sends (authentication information); the browser and system that
        // name the connection only with optional consent (technical data).
        data_collection_permissions: { required: ["authenticationInfo", "browsingActivity", "websiteContent"],
          optional: ["technicalAndInteraction"] },
      },
    },
  };
}
