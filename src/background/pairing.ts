// SPDX-License-Identifier: GPL-2.0-or-later
// The pairing flow (WS-E1 B2-B6), in the background: the popup closes as soon
// as the approval tab opens, so everything after the person's click runs
// here, and the popup only renders what is stored (src/shared/connection.ts).
//
// While waiting for approval the toolbar badge is updated on every poll: it
// shows the state, and an extension API call keeps the background alive
// where a fetch alone does not (spike S2).

import {deviceCode, saveConnection, setPairing} from "../shared/connection";
import {message} from "../shared/i18n";
import {
  LOCAL_ORIGINS, ServerError, candidateOrigins, pollPairing, probe, readSession, startPairing,
  type Failure,
} from "../shared/server";

let active = 0;   // the generation of the pairing in progress; a newer one or Cancel ends an older loop

async function badge(text: string): Promise<void> {
  await chrome.action.setBadgeText({text});
}

async function fail(failure: Failure, generation: number): Promise<void> {
  if (generation !== active) return;
  await setPairing({state: "failed", failure});
  await badge("");
}

/** The browser's own name for this connection, for example "Firefox on Linux". */
export async function clientName(): Promise<string> {
  const platform = await chrome.runtime.getPlatformInfo();
  const system = ({mac: "macOS", win: "Windows", linux: "Linux", cros: "ChromeOS", android: "Android",
    openbsd: "OpenBSD", fuchsia: "Fuchsia"} as Record<string, string>)[platform.os] ?? platform.os;
  return message("pairingClientName", [browserName(), system]) || `${browserName()} on ${system}`;
}

function browserName(): string {
  const agent = navigator.userAgent;
  if (/Firefox\//.test(agent)) return "Firefox";
  const brands = (navigator as Navigator & {userAgentData?: {brands?: {brand: string}[]}}).userAgentData?.brands ?? [];
  const named = brands.map((item) => item.brand).find((brand) => !/Chromium|Not.?A.?Brand/i.test(brand));
  return named?.replace(/^Google /, "") || "Chromium";
}

/** B2: look for a DownloadPulse on this computer, then pair with it. */
export async function connectLocal(): Promise<void> {
  const generation = ++active;
  await setPairing({state: "probing"});
  for (const origin of LOCAL_ORIGINS) {
    if (await probe(origin) === "downloadpulse") {
      await pair(origin, generation);
      return;
    }
  }
  if (generation === active) await setPairing({state: "not_found"});
}

/** B3: a server the person named (its origin access already granted by the popup). */
export async function connectRemote(address: string): Promise<void> {
  const generation = ++active;
  await setPairing({state: "probing"});
  const origins = candidateOrigins(address);
  if (!origins.length) return fail("unreachable", generation);
  // The most specific reason any candidate gave: something that is not
  // DownloadPulse beats a certificate failure beats nothing reachable.
  const rank = {unreachable: 0, certificate: 1, not_downloadpulse: 2} as const;
  let reason: keyof typeof rank = "unreachable";
  let reached: string | null = null;
  for (const origin of origins) {
    const found = await probe(origin);
    if (found === "downloadpulse") {
      reached = origin;
      break;
    }
    if (rank[found] > rank[reason]) reason = found;
  }
  if (!reached) return fail(reason, generation);
  await pair(reached, generation);
}

export async function cancel(): Promise<void> {
  active += 1;
  await setPairing(null);
  await badge("");
}

async function pair(origin: string, generation: number): Promise<void> {
  try {
    const started = await startPairing(origin, await clientName());
    if (generation !== active) return;
    const expiresAt = Date.now() + started.expires_in * 1000;
    await setPairing({state: "waiting", server: origin, userCode: started.user_code, expiresAt}, started.device_code);
    await chrome.tabs.create({url: origin + started.verification_path});
    await waitForApproval(origin, started.interval, expiresAt, generation);
  } catch (error) {
    await fail(error instanceof ServerError ? error.failure : "failed", generation);
  }
}

async function waitForApproval(origin: string, interval: number, expiresAt: number, generation: number): Promise<void> {
  let pace = interval;
  let tick = 0;
  while (generation === active && Date.now() < expiresAt) {
    await badge(["·", "··", "···"][tick++ % 3]!);
    await new Promise((resolve) => setTimeout(resolve, pace * 1000));
    if (generation !== active) return;
    const code = await deviceCode();
    if (!code) return fail("expired", generation);
    const answer = await pollPairing(origin, code);
    if (answer.status !== "approved") {
      if (answer.status === "denied" || answer.status === "expired") return fail(answer.status, generation);
      if (answer.status === "slow_down") pace += 1;
      continue;
    }
    const session = await readSession(origin, answer.token);
    if (generation !== active) return;
    await saveConnection({server: origin, token: answer.token, tokenId: session.token.id,
      label: session.token.label, account: session.account.display_name});
    await setPairing(null);
    await badge("");
    return;
  }
  if (generation === active) await fail("expired", generation);
}
