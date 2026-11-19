// SPDX-License-Identifier: GPL-2.0-or-later
// The person's sign-in on a video's site, for DownloadPulse's video downloader
// (operator, 2026-11-19: sent with videos by default, switched off in the
// settings). Exactly the cookies this browser would send to the video's own
// address -- the player's, for an embedded one -- from the tab's own cookie
// store (a Firefox container's), including the embed's partitioned cookies
// under that page's site. Never another site's, never for anything but a
// video send, never stored here: they go with that one submission.

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

export async function cookiesFor(url: string, tab: chrome.tabs.Tab | undefined): Promise<Cookie[]> {
  if (!/^https?:\/\//i.test(url)) return [];
  const store: Store = {};
  const container = (tab as (chrome.tabs.Tab & {cookieStoreId?: string}) | undefined)?.cookieStoreId;
  if (container) store.storeId = container;
  const pageHost = site(tab?.url);
  // Unpartitioned, as for a page of that site; and, for an embed, the ones partitioned under this page.
  const found = [...await all({url, ...store}),
    ...(pageHost && pageHost !== site(url) ? (await all({url, ...store, partitionKey: {}})).filter((c) => underPage(c, pageHost)) : [])];
  const seen = new Set<string>();
  const cookies: Cookie[] = [];
  for (const cookie of found) {
    const id = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    cookies.push({name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, secure: cookie.secure,
      http_only: cookie.httpOnly, host_only: cookie.hostOnly,
      expires: cookie.session || cookie.expirationDate === undefined ? null : Math.floor(cookie.expirationDate)});
  }
  const bytes = cookies.reduce((total, c) => total + c.name.length + c.value.length + c.domain.length + c.path.length, 0);
  return cookies.length > MAX_COOKIES || bytes > MAX_BYTES ? [] : cookies;
}
