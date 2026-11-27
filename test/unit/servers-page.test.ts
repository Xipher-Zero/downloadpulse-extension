// SPDX-License-Identifier: GPL-2.0-or-later
// WS-X1 part 2 (1.0.8): what pages and the right-click menu see of more than one server, against
// the background loaded in an in-memory browser: a page learns each server's ID, name, whether it
// can be chosen and which is the default -- never an address; a send names a server only by an ID
// the background knows (any other is refused, nothing sent); the right-click menu has a submenu of
// the servers in display order, made again when they change.
import {test} from "node:test";
import assert from "node:assert/strict";

type Listener = (...args: unknown[]) => unknown;
const event = () => {
  const listeners: Listener[] = [];
  return {listeners, addListener: (listener: Listener) => void listeners.push(listener)};
};
const area = () => {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys?: string | string[] | null) => {
      if (keys === null || keys === undefined) return structuredClone(data);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data)
        .map((key) => [key, structuredClone(data[key])]));
    },
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
};

// The extension origin's IndexedDB (the tokens), in memory.
const secrets = new Map<string, unknown>();
const request = <T>(result: () => T) => {
  const value: {result?: T; onsuccess?: () => void} = {};
  queueMicrotask(() => { value.result = result(); value.onsuccess?.(); });
  return value;
};
(globalThis as unknown as {indexedDB: unknown}).indexedDB = {
  open: () => {
    const opened: {result?: unknown; onsuccess?: () => void} = {};
    queueMicrotask(() => {
      opened.result = {
        close: () => undefined,
        transaction: () => {
          const tx: {oncomplete?: () => void; objectStore: () => unknown} = {
            objectStore: () => {
              const done = <T>(r: T) => { queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.())); return r; };
              return {
                get: (key: string) => done(request(() => secrets.get(key))),
                put: (value: unknown, key: string) => done(request(() => secrets.set(key, value))),
                delete: (key: string) => done(request(() => secrets.delete(key))),
              };
            },
          };
          return tx;
        },
      };
      opened.onsuccess?.();
    });
    return opened;
  },
};

const EXTENSION = "chrome-extension://servers-test/";
const onMessage = event(), onInstalled = event(), onStartup = event(), onChanged = event(), onClicked = event();
const local = area(), session = area();
const menus: {id: string; parentId?: string; title: string}[] = [];
const toasts: string[] = [];
const fetched: string[] = [];
(globalThis as unknown as {fetch: unknown}).fetch = async (url: string) => {
  fetched.push(String(url));
  return new Response(JSON.stringify({detail: {code: "invalid_source", retryable: false}}), {status: 422,
    headers: {"Content-Type": "application/json"}});
};
(globalThis as unknown as {chrome: unknown}).chrome = {
  runtime: {
    id: "servers-test", onMessage, onInstalled, onStartup,
    getURL: (path: string) => EXTENSION + path,
    getPlatformInfo: async () => ({os: "linux", arch: "x86-64"}),
    sendMessage: async () => undefined,
  },
  storage: {local, session, onChanged},
  permissions: {onAdded: event(), onRemoved: event(), contains: async () => false, remove: async () => false},
  alarms: {onAlarm: event(), create: async () => undefined, clear: async () => true},
  tabs: {query: async () => [], create: async () => ({}), onRemoved: event(),
    sendMessage: async (_tab: number, value: {type?: string; text?: string}) => { if (value?.type === "dp-toast") toasts.push(String(value.text)); }},
  i18n: {getMessage: (key: string, subs?: string[]) => (subs ? `${key}:${subs.join("|")}` : key), getUILanguage: () => "en"},
  cookies: {getAll: async () => []},
  action: {setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined},
  contextMenus: {
    removeAll: async () => void menus.splice(0),
    create: (item: {id: string; parentId?: string; title: string}) => void menus.push({id: item.id, title: item.title,
      ...(item.parentId ? {parentId: item.parentId} : {})}),
    onClicked,
  },
};

const A = "https://home.example", B = "https://seed.example";
local.data["consent"] = {version: 3, deviceName: false, at: 1};
local.data["connections"] = {[A]: {server: A, tokenId: "t1", label: "Brave", account: "Una"},
  [B]: {server: B, tokenId: "t2", label: "Brave", account: "xz"}};
local.data["activeServer"] = A;
local.data["serverNames"] = {[A]: "Home", [B]: "Seedbox"};
secrets.set(`token@${A}`, "tok-a");
secrets.set(`token@${B}`, "tok-b");
session.data[`reach@${B}`] = {ok: false, at: Date.now()};

function ask(message: unknown, sender: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    let answered = false;
    const respond = (answer: unknown) => { answered = true; resolve(answer); };
    const asynchronous = onMessage.listeners.map((listener) => listener(message, {id: "servers-test", ...sender}, respond))
      .some((result) => result === true);
    if (!asynchronous && !answered) resolve(undefined);
  });
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const page = {url: "https://site.example/page", tab: {id: 7, url: "https://site.example/page"}, frameId: 0};

await import("../../src/background/index");
for (const listener of onInstalled.listeners) listener();
await settle();
const ids = local.data["serverIds"] as Record<string, string>;

test("a page learns each server's ID, name, whether it can be chosen and the default -- never an address", async () => {
  const state = await ask({type: "dp-state"}, page) as {servers: Record<string, unknown>[]};
  assert.deepEqual(state.servers, [
    {id: ids[A], name: "Home", reachable: true, isDefault: true},
    {id: ids[B], name: "Seedbox", reachable: false, isDefault: false},
  ]);
  assert.doesNotMatch(JSON.stringify(state), /example|http/);
  assert.ok(ids[A] && ids[B] && ids[A] !== ids[B]);
});

test("a send from a page names its server only by a known ID: any other is refused, nothing is fetched", async () => {
  for (const server of ["bogus", A, 42, {}]) {
    toasts.length = 0;
    fetched.length = 0;
    await ask({type: "dp-send", url: "https://files.example/a.iso", server}, page);
    await settle();
    assert.deepEqual(toasts, ["sendServerGone"], String(server));
    assert.deepEqual(fetched, [], String(server));
  }
  // The chosen server's ID: sent there, and only there.
  await ask({type: "dp-send", url: "https://files.example/a.iso", server: ids[B]}, page);
  await settle();
  assert.ok(fetched.length > 0);
  assert.ok(fetched.every((url) => url.startsWith(`${B}/`)), fetched.join(" "));
  // None named: the default.
  fetched.length = 0;
  await ask({type: "dp-send", url: "https://files.example/b.iso"}, page);
  await settle();
  assert.ok(fetched.length > 0 && fetched.every((url) => url.startsWith(`${A}/`)), fetched.join(" "));
});

test("the right-click menu: a submenu of the servers in display order, made again when they change", async () => {
  assert.deepEqual(menus.filter((item) => item.parentId === "dp-send-link").map((item) => [item.id, item.title]),
    [[`dp-send-link@${ids[A]}`, "menuServerDefault:Home"], [`dp-send-link@${ids[B]}`, "Seedbox"]]);
  assert.equal(menus.filter((item) => item.parentId === "dp-send-selection").length, 2);
  // Reordered: the submenu follows.
  local.data["serverOrder"] = [B, A];
  for (const listener of onChanged.listeners) listener({serverOrder: {newValue: [B, A]}}, "local");
  await settle();
  assert.deepEqual(menus.filter((item) => item.parentId === "dp-send-link").map((item) => item.title),
    ["Seedbox", "menuServerDefault:Home"]);
  // An item sends to its server; one whose server is gone is refused.
  fetched.length = 0;
  for (const listener of onClicked.listeners) listener({menuItemId: `dp-send-link@${ids[B]}`, linkUrl: "https://files.example/c.iso"}, {id: 7});
  await settle();
  assert.ok(fetched.length > 0 && fetched.every((url) => url.startsWith(`${B}/`)), fetched.join(" "));
  fetched.length = 0;
  toasts.length = 0;
  for (const listener of onClicked.listeners) listener({menuItemId: "dp-send-link@gone", linkUrl: "https://files.example/d.iso"}, {id: 7});
  await settle();
  assert.deepEqual([fetched, toasts], [[], ["sendServerGone"]]);
  // Down to one server: no submenu.
  local.data["connections"] = {[A]: (local.data["connections"] as Record<string, unknown>)[A]};
  for (const listener of onChanged.listeners) listener({connections: {}}, "local");
  await settle();
  assert.deepEqual(menus.map((item) => item.id), ["dp-send-link", "dp-send-selection"]);
});
