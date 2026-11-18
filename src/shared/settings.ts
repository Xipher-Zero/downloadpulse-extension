// SPDX-License-Identifier: GPL-2.0-or-later
// The extension's settings (WS-E4): this browser's own, never DownloadPulse's
// (L22). One reader and writer, in chrome.storage.local. Content scripts
// never read them: the background tells each frame what it may offer.

export interface Settings {
  hover: boolean;                 // the hover icon beside download links
  video: boolean;                 // the video-player button and Firefox's URL-bar icon
  offSites: string[];             // sites (host names) where neither is offered
  notify: {completed: boolean; failed: boolean; attention: boolean};
}

const KEY = "settings";
export const DEFAULTS: Settings = {hover: true, video: true, offSites: [],
  notify: {completed: true, failed: true, attention: true}};

export async function settings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return {...DEFAULTS, ...stored, notify: {...DEFAULTS.notify, ...(stored?.notify ?? {})},
    offSites: Array.isArray(stored?.offSites) ? stored!.offSites.filter((site) => typeof site === "string") : []};
}

export async function saveSettings(change: Partial<Settings>): Promise<Settings> {
  const next = {...(await settings()), ...change};
  next.offSites = [...new Set(next.offSites.map(siteOf).filter(Boolean))].sort();
  await chrome.storage.local.set({[KEY]: next});
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
