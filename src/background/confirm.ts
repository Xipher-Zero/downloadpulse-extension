// SPDX-License-Identifier: GPL-2.0-or-later
// Where the browser can't say whether an in-page button was drawn uncovered (Gecko: no
// Intersection Observer v2), a press on one never sends by itself (1.0.8, WS-A3; operator,
// 2026-11-27): it asks, and DownloadPulse's own small window -- which no page can cover,
// restyle or script -- shows what would be sent and from which site. Only Send there sends.
//
// One question at a time per tab: while a tab's window is open, that tab's pages ask nothing
// more (each ask also counts against the tab's allowance, background/page-sends.ts). Kept in
// the session store, so an event page stopped while the window is open still knows it.

import {captureKind, extractUrls} from "../shared/classify";
import {BATCH_LIMIT, SINGLE_LIMIT} from "./submit";

/** What a page's button asked to send. */
export type PageRequest =
  | {kind: "link"; url: string}
  | {kind: "selection"; text: string}
  | {kind: "video"; url: string};

/** The question: what, from where (the tab, the frame, its address and cookie store), and the window it is asked in. */
export interface Asked {
  id: string; request: PageRequest; tabId: number; frameId: number; tabUrl: string; frameUrl: string;
  cookieStoreId?: string; windowId?: number; viewTabId?: number;
}

const KEY = "confirmations";

async function all(): Promise<Record<string, Asked>> {
  return ((await chrome.storage.session.get(KEY))[KEY] as Record<string, Asked> | undefined) ?? {};
}

async function save(value: Record<string, Asked>): Promise<void> {
  await chrome.storage.session.set({[KEY]: value});
}

/** Whether the window (or, without windows, the tab) a question is asked in is still open. */
async function open(asked: Asked): Promise<boolean> {
  try {
    if (asked.windowId !== undefined) return Boolean(await chrome.windows.get(asked.windowId));
    if (asked.viewTabId !== undefined) return Boolean(await chrome.tabs.get(asked.viewTabId));
  } catch {
    // closed
  }
  return false;
}

async function close(asked: Asked): Promise<void> {
  try {
    if (asked.windowId !== undefined) await chrome.windows.remove(asked.windowId);
    else if (asked.viewTabId !== undefined) await chrome.tabs.remove(asked.viewTabId);
  } catch {
    // already closed
  }
}

// Asks are handled one after another: two presses at once never open two windows for one tab.
let asking: Promise<unknown> = Promise.resolve();

/**
 * Ask the person, in DownloadPulse's own window, whether to send ``request``. Answers whether
 * it was asked: not while that tab already has a question open.
 */
export function ask(question: Omit<Asked, "id" | "windowId" | "viewTabId">): Promise<boolean> {
  const next = asking.then(async () => {
    const questions = await all();
    const current = Object.values(questions).find((item) => item.tabId === question.tabId);
    if (current) {
      if (await open(current)) return false;
      delete questions[current.id];
    }
    const id = crypto.randomUUID();
    const url = chrome.runtime.getURL(`confirm/confirm.html?id=${id}`);
    const asked: Asked = {...question, id};
    // Saved before the window opens: the page in it asks for its question at once.
    questions[id] = asked;
    await save(questions);
    // A window of its own (Firefox for Android has none: a tab).
    if (chrome.windows?.create) {
      const made = await chrome.windows.create({url, type: "popup", width: 460, height: 400, focused: true});
      if (made?.id !== undefined) asked.windowId = made.id;
    } else {
      const made = await chrome.tabs.create({url, active: true});
      if (made?.id !== undefined) asked.viewTabId = made.id;
    }
    await save({...(await all()), [id]: asked});
    return true;
  });
  asking = next.catch(() => undefined);
  return next;
}

/** What a question's window shows: the site, and the links that would go (as a selection would send them). */
export async function shown(id: string): Promise<{kind: PageRequest["kind"]; site: string; links: string[]} | null> {
  const asked = (await all())[id];
  if (!asked) return null;
  let site = "";
  try {
    site = new URL(asked.tabUrl).host;
  } catch {
    site = "";
  }
  const request = asked.request;
  if (request.kind !== "selection") return {kind: request.kind, site, links: [request.url]};
  const urls = extractUrls(request.text);
  const single = urls.filter((url) => /^magnet:\?/i.test(url) || captureKind(url));
  const plain = urls.filter((url) => !single.includes(url));
  return {kind: request.kind, site, links: [...plain.slice(0, BATCH_LIMIT), ...single.slice(0, SINGLE_LIMIT)]};
}

/** The person answered (Send, or Cancel): the question is gone and its window closed; Send hands it back to be sent. */
export async function answer(id: string, send: boolean): Promise<Asked | null> {
  const questions = await all();
  const asked = questions[id];
  if (!asked) return null;
  delete questions[id];
  await save(questions);
  await close(asked);
  return send ? asked : null;
}

/** A question's window closed without an answer: nothing is sent. */
async function forget(match: (asked: Asked) => boolean): Promise<void> {
  const questions = await all();
  const left = Object.fromEntries(Object.entries(questions).filter(([, asked]) => !match(asked)));
  if (Object.keys(left).length !== Object.keys(questions).length) await save(left);
}
chrome.windows?.onRemoved?.addListener((windowId) => void forget((asked) => asked.windowId === windowId));
chrome.tabs?.onRemoved?.addListener((tabId) => void forget((asked) => asked.viewTabId === tabId));
