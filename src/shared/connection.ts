// SPDX-License-Identifier: GPL-2.0-or-later
// The stored connection and the pending pairing: their one reader and
// writer. What is shown (server, names, the pairing's state) is in
// chrome.storage for the popup; the token and the device code are secrets
// and live only in the extension origin's IndexedDB (src/shared/secrets.ts,
// WS-E2 B10).

import type {Failure} from "./server";
import {secret, setSecret} from "./secrets";

export interface Connection {
  server: string;
  tokenId: string;
  label: string;
  account: string;
}

export type Pairing =
  | {state: "probing"}
  | {state: "not_found"}
  | {state: "found"; server: string}
  | {state: "waiting"; server: string; userCode: string; expiresAt: number}
  | {state: "failed"; failure: Failure};

const CONNECTION = "connection";
const PAIRING = "pairing";

/** The connection as shown; a token stored in chrome.storage by WS-E1 is moved out once. */
export async function connection(): Promise<Connection | null> {
  const value = (await chrome.storage.local.get(CONNECTION))[CONNECTION] as (Connection & {token?: string}) | undefined;
  if (!value?.server) return null;
  if (value.token) {
    await setSecret("token", value.token);
    const {token: _moved, ...shown} = value;
    await chrome.storage.local.set({[CONNECTION]: shown});
    return shown;
  }
  return value;
}

/** The browser token: background only (content scripts never ask for it). */
export async function token(): Promise<string | null> {
  return (await connection()) ? await secret("token") : null;
}

export async function saveConnection(value: Connection, browserToken: string): Promise<void> {
  await setSecret("token", browserToken);
  await chrome.storage.local.set({[CONNECTION]: value});
}

export async function pairing(): Promise<Pairing | null> {
  return ((await chrome.storage.session.get(PAIRING))[PAIRING] as Pairing | undefined) ?? null;
}

export async function setPairing(value: Pairing | null, deviceCode?: string): Promise<void> {
  if (value === null) {
    await chrome.storage.session.remove(PAIRING);
    await setSecret("device", null);
    return;
  }
  if (deviceCode !== undefined) await setSecret("device", deviceCode);
  await chrome.storage.session.set({[PAIRING]: value});
}

export async function deviceCode(): Promise<string | null> {
  return secret("device");
}

/**
 * Forget the connection here: the token, what is shown, and this browser's
 * cached downloads. ``revoked``: DownloadPulse no longer accepts the token
 * (disconnected there), which the popup then says.
 */
export async function forgetConnection(revoked = false): Promise<void> {
  await setSecret("token", null);
  await chrome.storage.local.remove([CONNECTION, "appearance"]);
  await chrome.storage.session.remove(["jobs", "jobsCursor", "jobsNotified", "focusJob", "reach"]);
  if (revoked) await chrome.storage.session.set({[PAIRING]: {state: "failed", failure: "unauthorized"} satisfies Pairing});
}
