// SPDX-License-Identifier: GPL-2.0-or-later
// The one DownloadPulse HTTP client (WS-E1 B8): every request omits
// credentials (a session cookie must never ride along with the browser
// token; DebridPulse BROWSER_CLIENT.md §4), has a timeout, and fails typed.

export const PROTOCOL = "debridpulse.browser/1";
export const LOCAL_ORIGINS = ["http://127.0.0.1:8095", "http://localhost:8095"] as const;
const TIMEOUT_MS = 8000;

export type Failure =
  | "unreachable" | "certificate" | "not_downloadpulse" | "too_old" | "denied" | "expired"
  | "permission" | "unauthorized" | "failed";

export class ServerError extends Error {
  constructor(public readonly failure: Failure, message = failure) {
    super(message);
  }
}

/**
 * A server address as the person typed it, as candidate origins in the order to
 * try: a scheme given is kept; none means https, then http. Only an origin is
 * kept (no path, query or credentials). Empty or malformed: [].
 */
export function candidateOrigins(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  const schemes = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? [""] : ["https://", "http://"];
  const origins: string[] = [];
  for (const scheme of schemes) {
    try {
      const url = new URL(scheme + text);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname && !url.username && !url.password) {
        origins.push(url.origin);
      }
    } catch {
      // not a URL with this scheme
    }
  }
  return origins;
}

async function request(origin: string, path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(origin + path, {
      ...init, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // A TLS failure and an unreachable host look the same to fetch; an https
    // origin is named for the certificate case too (WS-E1 B6, PLAN D7).
    throw new ServerError(origin.startsWith("https:") ? "certificate" : "unreachable");
  }
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
export async function probe(origin: string): Promise<"downloadpulse" | "not_downloadpulse" | "unreachable" | "certificate"> {
  let response: Response;
  try {
    response = await request(origin, "/api/health");
  } catch (error) {
    return error instanceof ServerError && error.failure === "certificate" ? "certificate" : "unreachable";
  }
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
  if (response.status === 404 || response.status === 405) throw new ServerError("too_old");
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
  return {token: {id: String(token_["id"] ?? ""), label: String(token_["label"] ?? "")},
    account: {display_name: String(account["display_name"] ?? "")}};
}

export type Source =
  | {kind: "links"; links: string[]}
  | {kind: "magnet"; magnet: string}
  | {kind: "torrent"; filename: string; torrent_base64: string}
  | {kind: "nzb"; filename: string; nzb_base64: string}
  | {kind: "metalink"; filename: string; metalink_base64: string};

/** The server's answer to a submission: accepted, or refused with its code. */
export type Submitted = {ok: true} | {ok: false; code: string; retryable: boolean};

/** One submission under one idempotency key (DebridPulse BROWSER_CLIENT.md §2a). */
export async function submitJob(origin: string, browserToken: string, key: string, source: Source,
                                displayName = ""): Promise<Submitted> {
  const response = await request(origin, "/api/browser/v1/jobs", {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${browserToken}`},
    body: JSON.stringify({idempotency_key: key, source, ...(displayName ? {display_name: displayName.slice(0, 256)} : {})}),
  });
  if (response.ok) return {ok: true};
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
