// SPDX-License-Identifier: GPL-2.0-or-later
// The one monitor of this browser's downloads (WS-E3 B1, B2, B5). It reads
// the job list by change cursor into a non-secret cache (storage.session)
// that the popup renders, animates the toolbar ring while anything is
// active (the icon updates keep the background alive, spike S2), and raises
// a notification when a job completes, fails or needs attention. It runs
// only while a job is unsettled or the popup is open.

import {connection, forgetConnection, token} from "../shared/connection";
import {settings} from "../shared/settings";
import {message} from "../shared/i18n";
import {listJobs, ServerError, type Job} from "../shared/server";

const JOBS = "jobs";
const CURSOR = "jobsCursor";
const NOTIFIED = "jobsNotified";
const ALARM = "dp-monitor";
const POLL_MS = 2000;
const FRAME_MS = 125;
const POPUP_GRACE_MS = 7000;
const KEEP = 100;

let running = false;
let popupSeenAt = 0;

export const unsettled = (job: Job): boolean => ["accepted", "queued", "processing"].includes(job.phase);
export const active = (job: Job): boolean => unsettled(job) && job.reason !== "paused";

export async function cachedJobs(): Promise<Record<string, Job>> {
  return ((await chrome.storage.session.get(JOBS))[JOBS] as Record<string, Job> | undefined) ?? {};
}

/** The popup is open: keep the list fresh while it is. */
export function popupOpen(): void {
  popupSeenAt = Date.now();
  wake();
}

export function wake(): void {
  if (running) return;
  running = true;
  void loop().finally(() => { running = false; });
}

function ring(frame: number, size: number): ImageData {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d")!;
  const centre = size / 2;
  const radius = size * 0.36;
  context.lineWidth = Math.max(2, size * 0.14);
  context.strokeStyle = "rgba(59,130,246,.25)";
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = "#2563eb";
  context.lineCap = "round";
  const start = (frame % 12) * (Math.PI / 6);
  context.beginPath();
  context.arc(centre, centre, radius, start, start + Math.PI * 1.2);
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

async function drawRing(frame: number): Promise<void> {
  await chrome.action.setIcon({imageData: {16: ring(frame, 16), 32: ring(frame, 32)}});
}

async function restoreIcon(): Promise<void> {
  await chrome.action.setIcon({path: {16: "icons/icon-16.png", 32: "icons/icon-32.png"}});
}

function jobName(job: Job): string {
  const source = job.source ?? {};
  // DownloadPulse's own title first: it follows the transfer (a media
  // download's resolved title replaces its link's placeholder).
  return job.name || job.display_name || String(source["name"] ?? "") || String((source["hosts"] as string[] | undefined)?.[0] ?? "")
    || String(source["kind"] ?? "");
}

/** B5: what a transition into ``job`` deserves, once per job and state. */
function notice(job: Job, before: Job | undefined): string | null {
  if (job.phase === "completed" && before?.phase !== "completed") return "completed";
  if (job.phase === "failed" && before?.phase !== "failed") return "failed";
  if (unsettled(job) && job.actionability === "operator" && before?.actionability !== "operator") return "attention";
  return null;
}

async function notify(job: Job, kind: string): Promise<void> {
  // Only the notifications the person keeps on (WS-E4).
  if (!(await settings()).notify[kind as "completed" | "failed" | "attention"]) return;
  const notified = ((await chrome.storage.session.get(NOTIFIED))[NOTIFIED] as string[] | undefined) ?? [];
  const id = `dp:${job.id}:${kind}`;
  if (notified.includes(id)) return;
  await chrome.storage.session.set({[NOTIFIED]: [...notified, id].slice(-300)});
  const key = kind === "completed" ? "notifyCompleted" : kind === "failed" ? "notifyFailed" : "notifyAttention";
  await chrome.notifications.create(id, {type: "basic", iconUrl: "icons/icon-128.png", title: message("extName"),
    message: message(key, [jobName(job)])});
}

async function poll(): Promise<boolean> {
  const connected = await connection();
  const browserToken = await token();
  if (!connected || !browserToken) return false;
  const jobs = await cachedJobs();
  let cursor = Number((await chrome.storage.session.get(CURSOR))[CURSOR] ?? 0);
  try {
    for (let page = 0; page < 10; page++) {
      const listing = await listJobs(connected.server, browserToken, cursor);
      for (const job of listing.jobs) {
        const kind = notice(job, jobs[job.id]);
        // A job first seen already settled (an earlier session's) is listed quietly.
        if (kind && (jobs[job.id] || unsettled(job) || cursor > 0)) await notify(job, kind);
        jobs[job.id] = job;
      }
      cursor = listing.next_cursor;
      if (!listing.more) break;
    }
  } catch (error) {
    if (error instanceof ServerError && error.failure === "unauthorized") {
      // Disconnected in DownloadPulse (Connected browsers): forget it here, and say so.
      await forgetConnection(true);
      return false;
    }
    return true;   // unreachable for now: try again next time
  }
  const kept = Object.values(jobs).sort((a, b) => b.cursor - a.cursor).slice(0, KEEP);
  await chrome.storage.session.set({[JOBS]: Object.fromEntries(kept.map((job) => [job.id, job])), [CURSOR]: cursor});
  return true;
}

async function loop(): Promise<void> {
  let frame = 0;
  let polledAt = 0;
  let ringing = false;
  try {
    for (;;) {
      if (Date.now() - polledAt >= POLL_MS) {
        polledAt = Date.now();
        if (!(await poll())) break;
      }
      const jobs = Object.values(await cachedJobs());
      const anyUnsettled = jobs.some(unsettled);
      if (anyUnsettled) await chrome.alarms.create(ALARM, {periodInMinutes: 1});
      else await chrome.alarms.clear(ALARM);
      if (!anyUnsettled && Date.now() - popupSeenAt > POPUP_GRACE_MS) break;
      if (jobs.some(active)) {
        ringing = true;
        await drawRing(frame++);
      } else if (ringing) {
        ringing = false;
        await restoreIcon();
      }
      await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
    }
  } finally {
    if (ringing) await restoreIcon();
  }
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) wake(); });
// A notification about one of this browser's downloads opens the extension's
// own popup, on that download (operator, 2026-11-18). Where the browser does
// not let an extension open its toolbar popup from code (Firefox may require
// a user action), the same popup page opens in a window of its own size.
chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("dp:")) return;
  const job = id.split(":")[1] ?? "";
  void (async () => {
    await chrome.storage.session.set({focusJob: job});
    await chrome.notifications.clear(id);
    try {
      await chrome.action.openPopup();
    } catch {
      await chrome.windows.create({url: chrome.runtime.getURL(`popup/popup.html?job=${encodeURIComponent(job)}`),
        type: "popup", width: 380, height: 600, focused: true});
    }
  })();
});
