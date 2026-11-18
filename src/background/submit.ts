// SPDX-License-Identifier: GPL-2.0-or-later
// Sending downloads (WS-E2): one gesture is one submission under one fresh
// idempotency key (B7). A .torrent/.nzb/.meta4 link is captured first, with
// the person's own login for that site (spike S1, B5): the file URL itself
// is never sent, stored or logged. Feedback goes to the frame the gesture
// came from, else to the toolbar badge (B6).

import {connection, token} from "../shared/connection";
import {message} from "../shared/i18n";
import {captureKind, extractUrls, type CaptureKind} from "../shared/classify";
import {submitJob, type Source} from "../shared/server";
import {wake} from "./monitor";

const LIMITS: Record<CaptureKind, number> = {torrent: 16 * 1024 * 1024, nzb: 8 * 1024 * 1024, metalink: 16 * 1024 * 1024};
const SUFFIX: Record<CaptureKind, string> = {torrent: ".torrent", nzb: ".nzb", metalink: ".meta4"};
const CAPTURE_TIMEOUT_MS = 30_000;

export interface Origin {
  tabId?: number;
  frameId?: number;
}

class Refused extends Error {
  constructor(public readonly key: string) {
    super(key);
  }
}

// Server refusal codes (DebridPulse ExternalRefused) → what the person is told.
const REFUSALS: Record<string, string> = {
  local_network_confirmation_required: "sendLocalNetwork", acquisition_scope_required: "sendCollectionItem",
  client_job_limit: "sendTooMany", source_too_large: "sendTooLarge", invalid_source: "sendInvalid",
  unsupported_source: "sendInvalid", source_kind_not_permitted: "sendInvalid", source_refused: "sendRefused",
  source_unavailable: "sendUnavailable", unauthorized: "sendNotConnected",
};

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

function fileName(response: Response, url: URL, kind: CaptureKind): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const named = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
  let name = named ? decodeURIComponent(named[1] ?? named[2] ?? "") : decodeURIComponent(url.pathname.split("/").pop() ?? "");
  name = name.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 200) || "download";
  return name.toLowerCase().endsWith(SUFFIX[kind]) ? name : name.replace(/\.[^.]*$/, "") + SUFFIX[kind];
}

/** B5: fetch the file as the browser would, with the person's cookies for that site. */
async function capture(href: string, kind: CaptureKind): Promise<Source> {
  const url = new URL(href);
  if (!(await chrome.permissions.contains({origins: [`${url.origin}/*`]}))) throw new Refused("sendNoSiteAccess");
  let response: Response;
  try {
    response = await fetch(url, {credentials: "include", redirect: "follow", cache: "no-store",
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS)});
  } catch {
    throw new Refused("sendCaptureFailed");
  }
  if (!response.ok) throw new Refused("sendCaptureFailed");
  if (/^\s*(text\/html|application\/xhtml)/i.test(response.headers.get("Content-Type") ?? "")) {
    throw new Refused("sendCaptureWebPage");
  }
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > LIMITS[kind]) throw new Refused("sendTooLarge");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Refused("sendCaptureFailed");
  if (bytes.length > LIMITS[kind]) throw new Refused("sendTooLarge");
  const filename = fileName(response, url, kind);
  const encoded = base64(bytes);
  return kind === "torrent" ? {kind, filename, torrent_base64: encoded}
    : kind === "nzb" ? {kind, filename, nzb_base64: encoded} : {kind, filename, metalink_base64: encoded};
}

/** B6 (WS-E3): what the download is called in the list. */
function displayName(source: Source): string {
  if (source.kind === "magnet") {
    try {
      return new URL(source.magnet).searchParams.get("dn") ?? "";
    } catch {
      return "";
    }
  }
  if (source.kind === "links") {
    if (source.links.length !== 1) return "";
    try {
      return decodeURIComponent(new URL(source.links[0]!).pathname.split("/").pop() ?? "");
    } catch {
      return "";
    }
  }
  return source.filename;
}

async function send(source: Source): Promise<void> {
  const connected = await connection();
  const browserToken = await token();
  if (!connected || !browserToken) throw new Refused("sendNotConnected");
  const key = crypto.randomUUID();
  const name = displayName(source);
  let answer = await submitJob(connected.server, browserToken, key, source, name);
  if (!answer.ok && answer.retryable) {
    // The same gesture, the same key: never a second download (B7).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    answer = await submitJob(connected.server, browserToken, key, source, name);
  }
  if (!answer.ok) throw new Refused(REFUSALS[answer.code] ?? "sendFailed");
  wake();
}

async function sourceFor(href: string): Promise<Source> {
  if (/^magnet:\?/i.test(href)) return {kind: "magnet", magnet: href};
  const kind = captureKind(href);
  return kind ? capture(href, kind) : {kind: "links", links: [href]};
}

async function feedback(origin: Origin, key: string, ok: boolean): Promise<void> {
  const text = message(key);
  if (origin.tabId !== undefined && origin.tabId >= 0) {
    try {
      await chrome.tabs.sendMessage(origin.tabId, {type: "dp-toast", text, ok}, {frameId: origin.frameId ?? 0});
      return;
    } catch {
      // no content script there (a restricted page): the badge says it instead
    }
  }
  await chrome.action.setBadgeBackgroundColor({color: ok ? "#16a34a" : "#dc2626"});
  await chrome.action.setBadgeText({text: ok ? "✓" : "!"});
  setTimeout(() => void chrome.action.setBadgeText({text: ""}), 4000);
}

async function settle(origin: Origin, work: () => Promise<void>): Promise<void> {
  try {
    await work();
    await feedback(origin, "sendDone", true);
  } catch (error) {
    await feedback(origin, error instanceof Refused ? error.key : "sendFailed", false);
  }
}

/** A link: right-click, the hover icon, the video button, the URL-bar icon (B1, B3, B4). */
export function sendUrl(href: string, origin: Origin): Promise<void> {
  return settle(origin, async () => send(await sourceFor(href)));
}

/** A selection: its http(s) URLs as one batch, each magnet on its own (B2). */
export function sendSelection(text: string, origin: Origin): Promise<void> {
  return settle(origin, async () => {
    const urls = extractUrls(text);
    if (!urls.length) throw new Refused("sendNothingFound");
    // Plain links go as one batch; a magnet, and a file DownloadPulse takes
    // as contents (captured), each on its own.
    const single = urls.filter((url) => /^magnet:\?/i.test(url) || captureKind(url));
    const links = urls.filter((url) => !single.includes(url)).slice(0, 100);
    if (links.length) await send({kind: "links", links});
    for (const url of single) await send(await sourceFor(url));
  });
}
