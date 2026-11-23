// SPDX-License-Identifier: GPL-2.0-or-later
// Browser downloads sent to DownloadPulse instead (1.0.2, operator 2026-11-22): with the
// setting on and a connection usable, a download the browser starts is held (paused) and sent
// to DownloadPulse with the person's sign-in on its site and the page it came from
// (submit.ts sendDownload). Refused, unreachable or not connected: the browser's download
// simply goes on. Sending by hand (the icon, right-click, Quick Add) is the same either way.
//
// Accepted is not yet downloaded (1.0.3, review 2026-11-22): a signed or one-time address, or
// a download a form started, may fail in DownloadPulse after it was accepted. So the browser's
// copy stays held -- paused, in its list -- until DownloadPulse's job settles, as the monitor's
// one job cache reports it (monitor.ts): completed (or removed by the person here), and the
// browser's copy is cancelled and taken off its list; failed or removed in DownloadPulse, and
// it resumes. Disconnected, reconnected as someone else, or the connection no longer usable:
// it resumes, never erased. Limits, said plainly: a download the browser cannot pause is
// cancelled as soon as DownloadPulse accepts it (else both would fetch it whole); a held
// download the browser has meanwhile dropped (a restart, an expired address) cannot be brought
// back; disconnecting while DownloadPulse is still downloading lets both finish it; turning
// this off while a download is held gives the permission back at once, so that download stays
// paused in the browser's list for the person to resume; a held job that falls out of the
// monitor's list (it keeps the newest 100) is never settled, and stays paused likewise.
//
// Left to the browser, always: what is not an http(s) file (a page's own data -- blob:,
// data: -- and file:), a download another extension started, a .torrent/.nzb/.meta4 (the
// in-page and right-click sends take those as contents), one known to be under the person's
// minimum size, and a file type they listed.

import {connections, token, whileConnectedWith} from "../shared/connection";
import {decide} from "../shared/downloads";
import {isStateKey} from "../shared/server-state";
import {saveSettings, settings} from "../shared/settings";
import {cachedJobs} from "./monitor";
import {feedback, sendDownload, type Sent} from "./submit";

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
    if (sent.ok && paused && sent.sent.job) {
      await hold(item, sent.sent);
    } else if (sent.ok && paused) {
      // Accepted without a job to follow (a DownloadPulse that named none): nothing could ever
      // settle it, so the browser carries on rather than wait for good.
      await resume(item.id);
    } else if (sent.ok) {
      // Could not be held: both would fetch it whole, so the browser's copy goes now.
      await drop(item.id);
    } else if (paused) {
      await resume(item.id);
    }
    await feedback(await activeTab(), sent.ok ? sent.said : "captureKeptInBrowser", sent.ok);
  } finally {
    handling.delete(item.id);
  }
}

// ── held downloads ───────────────────────────────────────────────────────
// Which of the browser's downloads wait on which DownloadPulse job: nothing else (the job's
// state is the monitor's cache's, never kept here). In local storage, so a held download is
// still settled after the browser restarts; with its address and start, so a download id the
// browser gave out again (Firefox numbers them per session) is never mistaken for it.

const HELD = "heldDownloads";

interface Held { server: string; tokenId: string; job: string; url: string; startTime: string }

// Every change of the held list runs one after another, each reading what the one before wrote.
let changing: Promise<unknown> = Promise.resolve();
function changeHeld(change: (held: Record<string, Held>) => void): Promise<void> {
  const next = changing.then(async () => {
    const held = {...(((await chrome.storage.local.get(HELD))[HELD] as Record<string, Held> | undefined) ?? {})};
    change(held);
    await chrome.storage.local.set({[HELD]: held});
  });
  changing = next.catch(() => undefined);
  return next;
}

async function heldDownloads(): Promise<Record<string, Held>> {
  return ((await chrome.storage.local.get(HELD))[HELD] as Record<string, Held> | undefined) ?? {};
}

/** Accepted while paused: held until its job settles -- only while still connected as the send was. */
async function hold(item: chrome.downloads.DownloadItem, sent: Sent): Promise<void> {
  const held = await whileConnectedWith(sent.server, sent.browserToken, async () => {
    const tokenId = (await connections())[sent.server]?.tokenId ?? "";
    await changeHeld((all) => {
      all[String(item.id)] = {server: sent.server, tokenId, job: sent.job, url: item.url, startTime: item.startTime};
    });
  });
  // Disconnected while it was being sent: the browser carries on with it.
  if (!held) await resume(item.id);
  // It may have settled already (a fast failure), with no later change of the cache to say so.
  else await settleHeld();
}

async function resume(id: number): Promise<void> {
  try {
    await chrome.downloads.resume(id);
  } catch {
    // the browser ended it meanwhile
  }
}

async function drop(id: number): Promise<void> {
  try {
    await chrome.downloads.cancel(id);
  } catch {
    // already finished in the browser: both have it, and nothing is lost
  }
  try {
    await chrome.downloads.erase({id});
  } catch {
    // gone already
  }
}

/** The browser's download ``id``, if it is still the one held there and still paused. */
async function stillHeld(id: number, entry: Held): Promise<boolean> {
  try {
    const [item] = await chrome.downloads.search({id});
    return Boolean(item && item.url === entry.url && item.startTime === entry.startTime
      && item.state === "in_progress" && item.paused);
  } catch {
    return false;
  }
}

/**
 * Settle every held download whose job has settled, or whose connection is gone: reads the
 * current state each time, so it may run as often as anything changes (and does).
 */
let settling: Promise<unknown> = Promise.resolve();
export function settleHeld(): Promise<void> {
  const next = settling.then(settleOnce);
  settling = next.catch(() => undefined);
  return next;
}

async function settleOnce(): Promise<void> {
  if (!chrome.downloads?.search) return;
  const held = await heldDownloads();
  if (!Object.keys(held).length) return;
  const saved = await connections();
  const settled: string[] = [];
  for (const [key, entry] of Object.entries(held)) {
    const id = Number(key);
    // Resumed, finished or ended in the browser by the person, or no longer the same download.
    if (!(await stillHeld(id, entry))) {
      settled.push(key);
      continue;
    }
    // Disconnected, connected again as someone else, or the connection may no longer be used.
    if (saved[entry.server]?.tokenId !== entry.tokenId || !(await token(entry.server))) {
      await resume(id);
      settled.push(key);
      continue;
    }
    const job = (await cachedJobs(entry.server))[entry.job];
    if (!job) continue;
    if (job.phase === "completed" || (job.phase === "withdrawn" && job.reason === "withdrawn_by_client")) {
      await drop(id);
      settled.push(key);
    } else if (job.phase === "failed" || job.phase === "withdrawn") {
      await resume(id);
      settled.push(key);
      await feedback(await activeTab(), "captureResumedInBrowser", false);
    }
  }
  // Only the entries settled here: one the browser gave the same id meanwhile is another download.
  if (settled.length) {
    await changeHeld((all) => {
      for (const key of settled) {
        if (all[key]?.url === held[key]?.url && all[key]?.startTime === held[key]?.startTime) delete all[key];
      }
    });
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
// Whatever a held download waits on: its job in the monitor's cache, its connection, the consent.
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  if ((area === "session" && keys.some((key) => isStateKey(key, "jobs")))
      || (area === "local" && keys.some((key) => key === "connections" || key === "consent"))) {
    void settleHeld();
  }
});
// Started (or woken) with downloads still held from before.
void settleHeld();

chrome.permissions?.onRemoved?.addListener((removed) => {
  // The permission taken back in the browser's own settings: the setting follows it.
  if (removed.permissions?.includes("downloads")) {
    void saveSettings({capture: false});
  }
});
