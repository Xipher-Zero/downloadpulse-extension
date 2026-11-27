// SPDX-License-Identifier: GPL-2.0-or-later
// The person's sign-in on a video's site, for DownloadPulse's video downloader
// (operator, 2026-11-19: sent with videos by default, switched off in the
// settings). Exactly the cookies this browser would send to the video's own
// address -- the player's, for an embedded one -- from the tab's own cookie
// store (a Firefox container's), including the embed's partitioned cookies
// under that page's site. Never another site's, never for anything but a
// video send, never stored here: they go with that one submission.
//
// A browser download a page of another site started (1.0.8, WS-A5): the browser itself sends no
// SameSite=Strict cookie on that cross-site navigation, so none goes with it here either; Lax and
// None ones go, as the browser's own request would carry them. Started on the file's own site (or
// with no page known), unchanged.

import type {Cookie} from "../shared/server";

/** At most this many cookies, and this many bytes of them; past either, none are sent. */
const MAX_COOKIES = 300;
const MAX_BYTES = 64 * 1024;

type Store = {storeId?: string};

function site(address: string | undefined): string {
  try {
    return new URL(address ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A partition key's top-level site belongs to the tab's page (same host, or the page a subdomain of it). */
function underPage(cookie: chrome.cookies.Cookie, pageHost: string): boolean {
  const key = (cookie as chrome.cookies.Cookie & {partitionKey?: {topLevelSite?: string}}).partitionKey;
  if (!key) return true;
  const top = site(key.topLevelSite);
  return Boolean(top) && (pageHost === top || pageHost.endsWith(`.${top}`));
}

async function all(query: chrome.cookies.GetAllDetails & Store & {partitionKey?: object}): Promise<chrome.cookies.Cookie[]> {
  try {
    return await chrome.cookies.getAll(query);
  } catch {
    return [];   // an older browser without partition support, or first-party isolation on: none from that query
  }
}

/** Two-letter country domains whose second level is a registry's own (example.co.uk, example.com.au). */
const SECOND_LEVEL = /^(ac|co|com|edu|gob|go|gov|govt|ltd|mil|ne|net|nic|or|org|plc|sch)$/;

/**
 * The registrable domain ("site") of a host, without a public suffix list: the last two labels,
 * or three under a country's own second level (example.co.uk). An IP address or a single label
 * is its own site. Approximate: hosts under a private suffix (a.github.io, b.github.io) count
 * as one site, so their Strict cookies go as they did before 1.0.8; a public list would be the
 * exact answer, and no browser gives an extension one.
 */
export function registrable(host: string): string {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name.startsWith("[") || /^\d+(\.\d+){3}$/.test(name)) return name;
  const labels = name.split(".");
  if (labels.length <= 2) return name;
  const take = labels.at(-1)!.length === 2 && SECOND_LEVEL.test(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * Whether ``initiator`` (a download's referrer) is another site than ``url`` -- schemeful, as
 * the browser judges SameSite: http and https of one domain are two sites. No page known (a
 * typed address, a referrer the page withheld): not cross-site, as the browser's own request.
 */
export function crossSite(url: string, initiator: string | undefined): boolean {
  if (!initiator || !/^https?:\/\//i.test(initiator)) return false;
  try {
    const target = new URL(url), from = new URL(initiator);
    return target.protocol !== from.protocol || registrable(target.hostname) !== registrable(from.hostname);
  } catch {
    return false;
  }
}

/**
 * ``dropped``: there were cookies, but past a bound, so none are sent (and the person is told).
 * ``initiator``: the page a browser download was started from; cross-site to ``url``, no
 * SameSite=Strict cookie is taken (the browser would not send one either), and it is not
 * counted as dropped.
 */
export async function cookiesFor(url: string, tab: chrome.tabs.Tab | undefined, initiator?: string):
    Promise<{cookies: Cookie[]; dropped: boolean}> {
  if (!/^https?:\/\//i.test(url)) return {cookies: [], dropped: false};
  const store: Store = {};
  const container = (tab as (chrome.tabs.Tab & {cookieStoreId?: string}) | undefined)?.cookieStoreId;
  if (container) store.storeId = container;
  const pageHost = site(tab?.url);
  // Unpartitioned, as for a page of that site; and, for an embed, the ones partitioned under this page.
  const found = [...await all({url, ...store}),
    ...(pageHost && pageHost !== site(url) ? (await all({url, ...store, partitionKey: {}})).filter((c) => underPage(c, pageHost)) : [])];
  const strictGoes = !crossSite(url, initiator);
  const seen = new Set<string>();
  const cookies: Cookie[] = [];
  for (const cookie of found) {
    if (!strictGoes && cookie.sameSite === "strict") continue;
    const id = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    cookies.push({name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, secure: cookie.secure,
      http_only: cookie.httpOnly, host_only: cookie.hostOnly,
      expires: cookie.session || cookie.expirationDate === undefined ? null : Math.floor(cookie.expirationDate)});
  }
  const bytes = cookies.reduce((total, c) => total + c.name.length + c.value.length + c.domain.length + c.path.length, 0);
  return cookies.length > MAX_COOKIES || bytes > MAX_BYTES ? {cookies: [], dropped: true} : {cookies, dropped: false};
}
