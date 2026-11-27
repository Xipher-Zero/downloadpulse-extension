// SPDX-License-Identifier: GPL-2.0-or-later
// The server's identity (1.0.8, WS-A4): whatever listens at a connection's address -- another
// program on 127.0.0.1:8095 while DownloadPulse is stopped, on a shared computer -- would
// otherwise be handed the browser token and, for a video or a captured download, the person's
// sign-in on that site. A DownloadPulse that says so (its session's ``capabilities.identity``)
// proves it issued the token, without the token being sent: it answers a fresh nonce with
// HMAC-SHA256 keyed by the token's SHA-256 (the digest it keeps of it) over the context, the
// nonce and the address as this extension knows it (DownloadPulse BROWSER_CLIENT.md, 2c).
//
// Here: that computation, and which server said it proves itself, for which token. That is kept
// with the token, in the extension origin's IndexedDB (secrets.ts), never in chrome.storage,
// which a content script could change: a server once seen to prove itself is never again sent
// that token unproven. The check itself is the server client's (server.ts, ``proveIdentity``).

import {secret, setSecret} from "./secrets";

export const IDENTITY_CONTEXT = "downloadpulse.browser/identity/1";

const slot = (server: string): `identity@${string}` => `identity@${server}`;
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digestOf(browserToken: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(browserToken));
}

/** The proof a DownloadPulse holding ``browserToken``'s digest answers ``nonce`` with, for ``origin``. */
export async function identityProof(browserToken: string, nonce: string, origin: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", await digestOf(browserToken), {name: "HMAC", hash: "SHA-256"},
    false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${IDENTITY_CONTEXT}\n${nonce}\n${origin}`)));
}

/** 128 random bits, base64url: one check's nonce, never used twice. */
export function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Kept { digest: string; tokenId: string }

// Outside an extension (the unit tests' Node) there is no IndexedDB: nothing is known or kept.
const storage = (): boolean => typeof indexedDB !== "undefined";

/**
 * ``server`` proves its identity for ``browserToken``: the token's ID to ask with, and the
 * token's digest (which names it, for the proof kept in memory). Null: it never said it does.
 */
export async function knownIdentity(server: string, browserToken: string): Promise<Kept | null> {
  if (!storage()) return null;
  const kept = await keptFor(server);
  const digest = hex(await digestOf(browserToken));
  return kept?.digest === digest ? kept : null;
}

async function keptFor(server: string): Promise<Kept | null> {
  const raw = await secret(slot(server));
  try {
    const kept = (raw ? JSON.parse(raw) : null) as Partial<Kept> | null;
    return typeof kept?.digest === "string" && typeof kept.tokenId === "string" && kept.tokenId
      ? {digest: kept.digest, tokenId: kept.tokenId} : null;
  } catch {
    return null;
  }
}

/**
 * What ``server``'s session answer for ``browserToken`` said: it proves its identity (with the
 * token's ID, ``tokenId``), or not (null). Once said for a token it stays said for that token --
 * only that server, proven, could have answered since -- and a new token (a new pairing) starts
 * again from what its own server says.
 */
export async function rememberIdentity(server: string, browserToken: string, tokenId: string | null): Promise<void> {
  if (!storage()) return;
  const digest = hex(await digestOf(browserToken));
  if (tokenId) {
    const value = JSON.stringify({digest, tokenId} satisfies Kept);
    if ((await secret(slot(server))) !== value) await setSecret(slot(server), value);
    return;
  }
  const kept = await keptFor(server);
  if (kept && kept.digest !== digest) await setSecret(slot(server), null);
}
