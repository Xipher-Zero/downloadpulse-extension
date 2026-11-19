// SPDX-License-Identifier: GPL-2.0-or-later
// Background entry point: a service worker in Chromium, an event page in
// Firefox (WS-E0 B2). It routes the popup's and the content scripts'
// requests, owns the right-click menu (shown only while connected, WS-E2
// B8) and, in Firefox, the URL-bar icon (page action, WS-E2 B4).

import {connection, forgetConnection, token} from "../shared/connection";
import {controlJob, disconnectBrowser, isLocal, showApplication, withdrawJob} from "../shared/server";
import {isOffSite, settings} from "../shared/settings";
import {appearance, type Appearance} from "../shared/appearance";
import {refreshAppearance} from "./appearance";
import {restIcon} from "./icon";
import {popupOpen, wake} from "./monitor";
import {message} from "../shared/i18n";
import {cancel, connectLocal, connectRemote, pairLocal} from "./pairing";
import {sendSelection, sendUrl} from "./submit";

type Request =
  | {type: "connect-local"} | {type: "pair-local"; origin: string} | {type: "connect-remote"; address: string; insecure?: boolean}
  | {type: "cancel"} | {type: "dp-open"}
  | {type: "dp-state"} | {type: "dp-send"; url: string} | {type: "dp-send-selection"; text: string} | {type: "dp-has-video"}
  | {type: "dp-popup-open"} | {type: "dp-control"; id: string; kind: "pause" | "resume"} | {type: "dp-withdraw"; id: string}
  | {type: "dp-disconnect"};

/** WS-E4: Disconnect revokes this browser's token on the server, then forgets it here (even if the server is unreachable). */
async function disconnect(): Promise<{revoked: boolean}> {
  const connected = await connection();
  const browserToken = await token();
  let revoked = false;
  if (connected && browserToken) {
    try {
      await disconnectBrowser(connected.server, browserToken);
      revoked = true;
    } catch {
      revoked = false;
    }
  }
  await forgetConnection();
  return {revoked};
}

/**
 * Open DownloadPulse: the installed desktop application on this computer
 * brings its own window forward; anything else (a server, an older
 * DownloadPulse, no answer) opens in a tab. Answers whether a tab opened.
 */
async function openDownloadPulse(): Promise<{tab: boolean}> {
  const connected = await connection();
  if (!connected) return {tab: false};
  const browserToken = await token();
  if (isLocal(connected.server) && browserToken && await showApplication(connected.server, browserToken)) return {tab: false};
  await chrome.tabs.create({url: `${connected.server}/`});
  return {tab: true};
}

/** What a frame may offer: nothing unless connected, then as the settings say for its tab's site. */
async function frameState(sender: chrome.runtime.MessageSender):
    Promise<{connected: boolean; hover: boolean; video: boolean; appearance: Appearance | null}> {
  if (!(await connection())) return {connected: false, hover: false, video: false, appearance: null};
  const chosen = await settings();
  const off = isOffSite(sender.tab?.url ?? sender.url ?? "", chosen.offSites);
  // The person's theme, by palette ID (not a secret): what the page's surfaces are drawn in.
  // The master switch first: off, the page offers nothing (its own choices are kept for when it is on).
  const on = chosen.inPage && !off;
  return {connected: true, hover: on && chosen.hover, video: on && chosen.video, appearance: await appearance()};
}

const MENU_LINK = "dp-send-link";
const MENU_SELECTION = "dp-send-selection";

async function refreshMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  if (!(await connection())) return;
  const title = message("menuSend");
  chrome.contextMenus.create({id: MENU_LINK, title, contexts: ["link"]});
  chrome.contextMenus.create({id: MENU_SELECTION, title, contexts: ["selection"]});
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshMenus();
  void restIcon();
});
chrome.runtime.onStartup.addListener(() => {
  void refreshMenus();
  void restIcon();
  wake();   // downloads unsettled when the browser closed (WS-E3 B1)
});

/** A control or Remove from the popup, answered with DebridPulse's decision. */
async function act(request: {type: "dp-control"; id: string; kind: "pause" | "resume"} | {type: "dp-withdraw"; id: string}):
    Promise<{ok: boolean; reason?: string}> {
  const connected = await connection();
  const browserToken = await token();
  if (!connected || !browserToken) return {ok: false, reason: "not_connected"};
  try {
    if (request.type === "dp-withdraw") {
      await withdrawJob(connected.server, browserToken, request.id);
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
  if (area === "local" && "connection" in changes) void refreshMenus();
  // The toolbar icon in the person's theme, redrawn when it changes (or the connection goes).
  if (area === "local" && "appearance" in changes) void restIcon();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const origin = {...(tab?.id !== undefined ? {tabId: tab.id} : {}), frameId: info.frameId ?? 0};
  if (info.menuItemId === MENU_LINK && info.linkUrl) void sendUrl(info.linkUrl, origin);
  else if (info.menuItemId === MENU_SELECTION && info.selectionText) void sendSelection(info.selectionText, origin);
});

// Firefox only: the URL-bar icon, shown on a tab whose content script saw a video.
const pageAction = (globalThis as unknown as {browser?: {pageAction?: {show(tabId: number): Promise<void>;
  onClicked: {addListener(listener: (tab: chrome.tabs.Tab) => void): void}}}}).browser?.pageAction;
pageAction?.onClicked.addListener((tab) => {
  if (tab.url && tab.id !== undefined) void sendUrl(tab.url, {tabId: tab.id, frameId: 0});
});

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
      void openDownloadPulse().then(respond);
      return true;
    case "cancel": if (!fromPage) void cancel(); return undefined;
    case "dp-popup-open":
      if (!fromPage) {
        popupOpen();
        void refreshAppearance();
      }
      return undefined;
    case "dp-disconnect":
      if (fromPage) return undefined;
      void disconnect().then(respond);
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
      if (fromPage && typeof request.url === "string" && sender.tab?.id !== undefined) {
        void sendUrl(request.url, {tabId: sender.tab.id, frameId: sender.frameId ?? 0});
      }
      return undefined;
    case "dp-send-selection":
      // The page's selection, as the right-click "selection" item sends it (a site may block right-click).
      if (fromPage && typeof request.text === "string" && request.text.length <= 200_000 && sender.tab?.id !== undefined) {
        void sendSelection(request.text, {tabId: sender.tab.id, frameId: sender.frameId ?? 0});
      }
      return undefined;
    case "dp-has-video":
      if (fromPage && pageAction && sender.tab?.id !== undefined) {
        const tabId = sender.tab.id;
        void frameState(sender).then((state) => { if (state.video) void pageAction.show(tabId); });
      }
      return undefined;
  }
  return undefined;
});
