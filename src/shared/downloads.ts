// SPDX-License-Identifier: GPL-2.0-or-later
// Which browser downloads go to DownloadPulse (1.0.2; background/capture.ts acts on it):
// pure rules over a download's facts and the person's settings.

import {captureKind} from "./classify";
import type {Settings} from "./settings";

const MB = 1024 * 1024;
/** File types DownloadPulse takes as contents when sent by hand: their downloads stay with the browser. */
const CONTENTS = new Set(["torrent", "nzb", "meta4", "metalink"]);

export type Decision = "capture" | "off" | "scheme" | "extension" | "contents" | "small" | "type" | "finished";

/** The part of a browser download the decision reads (chrome.downloads.DownloadItem). */
export interface DownloadFacts {
  url: string;
  finalUrl?: string | undefined;
  filename?: string | undefined;
  totalBytes?: number | undefined;
  fileSize?: number | undefined;
  byExtensionId?: string | undefined;
  incognito?: boolean | undefined;
  state?: string | undefined;
}

/** The file's type: its name's extension, else its address's last path segment's. */
export function fileType(item: DownloadFacts): string {
  const named = String(item.filename ?? "").split(/[\\/]/).pop() ?? "";
  let last = named;
  if (!last) {
    try {
      last = decodeURIComponent(new URL(item.finalUrl || item.url).pathname.split("/").pop() ?? "");
    } catch {
      last = "";
    }
  }
  const match = /\.([A-Za-z0-9+_-]{1,16})$/.exec(last);
  return match ? match[1]!.toLowerCase() : "";
}

/** Whether a browser download goes to DownloadPulse, or why it stays with the browser. */
export function decide(item: DownloadFacts, chosen: Pick<Settings, "capture" | "captureMinMB" | "captureSkipTypes">):
    Decision {
  if (!chosen.capture) return "off";
  if (item.state && item.state !== "in_progress") return "finished";
  if (item.incognito) return "off";
  // Another extension's download (or this one's own): its own business.
  if (item.byExtensionId) return "extension";
  const href = item.finalUrl || item.url;
  if (!/^https?:\/\//i.test(href)) return "scheme";
  const type = fileType(item);
  if (CONTENTS.has(type) || captureKind(href)) return "contents";
  // A size the browser does not know yet (0) may be a small file's: it stays, as one under the
  // minimum does (operator, 2026-11-24). Only a minimum of 0 (every size) takes it.
  const size = Math.max(Number(item.totalBytes ?? 0), Number(item.fileSize ?? 0));
  if (chosen.captureMinMB > 0 && size < chosen.captureMinMB * MB) return "small";
  if (type && chosen.captureSkipTypes.includes(type)) return "type";
  return "capture";
}

/** What holding a browser download needs of the browser's downloads API (chrome.downloads). */
type DownloadsApi = Partial<Pick<typeof chrome.downloads, "onCreated" | "pause" | "resume" | "search" | "cancel" | "erase">>;

/**
 * Whether this browser's downloads API can hold a download: all of it, or none of it is used
 * (Firefox for Android has no downloads list an extension can pause). Feature detection only;
 * the API is there only while the optional "downloads" permission is granted.
 */
export function downloadsUsable(api: DownloadsApi | undefined): boolean {
  return Boolean(api?.onCreated && api.pause && api.resume && api.search && api.cancel && api.erase);
}
