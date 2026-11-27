// SPDX-License-Identifier: GPL-2.0-or-later
// The one DownloadPulse HTTP client (WS-E1 B8): every request omits
// credentials (a session cookie must never ride along with the browser
// token; DebridPulse BROWSER_CLIENT.md §4), has a timeout, and fails typed.

import {freshNonce, identityProof, knownIdentity, rememberIdentity} from "./identity";

// The pairing protocol, by the name the server gives it: DownloadPulse 1.0.0
// names it downloadpulse.browser/1; the same protocol was debridpulse.browser/1
// before the rename (1.0.14). Either is this extension's protocol.
export const PROTOCOLS: readonly string[] = ["downloadpulse.browser/1", "debridpulse.browser/1"];
const speaks = (protocol: unknown): boolean => typeof protocol === "string" && PROTOCOLS.includes(protocol);
export const LOCAL_ORIGINS = ["http://127.0.0.1:8095", "http://localhost:8095"] as const;

/** DownloadPulse on this computer: a loopback origin (the desktop application, or a local install). */
export function isLocal(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    // All of 127.0.0.0/8 is this computer, not only 127.0.0.1 (review, 2026-11-19).
    return host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}

/**
 * Whether a video's sign-in (its site's cookies) may be sent to the DownloadPulse at ``origin``:
 * only over HTTPS or to this computer, never over plain HTTP -- not even to a server on the
 * person's network chosen on the plain-HTTP warning (review, 2026-11-19).
 */
export function signInMayTravel(origin: string): boolean {
  try {
    return new URL(origin).protocol === "https:" || isLocal(origin);
  } catch {
    return false;
  }
}
const TIMEOUT_MS = 8000;
/** A submission carrying a captured file (up to ~21 MB as base64) gets longer than a plain request. */
export const UPLOAD_TIMEOUT_MS = 120_000;

export type Failure =
  | "unreachable" | "certificate" | "not_downloadpulse" | "too_old" | "denied" | "expired"
  | "permission" | "unauthorized" | "failed" | "https_only" | "insecure_refused" | "blocked" | "setup_incomplete"
  // This browser is connected to as many servers as it may be (WS-X1).
  | "too_many";

export class ServerError extends Error {
  constructor(public readonly failure: Failure, message = failure) {
    super(message);
  }
}

/**
 * How a server is reached (store review, 2026-11-18): DownloadPulse on this
 * computer over plain HTTP; any other server over HTTPS; plain HTTP to another
 * server only as the person's deliberate choice, and only on a private network
 * (the connection key and downloads would cross it unencrypted); never plain
 * HTTP across the internet. Nothing falls back from HTTPS to HTTP silently.
 */
export type Transport = "local" | "https" | "lan-http" | "public-http";

export interface ServerAddress { origin: string; transport: Transport; schemeGiven: boolean; privateHost: boolean }

/** A host on a private network: RFC 1918 and link-local addresses, IPv6 unique-local and link-local, local names. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    // 100.64.0.0/10: Tailscale's addresses, counted as the person's network (operator, 2026-11-19).
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(":")) return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  return !host.includes(".") || /\.(local|lan|home\.arpa|internal|localdomain|ts\.net)$/.test(host);
}

/**
 * 100.64.0.0/10: Tailscale's addresses, which count as the person's network (isPrivateHost) -- but
 * carrier-grade NAT uses the same range for networks an internet provider shares among its
 * customers, so plain HTTP there is warned about separately (1.0.3, review 2026-11-22).
 */
export function isSharedAddressRange(hostname: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname.replace(/^\[|\]$/g, ""));
  return Boolean(v4 && Number(v4[1]) === 100 && Number(v4[2]) >= 64 && Number(v4[2]) <= 127);
}

/** An address (as DNS answers it) on this computer or the private network. */
function privateAddress(address: string): boolean {
  const host = address.toLowerCase();
  if (host === "::1" || /^127\./.test(host)) return true;
  return (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) && isPrivateHost(host);
}

/**
 * Split DNS (operator, 2026-11-19): a name that looks like an internet name but
 * resolves only to private addresses (``nas.home.example.com``) counts as the
 * private network. Firefox only: Chromium gives an extension no DNS lookup, so
 * there such a name stays HTTPS-only. Every address must be private.
 */
export async function resolvesPrivate(hostname: string): Promise<boolean> {
  const dns = (globalThis as unknown as {browser?: {dns?: {resolve(host: string): Promise<{addresses: string[]}>}}}).browser?.dns;
  if (!dns) return false;
  try {
    const {addresses} = await dns.resolve(hostname.replace(/^\[|\]$/g, ""));
    return addresses.length > 0 && addresses.every(privateAddress);
  } catch {
    return false;
  }
}

/**
 * A server address as the person typed it: its origin (no path, query or
 * credentials) and how it would be reached. No scheme: this computer over
 * HTTP, any other host over HTTPS only. Empty or malformed: null.
 */
export function serverAddress(input: string): ServerAddress | null {
  const text = input.trim();
  if (!text) return null;
  const schemeGiven = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url: URL;
  try {
    url = new URL(schemeGiven ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return null;
  const local = isLocal(url.origin);
  if (local && !schemeGiven) url = new URL(`http://${url.host}`);
  const privateHost = isPrivateHost(url.hostname);
  const transport: Transport = local ? "local" : url.protocol === "https:" ? "https" : privateHost ? "lan-http" : "public-http";
  return {origin: url.origin, transport, schemeGiven, privateHost};
}

/** serverAddress, with a split-DNS name resolving only to private addresses counted as the private network. */
export async function effectiveAddress(input: string): Promise<ServerAddress | null> {
  const address = serverAddress(input);
  if (address?.transport !== "public-http" || !(await resolvesPrivate(new URL(address.origin).hostname))) return address;
  return {...address, transport: "lan-http", privateHost: true};
}

async function request(origin: string, path: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<Response> {
  // Never plain HTTP across the internet, whatever asked (the transport rule's last guard).
  if ((await effectiveAddress(origin))?.transport === "public-http") throw new ServerError("insecure_refused");
  // The token goes only to a server proven to be the one that issued it, once it said it proves
  // itself (identity.ts, 1.0.8): every request that carries a token comes through here.
  const bearer = /^Bearer (.+)$/.exec((init.headers as Record<string, string> | undefined)?.["Authorization"] ?? "")?.[1];
  if (bearer) await proveIdentity(origin, bearer);
  let response: Response;
  try {
    // No redirect is followed: DownloadPulse's API doesn't redirect, so one means something in
    // front of it (a sign-in page, a proxy): named for what it is (review, 2026-11-19).
    response = await fetch(origin + path, {
      ...init, credentials: "omit", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeout),
    });
  } catch {
    // Not reached: whatever answers next may be something else, so it proves itself again.
    forgetProofs(origin);
    // A TLS failure and an unreachable host look the same to fetch; an https
    // origin is named for the certificate case too (WS-E1 B6, PLAN D7).
    throw new ServerError(origin.startsWith("https:") ? "certificate" : "unreachable");
  }
  if (response.status >= 500) forgetProofs(origin);
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    forgetProofs(origin);
    throw new ServerError("blocked");
  }
  return response;
}

/** How long a server's proof stands for the requests that follow it (a sign-in is always proven anew). */
const PROOF_MS = 30_000;
const IDENTITY_PATH = "/api/browser/v1/identity";

/** Proofs this background has seen, by server and token digest: when, and the check itself (shared while it runs). */
const proven = new Map<string, {at: number; check: Promise<void>}>();

function forgetProofs(origin: string): void {
  for (const key of proven.keys()) if (key.startsWith(`${origin} `)) proven.delete(key);
}

/**
 * Before ``browserToken`` goes to ``origin``: when that server said it proves its identity
 * (identity.ts), it proves it now -- or did within PROOF_MS, with no failed request since; with
 * ``fresh``, now whatever it did before (a send carrying a sign-in). A proof that fails sends
 * nothing: the server counts as unreachable. Answers whether the server proved itself (false: it
 * never said it does, as DownloadPulse before 1.0.8, and the token goes as it always did).
 */
export async function proveIdentity(origin: string, browserToken: string, fresh = false): Promise<boolean> {
  const known = await knownIdentity(origin, browserToken);
  if (!known) return false;
  const key = `${origin} ${known.digest}`;
  const kept = proven.get(key);
  if (!fresh && kept && Date.now() - kept.at < PROOF_MS) {
    await kept.check;
    return true;
  }
  const check = challenge(origin, known.tokenId, browserToken);
  proven.set(key, {at: Date.now(), check});
  try {
    await check;
  } catch (error) {
    if (proven.get(key)?.check === check) proven.delete(key);
    throw error;
  }
  return true;
}

/** One identity check: a fresh nonce, no credential; anything but the right proof is refused. */
async function challenge(origin: string, tokenId: string, browserToken: string): Promise<void> {
  const nonce = freshNonce();
  const response = await request(origin, IDENTITY_PATH, {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({token_id: tokenId, nonce, origin}),
  });
  // A sign-in demanded in front of it (an Authelia and the like) is named so, as for any request.
  if ([401, 403, 407].includes(response.status)) throw new ServerError("blocked");
  let proof: unknown;
  try {
    proof = response.ok ? (await json(response))["proof"] : undefined;
  } catch {
    proof = undefined;
  }
  if (typeof proof !== "string" || proof !== (await identityProof(browserToken, nonce, origin))) {
    throw new ServerError("unreachable");
  }
}

/**
 * The approval page for a pairing: ``verificationPath`` on ``origin`` itself, never another site
 * (1.0.8, EXT-3: ``@evil.example/x`` appended to the origin would name evil.example). Exactly one
 * leading slash, and the same origin once resolved; else null.
 */
export function approvalUrl(origin: string, verificationPath: string): string | null {
  if (!/^\/(?![/\\])/.test(verificationPath)) return null;
  try {
    const url = new URL(verificationPath, origin);
    return url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A refusal of the token by DownloadPulse itself -- its 401 names its own code -- as opposed to
 * a 401 from something in front of it (an Authelia or other sign-in proxy), which says nothing
 * about the token (1.0.3, review 2026-11-22: such a 401 forgot a token the server still held).
 * Only DownloadPulse's own refusal disconnects; anything else is "blocked", as a redirect is.
 */
async function tokenRefused(response: Response): Promise<ServerError> {
  try {
    const body: unknown = await response.json();
    if ((body as {code?: unknown} | null)?.code === "auth.unauthorized") return new ServerError("unauthorized");
  } catch {
    // not DownloadPulse's JSON
  }
  return new ServerError("blocked");
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    throw new ServerError("not_downloadpulse");
  }
}

/**
 * What answers at ``origin``: DownloadPulse (its health endpoint says so),
 * something else, or nothing reachable (``unreachable`` / ``certificate``).
 */
export async function probe(origin: string): Promise<"downloadpulse" | "not_downloadpulse" | "unreachable" | "certificate" | "blocked"> {
  let response: Response;
  try {
    response = await request(origin, "/api/health");
  } catch (error) {
    if (error instanceof ServerError && (error.failure === "certificate" || error.failure === "blocked")) return error.failure;
    return "unreachable";
  }
  // DownloadPulse's health answers anyone: a sign-in demanded for it is something in front of it.
  if ([401, 403, 407].includes(response.status)) return "blocked";
  try {
    const body = response.ok ? await json(response) : {};
    return body["status"] === "ok" && typeof body["version"] === "string" ? "downloadpulse" : "not_downloadpulse";
  } catch {
    return "not_downloadpulse";
  }
}

export interface PairingStart {
  device_code: string;
  user_code: string;
  verification_path: string;
  /** ``verification_path`` on this server (approvalUrl): the page the approval tab opens. */
  approval_url: string;
  expires_in: number;
  interval: number;
}

export async function startPairing(origin: string, clientName: string): Promise<PairingStart> {
  const response = await request(origin, "/api/browser/v1/pairings", {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({client_name: clientName}),
  });
  // A current DownloadPulse admits this request from an extension, with no
  // credential. An older one refuses it before any route: Forbidden origin
  // (403), sign-in required (401), or no such route (404/405).
  if ([401, 403, 404, 405].includes(response.status)) throw new ServerError("too_old");
  if (!response.ok) {
    // A new DownloadPulse whose setup is not finished yet says so by its refusal's code.
    const refusal: unknown = await response.json().catch(() => null);
    if (refusal && typeof refusal === "object"
        && (refusal as Record<string, unknown>)["code"] === "browser.pairing.setup_incomplete") {
      throw new ServerError("setup_incomplete");
    }
    throw new ServerError("failed");
  }
  const body = await json(response);
  if (!speaks(body["protocol"]) || typeof body["device_code"] !== "string" || typeof body["user_code"] !== "string"
      || typeof body["verification_path"] !== "string") {
    throw new ServerError("too_old");
  }
  // An approval page anywhere but on this server is refused, and the pairing with it.
  const approval = approvalUrl(origin, body["verification_path"]);
  if (!approval) throw new ServerError("failed");
  return {
    device_code: body["device_code"], user_code: body["user_code"], verification_path: body["verification_path"],
    approval_url: approval,
    expires_in: Number(body["expires_in"]) || 600, interval: Math.max(2, Number(body["interval"]) || 2),
  };
}

export type PollAnswer =
  | {status: "pending" | "slow_down" | "denied" | "expired"}
  | {status: "approved"; token: string; token_id: string; label: string};

export async function pollPairing(origin: string, deviceCode: string): Promise<PollAnswer> {
  const response = await request(origin, "/api/browser/v1/pairings/poll", {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({device_code: deviceCode}),
  });
  if (!response.ok) throw new ServerError("failed");
  const body = await json(response);
  const status = body["status"];
  if (status === "approved" && typeof body["token"] === "string") {
    return {status, token: body["token"], token_id: String(body["token_id"] ?? ""), label: String(body["label"] ?? "")};
  }
  if (status === "pending" || status === "slow_down" || status === "denied" || status === "expired") return {status};
  throw new ServerError("failed");
}

export interface Session {
  token: {id: string; label: string};
  account: {display_name: string};
  /** The person's appearance, by palette ID (a current DownloadPulse; absent from an older one). */
  appearance?: unknown;
  /** Whether this DownloadPulse takes the links' cookies (its session's capabilities.cookies, for links). */
  videoCookies: boolean;
  /** Whether this DownloadPulse takes the page a link came from (capabilities.referrer, for links; 1.0.2). */
  referrer: boolean;
}

/** The server's own account of this token: how a pairing is verified (L19). */
export async function readSession(origin: string, token: string): Promise<Session> {
  const response = await request(origin, "/api/browser/v1/session", {headers: {Authorization: `Bearer ${token}`}});
  if (response.status === 401) throw await tokenRefused(response);
  if (response.status === 404) throw new ServerError("too_old");
  if (!response.ok) throw new ServerError("failed");
  const body = await json(response);
  const token_ = body["token"] as Record<string, unknown> | undefined;
  const account = body["account"] as Record<string, unknown> | undefined;
  if (!speaks(body["protocol"]) || !token_ || !account) throw new ServerError("too_old");
  const capabilities = (body["capabilities"] ?? {}) as Record<string, unknown>;
  const tokenId = String(token_["id"] ?? "");
  // A DownloadPulse that proves its identity (1.0.8) is asked to before this token goes to it again.
  const identity = Number(capabilities["identity"]) >= 1 && Boolean(tokenId);
  await rememberIdentity(origin, token, identity ? tokenId : null);
  return {token: {id: tokenId, label: String(token_["label"] ?? "")},
    account: {display_name: String(account["display_name"] ?? "")}, appearance: body["appearance"],
    // Only a DownloadPulse that says it takes the links' cookies (or referrer) is ever sent them:
    // an older one refuses a field it does not know. A sign-in goes to DownloadPulse on this
    // computer only when it proves its identity (1.0.8): anything else may be listening there.
    videoCookies: takesForLinks(capabilities["cookies"]) && (identity || !isLocal(origin)),
    referrer: takesForLinks(capabilities["referrer"])};
}

function takesForLinks(capability: unknown): boolean {
  const sources = (capability as {sources?: unknown} | undefined)?.sources;
  return Array.isArray(sources) && sources.includes("links");
}

/** One cookie as DownloadPulse takes it for a video (DebridPulse BROWSER_CLIENT.md, video sign-in). */
export interface Cookie {
  name: string; value: string; domain: string; path: string;
  secure: boolean; http_only: boolean; host_only: boolean;
  /** Unix seconds; null for a session cookie. */
  expires: number | null;
}

export type Source =
  | {kind: "links"; links: string[]}
  | {kind: "magnet"; magnet: string}
  | {kind: "torrent"; filename: string; torrent_base64: string}
  | {kind: "nzb"; filename: string; nzb_base64: string}
  | {kind: "metalink"; filename: string; metalink_base64: string};

/** The server's answer to a submission: accepted, or refused with its code. */
export type Submitted = {ok: true; id: string} | {ok: false; code: string; retryable: boolean};

/** One submission under one idempotency key (DebridPulse BROWSER_CLIENT.md §2a). */
export async function submitJob(origin: string, browserToken: string, key: string, source: Source,
                                displayName = "", cookies: Cookie[] = [], referrer = ""): Promise<Submitted> {
  // A sign-in goes only to a server that proves its identity now, if it ever said it does; and to
  // DownloadPulse on this computer only when it does (1.0.8): never to whatever else may listen there.
  if (cookies.length && !(await proveIdentity(origin, browserToken, true)) && isLocal(origin)) cookies = [];
  const response = await request(origin, "/api/browser/v1/jobs", {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${browserToken}`},
    body: JSON.stringify({idempotency_key: key, source, ...(displayName ? {display_name: displayName.slice(0, 256)} : {}),
      ...(cookies.length ? {cookies} : {}), ...(referrer ? {referrer} : {})}),
  }, source.kind === "links" || source.kind === "magnet" ? TIMEOUT_MS : UPLOAD_TIMEOUT_MS);
  if (response.ok) {
    let id = "";
    try {
      const body = (await response.json()) as {id?: unknown};
      id = typeof body.id === "string" ? body.id : "";
    } catch {
      id = "";
    }
    return {ok: true, id};
  }
  if (response.status === 401) {
    const refused = await tokenRefused(response);
    if (refused.failure !== "unauthorized") throw refused;
    return {ok: false, code: "unauthorized", retryable: false};
  }
  // Too large for DownloadPulse, or for something in front of it, whatever the body (1.0.8,
  // WS-A11): a request-size cap answers 413 with no refusal code of DownloadPulse's own.
  if (response.status === 413) return {ok: false, code: "source_too_large", retryable: false};
  let detail: Record<string, unknown> = {};
  try {
    detail = ((await response.json()) as {detail?: Record<string, unknown>}).detail ?? {};
  } catch {
    // no structured refusal
  }
  return {ok: false, code: typeof detail["code"] === "string" ? detail["code"] : "failed",
    retryable: detail["retryable"] === true};
}

/** One of this browser's downloads, as DebridPulse reports it (BROWSER_CLIENT.md §2a). */
export interface Job {
  id: string;
  cursor: number;
  submitted_at: string | null;
  display_name: string;
  /** The transfer's title as DownloadPulse shows it (its Downloads list's own), once known. */
  name?: string | null;
  source: Record<string, unknown>;
  phase: "accepted" | "queued" | "processing" | "completed" | "failed" | "withdrawn";
  reason: string | null;
  actionability: string;
  paused_by: string | null;
  progress: {percent?: number | null; effective?: {percent?: number | null} | null} | null;
  estimate: {seconds: number | null; indeterminate: boolean} | null;
}

export interface Listing { jobs: Job[]; next_cursor: number; more: boolean }

function authorized(browserToken: string): Record<string, string> {
  return {Authorization: `Bearer ${browserToken}`};
}

/** This browser's jobs changed after ``after`` (the change cursor). */
export async function listJobs(origin: string, browserToken: string, after: number): Promise<Listing> {
  const response = await request(origin, `/api/browser/v1/jobs?after=${Math.max(0, Math.floor(after))}&limit=100`,
    {headers: authorized(browserToken)});
  if (response.status === 401) throw await tokenRefused(response);
  if (!response.ok) throw new ServerError("failed");
  const body = await json(response);
  return {jobs: Array.isArray(body["jobs"]) ? body["jobs"] as Job[] : [],
    next_cursor: Number(body["next_cursor"]) || after, more: body["more"] === true};
}

/** An advisory pause/resume, and DebridPulse's decision on it. */
export async function controlJob(origin: string, browserToken: string, id: string,
                                 kind: "pause" | "resume"): Promise<{disposition: string; reason: string}> {
  const response = await request(origin, `/api/browser/v1/jobs/${encodeURIComponent(id)}/controls`, {
    method: "POST", headers: {...authorized(browserToken), "Content-Type": "application/json"},
    body: JSON.stringify({kind, request_key: crypto.randomUUID()}),
  });
  if (response.status === 401) throw await tokenRefused(response);
  if (!response.ok) throw new ServerError("failed");
  const body = await json(response);
  return {disposition: String(body["disposition"] ?? ""), reason: String(body["reason"] ?? "")};
}

/** Remove: withdraw this browser's request. */
export async function withdrawJob(origin: string, browserToken: string, id: string): Promise<void> {
  const response = await request(origin, `/api/browser/v1/jobs/${encodeURIComponent(id)}/withdraw`, {
    method: "POST", headers: authorized(browserToken),
  });
  if (response.status === 401) throw await tokenRefused(response);
  if (!response.ok) throw new ServerError("failed");
}

/**
 * Open DownloadPulse, for the installed desktop application: it brings its
 * own window forward. True when it will; false for a server (it has no
 * window), an older DownloadPulse, or any failure -- the page is opened instead.
 */
export async function showApplication(origin: string, browserToken: string): Promise<boolean> {
  try {
    const response = await request(origin, "/api/browser/v1/application/show", {method: "POST", headers: authorized(browserToken)});
    return response.ok && (await json(response))["desktop"] === true;
  } catch {
    return false;
  }
}

/** The extension's Disconnect: this browser's token revokes itself on the server. */
/**
 * This browser's access revoked on the server (Disconnect): ``revoked``, or ``already`` when
 * DownloadPulse itself refuses the token (removed there before). Anything else -- no answer, a
 * time-out, a certificate error, something in front of DownloadPulse answering, a server error --
 * throws: nothing is known to be revoked (WS-X1: the person then chooses what happens).
 */
export async function disconnectBrowser(origin: string, browserToken: string): Promise<"revoked" | "already"> {
  const response = await request(origin, "/api/browser/v1/session", {method: "DELETE", headers: authorized(browserToken)});
  if (response.status === 401) {
    const refused = await tokenRefused(response);
    if (refused.failure === "unauthorized") return "already";
    throw refused;
  }
  // DownloadPulse's own refusal that this browser is not there (since 1.0.0, code
  // account.browser_token_not_found): already removed there. Any other 404 -- a proxy's page, another
  // JSON service, a framework's generic "Not Found" -- says nothing about this browser.
  if (response.status === 404) {
    const body = await response.json().catch(() => null);
    if ((body as {code?: unknown} | null)?.code === "account.browser_token_not_found") return "already";
    throw new ServerError("failed");
  }
  if (!response.ok) throw new ServerError("failed");
  return "revoked";
}
