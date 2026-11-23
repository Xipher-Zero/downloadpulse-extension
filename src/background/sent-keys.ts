// SPDX-License-Identifier: GPL-2.0-or-later
// The idempotency keys of this browser's sends (B7): a repeat of the same send
// within 10 minutes reuses its key, so DownloadPulse never queues it twice.
// Kept for the browser session only, by a digest (never the link itself, never
// a cookie). A key is forgotten when its download is removed here, or settles
// (the monitor sees it end, fail or be removed in DownloadPulse): sending it
// again is then a new request, never a replay of the old one (review, 2026-11-19).

import type {Cookie, Source} from "../shared/server";

/** How long a repeat of the same send reuses its idempotency key. */
const KEY_WINDOW_MS = 10 * 60_000;
const KEYS = "sendKeys";

interface SentKey { key: string; at: number; job?: string }

async function digestOf(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The idempotency key for ``source`` to ``server``: the one a repeat of the same send in the
 * last 10 minutes used, else a fresh one. The digest covers the server, the source and the
 * sign-in sent with it: a send after signing in to the site is a new request, never the old
 * one replayed without it (DownloadPulse answers a known key with its job, whatever else
 * the request carries).
 */
export async function keyFor(server: string, source: Source, cookies: Cookie[] = []):
    Promise<{digest: string; key: string; job?: string}> {
  const signIn = cookies.length
    ? await digestOf(JSON.stringify(cookies.map((c) => [c.domain, c.path, c.name, c.value]).sort()))
    : "";
  const digest = await digestOf(server + "\n" + JSON.stringify(source) + "\n" + signIn);
  const kept = ((await chrome.storage.session.get(KEYS))[KEYS] ?? {}) as Record<string, SentKey>;
  const now = Date.now();
  for (const [name, entry] of Object.entries(kept)) if (now - entry.at > KEY_WINDOW_MS) delete kept[name];
  const entry = kept[digest] ?? {key: crypto.randomUUID(), at: now};
  kept[digest] = entry;
  await chrome.storage.session.set({[KEYS]: kept});
  return {digest, key: entry.key, ...(entry.job ? {job: entry.job} : {})};
}

/** Sending ``digest`` again is a new request (its job paused elsewhere: operator, 2026-11-22). */
export async function forgetDigest(digest: string): Promise<void> {
  const kept = ((await chrome.storage.session.get(KEYS))[KEYS] ?? {}) as Record<string, SentKey>;
  if (!kept[digest]) return;
  delete kept[digest];
  await chrome.storage.session.set({[KEYS]: kept});
}

export async function keyAnswered(digest: string, job: string): Promise<void> {
  const kept = ((await chrome.storage.session.get(KEYS))[KEYS] ?? {}) as Record<string, SentKey>;
  if (kept[digest]) await chrome.storage.session.set({[KEYS]: {...kept, [digest]: {...kept[digest], job}}});
}

/** ``job``'s download was removed or has settled: sending it again is a new request. */
export async function forgetSentKey(job: string): Promise<void> {
  const kept = ((await chrome.storage.session.get(KEYS))[KEYS] ?? {}) as Record<string, SentKey>;
  if (!Object.values(kept).some((entry) => entry.job === job)) return;
  const left = Object.fromEntries(Object.entries(kept).filter(([, entry]) => entry.job !== job));
  await chrome.storage.session.set({[KEYS]: left});
}
