// SPDX-License-Identifier: GPL-2.0-or-later
// Keeps the person's DownloadPulse appearance current: read from the browser
// session when the dropdown opens and, while it stays open, with each of its
// keep-fresh calls (every 4 s), so a theme chosen in DownloadPulse shows within
// seconds, and with it what that DownloadPulse takes with a link (its session's
// capabilities, kept by connection.ts). REFRESH_MS only absorbs a burst. A failure keeps the last answer; a
// revoked token is the monitor's to handle.

import {saveAppearance} from "../shared/appearance";
import {connection, keepCapabilities, token} from "../shared/connection";
import {readSession} from "../shared/server";

const REFRESH_MS = 2_000;
let readAt = 0;

export async function refreshAppearance(): Promise<void> {
  if (Date.now() - readAt < REFRESH_MS) return;
  const connected = await connection();
  const browserToken = connected ? await token(connected.server) : null;
  if (!connected || !browserToken) return;
  readAt = Date.now();
  try {
    const session = await readSession(connected.server, browserToken);
    await saveAppearance(session.appearance);
    // The same answer keeps what this DownloadPulse takes with a link current (connection.ts).
    await keepCapabilities(connected.server, browserToken, session);
  } catch {
    readAt = 0;   // unreachable now: the next opening asks again
  }
}
