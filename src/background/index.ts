// SPDX-License-Identifier: GPL-2.0-or-later
// Background entry point: a service worker in Chromium, an event page in
// Firefox (WS-E0 B2). It routes the popup's and the content scripts'
// requests, owns the right-click menu (shown only while connected, WS-E2
// B8) and, in Firefox, the URL-bar icon (page action, WS-E2 B4).

import {connection} from "../shared/connection";
import {message} from "../shared/i18n";
import {cancel, connectLocal, connectRemote} from "./pairing";
import {sendSelection, sendUrl} from "./submit";

type Request =
  | {type: "connect-local"} | {type: "connect-remote"; address: string} | {type: "cancel"}
  | {type: "dp-state"} | {type: "dp-send"; url: string} | {type: "dp-has-video"};

const MENU_LINK = "dp-send-link";
const MENU_SELECTION = "dp-send-selection";

async function refreshMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  if (!(await connection())) return;
  const title = message("menuSend");
  chrome.contextMenus.create({id: MENU_LINK, title, contexts: ["link"]});
  chrome.contextMenus.create({id: MENU_SELECTION, title, contexts: ["selection"]});
}

chrome.runtime.onInstalled.addListener(() => void refreshMenus());
chrome.runtime.onStartup.addListener(() => void refreshMenus());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "connection" in changes) void refreshMenus();
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
    case "connect-remote": if (!fromPage) void connectRemote(String(request.address || "")); return undefined;
    case "cancel": if (!fromPage) void cancel(); return undefined;
    case "dp-state":
      // A content script learns only whether it may offer anything: never a secret.
      void connection().then((connected) => respond({connected: Boolean(connected)}));
      return true;
    case "dp-send":
      if (fromPage && typeof request.url === "string" && sender.tab?.id !== undefined) {
        void sendUrl(request.url, {tabId: sender.tab.id, frameId: sender.frameId ?? 0});
      }
      return undefined;
    case "dp-has-video":
      if (fromPage && pageAction && sender.tab?.id !== undefined) {
        const tabId = sender.tab.id;
        void connection().then((connected) => connected && pageAction.show(tabId));
      }
      return undefined;
  }
  return undefined;
});
