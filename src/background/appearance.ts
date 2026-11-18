// SPDX-License-Identifier: GPL-2.0-or-later
// Keeps the person's DownloadPulse appearance current: read from the browser
// session when the dropdown opens, at most every REFRESH_MS. A failure keeps
// the last answer; a revoked token is the monitor's to handle.

import {saveAppearance} from "../shared/appearance";
import {connection, token} from "../shared/connection";
import {readSession} from "../shared/server";

const REFRESH_MS = 30_000;
let readAt = 0;

export async function refreshAppearance(): Promise<void> {
  if (Date.now() - readAt < REFRESH_MS) return;
  const connected = await connection();
  const browserToken = await token();
  if (!connected || !browserToken) return;
  readAt = Date.now();
  try {
    await saveAppearance((await readSession(connected.server, browserToken)).appearance);
  } catch {
    readAt = 0;   // unreachable now: the next opening asks again
  }
}
