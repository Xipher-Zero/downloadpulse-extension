// SPDX-License-Identifier: GPL-2.0-or-later
// Background entry point: a service worker in Chromium, an event page in
// Firefox (WS-E0 B2). No behaviour yet; later workstreams register here.

chrome.runtime.onInstalled.addListener(() => {
  // Intentionally empty in the scaffold.
});
