// SPDX-License-Identifier: GPL-2.0-or-later
// Keeps the person's DownloadPulse appearance current: read from the browser
// session when the dropdown opens and, while it stays open, with each of its
// keep-fresh calls (every 4 s), so a theme chosen in DownloadPulse shows within
// seconds, and with it what that DownloadPulse takes with a link (its session's
// capabilities, kept by connection.ts). REFRESH_MS only absorbs a burst. A failure keeps the last answer; a
// revoked token is the monitor's to handle.

import {saveAppearance} from "../shared/appearance";
import {connection, defaultServer, keepCapabilities, token} from "../shared/connection";
import {readSession} from "../shared/server";

const REFRESH_MS = 2_000;
let readAt = 0;

/** ``now``: whatever was read a moment ago (the default server changed, WS-X1). */
export async function refreshAppearance(now = false): Promise<void> {
  if (!now && Date.now() - readAt < REFRESH_MS) return;
  // The pages and the toolbar icon are drawn in the default server's colours (WS-X1).
  const server = await defaultServer();
  const connected = server ? await connection(server) : null;
  const browserToken = connected ? await token(connected.server) : null;
  if (!connected || !browserToken) return;
  readAt = Date.now();
  try {
    const session = await readSession(connected.server, browserToken);
    // Still the default when it answered: a read begun before the default changed never paints the old one's colours.
    if ((await defaultServer()) === connected.server) await saveAppearance(session.appearance);
    // The same answer keeps what this DownloadPulse takes with a link current (connection.ts).
    await keepCapabilities(connected.server, browserToken, session);
  } catch {
    readAt = 0;   // unreachable now: the next opening asks again
  }
}
