// SPDX-License-Identifier: GPL-2.0-or-later
// Keeps the person's DownloadPulse appearance current: read from the browser
// session when the dropdown opens and, while it stays open, with each of its
// keep-fresh calls (every 4 s), so a theme chosen in DownloadPulse shows within
// seconds. REFRESH_MS only absorbs a burst. A failure keeps the last answer; a
// revoked token is the monitor's to handle.

import {saveAppearance} from "../shared/appearance";
import {connection, token} from "../shared/connection";
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
    await saveAppearance((await readSession(connected.server, browserToken)).appearance);
  } catch {
    readAt = 0;   // unreachable now: the next opening asks again
  }
}
