// SPDX-License-Identifier: GPL-2.0-or-later
// Background entry point: a service worker in Chromium, an event page in
// Firefox (WS-E0 B2). It routes the popup's and the content scripts'
// requests, owns the right-click menu (shown only while connected, WS-E2
// B8) and, in Firefox, the URL-bar icon (page action, WS-E2 B4).
//
// Firefox for Android has no right-click menu, no windows and no downloads list an extension
// can pause (MDN browser-compat-data): every API not every browser has is looked for before it
// is used, and the requests are listened for first, so a missing one can never stop them.

import {
  connection, connectionState, defaultServer, forgetConnection, revocationToken, serverForId, servers, token, upgradeConnections,
} from "../shared/connection";
import {stateKey} from "../shared/server-state";
import {controlJob, disconnectBrowser, isLocal, showApplication, withdrawJob} from "../shared/server";
import {isOffSite, settings} from "../shared/settings";
import {videoAddress} from "../shared/classify";
import {downloadsUsable} from "../shared/downloads";
import {appearance, type Appearance} from "../shared/appearance";
import {refreshAppearance} from "./appearance";
import {restIcon} from "./icon";
import {popupOpen, wake} from "./monitor";
import {message} from "../shared/i18n";
import {cancel, connectLocal, connectRemote, pairLocal} from "./pairing";
import {feedback, sendSelection, sendUrl, quickAdd, sendVideo, type Origin} from "./submit";
import {forgetTab, pageSend, pageSingles} from "./page-sends";
import {answer as answerConfirmation, ask as askConfirmation, shown as confirmationShown, type PageRequest} from "./confirm";
import {forgetSentKey} from "./sent-keys";
import {listen as listenForDownloads, settleHeld} from "./capture";

type Request =
  | {type: "connect-local"} | {type: "pair-local"; origin: string} | {type: "connect-remote"; address: string; insecure?: boolean}
  | {type: "cancel"} | {type: "dp-open"; server?: string}
  | {type: "dp-state"} | {type: "dp-send"; url: string; server?: unknown} | {type: "dp-send-video"; url?: string; server?: unknown}
  | {type: "dp-send-selection"; text: string; server?: unknown} | {type: "dp-has-video"}
  | {type: "dp-popup-open"} | {type: "dp-quick-add"; text: string; server?: string}
  | {type: "dp-control"; id: string; kind: "pause" | "resume"; server: string} | {type: "dp-withdraw"; id: string; server: string}
  | {type: "dp-disconnect"; server: string; force?: boolean} | {type: "dp-settle-held"} | {type: "dp-capture-usable"}
  | {type: "dp-confirm-get"; id: string} | {type: "dp-confirm-answer"; id: string; send: boolean};

/** The server an extension page named (by origin, as the popup knows them), if it is a saved one; else the default. */
async function named(server: unknown): Promise<string | null> {
  if (typeof server === "string" && server) return (await connection(server)) ? server : null;
  return defaultServer();
}

/**
 * Disconnect ``server`` (WS-E4; WS-X1: the popup's confirmation dialog): this browser's token is
 * revoked there, and only then forgotten here -- also when DownloadPulse says it was removed
 * already. Unanswered, nothing is removed (``unreachable``) until the person chooses Remove
 * anyway (``force``), which forgets it here only. Revoked with the stored token even while the
 * connection is held for the disclosure or the plain-HTTP choice (EXT-6), never over plain HTTP
 * across the internet (no token is then sent, and the connection is only forgotten).
 */
const DISCONNECT_MS = 10_000;

async function disconnect(server: unknown, force: boolean): Promise<{result: "revoked" | "removed" | "unreachable" | "none"}> {
  if (typeof server !== "string" || !(await connection(server))) return {result: "none"};
  if (!force) {
    const browserToken = await revocationToken(server);
    if (browserToken) {
      // The dialog gives up after about 10 seconds, the identity proof included (WS-X1): then
      // nothing has been removed here, and the person chooses.
      let timer = 0;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), DISCONNECT_MS); });
      try {
        await Promise.race([disconnectBrowser(server, browserToken), timeout]);
      } catch {
        return {result: "unreachable"};
      } finally {
        clearTimeout(timer);
      }
      await forgetConnection(false, server);
      return {result: "revoked"};
    }
  }
  await forgetConnection(false, server);
  return {result: "removed"};
}

/**
 * Open DownloadPulse: the installed desktop application on this computer
 * brings its own window forward; anything else (a server, an older
 * DownloadPulse, no answer) opens in a tab. Answers whether a tab opened.
 */
async function openDownloadPulse(server: string | null): Promise<{tab: boolean}> {
  const connected = server ? await connection(server) : null;
  if (!connected) return {tab: false};
  const browserToken = connected ? await token(connected.server) : null;
  if (isLocal(connected.server) && browserToken && await showApplication(connected.server, browserToken)) return {tab: false};
  await chrome.tabs.create({url: `${connected.server}/`});
  return {tab: true};
}

/** What a frame may offer: nothing unless connected, then as the settings say for its tab's site. */
/**
 * A server as a page's ▾ list shows it (WS-X1): its ID, which means nothing outside the extension,
 * its short name, whether it can be chosen now, and whether it is the default -- never its address.
 */
interface PageServer { id: string; name: string; reachable: boolean; isDefault: boolean }

/** The servers a page may offer, in display order: only with two or more (one is the plain button). */
async function pageServers(): Promise<PageServer[]> {
  const all = await servers();
  if (all.length < 2) return [];
  const reach = await chrome.storage.session.get(all.map((item) => stateKey(item.server, "reach")));
  return Promise.all(all.map(async (item) => {
    // Held by the gate, or not answering its last look: shown, but it can't be chosen.
    const answered = (reach[stateKey(item.server, "reach")] as {ok?: boolean} | undefined)?.ok !== false;
    const usable = (await connectionState(item)) === "ok";
    return {id: item.id, name: item.name, reachable: answered && usable, isDefault: item.isDefault};
  }));
}

async function frameState(sender: chrome.runtime.MessageSender):
    Promise<{connected: boolean; hover: boolean; video: boolean; appearance: Appearance | null; servers: PageServer[]}> {
  // A connection held by the gate (connection.ts connectionState) offers nothing on a page.
  // A page's buttons send to the default server, or one chosen from their ▾ list (WS-X1).
  const server = await defaultServer();
  if (!server || !(await token(server))) return {connected: false, hover: false, video: false, appearance: null, servers: []};
  const chosen = await settings();
  const off = isOffSite(sender.tab?.url ?? sender.url ?? "", chosen.offSites);
  // The person's theme, by palette ID (not a secret): what the page's surfaces are drawn in.
  // The master switch first: off, the page offers nothing (its own choices are kept for when it is on).
  const on = chosen.inPage && !off;
  return {connected: true, hover: on && chosen.hover, video: on && chosen.video, appearance: await appearance(),
    servers: on ? await pageServers() : []};
}

/**
 * Whether a page's buttons may be offered in its frames, not only the tab's own page: only where the
 * browser can say a button is drawn uncovered (Intersection Observer v2, Chromium). Elsewhere (Gecko)
 * a framing page could fade or cover the frame unseen (operator, 2026-11-27; content/index.ts).
 */
const buttonsInFrames = chrome.runtime.getURL("").startsWith("chrome-extension:");

/**
 * Whether a press on a page's button is confirmed in DownloadPulse's own window before it sends
 * (background/confirm.ts): where the browser can't say the button was drawn uncovered (Gecko;
 * operator, 2026-11-27). A test build may ask for it everywhere (scripts/build.mjs).
 */
declare const __DP_CONFIRM_EVERYWHERE__: boolean;
const confirmInWindow = !buttonsInFrames || (typeof __DP_CONFIRM_EVERYWHERE__ !== "undefined" && __DP_CONFIRM_EVERYWHERE__);

const surfaceOf = (request: PageRequest): "hover" | "video" => (request.kind === "video" ? "video" : "hover");

/** Whether a page's button may send for ``sender`` now (connected, offered there): told when not connected. */
async function offered(sender: chrome.runtime.MessageSender, request: PageRequest, origin: Origin): Promise<boolean> {
  const state = await frameState(sender);
  // Held or gone since the page asked: told, as before; nothing is fetched or sent.
  if (!state.connected) {
    await feedback(origin, "sendNotConnected", false);
    return false;
  }
  return state[surfaceOf(request)] && (buttonsInFrames || (sender.frameId ?? 0) === 0);
}

/** A page button's send, made: within the tab's allowance of separate jobs; to ``server``, else the default. */
function perform(request: PageRequest, origin: Origin, tabId: number, tab: chrome.tabs.Tab | undefined,
                 server: string | undefined): Promise<void> {
  const allow = (wanted: number) => pageSingles(tabId, wanted);
  if (request.kind === "link") return sendUrl(request.url, origin, allow, server);
  if (request.kind === "selection") return sendSelection(request.text, origin, allow, server);
  return sendVideo(request.url, origin, tab, server);
}

/**
 * The server a page's ▾ list chose (WS-X1): only by an ID one of the saved servers has, never an
 * address. None given: the default (``undefined``). An ID that is not (or no longer) a saved
 * server's: ``null``, refused -- a send never falls back to another server.
 */
async function chosenServer(id: unknown): Promise<string | null | undefined> {
  if (id === undefined) return undefined;
  return serverForId(id);
}

/**
 * A send from a page's button (1.0.8, WS-A3): only while that button is offered there now -- the
 * person's settings for the tab's site read again, never the content script's own record of an
 * answer it was given -- and within the tab's allowance (background/page-sends.ts). Where it
 * must be confirmed, it is only asked about here (``confirmInWindow``).
 */
async function fromButton(sender: chrome.runtime.MessageSender, request: PageRequest, serverId: unknown): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  const origin = {tabId, frameId: sender.frameId ?? 0};
  const server = await chosenServer(serverId);
  if (server === null) {
    await feedback(origin, "sendServerGone", false);
    return;
  }
  if (!(await offered(sender, request, origin))) return;
  if (!pageSend(tabId)) {
    await feedback(origin, "sendPageLimit", false);
    return;
  }
  if (!confirmInWindow) {
    await perform(request, origin, tabId, sender.tab, server);
    return;
  }
  const tab = sender.tab as chrome.tabs.Tab & {cookieStoreId?: string};
  // The window names the server it would go to (WS-X1): the one chosen, else the default.
  const to = server ?? await defaultServer() ?? undefined;
  await askConfirmation({request, tabId, frameId: origin.frameId, tabUrl: tab.url ?? sender.url ?? "", frameUrl: sender.url ?? "",
    ...(tab.cookieStoreId ? {cookieStoreId: tab.cookieStoreId} : {}), ...(to ? {server: to} : {})});
}

/** Send, in a question's window: sent as the press would have been, its site's settings read again now. */
async function confirmed(id: string, send: boolean): Promise<void> {
  const asked = await answerConfirmation(id, send);
  if (!asked) return;
  const tab = {id: asked.tabId, url: asked.tabUrl, ...(asked.cookieStoreId ? {cookieStoreId: asked.cookieStoreId} : {})} as chrome.tabs.Tab;
  const sender = {id: chrome.runtime.id, tab, url: asked.frameUrl, frameId: asked.frameId} as chrome.runtime.MessageSender;
  const origin = {tabId: asked.tabId, frameId: asked.frameId};
  if (!(await offered(sender, asked.request, origin))) return;
  // To the server the window named, never another (gone since: refused there).
  await perform(asked.request, origin, asked.tabId, tab, asked.server);
}

chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return undefined;
  // The extension's own pages (the popup, wherever it is open) may connect;
  // a content script, in a web page, only asks and sends.
  const fromPage = !String(sender.url ?? "").startsWith(chrome.runtime.getURL(""));
  switch (request.type) {
    case "connect-local": if (!fromPage) void connectLocal(); return undefined;
    case "pair-local": if (!fromPage) void pairLocal(String(request.origin || "")); return undefined;
    case "connect-remote": if (!fromPage) void connectRemote(String(request.address || ""), request.insecure === true); return undefined;
    case "dp-open":
      if (fromPage) return undefined;
      void named(request.server).then(openDownloadPulse).then(respond);
      return true;
    case "cancel": if (!fromPage) void cancel(); return undefined;
    case "dp-quick-add":
      if (fromPage || typeof request.text !== "string" || request.text.length > 200_000) return undefined;
      void named(request.server).then((server) => quickAdd(request.text, server)).then(respond);
      return true;
    case "dp-popup-open":
      if (!fromPage) {
        popupOpen();
        void refreshAppearance();
      }
      return undefined;
    case "dp-disconnect":
      if (fromPage) return undefined;
      void disconnect(request.server, request.force === true).then(respond);
      return true;
    case "dp-capture-usable":
      if (fromPage) return undefined;
      respond(downloadsUsable(chrome.downloads));
      return undefined;
    case "dp-settle-held":
      // Turned off in the popup: the held downloads resume while the permission is still there.
      if (fromPage) return undefined;
      void settleHeld().then(() => respond({}), () => respond({}));
      return true;
    case "dp-control":
    case "dp-withdraw":
      if (fromPage) return undefined;
      void act(request).then(respond);
      return true;
    case "dp-state":
      // A content script learns only whether it may offer anything: never a secret.
      void frameState(sender).then(respond);
      return true;
    case "dp-send":
      if (fromPage && typeof request.url === "string") void fromButton(sender, {kind: "link", url: request.url}, request.server);
      return undefined;
    case "dp-send-video": {
      // The frame's current address (a single-page site changes it in place; the browser's
      // record of the frame, sender.url, keeps the address it loaded), accepted only on the
      // origin the browser reports for that frame: a frame sends only its own site's video,
      // with the cookies for exactly that address (2026-11-19).
      const href = videoAddress(request.url, sender.url);
      if (fromPage && href) void fromButton(sender, {kind: "video", url: href}, request.server);
      return undefined;
    }
    case "dp-send-selection":
      // The page's selection, as the right-click "selection" item sends it (a site may block right-click).
      // Offered with the hover icon (content/index.ts offerSelection), so only while that is on.
      if (fromPage && typeof request.text === "string" && request.text.length <= 200_000) {
        void fromButton(sender, {kind: "selection", text: request.text}, request.server);
      }
      return undefined;
    case "dp-confirm-get":
      // The question's own window (an extension page) only: never a page's content script.
      if (fromPage || typeof request.id !== "string") return undefined;
      void confirmationShown(request.id).then(respond);
      return true;
    case "dp-confirm-answer":
      if (fromPage || typeof request.id !== "string") return undefined;
      void confirmed(request.id, request.send === true).then(() => respond({}), () => respond({}));
      return true;
    case "dp-has-video":
      if (fromPage && pageAction && sender.tab?.id !== undefined) {
        const tabId = sender.tab.id;
        void frameState(sender).then((state) => { if (state.video) void pageAction.show(tabId); });
      }
      return undefined;
  }
  return undefined;
});

chrome.tabs?.onRemoved?.addListener((tabId) => forgetTab(tabId));

// Browser downloads (1.0.2): listened to only while the optional "downloads" permission is granted.
listenForDownloads();

const MENU_LINK = "dp-send-link";
const MENU_SELECTION = "dp-send-selection";

/**
 * The right-click menu: "Download with DownloadPulse" for links and selected text; with two or more
 * servers (WS-X1), a submenu of their names in display order (the default named so), each item by
 * the server's page ID, never its address. Made again whenever the servers change.
 */
let menusMade: Promise<void> = Promise.resolve();
function refreshMenus(): Promise<void> {
  menusMade = menusMade.then(makeMenus, makeMenus);
  return menusMade;
}

async function makeMenus(): Promise<void> {
  if (!chrome.contextMenus) return;   // no right-click menu (Firefox for Android)
  await chrome.contextMenus.removeAll();
  const server = await defaultServer();
  if (!server || !(await token(server))) return;
  const title = message("menuSend");
  chrome.contextMenus.create({id: MENU_LINK, title, contexts: ["link"]});
  chrome.contextMenus.create({id: MENU_SELECTION, title, contexts: ["selection"]});
  const all = await servers();
  if (all.length < 2) return;
  for (const item of all) {
    const name = item.isDefault ? message("menuServerDefault", [item.name]) : item.name;
    chrome.contextMenus.create({id: `${MENU_LINK}@${item.id}`, parentId: MENU_LINK, title: name, contexts: ["link"]});
    chrome.contextMenus.create({id: `${MENU_SELECTION}@${item.id}`, parentId: MENU_SELECTION, title: name, contexts: ["selection"]});
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void upgradeConnections();   // 1.0.7's connection: its name, page ID and place (WS-X1)
  void refreshMenus();
  void restIcon();
});
chrome.runtime.onStartup.addListener(() => {
  void refreshMenus();
  void restIcon();
  wake();   // downloads unsettled when the browser closed (WS-E3 B1)
});

/** A control or Remove from the popup, answered with DebridPulse's decision. */
async function act(request: {type: "dp-control"; id: string; kind: "pause" | "resume"; server: string}
    | {type: "dp-withdraw"; id: string; server: string}): Promise<{ok: boolean; reason?: string}> {
  // That job's own server, named by the popup's row: never another one.
  const connected = typeof request.server === "string" ? await connection(request.server) : null;
  const browserToken = connected ? await token(connected.server) : null;
  if (!connected || !browserToken) return {ok: false, reason: "not_connected"};
  try {
    if (request.type === "dp-withdraw") {
      await withdrawJob(connected.server, browserToken, request.id);
      await forgetSentKey(request.id);
      return {ok: true};
    }
    const decision = await controlJob(connected.server, browserToken, request.id, request.kind);
    return {ok: decision.disposition === "honored", reason: decision.reason};
  } catch {
    return {ok: false, reason: "failed"};
  } finally {
    wake();
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ["connections", "activeServer", "consent", "serverOrder", "serverNames", "serverIds"]
    .some((key) => key in changes)) void refreshMenus();
  // The toolbar icon in the person's theme, redrawn when it changes (or the connection goes).
  if (area === "local" && "appearance" in changes) void restIcon();
  // Another default server (☆, or the default disconnected): its colours, now (WS-X1).
  if (area === "local" && "activeServer" in changes && changes["activeServer"]?.newValue) void refreshAppearance(true);
});

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  const origin = {...(tab?.id !== undefined ? {tabId: tab.id} : {}), frameId: info.frameId ?? 0};
  const [item = "", id] = String(info.menuItemId).split("@");
  void (async () => {
    // A submenu item (two or more servers): that server, by its ID; gone since the menu was made, refused.
    const server = id === undefined ? undefined : await serverForId(id);
    if (server === null) return feedback(origin, "sendServerGone", false);
    if (item === MENU_LINK && info.linkUrl) await sendUrl(info.linkUrl, origin, undefined, server);
    else if (item === MENU_SELECTION && info.selectionText) await sendSelection(info.selectionText, origin, undefined, server);
  })();
});

// Firefox only: the URL-bar icon, shown on a tab whose content script saw a video.
const pageAction = (globalThis as unknown as {browser?: {pageAction?: {show(tabId: number): Promise<void>;
  onClicked: {addListener(listener: (tab: chrome.tabs.Tab) => void): void}}}}).browser?.pageAction;
pageAction?.onClicked.addListener((tab) => {
  if (tab.url && tab.id !== undefined) void sendVideo(tab.url, {tabId: tab.id, frameId: 0}, tab);
});
