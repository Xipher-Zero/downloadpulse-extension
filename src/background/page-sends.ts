// SPDX-License-Identifier: GPL-2.0-or-later
// How much a page's buttons may send (1.0.8, WS-A3). The content script sends only on the
// person's own press of a button they could see; this bound holds even if that were ever
// got round: per tab, a minute's sends from its pages, and the downloads among them that each
// become their own job (a magnet, or a .torrent/.nzb/.meta4 fetched with the person's sign-in).
//
// Kept in memory: the browser may stop the background between sends (Chromium's service
// worker), which starts a new minute -- by then the page has sent nothing for a while.

const WINDOW_MS = 60_000;
/** Presses of in-page buttons from one tab in a minute: far more than a person makes (operator, 2026-11-27). */
export const PAGE_SENDS = 120;
/** Separate jobs (magnets, captured files) from one tab's pages in a minute: three full selections (operator, 2026-11-27). */
export const PAGE_SINGLES = 300;

interface Spent { at: number; send: boolean; singles: number }
const spent = new Map<number, Spent[]>();

function recent(tabId: number, now: number): Spent[] {
  const kept = (spent.get(tabId) ?? []).filter((item) => now - item.at < WINDOW_MS);
  if (kept.length) spent.set(tabId, kept);
  else spent.delete(tabId);
  return kept;
}

/** One more send from ``tabId``'s pages, if its minute allows it (recorded when it does). */
export function pageSend(tabId: number, now = Date.now()): boolean {
  const kept = recent(tabId, now);
  if (kept.filter((item) => item.send).length >= PAGE_SENDS) return false;
  spent.set(tabId, [...kept, {at: now, send: true, singles: 0}]);
  return true;
}

/**
 * Of ``wanted`` separate jobs for a send from ``tabId``'s pages, how many its minute still
 * allows -- that many are counted as taken.
 */
export function pageSingles(tabId: number, wanted: number, now = Date.now()): number {
  const kept = recent(tabId, now);
  const used = kept.reduce((total, item) => total + item.singles, 0);
  const granted = Math.max(0, Math.min(wanted, PAGE_SINGLES - used));
  if (granted) spent.set(tabId, [...kept, {at: now, send: false, singles: granted}]);
  return granted;
}

/** Forgotten with its tab. */
export function forgetTab(tabId: number): void {
  spent.delete(tabId);
}
