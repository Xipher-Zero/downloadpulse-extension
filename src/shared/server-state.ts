// SPDX-License-Identifier: GPL-2.0-or-later
// One DownloadPulse's state in this browser session, kept under its own server
// (multi-server preparation, 2026-11-19): its downloads, their cursor, what was
// notified, whether it answered, what the person cleared, and what it takes
// with a link (its session's capabilities, connection.ts). Each name is
// stored as "<name>@<server origin>", so one server's state never reads or
// clears another's.

export type ServerState = "jobs" | "jobsCursor" | "jobsNotified" | "reach" | "jobsCleared" | "capabilities";

export const SERVER_STATE: readonly ServerState[] = ["jobs", "jobsCursor", "jobsNotified", "reach", "jobsCleared", "capabilities"];

export function stateKey(server: string, name: ServerState): string {
  return `${name}@${server}`;
}

/** Whether a changed storage key is ``name`` for any server. */
export function isStateKey(key: string, name: ServerState): boolean {
  return key.startsWith(`${name}@`);
}
