// SPDX-License-Identifier: GPL-2.0-or-later
// The one monitor of this browser's downloads (WS-E3 B1, B2, B5). It reads
// the job list by change cursor into a non-secret cache (storage.session)
// that the popup renders, animates the toolbar icon while anything is
// active (the icon updates keep the background alive, spike S2), and raises
// a notification when a job completes, fails or needs attention. It runs
// only while a job is unsettled or the popup is open.

import {connections, forgetConnection, token} from "../shared/connection";
import {stateKey} from "../shared/server-state";
import {settings} from "../shared/settings";
import {message} from "../shared/i18n";
import {listJobs, ServerError, type Job} from "../shared/server";
import {restIcon, themedIcon} from "./icon";
import {forgetSentKey} from "./sent-keys";

const ALARM = "dp-monitor";
const POLL_MS = 2000;
const FRAME_MS = 125;
const POPUP_GRACE_MS = 7000;
const KEEP = 100;

let running = false;
let popupSeenAt = 0;

export const unsettled = (job: Job): boolean => ["accepted", "queued", "processing"].includes(job.phase);
export const active = (job: Job): boolean => unsettled(job) && job.reason !== "paused";

/** ``server``'s downloads as last seen (each server's under its own key: server-state.ts). */
export async function cachedJobs(server: string): Promise<Record<string, Job>> {
  const key = stateKey(server, "jobs");
  return ((await chrome.storage.session.get(key))[key] as Record<string, Job> | undefined) ?? {};
}

/** Every saved server's downloads, together (what the icon and the wake-up alarm follow). */
async function everyJob(): Promise<Job[]> {
  const servers = Object.keys(await connections());
  return (await Promise.all(servers.map(cachedJobs))).flatMap((jobs) => Object.values(jobs));
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

// The activity mark (operator, 2026-11-18): DownloadPulse's own icon,
// breathing -- the whole logo fades out and back in, one breath every
// FRAMES frames of FRAME_MS (2 s), down to LOWEST opacity.
const FRAMES = 16;
const LOWEST = 0.3;
const logos = new Map<number, Promise<ImageBitmap>>();

function logo(size: number): Promise<ImageBitmap> {
  let bitmap = logos.get(size);
  if (!bitmap) {
    bitmap = fetch(chrome.runtime.getURL(`icons/icon-${size}.png`)).then((r) => r.blob()).then((b) => createImageBitmap(b));
    logos.set(size, bitmap);
  }
  return bitmap;
}

/** The logo's opacity at ``frame``: 1 at the start of a breath, LOWEST halfway. */
export function breath(frame: number): number {
  return LOWEST + (1 - LOWEST) * (0.5 + 0.5 * Math.cos(2 * Math.PI * (frame % FRAMES) / FRAMES));
}

/** One frame of the breath at ``size`` px: the themed mark, else the static icon. */
export async function activityFrame(frame: number, size: number): Promise<ImageData> {
  const themed = await themedIcon(size, breath(frame));
  if (themed) return themed;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d")!;
  context.globalAlpha = breath(frame);
  context.drawImage(await logo(size), 0, 0, size, size);
  return context.getImageData(0, 0, size, size);
}

async function drawRing(frame: number): Promise<void> {
  await chrome.action.setIcon({imageData: {16: await activityFrame(frame, 16), 32: await activityFrame(frame, 32)}});
}

async function restoreIcon(): Promise<void> {
  await restIcon();
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

async function notify(server: string, job: Job, kind: string): Promise<void> {
  // Only the notifications the person keeps on (WS-E4).
  if (!(await settings()).notify[kind as "completed" | "failed" | "attention"]) return;
  const seen = stateKey(server, "jobsNotified");
  const notified = ((await chrome.storage.session.get(seen))[seen] as string[] | undefined) ?? [];
  const id = `dp:${job.id}:${kind}`;
  if (notified.includes(id)) return;
  await chrome.storage.session.set({[seen]: [...notified, id].slice(-300)});
  const key = kind === "completed" ? "notifyCompleted" : kind === "failed" ? "notifyFailed" : "notifyAttention";
  await chrome.notifications.create(id, {type: "basic", iconUrl: "icons/icon-128.png", title: message("extName"),
    message: message(key, [jobName(job)])});
}

/** Every saved connection that may be used is looked at; whether any could be. */
async function poll(): Promise<boolean> {
  const servers = Object.keys(await connections());
  const results = await Promise.all(servers.map(pollServer));
  return results.some(Boolean);
}

async function pollServer(server: string): Promise<boolean> {
  const browserToken = await token(server);
  if (!browserToken) return false;
  const jobs = await cachedJobs(server);
  const CURSOR = stateKey(server, "jobsCursor"), REACH = stateKey(server, "reach"), JOBS = stateKey(server, "jobs");
  let cursor = Number((await chrome.storage.session.get(CURSOR))[CURSOR] ?? 0);
  try {
    for (let page = 0; page < 10; page++) {
      const listing = await listJobs(server, browserToken, cursor);
      for (const job of listing.jobs) {
        const kind = notice(job, jobs[job.id]);
        // A job first seen already settled (an earlier session's) is listed quietly.
        if (kind && (jobs[job.id] || unsettled(job) || cursor > 0)) await notify(server, job, kind);
        // Settled (finished, failed, or removed in DownloadPulse itself): sending it again is a
        // new request, never a replay of this job (review, 2026-11-19).
        if (!unsettled(job) && (!jobs[job.id] || unsettled(jobs[job.id]!))) await forgetSentKey(job.id);
        jobs[job.id] = job;
      }
      cursor = listing.next_cursor;
      if (!listing.more) break;
    }
  } catch (error) {
    if (error instanceof ServerError && error.failure === "unauthorized") {
      // Disconnected in DownloadPulse (Connected browsers): forget that one here, and say so.
      await forgetConnection(true, server);
      return false;
    }
    await chrome.storage.session.set({[REACH]: {ok: false, at: Date.now()}});
    return true;   // unreachable for now: try again next time
  }
  const kept = Object.values(jobs).sort((a, b) => b.cursor - a.cursor).slice(0, KEEP);
  await chrome.storage.session.set({[JOBS]: Object.fromEntries(kept.map((job) => [job.id, job])), [CURSOR]: cursor,
    [REACH]: {ok: true, at: Date.now()}});
  return true;
}

async function loop(): Promise<void> {
  let frame = 0;
  let polledAt = 0;
  let ringing = false;
  let alarmed: boolean | null = null;
  try {
    for (;;) {
      if (Date.now() - polledAt >= POLL_MS) {
        polledAt = Date.now();
        if (!(await poll())) {
          // No connection left to follow: no wake-up stays scheduled (review, 2026-11-19).
          await chrome.alarms.clear(ALARM);
          break;
        }
      }
      const jobs = await everyJob();
      const anyUnsettled = jobs.some(unsettled);
      // The wake-up alarm is set or cleared when that changes, not on every pass (review, 2026-11-19).
      if (anyUnsettled !== alarmed) {
        alarmed = anyUnsettled;
        if (anyUnsettled) await chrome.alarms.create(ALARM, {periodInMinutes: 1});
        else await chrome.alarms.clear(ALARM);
      }
      if (!anyUnsettled && Date.now() - popupSeenAt > POPUP_GRACE_MS) break;
      if (jobs.some(active)) {
        ringing = true;
        await drawRing(frame++);
      } else if (ringing) {
        ringing = false;
        await restoreIcon();
      }
      // Frames only while the icon breathes; otherwise (only paused jobs, or the popup open
      // with nothing active) the loop wakes at the polling pace, not every frame.
      await new Promise((resolve) => setTimeout(resolve, ringing ? FRAME_MS : Math.max(FRAME_MS, POLL_MS - (Date.now() - polledAt))));
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
