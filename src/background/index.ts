// SPDX-License-Identifier: GPL-2.0-or-later
// Background entry point: a service worker in Chromium, an event page in
// Firefox (WS-E0 B2). It routes the popup's requests (WS-E1); the popup
// renders only what is stored.

import {cancel, connectLocal, connectRemote} from "./pairing";

type Request = {type: "connect-local"} | {type: "connect-remote"; address: string} | {type: "cancel"};

chrome.runtime.onMessage.addListener((request: Request, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (request.type === "connect-local") void connectLocal();
  else if (request.type === "connect-remote") void connectRemote(String(request.address || ""));
  else if (request.type === "cancel") void cancel();
});
