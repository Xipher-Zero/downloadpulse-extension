// SPDX-License-Identifier: GPL-2.0-or-later
// The person's agreement to what this browser sends to DownloadPulse (the
// disclosure page; store review, 2026-11-18): recorded before any pairing, and
// asked again whenever the disclosure changes (CONSENT_VERSION). Not a secret.

// 2: a video goes with the person's sign-in on its site (operator, 2026-11-19).
// 3: browser downloads sent to DownloadPulse, with the page each came from (1.0.2's
//    discloseDownloads, never asked again until now; review 2026-11-22), and the links
//    item led by links in general (1.0.3).
export const CONSENT_VERSION = 3;
const KEY = "consent";

export interface Consent { version: number; deviceName: boolean; at: number }

export async function consent(): Promise<Consent | null> {
  const value = (await chrome.storage.local.get(KEY))[KEY] as Consent | undefined;
  return value && value.version === CONSENT_VERSION ? value : null;
}

export async function consented(): Promise<boolean> {
  return Boolean(await consent());
}

export async function recordConsent(deviceName: boolean): Promise<void> {
  await chrome.storage.local.set({[KEY]: {version: CONSENT_VERSION, deviceName, at: Date.now()} satisfies Consent});
}

type DataCollection = {permissions?: {contains(request: {data_collection: string[]}): Promise<boolean>}};

/**
 * Whether the browser and system may name the connection: the person chose it on the
 * disclosure page and, in Firefox, granted its optional technical-data consent.
 */
export async function deviceNameAllowed(): Promise<boolean> {
  if (!(await consent())?.deviceName) return false;
  const firefox = (globalThis as unknown as {browser?: DataCollection}).browser;
  if (firefox?.permissions && /Firefox\//.test(navigator.userAgent)) {
    try {
      return await firefox.permissions.contains({data_collection: ["technicalAndInteraction"]});
    } catch {
      return false;
    }
  }
  return true;
}
