// SPDX-License-Identifier: GPL-2.0-or-later
// The stored connections and the pending pairing: their one reader and
// writer. Connections are kept by server (multi-server preparation,
// 2026-11-19): a map of server origin to its connection. Up to three (WS-X1,
// 1.0.8), each with a short name, in one display order, one of them the default
// (the storage key "activeServer", as 1.0.7 named the one in use) -- all kept in
// this browser only (servers.ts holds the rules). What is shown (server, names, the pairing's state) is in
// chrome.storage for the popup; the token and the device code are secrets
// and live only in the extension origin's IndexedDB (src/shared/secrets.ts,
// WS-E2 B10).

import {consent} from "./consent";
import {effectiveAddress, readSession, ServerError, type Failure, type Session} from "./server";
import {secret, setSecret} from "./secrets";
import {SERVER_STATE, stateKey} from "./server-state";
import {cleanName, displayNames, displayOrder, MAX_SERVERS, nameFromHost, nameProblem} from "./servers";

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

// Every write of the connections (choosing plain HTTP, saving, forgetting) runs one after
// another in this context, each reading what the one before it wrote: with more than one
// server, two writes never lose one another's change (review, 2026-11-19).
let writing: Promise<unknown> = Promise.resolve();
function serialized<T>(write: () => Promise<T>): Promise<T> {
  const next = writing.then(write);
  writing = next.catch(() => undefined);
  return next;
}

/** The person chose plain HTTP for ``server``'s saved private-network connection (the warning screen). */
export function choosePlainHttp(server: string): Promise<void> {
  return serialized(async () => {
    const value = await connection(server);
    if (!value) return;
    const all = await connections();
    await chrome.storage.local.set({[CONNECTIONS]: {...all, [value.server]: {...value, plainHttp: true}}});
  });
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
/** The default server: every send that names no server goes to it (1.0.7: the one in use). */
const ACTIVE = "activeServer";
const PAIRING = "pairing";
/** The display order (server origins), each server's short name and its page ID (WS-X1): this browser only. */
const ORDER = "serverOrder";
const NAMES = "serverNames";
const IDS = "serverIds";

/** Where a server's browser token is kept (IndexedDB, secrets.ts). */
const tokenSlot = (server: string): `token@${string}` => `token@${server}`;

/** Every saved connection, by server origin; an earlier build's single one is moved in on first read. */
let migrating: Promise<void> | null = null;

export async function connections(): Promise<Record<string, Connection>> {
  // An earlier build's connection is moved in once: concurrent readers share that one move.
  if ((await chrome.storage.local.get(LEGACY_CONNECTION))[LEGACY_CONNECTION]) {
    migrating ??= migrateLegacy().finally(() => { migrating = null; });
    await migrating;
  }
  return {...(((await chrome.storage.local.get(CONNECTIONS))[CONNECTIONS] as Record<string, Connection> | undefined) ?? {})};
}

async function migrateLegacy(): Promise<void> {
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
}

/** The saved servers in display order (a 1.0.7 connection's: the order they were stored in). */
export async function serverOrder(): Promise<string[]> {
  const all = await connections();
  return displayOrder(Object.keys(all), (await chrome.storage.local.get(ORDER))[ORDER] as string[] | undefined);
}

/** The default server, if any: the one chosen (1.0.7's one in use), else the first in display order. */
export async function defaultServer(): Promise<string | null> {
  const all = await connections();
  const chosen = (await chrome.storage.local.get(ACTIVE))[ACTIVE] as string | undefined;
  if (chosen && all[chosen]) return chosen;
  return (await serverOrder())[0] ?? null;
}

/** A saved server as the person's views show it. ``id``: what a page may call it (meaningless outside the extension). */
export interface Server extends Connection { name: string; id: string; isDefault: boolean }

/**
 * Every saved server, in display order, each with its short name and page ID. A server without an
 * ID yet (saved before IDs, or by a write that raced the upgrade) gets one now, kept: an ID is
 * never empty, so a page's list or a menu item always names a server it can be told apart by.
 */
export async function servers(): Promise<Server[]> {
  const found = await readServers();
  if (found.every((item) => item.id)) return found;
  await serialized(async () => {
    const all = await connections();
    const ids = {...(((await chrome.storage.local.get(IDS))[IDS] as Record<string, string> | undefined) ?? {})};
    let added = false;
    for (const server of Object.keys(all)) {
      if (ids[server]) continue;
      ids[server] = newId();
      added = true;
    }
    if (added) await chrome.storage.local.set({[IDS]: ids});
  });
  return readServers();
}

/** ``servers()`` as stored, without writing (also inside a write already under way). */
async function readServers(): Promise<Server[]> {
  const all = await connections();
  const stored = await chrome.storage.local.get([ORDER, NAMES, IDS, ACTIVE]);
  const order = displayOrder(Object.keys(all), stored[ORDER] as string[] | undefined);
  const names = displayNames(order, (stored[NAMES] as Record<string, string> | undefined) ?? {});
  const ids = (stored[IDS] as Record<string, string> | undefined) ?? {};
  const chosen = stored[ACTIVE] as string | undefined;
  const fallback = chosen && all[chosen] ? chosen : order[0];
  return order.map((server) => ({...all[server]!, name: names[server]!, id: ids[server] ?? "", isDefault: server === fallback}));
}

/** The server a page named by its ID, if that ID is one of the saved servers' (never an address). */
export async function serverForId(id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !id) return null;
  return (await servers()).find((server) => server.id === id)?.server ?? null;
}

/** The server that becomes the default when ``server`` (the default) goes: the next in display order, else the first. */
export function successor(order: readonly string[], server: string): string | null {
  const rest = order.filter((item) => item !== server);
  const at = order.indexOf(server);
  return rest[at] ?? rest[0] ?? null;
}

/** A saved connection: ``server``'s. Every caller names its server (WS-X1). */
export async function connection(server: string): Promise<Connection | null> {
  return (await connections())[server] ?? null;
}

/**
 * A server's browser token: background only (content scripts never ask for it), and only while
 * that connection may be used (connectionState): every request that carries it goes through here.
 */
export async function token(server: string): Promise<string | null> {
  const value = await connection(server);
  if (!value || (await connectionState(value)) !== "ok") return null;
  return secret(tokenSlot(value.server));
}

/**
 * The token that revokes ``server``'s connection on Disconnect (EXT-6): also while the connection
 * is held for the disclosure or the plain-HTTP choice -- the person is removing it, and the server
 * should forget this browser too -- but never over plain HTTP across the internet.
 */
export async function revocationToken(server: string): Promise<string | null> {
  const value = await connection(server);
  if (!value || (await connectionState(value)) === "insecure") return null;
  return secret(tokenSlot(value.server));
}

/** The default server is now ``server`` (☆ in the popup). The display order is not changed. */
export function setDefaultServer(server: string): Promise<void> {
  return serialized(async () => {
    if (!(await connections())[server]) return;
    await chrome.storage.local.set({[ACTIVE]: server});
  });
}

/** The display order, as the person arranged it (the default is not changed). */
export function setServerOrder(order: readonly string[]): Promise<void> {
  return serialized(async () => {
    await chrome.storage.local.set({[ORDER]: displayOrder(Object.keys(await connections()), order)});
  });
}

/** ``server`` renamed (this browser only): refused when blank or another server's name. */
export function renameServer(server: string, typed: string): Promise<"blank" | "duplicate" | null> {
  return serialized(async () => {
    const all = await readServers();
    if (!all.some((item) => item.server === server)) return null;
    const problem = nameProblem(typed, all.filter((item) => item.server !== server).map((item) => item.name));
    if (problem) return problem;
    const names = ((await chrome.storage.local.get(NAMES))[NAMES] as Record<string, string> | undefined) ?? {};
    await chrome.storage.local.set({[NAMES]: {...names, [server]: cleanName(typed)}});
    return null;
  });
}

const newId = (): string => crypto.randomUUID();

/**
 * 1.0.7's storage made 1.0.8's (on install or update): each server gets the name its host gives
 * it and a page ID, the stored order becomes the display order, and the server in use stays
 * the default. Nothing visible changes for one server. Safe to repeat.
 */
export function upgradeConnections(): Promise<void> {
  return serialized(async () => {
    const all = await connections();
    const stored = await chrome.storage.local.get([ORDER, NAMES, IDS]);
    const order = displayOrder(Object.keys(all), stored[ORDER] as string[] | undefined);
    const names = displayNames(order, (stored[NAMES] as Record<string, string> | undefined) ?? {});
    const ids = {...((stored[IDS] as Record<string, string> | undefined) ?? {})};
    for (const server of order) ids[server] ||= newId();
    await chrome.storage.local.set({[ORDER]: order, [NAMES]: names,
      [IDS]: Object.fromEntries(order.map((server) => [server, ids[server]!]))});
  });
}

/**
 * ``write`` -- what was read with ``browserToken`` -- only while ``server`` is still connected
 * with that very token, in turn with every connection change: a read that was in flight when
 * this browser disconnected (or reconnected as another identity) never writes the old
 * identity's state back (operator, 2026-11-22). Answers whether it was written.
 */
export function whileConnectedWith(server: string, browserToken: string, write: () => Promise<void>): Promise<boolean> {
  return serialized(async () => {
    if ((await token(server)) !== browserToken) return false;
    await write();
    return true;
  });
}

/** Whether one more server may be connected (a saved one may always be connected again). */
export async function mayConnect(server: string): Promise<boolean> {
  const all = await connections();
  return server in all || Object.keys(all).length < MAX_SERVERS;
}

/**
 * A new or renewed connection to ``value.server``. A new one joins the end of the display order
 * with the name its host gives it, and is the default only if there is none (the first server).
 * A fourth server is refused (``too_many``): nothing is saved.
 */
export function saveConnection(value: Connection, browserToken: string): Promise<void> {
  return serialized(async () => {
    const all = await connections();
    if (!(value.server in all) && Object.keys(all).length >= MAX_SERVERS) throw new ServerError("too_many");
    await setSecret(tokenSlot(value.server), browserToken);
    const stored = await chrome.storage.local.get([ORDER, NAMES, IDS, ACTIVE]);
    const order = displayOrder(Object.keys(all), stored[ORDER] as string[] | undefined);
    const names = displayNames(order, (stored[NAMES] as Record<string, string> | undefined) ?? {});
    const ids = {...((stored[IDS] as Record<string, string> | undefined) ?? {})};
    if (!order.includes(value.server)) {
      order.push(value.server);
      names[value.server] = nameFromHost(value.server, Object.values(names));
    }
    ids[value.server] ||= newId();
    const chosen = stored[ACTIVE] as string | undefined;
    await chrome.storage.local.set({[CONNECTIONS]: {...all, [value.server]: value}, [ORDER]: order, [NAMES]: names,
      [IDS]: ids, ...(chosen && all[chosen] ? {} : {[ACTIVE]: value.server})});
  });
}

/** What a DownloadPulse takes with a link: its session's capabilities. */
export type Capabilities = Pick<Session, "videoCookies" | "referrer">;

/**
 * ``server``'s capabilities as its session last said, kept with its other state for this
 * browser session (server-state.ts) and cleared with the connection. Every read of the session
 * keeps them (pairing, the appearance refresh), so sending -- a browser download held paused
 * while it is sent -- never asks again (1.0.3); they are read here only when none are kept yet
 * (the browser restarted since). Written only while still connected with ``browserToken``, and
 * only when changed (an open popup redraws on every change).
 */
export function keepCapabilities(server: string, browserToken: string, session: Capabilities): Promise<boolean> {
  const value: Capabilities = {videoCookies: session.videoCookies, referrer: session.referrer};
  const key = stateKey(server, "capabilities");
  return whileConnectedWith(server, browserToken, async () => {
    const kept = (await chrome.storage.session.get(key))[key] as Capabilities | undefined;
    if (kept?.videoCookies !== value.videoCookies || kept?.referrer !== value.referrer) {
      await chrome.storage.session.set({[key]: value});
    }
  });
}

/** ``server``'s kept capabilities dropped (a send carrying them was refused): read again when next needed. */
export function forgetCapabilities(server: string, browserToken: string): Promise<boolean> {
  return whileConnectedWith(server, browserToken, () => chrome.storage.session.remove(stateKey(server, "capabilities")));
}

export async function capabilities(server: string, browserToken: string): Promise<Capabilities> {
  const key = stateKey(server, "capabilities");
  const kept = (await chrome.storage.session.get(key))[key] as Capabilities | undefined;
  if (kept) return kept;
  const session = await readSession(server, browserToken);
  await keepCapabilities(server, browserToken, session);
  return {videoCookies: session.videoCookies, referrer: session.referrer};
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
 * Forget ``server``'s connection here, and only it: its token, what is shown, its name and
 * place, and its cached downloads. Another server's connection and state are kept; if the
 * default is forgotten, the next in display order becomes the default. ``revoked``:
 * DownloadPulse no longer accepts the token (disconnected there), which the popup then says
 * when no server is left.
 */
export function forgetConnection(revoked: boolean, server: string): Promise<void> {
  return serialized(() => forget(revoked, server));
}

async function forget(revoked: boolean, target: string): Promise<void> {
  const all = await connections();
  if (!all[target]) {
    await setSecret(tokenSlot(target), null);
    return;
  }
  const order = await serverOrder();
  const wasDefault = target === (await defaultServer());
  await setSecret(tokenSlot(target), null);
  await setSecret(`identity@${target}`, null);   // whether it proves its identity, for that token (identity.ts)
  const {[target]: _forgotten, ...rest} = all;
  const next = wasDefault ? successor(order, target) : null;
  const stored = await chrome.storage.local.get([NAMES, IDS]);
  const {[target]: _name, ...names} = (stored[NAMES] as Record<string, string> | undefined) ?? {};
  const {[target]: _id, ...ids} = (stored[IDS] as Record<string, string> | undefined) ?? {};
  // The connections and the default change in one write: no reader ever sees a default
  // whose connection is already gone.
  await chrome.storage.local.set({[CONNECTIONS]: rest, [ORDER]: order.filter((item) => item !== target),
    [NAMES]: names, [IDS]: ids, ...(wasDefault && next ? {[ACTIVE]: next} : {})});
  if (wasDefault) {
    await chrome.storage.local.remove(["appearance", ...(next ? [] : [ACTIVE])]);
    await chrome.storage.session.remove(["focusJob", "focusServer"]);
  }
  await chrome.storage.session.remove(SERVER_STATE.map((name) => stateKey(target, name)));
  // The last server gone: the popup says why (with others left, it shows them).
  const last = Object.keys(rest).length === 0;
  if (revoked && last) await chrome.storage.session.set({[PAIRING]: {state: "failed", failure: "unauthorized"} satisfies Pairing});
}
