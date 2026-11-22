// SPDX-License-Identifier: GPL-2.0-or-later
// Browser downloads sent to DownloadPulse instead (1.0.2, operator 2026-11-22): with the
// setting on and a connection usable, a download the browser starts is held (paused), sent
// to DownloadPulse with the person's sign-in on its site and the page it came from
// (submit.ts sendDownload), and only once DownloadPulse has accepted it is the browser's own
// copy cancelled and taken off its list. Refused, unreachable or not connected: the browser's
// download simply goes on -- nothing is ever lost. Sending by hand (the icon, right-click,
// Quick Add) is the same either way.
//
// Left to the browser, always: what is not an http(s) file (a page's own data -- blob:,
// data: -- and file:), a download another extension started, a .torrent/.nzb/.meta4 (the
// in-page and right-click sends take those as contents), one known to be under the person's
// minimum size, and a file type they listed.

import {token} from "../shared/connection";
import {decide} from "../shared/downloads";
import {saveSettings, settings} from "../shared/settings";
import {feedback, sendDownload} from "./submit";

const handling = new Set<number>();

async function onCreated(item: chrome.downloads.DownloadItem): Promise<void> {
  if (handling.has(item.id)) return;
  const chosen = await settings();
  if (decide(item, chosen) !== "capture") return;
  // Not connected (or the connection held): the browser keeps it, as if this were off.
  if (!(await token())) return;
  handling.add(item.id);
  try {
    // Held while DownloadPulse answers. A download the browser cannot pause goes on meanwhile;
    // it is still cancelled once DownloadPulse has it.
    let paused = false;
    try {
      await chrome.downloads.pause(item.id);
      paused = true;
    } catch {
      paused = false;
    }
    const href = item.finalUrl || item.url;
    const sent = await sendDownload(href, item.referrer ?? "",
      {cookieStoreId: (item as chrome.downloads.DownloadItem & {cookieStoreId?: string}).cookieStoreId});
    if (sent.ok) {
      try {
        await chrome.downloads.cancel(item.id);
      } catch {
        // already finished in the browser: both have it, and nothing is lost
      }
      try {
        await chrome.downloads.erase({id: item.id});
      } catch {
        // gone already
      }
    } else if (paused) {
      try {
        await chrome.downloads.resume(item.id);
      } catch {
        // the browser ended it meanwhile
      }
    }
    await feedback(await activeTab(), sent.ok ? sent.said : "captureKeptInBrowser", sent.ok);
  } finally {
    handling.delete(item.id);
  }
}

/** Where the person is looking: the toast goes to that tab, or to the toolbar badge. */
async function activeTab(): Promise<{tabId?: number; frameId?: number}> {
  try {
    const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
    return tab?.id !== undefined ? {tabId: tab.id, frameId: 0} : {};
  } catch {
    return {};
  }
}

let listening = false;

/** Start listening once the browser grants the optional "downloads" permission (now, or when it is granted). */
export function listen(): void {
  if (listening || !chrome.downloads?.onCreated) return;
  chrome.downloads.onCreated.addListener((item) => void onCreated(item));
  listening = true;
}

chrome.permissions?.onAdded?.addListener((granted) => {
  if (!granted.permissions?.includes("downloads")) return;
  listen();
  // Granted by the person (the setup offer, the switch, or the browser's own add-on settings):
  // it is turned on HERE, not by the dropdown that asked. The browser's permission prompt closes
  // the dropdown, so its own answer may never arrive; then the setup offer stayed and had to be
  // answered a second time (operator, 2026-11-22). An open dropdown redraws from this change.
  void saveSettings({capture: true, captureAsked: true})
    .then(() => chrome.storage.local.remove("captureOffer"));
});
chrome.permissions?.onRemoved?.addListener((removed) => {
  // The permission taken back in the browser's own settings: the setting follows it.
  if (removed.permissions?.includes("downloads")) {
    void saveSettings({capture: false});
  }
});
