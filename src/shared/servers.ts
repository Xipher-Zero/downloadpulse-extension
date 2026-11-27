// SPDX-License-Identifier: GPL-2.0-or-later
// More than one DownloadPulse (WS-X1, 1.0.8): what the person calls each server, the one
// order every list shows them in, and the cap. Pure rules, no storage: connection.ts keeps
// them in this browser only (the server knows nothing of any of it).

/** The most servers one browser connects to (the background refuses a fourth: connection.ts saveConnection). */
export const MAX_SERVERS = 3;
/** A short name's longest. */
export const NAME_MAX = 24;

const same = (a: string, b: string): boolean => a.localeCompare(b, undefined, {sensitivity: "accent"}) === 0;

/** A short name as typed: trimmed, inner runs of space made one, cut to NAME_MAX characters. */
export function cleanName(typed: string): string {
  return [...typed.replace(/\s+/g, " ").trim()].slice(0, NAME_MAX).join("").trim();
}

/**
 * A server's name before the person gives it one: its host name (this computer's DownloadPulse is
 * "localhost"; a long name its first label), cut to NAME_MAX and made unique among ``taken`` by a
 * number ("nas 2").
 */
export function nameFromHost(origin: string, taken: readonly string[]): string {
  let host = origin;
  try {
    host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  } catch {
    // not a URL: the text itself
  }
  if (host === "::1" || /^127\./.test(host)) host = "localhost";
  if ([...host].length > NAME_MAX && !/^[\d.:]+$/.test(host)) host = host.split(".")[0] || host;
  const base = cleanName(host) || "DownloadPulse";
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? "" : ` ${number}`;
    const name = [...base].slice(0, NAME_MAX - suffix.length).join("") + suffix;
    if (!taken.some((other) => same(other, name))) return name;
  }
}

/** Why a typed name can't be used, if it can't: blank, or another server's already. */
export function nameProblem(typed: string, others: readonly string[]): "blank" | "duplicate" | null {
  const name = cleanName(typed);
  if (!name) return "blank";
  return others.some((other) => same(other, name)) ? "duplicate" : null;
}

/**
 * The display order: the stored one, keeping only servers still connected, then any not in it
 * yet in the order they were connected (a 1.0.7 connection, or one just saved).
 */
export function displayOrder(connected: readonly string[], stored: readonly string[] | undefined): string[] {
  const kept = (stored ?? []).filter((server, index, all) => connected.includes(server) && all.indexOf(server) === index);
  return [...kept, ...connected.filter((server) => !kept.includes(server))];
}

/** ``order`` with ``server`` moved to ``to`` (clamped to the list). */
export function moved(order: readonly string[], server: string, to: number): string[] {
  const rest = order.filter((item) => item !== server);
  if (rest.length === order.length) return [...order];
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), server, ...rest.slice(at)];
}

/** Every server's name: the stored one if usable, else one from its host, unique in display order. */
export function displayNames(order: readonly string[], stored: Readonly<Record<string, string>>): Record<string, string> {
  const names: Record<string, string> = {};
  const taken: string[] = [];
  // The person's own names first, so a derived one never takes a chosen one's place.
  for (const server of order) {
    const chosen = cleanName(stored[server] ?? "");
    if (chosen && !taken.some((other) => same(other, chosen))) {
      names[server] = chosen;
      taken.push(chosen);
    }
  }
  for (const server of order) {
    if (names[server]) continue;
    names[server] = nameFromHost(server, taken);
    taken.push(names[server]);
  }
  return names;
}
