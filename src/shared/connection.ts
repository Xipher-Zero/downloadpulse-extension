// SPDX-License-Identifier: GPL-2.0-or-later
// The stored connections and the pending pairing: their one reader and
// writer. Connections are kept by server (multi-server preparation,
// 2026-11-19): a map of server origin to its connection, and which one is in
// use. The extension uses one at a time; nothing here assumes there is only one. What is shown (server, names, the pairing's state) is in
// chrome.storage for the popup; the token and the device code are secrets
// and live only in the extension origin's IndexedDB (src/shared/secrets.ts,
// WS-E2 B10).

import {consent} from "./consent";
import {effectiveAddress, type Failure} from "./server";
import {secret, setSecret} from "./secrets";
import {SERVER_STATE, stateKey} from "./server-state";

export interface Connection {
  server: string;
  tokenId: string;
  label: string;
  account: string;
  /** Plain HTTP to a server on the private network, chosen by the person on the warning screen. */
  plainHttp?: boolean;
}

/**
 * Whether a saved connection may be used now (store review, 2026-11-18): the
 * disclosure agreed to (at its current version), and the server reached as the
 * transport rules allow -- a connection saved before them, or by an older
 * build, is held until it meets them.
 *   ok          usable;
 *   consent     the disclosure must be agreed to first;
 *   plain-http  a private-network server over plain HTTP, not yet chosen on the warning;
 *   insecure    plain HTTP across the internet: never usable.
 */
export type ConnectionState = "ok" | "consent" | "plain-http" | "insecure";

export async function connectionState(value: Connection): Promise<ConnectionState> {
  const address = await effectiveAddress(value.server);
  if (!address || address.transport === "public-http") return "insecure";
  if (!(await consent())) return "consent";
  if (address.transport === "lan-http" && !value.plainHttp) return "plain-http";
  return "ok";
}

/** The person chose plain HTTP for a saved private-network connection (the warning screen). */
export async function choosePlainHttp(server?: string): Promise<void> {
  const value = await connection(server);
  if (!value) return;
  const all = await connections();
  await chrome.storage.local.set({[CONNECTIONS]: {...all, [value.server]: {...value, plainHttp: true}}});
}

export type Pairing =
  | {state: "probing"}
  | {state: "not_found"}
  | {state: "found"; server: string}
  | {state: "waiting"; server: string; userCode: string; expiresAt: number}
  | {state: "failed"; failure: Failure};

/** An earlier build's single connection (and, from WS-E1, its token in chrome.storage): read once, then moved. */
const LEGACY_CONNECTION = "connection";
const CONNECTIONS = "connections";
const ACTIVE = "activeServer";
const PAIRING = "pairing";

/** Where a server's browser token is kept (IndexedDB, secrets.ts). */
const tokenSlot = (server: string): `token@${string}` => `token@${server}`;

/** Every saved connection, by server origin; an earlier build's single one is moved in on first read. */
export async function connections(): Promise<Record<string, Connection>> {
  const stored = await chrome.storage.local.get([CONNECTIONS, LEGACY_CONNECTION]);
  const all = {...((stored[CONNECTIONS] as Record<string, Connection> | undefined) ?? {})};
  const legacy = stored[LEGACY_CONNECTION] as (Connection & {token?: string}) | undefined;
  if (legacy?.server) {
    const {token: inStorage, ...shown} = legacy;
    // The token: WS-E1 kept it in chrome.storage; later builds in IndexedDB's single slot.
    const moved = inStorage || (await secret("token"));
    if (moved) await setSecret(tokenSlot(shown.server), moved);
    await setSecret("token", null);
    all[shown.server] = shown;
    await chrome.storage.local.set({[CONNECTIONS]: all, [ACTIVE]: shown.server});
    await chrome.storage.local.remove(LEGACY_CONNECTION);
    // That build's session state was not kept by server: it is fetched again.
    await chrome.storage.session.remove(["jobs", "jobsCursor", "jobsNotified", "reach", "jobsCleared"]);
  }
  return all;
}

/** The server in use, if any. */
export async function activeServer(): Promise<string | null> {
  const all = await connections();
  const chosen = (await chrome.storage.local.get(ACTIVE))[ACTIVE] as string | undefined;
  if (chosen && all[chosen]) return chosen;
  return Object.keys(all)[0] ?? null;
}

/** A saved connection: ``server``'s, else the one in use. */
export async function connection(server?: string): Promise<Connection | null> {
  const all = await connections();
  const chosen = server ?? (await activeServer());
  return (chosen && all[chosen]) || null;
}

/**
 * A server's browser token: background only (content scripts never ask for it), and only while
 * that connection may be used (connectionState): every request that carries it goes through here.
 * ``server``: that one's, else the one in use.
 */
export async function token(server?: string): Promise<string | null> {
  const value = await connection(server);
  if (!value || (await connectionState(value)) !== "ok") return null;
  return secret(tokenSlot(value.server));
}

/** A new or renewed connection to ``value.server``, which becomes the one in use. */
export async function saveConnection(value: Connection, browserToken: string): Promise<void> {
  await setSecret(tokenSlot(value.server), browserToken);
  const all = await connections();
  await chrome.storage.local.set({[CONNECTIONS]: {...all, [value.server]: value}, [ACTIVE]: value.server});
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
 * Forget one connection here -- ``server``'s, else the one in use -- and only it: its token,
 * what is shown, and its cached downloads. Another server's connection and state are kept;
 * if the one in use is forgotten, another (if any) is used. ``revoked``: DownloadPulse no
 * longer accepts the token (disconnected there), which the popup then says.
 */
export async function forgetConnection(revoked = false, server?: string): Promise<void> {
  const target = server ?? (await activeServer());
  if (!target) return;
  const wasActive = target === (await activeServer());
  await setSecret(tokenSlot(target), null);
  const {[target]: _forgotten, ...rest} = await connections();
  const next = Object.keys(rest)[0];
  // The connections and the server in use change in one write: no reader ever sees a
  // server in use whose connection is already gone.
  await chrome.storage.local.set({[CONNECTIONS]: rest, ...(wasActive && next ? {[ACTIVE]: next} : {})});
  if (wasActive) {
    await chrome.storage.local.remove(["appearance", ...(next ? [] : [ACTIVE])]);
    await chrome.storage.session.remove("focusJob");
  }
  await chrome.storage.session.remove(SERVER_STATE.map((name) => stateKey(target, name)));
  if (revoked && wasActive) await chrome.storage.session.set({[PAIRING]: {state: "failed", failure: "unauthorized"} satisfies Pairing});
}
