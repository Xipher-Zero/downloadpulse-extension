// SPDX-License-Identifier: GPL-2.0-or-later
// The stored connection and the pending pairing (WS-E1 B8): their one reader
// and writer. The token lives in storage.local only; a pending pairing (and
// its device code) in storage.session only, gone when the browser closes.

import type {Failure} from "./server";

export interface Connection {
  server: string;
  token: string;
  tokenId: string;
  label: string;
  account: string;
}

export type Pairing =
  | {state: "probing"}
  | {state: "not_found"}
  | {state: "waiting"; server: string; userCode: string; expiresAt: number}
  | {state: "failed"; failure: Failure};

const CONNECTION = "connection";
const PAIRING = "pairing";
const DEVICE = "pairingDevice";

export async function connection(): Promise<Connection | null> {
  const value = (await chrome.storage.local.get(CONNECTION))[CONNECTION] as Connection | undefined;
  return value && value.server && value.token ? value : null;
}

export async function saveConnection(value: Connection): Promise<void> {
  await chrome.storage.local.set({[CONNECTION]: value});
}

export async function pairing(): Promise<Pairing | null> {
  return ((await chrome.storage.session.get(PAIRING))[PAIRING] as Pairing | undefined) ?? null;
}

export async function setPairing(value: Pairing | null, deviceCode?: string): Promise<void> {
  if (value === null) {
    await chrome.storage.session.remove([PAIRING, DEVICE]);
    return;
  }
  const items: Record<string, unknown> = {[PAIRING]: value};
  if (deviceCode !== undefined) items[DEVICE] = deviceCode;
  await chrome.storage.session.set(items);
}

export async function deviceCode(): Promise<string | null> {
  return ((await chrome.storage.session.get(DEVICE))[DEVICE] as string | undefined) ?? null;
}
