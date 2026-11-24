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
// it resumes, never erased. Turned off here: every held download resumes before the permission
// is given back. A held job that falls out of the monitor's list (it keeps the newest 100) has
// an outcome no longer known here, so the browser's copy resumes too (1.0.3, WS26). Limits,
// said plainly: a download the browser cannot pause is cancelled as soon as DownloadPulse
// accepts it (else both would fetch it whole); a held download the browser has meanwhile
// dropped (a restart, an expired address) cannot be brought back; disconnecting while
// DownloadPulse is still downloading, or a job that fell out of the list, lets both finish it;
// the permission taken back in the browser's own settings leaves nothing this extension may
// resume with, so a download held then stays paused in the browser's list for the person, and
// the held list is cleared. A browser without a downloads list an extension can pause (Firefox
// for Android) holds nothing: browser downloads stay with it there. A download sent without
// the person's sign-in on its site (1.0.4, review 2026-11-24) is never held or cancelled: the
// browser's copy carries on beside DownloadPulse's, which may be a sign-in page.
//
// Held, not forever (1.0.4, review 2026-11-24): a held download whose job DownloadPulse has not
// been seen downloading or paused for HELD_LIMIT_MS -- never listed, still accepted or queued,
// resolving, waiting on the person there, or its DownloadPulse not answering -- resumes in the
// browser and leaves the held list, and the person is told. The clock starts when it is held and
// starts again whenever its job is seen downloading (or verifying, finishing), so a transfer that
// is moving is never cut off however long it takes; or seen paused, by whoever paused it (here,
// in DownloadPulse, or DownloadPulse itself), so a paused download stays paused in DownloadPulse
// and is never handed back to the browser (operator, 2026-11-24); and once when each browser
// session begins, so the time the browser was closed is never judged as time without progress.
// Both may then finish it.
//
// Left to the browser, always: what is not an http(s) file (a page's own data -- blob:,
// data: -- and file:), a download another extension started, a .torrent/.nzb/.meta4 (the
// in-page and right-click sends take those as contents), one under the person's minimum size or
// of a size the browser does not know yet (unless the minimum is 0: decide()), and a file type
// they listed.

import {connections, token, whileConnectedWith} from "../shared/connection";
import {decide, downloadsUsable} from "../shared/downloads";
import type {Job} from "../shared/server";
import {isStateKey, stateKey} from "../shared/server-state";
import {saveSettings, settings} from "../shared/settings";
import {cachedJobs} from "./monitor";
import {feedback, sendDownload, type Sent} from "./submit";

const handling = new Set<number>();

const DOWNLOADS: chrome.permissions.Permissions = {permissions: ["downloads"]};

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
    if (sent.ok && sent.withoutSignIn) {
      // A sign-in on that site did not go with it (switched off, a plain-HTTP DownloadPulse, or
      // one that does not take it): DownloadPulse may be given a sign-in page and call it done,
      // so the browser's copy is never cancelled for it -- it carries on now (review, 2026-11-24).
      if (paused) await resume(item.id);
    } else if (sent.ok && paused && sent.sent.job) {
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
// browser gave out again (Firefox numbers them per session) is never mistaken for it; and with
// the job's change cursor when the cache first listed it (``seen``), so a job that has since
// fallen out of the cache is told from one not listed yet; and with when its job was last seen
// moving or paused (``progressAt``), for the time limit. PRIVACY.md says what is kept.

const HELD = "heldDownloads";

interface Held {
  server: string; tokenId: string; job: string; url: string; startTime: string; seen?: number;
  /** When it was held, its job last seen moving or paused, or this browser session began (ms); none on one held by 1.0.3 (counted from now). */
  progressAt?: number;
}

/**
 * How long a held download waits for its job to be seen moving (or paused): 10 minutes. A real
 * transfer is past its queue and resolving well within that (DownloadPulse resolves a file link
 * in seconds, and its queue moves on as downloads finish); one that has not moved for that long
 * is stuck or its DownloadPulse unreachable, and the person is better served by the browser's
 * own copy than by a download held for good. Long enough that a busy queue or a short outage
 * does not hand every held download back. A paused job is not stuck: it waits on whoever paused
 * it, for as long as it stays paused.
 */
const HELD_LIMIT_MS = 10 * 60_000;
/** A moving (or paused) job's clock is written down at most this often (each listing would otherwise write it). */
const PROGRESS_WRITE_MS = 60_000;
/** Wakes the background when the next held download's limit is up (nothing else may change then). */
const HELD_ALARM = "dp-held";
/**
 * Set (session storage) once this browser session's first settling pass has started every held
 * clock again. The job cache and each server's reach are the session's, empty after a restart,
 * while the held list is kept: until this session hears from a held download's DownloadPulse
 * nothing is known of its job, so the time the browser was closed is never judged as time
 * without progress (review of 1fe2913d). Once per session, not per answer: the first pass may
 * run before or after the monitor's first listing.
 */
const CLOCKS_STARTED = "heldClocksStarted";
/**
 * The job reasons (BROWSER_CLIENT.md §2a, phase "processing") that start its clock again: its
 * transfer moving, or paused (DownloadPulse's "paused" status, whoever ``paused_by`` names).
 */
const NOT_STUCK = new Set(["downloading", "verifying", "finalizing", "paused"]);

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
      all[String(item.id)] = {server: sent.server, tokenId, job: sent.job, url: item.url, startTime: item.startTime,
        progressAt: Date.now()};
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
 * Whether ``entry``'s job, absent from ``jobs``, fell out of the cache: listed once at cursor
 * ``seen``, and everything kept now changed later (the cache keeps the newest by cursor, and a
 * job's cursor only grows). Never listed, it may simply not be listed yet (just accepted, or the
 * cache refilling after a restart): it waits.
 */
function fellOut(entry: Held, jobs: Record<string, {cursor: number}>): boolean {
  const cursors = Object.values(jobs).map((job) => job.cursor);
  return entry.seen !== undefined && cursors.length > 0 && Math.min(...cursors) > entry.seen;
}

/**
 * Whether ``job`` is paused, or being downloaded now. Downloading only while its DownloadPulse
 * answered its last listing: a transfer last seen moving by a DownloadPulse that no longer
 * answers may have stopped, and the browser's copy carries on after the limit. Paused, whatever
 * the reach: a paused download stays paused (operator, 2026-11-24), and nothing but the person
 * or DownloadPulse resumes it. That last listing is this browser session's (the cache is session
 * storage, empty after a restart), so a pause seen in an earlier session is never relied on.
 */
async function notStuck(server: string, job: Job): Promise<boolean> {
  if (job.phase !== "processing" || !NOT_STUCK.has(job.reason ?? "")) return false;
  if (job.reason === "paused") return true;
  const reach = stateKey(server, "reach");
  return Boolean(((await chrome.storage.session.get(reach))[reach] as {ok?: boolean} | undefined)?.ok);
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
  const held = await heldDownloads();
  if (!Object.keys(held).length) return;
  const settled: string[] = [];
  const seen: Record<string, number> = {};
  const progress: Record<string, number> = {};
  const now = Date.now();
  const restarted = !(await chrome.storage.session.get(CLOCKS_STARTED))[CLOCKS_STARTED];
  let wakeAt = Infinity;
  // The permission taken back (or no usable downloads API): nothing here may resume them any
  // more, so the browser keeps them as they are, and the list goes.
  const allowed = downloadsUsable(chrome.downloads)
    && await chrome.permissions.contains(DOWNLOADS).catch(() => false);
  const capturing = allowed && (await settings()).capture;
  const saved = await connections();
  for (const [key, entry] of Object.entries(held)) {
    const id = Number(key);
    // Resumed, finished or ended in the browser by the person, or no longer the same download.
    if (!allowed || !(await stillHeld(id, entry))) {
      settled.push(key);
      continue;
    }
    // Turned off; disconnected, connected again as someone else, or the connection may no
    // longer be used: released, never erased.
    if (!capturing || saved[entry.server]?.tokenId !== entry.tokenId || !(await token(entry.server))) {
      await resume(id);
      settled.push(key);
      continue;
    }
    const jobs = await cachedJobs(entry.server);
    const job = jobs[entry.job];
    if (!job) {
      // Its outcome in DownloadPulse is no longer known here: the browser's copy carries on.
      if (fellOut(entry, jobs)) {
        await resume(id);
        settled.push(key);
        continue;
      }
    } else {
      if (entry.seen === undefined) seen[key] = job.cursor;
      if (job.phase === "completed" || (job.phase === "withdrawn" && job.reason === "withdrawn_by_client")) {
        await drop(id);
        settled.push(key);
        continue;
      }
      if (job.phase === "failed" || job.phase === "withdrawn") {
        await resume(id);
        settled.push(key);
        await feedback(await activeTab(), "captureResumedInBrowser", false);
        continue;
      }
    }
    // Still waiting: on its time limit, from when it was held, its job last seen moving or paused,
    // or this browser session began (CLOCKS_STARTED).
    const since = restarted || (job && await notStuck(entry.server, job)) ? now : entry.progressAt ?? now;
    if (since - (entry.progressAt ?? -Infinity) >= PROGRESS_WRITE_MS) progress[key] = since;
    const kept = progress[key] ?? entry.progressAt ?? now;
    if (now - kept >= HELD_LIMIT_MS) {
      await resume(id);
      settled.push(key);
      await feedback(await activeTab(), "captureResumedNoProgress", false);
      continue;
    }
    wakeAt = Math.min(wakeAt, kept + HELD_LIMIT_MS);
  }
  // Nothing else may happen when a limit is up (a job never listed changes nothing): woken then.
  if (wakeAt < Infinity) await chrome.alarms.create(HELD_ALARM, {when: wakeAt});
  else await chrome.alarms.clear(HELD_ALARM);
  // Only the entries settled (or first listed) here: one the browser gave the same id meanwhile
  // is another download.
  if (settled.length || Object.keys(seen).length || Object.keys(progress).length) {
    await changeHeld((all) => {
      const same = (key: string) => all[key]?.url === held[key]?.url && all[key]?.startTime === held[key]?.startTime;
      for (const key of settled) if (same(key)) delete all[key];
      for (const [key, cursor] of Object.entries(seen)) if (same(key) && !settled.includes(key)) all[key]!.seen = cursor;
      for (const [key, at] of Object.entries(progress)) if (same(key) && !settled.includes(key)) all[key]!.progressAt = at;
    });
  }
  if (restarted) await chrome.storage.session.set({[CLOCKS_STARTED]: true});
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
  if (listening || !downloadsUsable(chrome.downloads)) return;
  chrome.downloads.onCreated.addListener((item) => void onCreated(item));
  listening = true;
}

chrome.permissions?.onAdded?.addListener((granted) => {
  if (!granted.permissions?.includes("downloads")) return;
  // Granted where there is no downloads list an extension can pause: given back, and it stays off.
  if (!downloadsUsable(chrome.downloads)) {
    void chrome.permissions.remove(DOWNLOADS).catch(() => false);
    return;
  }
  listen();
  // Granted by the person (the setup offer, the switch, or the browser's own add-on settings):
  // it is turned on HERE, not by the dropdown that asked. The browser's permission prompt closes
  // the dropdown, so its own answer may never arrive; then the setup offer stayed and had to be
  // answered a second time (operator, 2026-11-22). An open dropdown redraws from this change.
  void saveSettings({capture: true, captureAsked: true})
    .then(() => chrome.storage.local.remove("captureOffer"));
});
// Whatever a held download waits on: its job in the monitor's cache, its connection, the consent,
// the setting.
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  if ((area === "session" && keys.some((key) => isStateKey(key, "jobs")))
      || (area === "local" && keys.some((key) => key === "connections" || key === "consent" || key === "settings"))) {
    void settleHeld();
  }
});
// A held download's time limit is up.
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === HELD_ALARM) void settleHeld(); });
// Started (or woken) with downloads still held from before.
void settleHeld();

chrome.permissions?.onRemoved?.addListener((removed) => {
  // The permission taken back in the browser's own settings: the setting follows it.
  if (removed.permissions?.includes("downloads")) {
    void saveSettings({capture: false}).then(settleHeld);
  }
});
