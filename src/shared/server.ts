// SPDX-License-Identifier: GPL-2.0-or-later
// The one DownloadPulse HTTP client (WS-E1 B8): every request omits
// credentials (a session cookie must never ride along with the browser
// token; DebridPulse BROWSER_CLIENT.md §4), has a timeout, and fails typed.

export const PROTOCOL = "debridpulse.browser/1";
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
const TIMEOUT_MS = 8000;
/** A submission carrying a captured file (up to ~21 MB as base64) gets longer than a plain request. */
export const UPLOAD_TIMEOUT_MS = 120_000;

export type Failure =
  | "unreachable" | "certificate" | "not_downloadpulse" | "too_old" | "denied" | "expired"
  | "permission" | "unauthorized" | "failed" | "https_only" | "insecure_refused" | "blocked";

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
  let response: Response;
  try {
    // No redirect is followed: DownloadPulse's API doesn't redirect, so one means something in
    // front of it (a sign-in page, a proxy): named for what it is (review, 2026-11-19).
    response = await fetch(origin + path, {
      ...init, credentials: "omit", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeout),
    });
  } catch {
    // A TLS failure and an unreachable host look the same to fetch; an https
    // origin is named for the certificate case too (WS-E1 B6, PLAN D7).
    throw new ServerError(origin.startsWith("https:") ? "certificate" : "unreachable");
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) throw new ServerError("blocked");
  return response;
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
  if (!response.ok) throw new ServerError("failed");
  const body = await json(response);
  if (body["protocol"] !== PROTOCOL || typeof body["device_code"] !== "string" || typeof body["user_code"] !== "string"
      || typeof body["verification_path"] !== "string") {
    throw new ServerError("too_old");
  }
  return {
    device_code: body["device_code"], user_code: body["user_code"], verification_path: body["verification_path"],
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
  /** Whether this DownloadPulse takes a video's cookies (its session's capabilities.cookies, for links). */
  videoCookies: boolean;
}

/** The server's own account of this token: how a pairing is verified (L19). */
export async function readSession(origin: string, token: string): Promise<Session> {
  const response = await request(origin, "/api/browser/v1/session", {headers: {Authorization: `Bearer ${token}`}});
  if (response.status === 401) throw new ServerError("unauthorized");
  if (response.status === 404) throw new ServerError("too_old");
  if (!response.ok) throw new ServerError("failed");
  const body = await json(response);
  const token_ = body["token"] as Record<string, unknown> | undefined;
  const account = body["account"] as Record<string, unknown> | undefined;
  if (body["protocol"] !== PROTOCOL || !token_ || !account) throw new ServerError("too_old");
  const capabilities = (body["capabilities"] ?? {}) as Record<string, unknown>;
  return {token: {id: String(token_["id"] ?? ""), label: String(token_["label"] ?? "")},
    account: {display_name: String(account["display_name"] ?? "")}, appearance: body["appearance"],
    // Only a DownloadPulse that says it takes a video's cookies (with links) is ever sent them.
    videoCookies: Array.isArray((capabilities["cookies"] as {sources?: unknown} | undefined)?.sources)
      && ((capabilities["cookies"] as {sources: unknown[]}).sources).includes("links")};
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
                                displayName = "", cookies: Cookie[] = []): Promise<Submitted> {
  const response = await request(origin, "/api/browser/v1/jobs", {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${browserToken}`},
    body: JSON.stringify({idempotency_key: key, source, ...(displayName ? {display_name: displayName.slice(0, 256)} : {}),
      ...(cookies.length ? {cookies} : {})}),
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
  if (response.status === 401) return {ok: false, code: "unauthorized", retryable: false};
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
  if (response.status === 401) throw new ServerError("unauthorized");
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
  if (response.status === 401) throw new ServerError("unauthorized");
  if (!response.ok) throw new ServerError("failed");
  const body = await json(response);
  return {disposition: String(body["disposition"] ?? ""), reason: String(body["reason"] ?? "")};
}

/** Remove: withdraw this browser's request. */
export async function withdrawJob(origin: string, browserToken: string, id: string): Promise<void> {
  const response = await request(origin, `/api/browser/v1/jobs/${encodeURIComponent(id)}/withdraw`, {
    method: "POST", headers: authorized(browserToken),
  });
  if (response.status === 401) throw new ServerError("unauthorized");
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
export async function disconnectBrowser(origin: string, browserToken: string): Promise<void> {
  const response = await request(origin, "/api/browser/v1/session", {method: "DELETE", headers: authorized(browserToken)});
  if (!response.ok && response.status !== 401) throw new ServerError("failed");
}
