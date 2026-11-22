// SPDX-License-Identifier: GPL-2.0-or-later
// Sending downloads (WS-E2): one gesture is one submission under one
// idempotency key (B7), reused for a repeat of the same send within 10 minutes
// (operator, 2026-11-19), so DownloadPulse never queues it twice. A .torrent/.nzb/.meta4 link is captured first, with
// the person's own login for that site (spike S1, B5): the file URL itself
// is never sent, stored or logged. Feedback goes to the frame the gesture
// came from, else to the toolbar badge (B6).

import {connection, forgetConnection, token} from "../shared/connection";
import {message} from "../shared/i18n";
import {capturedName, isIndexerRefusal} from "../shared/capture";
import {captureKind, extractUrls, type CaptureKind} from "../shared/classify";
import {isLocal, isPrivateHost, readSession, resolvesPrivate, ServerError, signInMayTravel, submitJob, type Cookie, type Source} from "../shared/server";
import {settings} from "../shared/settings";
import {cookiesFor} from "./cookies";
import {wake} from "./monitor";
import {keyAnswered, keyFor} from "./sent-keys";

const LIMITS: Record<CaptureKind, number> = {torrent: 16 * 1024 * 1024, nzb: 8 * 1024 * 1024, metalink: 16 * 1024 * 1024};
const CAPTURE_TIMEOUT_MS = 30_000;
/** At most this many plain links go in one selection's batch; the person is told when more were found. */
const BATCH_LIMIT = 100;

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

/** B5: fetch the file as the browser would, with the person's cookies for that site. */
async function capture(href: string, kind: CaptureKind): Promise<Source> {
  const url = new URL(href);
  // The capture transport rule, decided before any request (operator, 2026-11-18; store review):
  // HTTPS, or plain HTTP only on this computer or the private network; never across the
  // internet, where the link (which may carry a key) and the person's sign-in would cross unencrypted.
  if (url.protocol !== "https:" && !isLocal(url.origin) && !isPrivateHost(url.hostname)
      && !(await resolvesPrivate(url.hostname))) throw new Refused("sendCaptureInsecure");
  if (!(await chrome.permissions.contains({origins: [`${url.origin}/*`]}))) throw new Refused("sendNoSiteAccess");
  let response: Response;
  try {
    // No redirect is followed: a browser does not show where one leads before following it, so a
    // redirect could carry the request (and the sign-in) to plain HTTP. One is refused instead.
    response = await fetch(url, {credentials: "include", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS)});
  } catch {
    throw new Refused("sendCaptureFailed");
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) throw new Refused("sendCaptureRedirect");
  if (!response.ok) throw new Refused("sendCaptureFailed");
  if (/^\s*(text\/html|application\/xhtml)/i.test(response.headers.get("Content-Type") ?? "")) {
    throw new Refused("sendCaptureWebPage");
  }
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > LIMITS[kind]) throw new Refused("sendTooLarge");
  const bytes = await bounded(response, LIMITS[kind]);
  if (!bytes.length) throw new Refused("sendCaptureFailed");
  // A newznab indexer answers a refusal with an <error> document and 200: that
  // is not the file. Anything else goes to DownloadPulse, which validates it.
  const head = new TextDecoder().decode(bytes.subarray(0, 65536));
  if (kind === "nzb" && isIndexerRefusal(head)) throw new Refused("sendCaptureFailed");
  const filename = capturedName(response.headers.get("Content-Disposition") ?? "", url.pathname, kind, head);
  const encoded = base64(bytes);
  return kind === "torrent" ? {kind, filename, torrent_base64: encoded}
    : kind === "nzb" ? {kind, filename, nzb_base64: encoded} : {kind, filename, metalink_base64: encoded};
}

/**
 * The body, read as it arrives and stopped past ``limit`` (review, 2026-11-19): a file with
 * no Content-Length is never buffered whole first, and a timeout mid-read is a capture failure.
 */
async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        void reader.cancel();
        throw new Refused("sendTooLarge");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused("sendCaptureFailed");
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
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
      // Only a real file name (it has an extension): a page's path (YouTube's
      // "watch") is no name, and DownloadPulse's own title is shown instead.
      const last = decodeURIComponent(new URL(source.links[0]!).pathname.split("/").pop() ?? "");
      return /\.[A-Za-z0-9]{1,8}$/.test(last) ? last : "";
    } catch {
      return "";
    }
  }
  return source.filename;
}

async function send(source: Source, cookies: Cookie[] = [], referrer = ""): Promise<void> {
  const connected = await connection();
  const browserToken = connected ? await token(connected.server) : null;
  if (!connected || !browserToken) throw new Refused("sendNotConnected");
  const {digest, key} = await keyFor(connected.server, source, cookies);
  const name = displayName(source);
  // A request that timed out or lost its connection may still have arrived: it is retried
  // once with the same key, so DownloadPulse answers the same job (review, 2026-11-19).
  const attempt = async (): Promise<Awaited<ReturnType<typeof submitJob>>> => {
    try {
      return await submitJob(connected.server, browserToken, key, source, name, cookies, referrer);
    } catch (error) {
      if (error instanceof ServerError && (error.failure === "unreachable" || error.failure === "certificate")) {
        return {ok: false, code: "unreachable", retryable: true};
      }
      // Something in front of DownloadPulse answered instead of it (review, 2026-11-19).
      if (error instanceof ServerError && error.failure === "blocked") throw new Refused("sendBlocked");
      throw error;
    }
  };
  let answer = await attempt();
  if (!answer.ok && answer.retryable) {
    // The same gesture, the same key: never a second download (B7).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    answer = await attempt();
  }
  if (answer.ok && answer.id) await keyAnswered(digest, answer.id);
  if (!answer.ok && answer.code === "unauthorized") await forgetConnection(true, connected.server);
  if (!answer.ok) throw new Refused(REFUSALS[answer.code] ?? "sendFailed");
  wake();
}

async function sourceFor(href: string): Promise<Source> {
  if (/^magnet:\?/i.test(href)) return {kind: "magnet", magnet: href};
  const kind = captureKind(href);
  return kind ? capture(href, kind) : {kind: "links", links: [href]};
}

export async function feedback(origin: Origin, key: string, ok: boolean): Promise<void> {
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

async function settle(origin: Origin, work: () => Promise<string | void>): Promise<void> {
  try {
    const said = await work();
    await feedback(origin, said || "sendDone", true);
  } catch (error) {
    await feedback(origin, error instanceof Refused ? error.key : "sendFailed", false);
  }
}

/** A link: right-click, the hover icon, the video button, the URL-bar icon (B1, B3, B4). */
/**
 * The connection may be used (connection.ts token(): agreed to, the transport rules met) --
 * checked before anything else happens, so no file is fetched from a site for a send that
 * cannot go anywhere (store review of cd9556b: a page's buttons may still be offered for a
 * few seconds after a connection is held). send() checks again before submitting.
 */
async function mayUseConnection(): Promise<void> {
  if (!(await token())) throw new Refused("sendNotConnected");
}

export function sendUrl(href: string, origin: Origin): Promise<void> {
  return settle(origin, async () => {
    // Only a web page or file (http, https) or a magnet is ever sent (review, 2026-11-19).
    if (!/^magnet:\?/i.test(href) && !/^https?:\/\//i.test(href)) throw new Refused("sendNothingFound");
    await mayUseConnection();
    await send(await sourceFor(href));
  });
}

/**
 * A video (the player's button; Firefox's URL-bar icon): its address -- the player's own, for an
 * embedded one -- with the person's sign-in on that site, unless switched off, and only to a
 * DownloadPulse that says it takes it (operator, 2026-11-19).
 */
export function sendVideo(href: string, origin: Origin, tab: chrome.tabs.Tab | undefined): Promise<void> {
  return settle(origin, async () => {
    if (!/^https?:\/\//i.test(href)) throw new Refused("sendNothingFound");
    await mayUseConnection();
    let cookies: Cookie[] = [];
    // Switched on, yet sent without them: said in the toast, never silently (review, 2026-11-19).
    let withoutSignIn = false;
    if ((await settings()).videoCookies) {
      const connected = await connection();
      const browserToken = connected ? await token(connected.server) : null;
      // A sign-in goes only over HTTPS or to this computer: never over plain HTTP, even to a
      // server on the person's network chosen on the plain-HTTP warning (review, 2026-11-19).
      try {
        if (!connected || !browserToken || !signInMayTravel(connected.server)
            || !(await readSession(connected.server, browserToken)).videoCookies) {
          withoutSignIn = true;
        } else {
          const found = await cookiesFor(href, tab);
          cookies = found.cookies;
          withoutSignIn = found.dropped;
        }
      } catch {
        withoutSignIn = true;   // its capabilities unknown: the video goes without
      }
    }
    await send({kind: "links", links: [href]}, cookies);
    return withoutSignIn ? "sendDoneWithoutSignIn" : undefined;
  });
}

/**
 * A browser download sent to DownloadPulse instead (1.0.2, background/capture.ts): its final
 * address, with the person's sign-in on that site and the page it was started from -- each only
 * when this DownloadPulse says it takes it, and the sign-in only over HTTPS or to this computer
 * (as a video's). Settles to whether DownloadPulse accepted it; never a toast in a page.
 */
export async function sendDownload(href: string, referrer: string, store: {cookieStoreId?: string | undefined}):
    Promise<{ok: boolean; said: string}> {
  try {
    if (!/^https?:\/\//i.test(href)) throw new Refused("sendNothingFound");
    await mayUseConnection();
    const connected = await connection();
    const browserToken = connected ? await token(connected.server) : null;
    if (!connected || !browserToken) throw new Refused("sendNotConnected");
    let capabilities = {videoCookies: false, referrer: false};
    try {
      capabilities = await readSession(connected.server, browserToken);
    } catch {
      // Its capabilities unknown: the link goes alone, as any link would.
    }
    // Exactly the cookies this browser would send to that address, from the download's own
    // cookie store (a Firefox container's); the page it started from names the partition.
    const found = await cookiesFor(href, {...(store.cookieStoreId ? {cookieStoreId: store.cookieStoreId} : {}),
      url: /^https?:\/\//i.test(referrer) ? referrer : undefined} as chrome.tabs.Tab);
    const travels = capabilities.videoCookies && signInMayTravel(connected.server);
    const cookies = travels ? found.cookies : [];
    // Said only when there was a sign-in that could not go with it: a public file needs none.
    const withoutSignIn = found.dropped || (!travels && found.cookies.length > 0);
    const page = capabilities.referrer && /^https?:\/\//i.test(referrer) && referrer.length <= 2048 ? referrer : "";
    await send({kind: "links", links: [href]}, cookies, page);
    return {ok: true, said: withoutSignIn ? "captureDoneWithoutSignIn" : "captureDone"};
  } catch (error) {
    return {ok: false, said: error instanceof Refused ? error.key : "sendFailed"};
  }
}

/** A selection: its http(s) URLs as one batch, each magnet on its own (B2). */
export function sendSelection(text: string, origin: Origin): Promise<void> {
  return settle(origin, () => sendText(text, "sendNothingFound"));
}

/**
 * Quick Add in the popup (operator, 2026-11-19): the typed or pasted text sent as a selection is,
 * its result answered to the popup (which shows it on its title row) instead of a toast.
 */
export async function quickAdd(text: string): Promise<{ok: boolean; text: string}> {
  try {
    const said = await sendText(text, "quickAddNothing");
    return {ok: true, text: message(said || "quickAddDone")};
  } catch (error) {
    return {ok: false, text: message(error instanceof Refused ? error.key : "sendFailed")};
  }
}

async function sendText(text: string, nothing: string): Promise<string | void> {
  {
    await mayUseConnection();
    const urls = extractUrls(text);
    if (!urls.length) throw new Refused(nothing);
    // Plain links go as one batch; a magnet, and a file DownloadPulse takes
    // as contents (captured), each on its own.
    const single = urls.filter((url) => /^magnet:\?/i.test(url) || captureKind(url));
    const plain = urls.filter((url) => !single.includes(url));
    const links = plain.slice(0, BATCH_LIMIT);
    if (links.length) await send({kind: "links", links});
    for (const url of single) await send(await sourceFor(url));
    // More plain links than one batch takes: the person is told, never a silent drop.
    return plain.length > BATCH_LIMIT ? "sendSelectionCapped" : undefined;
  }
}
