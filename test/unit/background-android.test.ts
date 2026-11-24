// SPDX-License-Identifier: GPL-2.0-or-later
// Firefox for Android (WS26): no right-click menu, no windows, no downloads list an extension
// can pause, and here also no notifications and no toolbar icon drawing. The background script
// is loaded against a browser like that and must still answer the popup and the page buttons.
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
      if (keys === null || keys === undefined) return {...data};
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data).map((key) => [key, data[key]]));
    },
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
};

const EXTENSION = "moz-extension://android-test/";
const onMessage = event(), onInstalled = event(), onStartup = event();
const failures: unknown[] = [];
process.on("unhandledRejection", (reason) => void failures.push(reason));

// What Firefox for Android has (MDN browser-compat-data 8.1.4): no contextMenus/menus, windows,
// commands or downloads. notifications and action.setIcon are taken away as well, to prove
// nothing on the message path depends on them.
(globalThis as unknown as {chrome: unknown}).chrome = {
  runtime: {
    id: "android-test", onMessage, onInstalled, onStartup,
    getURL: (path: string) => EXTENSION + path,
    getPlatformInfo: async () => ({os: "android", arch: "arm64"}),
    sendMessage: async () => undefined,
  },
  storage: {local: area(), session: area(), onChanged: event()},
  permissions: {
    onAdded: event(), onRemoved: event(),
    // The permission this browser does not know: asking about it fails.
    contains: async () => { throw new Error("Type error for parameter permissions"); },
    remove: async () => false,
  },
  alarms: {onAlarm: event(), create: async () => undefined, clear: async () => true},
  tabs: {query: async () => [], create: async () => ({}), sendMessage: async () => undefined},
  i18n: {getMessage: (key: string) => key, getUILanguage: () => "en"},
  cookies: {getAll: async () => []},
  action: {setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined},
};

/** One request the way the browser delivers it: answered through ``respond``, or not at all. */
function ask(request: unknown, sender: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    let answered = false;
    const respond = (answer: unknown) => { answered = true; resolve(answer); };
    const asynchronous = onMessage.listeners.map((listener) => listener(request, {id: "android-test", ...sender}, respond))
      .some((result) => result === true);
    if (!asynchronous && !answered) resolve(undefined);
  });
}

test("the background loads without the APIs Firefox for Android lacks, and answers its requests", async () => {
  await import("../../src/background/index");
  assert.equal(onMessage.listeners.length, 1, "runtime.onMessage is listened to");

  // The browser starting and the extension installed: menus and the icon are skipped, not thrown.
  for (const listener of [...onInstalled.listeners, ...onStartup.listeners]) listener();

  // A page's buttons: what the frame may offer (nothing until connected).
  assert.deepEqual(await ask({type: "dp-state"}, {url: "https://example.com/", tab: {id: 1}, frameId: 0}),
    {connected: false, hover: false, video: false, appearance: null});
  // The popup: downloads cannot be held here, and disconnecting with nothing connected answers.
  const popup = {url: EXTENSION + "popup/popup.html"};
  assert.equal(await ask({type: "dp-capture-usable"}, popup), false);
  assert.deepEqual(await ask({type: "dp-disconnect"}, popup), {revoked: false});
  assert.deepEqual(await ask({type: "dp-settle-held"}, popup), {});
  assert.deepEqual(await ask({type: "dp-open"}, popup), {tab: false});

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(failures, []);
});
