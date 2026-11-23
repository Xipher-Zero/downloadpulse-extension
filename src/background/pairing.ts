// SPDX-License-Identifier: GPL-2.0-or-later
// The pairing flow (WS-E1 B2-B6), in the background: the popup closes as soon
// as the approval tab opens, so everything after the person's click runs
// here, and the popup only renders what is stored (src/shared/connection.ts).
//
// While waiting for approval the toolbar badge is updated on every poll: it
// shows the state, and an extension API call keeps the background alive
// where a fetch alone does not (spike S2).

import {saveAppearance} from "../shared/appearance";
import {consented, deviceNameAllowed} from "../shared/consent";
import {deviceCode, saveConnection, setPairing} from "../shared/connection";
import {settings} from "../shared/settings";
import {message} from "../shared/i18n";
import {
  LOCAL_ORIGINS, ServerError, effectiveAddress, pollPairing, probe, readSession, startPairing,
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
  // The browser and system only with the person's optional consent (the disclosure page; in
  // Firefox, its technical-data consent too); else a neutral name, renamed in DownloadPulse.
  if (!(await deviceNameAllowed())) return message("pairingClientGeneric") || "Browser";
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

/**
 * B2: look for a DownloadPulse on this computer. One found is offered, not
 * paired: the person chooses it or a different DownloadPulse (operator,
 * 2026-11-18).
 */
export async function connectLocal(): Promise<void> {
  if (!(await consented())) return;
  const generation = ++active;
  await setPairing({state: "probing"});
  for (const origin of LOCAL_ORIGINS) {
    if (await probe(origin) === "downloadpulse") {
      if (generation === active) await setPairing({state: "found", server: origin});
      return;
    }
  }
  if (generation === active) await setPairing({state: "not_found"});
}

/** The person chose the DownloadPulse found on this computer. */
export async function pairLocal(origin: string): Promise<void> {
  if (!(LOCAL_ORIGINS as readonly string[]).includes(origin)) return;
  const generation = ++active;
  await setPairing({state: "probing"});
  await pair(origin, generation);
}

/** B3: a server the person named (its origin access already granted by the popup). */
export async function connectRemote(address: string, insecure = false): Promise<void> {
  if (!(await consented())) return;
  const generation = ++active;
  await setPairing({state: "probing"});
  const target = await effectiveAddress(address);
  if (!target) return fail("unreachable", generation);
  // Plain HTTP: never across the internet; on a private network only once the person chose it.
  if (target.transport === "public-http" || (target.transport === "lan-http" && !insecure)) {
    return fail("insecure_refused", generation);
  }
  const found = await probe(target.origin);
  if (found !== "downloadpulse") {
    // A private-network address typed without a scheme was tried over HTTPS only: say how to choose HTTP.
    if (found !== "not_downloadpulse" && !target.schemeGiven && target.privateHost && target.transport === "https") {
      return fail("https_only", generation);
    }
    return fail(found, generation);
  }
  await pair(target.origin, generation, target.transport === "lan-http");
}

export async function cancel(): Promise<void> {
  active += 1;
  await setPairing(null);
  await badge("");
}

async function pair(origin: string, generation: number, plainHttp = false): Promise<void> {
  try {
    const started = await startPairing(origin, await clientName());
    if (generation !== active) return;
    const expiresAt = Date.now() + started.expires_in * 1000;
    await setPairing({state: "waiting", server: origin, userCode: started.user_code, expiresAt}, started.device_code);
    await chrome.tabs.create({url: origin + started.verification_path});
    await waitForApproval(origin, started.interval, expiresAt, generation, plainHttp);
  } catch (error) {
    await fail(error instanceof ServerError ? error.failure : "failed", generation);
  }
}

async function waitForApproval(origin: string, interval: number, expiresAt: number, generation: number,
                               plainHttp: boolean): Promise<void> {
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
    await saveConnection({server: origin, tokenId: session.token.id, label: session.token.label,
      account: session.account.display_name, ...(plainHttp ? {plainHttp: true} : {})}, answer.token);
    await saveAppearance(session.appearance);
    // Newly connected: browser downloads to DownloadPulse are offered once (popup capture-offer),
    // unless the person already chose either way.
    const chosen = await settings();
    if (!chosen.capture && !chosen.captureAsked) await chrome.storage.local.set({captureOffer: true});
    await setPairing(null);
    await badge("");
    return;
  }
  if (generation === active) await fail("expired", generation);
}
