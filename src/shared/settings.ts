// SPDX-License-Identifier: GPL-2.0-or-later
// The extension's settings (WS-E4): this browser's own, never DownloadPulse's
// (L22). One reader and writer, in chrome.storage.local. Content scripts
// never read them: the background tells each frame what it may offer.

export interface Settings {
  inPage: boolean;                // the in-page buttons at all (their master switch; off, none is offered)
  hover: boolean;                 // the hover icon beside download links
  video: boolean;                 // the video-player button and Firefox's URL-bar icon
  videoCookies: boolean;          // a video goes with the person's sign-in on its site (its cookies); on unless switched off
  offSites: string[];             // sites (host names) where neither is offered
  notify: {completed: boolean; failed: boolean; attention: boolean};
  // Browser downloads sent to DownloadPulse instead of the browser (1.0.2, operator 2026-11-22):
  // off until the person turns it on (it needs the optional "downloads" permission).
  capture: boolean;
  captureMinMB: number;           // a download known to be smaller than this stays in the browser (0: none)
  captureSkipTypes: string[];     // file extensions (lower case, no dot) that always stay in the browser
  captureAsked: boolean;          // the setup offer was answered once (either way): never offered again
}

const KEY = "settings";
export const DEFAULTS: Settings = {inPage: true, hover: true, video: true, videoCookies: true, offSites: [],
  notify: {completed: true, failed: true, attention: true},
  capture: false, captureMinMB: 10, captureSkipTypes: [], captureAsked: false};

/** A typed list of file types: "pdf, .JPG  zip" -> ["jpg", "pdf", "zip"]. */
export function fileTypes(value: string | string[]): string[] {
  const items = Array.isArray(value) ? value : value.split(/[\s,;]+/);
  return [...new Set(items.map((item) => String(item).trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => /^[a-z0-9][a-z0-9+_-]{0,15}$/.test(item)))].sort();
}

/** A size limit in whole megabytes, 0 to 100 000. */
export function megabytes(value: unknown): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(100_000, Math.max(0, number)) : DEFAULTS.captureMinMB;
}

export async function settings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return {...DEFAULTS, ...stored, notify: {...DEFAULTS.notify, ...(stored?.notify ?? {})},
    offSites: Array.isArray(stored?.offSites) ? stored!.offSites.filter((site) => typeof site === "string") : [],
    captureMinMB: megabytes(stored?.captureMinMB ?? DEFAULTS.captureMinMB),
    captureSkipTypes: fileTypes(Array.isArray(stored?.captureSkipTypes) ? stored!.captureSkipTypes : [])};
}

let saving: Promise<unknown> = Promise.resolve();

/** One change, applied to what is stored now. ``change`` may be a function of the stored
 * settings (a change to a list or to notify). Changes from this page apply one after
 * another, so two quick switches never write over each other. */
export function saveSettings(change: Partial<Settings> | ((current: Settings) => Partial<Settings>)): Promise<Settings> {
  const next = saving.then(async () => {
    const current = await settings();
    const merged = {...current, ...(typeof change === "function" ? change(current) : change)};
    merged.offSites = [...new Set(merged.offSites.map(siteOf).filter(Boolean))].sort();
    merged.captureMinMB = megabytes(merged.captureMinMB);
    merged.captureSkipTypes = fileTypes(merged.captureSkipTypes);
    await chrome.storage.local.set({[KEY]: merged});
    return merged;
  });
  saving = next.catch(() => undefined);
  return next;
}

/** A site as the person names it, or as a page's address gives it: its host name, without "www.". */
export function siteOf(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text) return "";
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Whether a page's address is on one of the sites switched off (that site or a subdomain of it). */
export function isOffSite(address: string, offSites: string[]): boolean {
  const host = siteOf(address);
  return Boolean(host) && offSites.some((site) => host === site || host.endsWith(`.${site}`));
}
