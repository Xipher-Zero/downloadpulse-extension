// SPDX-License-Identifier: GPL-2.0-or-later
// What a captured file's answer says (src/background/submit.ts captures it):
// whether it is plainly not the file, and what it is called. Pure, so each rule
// is tested on its own (review of affeb5d, P2/P3).

import type {CaptureKind} from "./classify";

export const SUFFIX: Record<CaptureKind, string> = {torrent: ".torrent", nzb: ".nzb", metalink: ".meta4"};

/**
 * A newznab indexer's refusal (a bad key, a limit reached): an XML document
 * whose root is ``<error>``, answered with 200. Only that is refused here: an
 * NZB itself is validated by DownloadPulse, which accepts forms (a namespace
 * prefix, a comment or doctype first) this check must not second-guess.
 */
export function isIndexerRefusal(head: string): boolean {
  return /^\s*(?:\ufeff)?(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?error[\s/>]/i.test(head);
}

/** Content-Disposition's file name: ``filename*=charset''pct-encoded`` decoded, plain ``filename=`` literal. */
export function dispositionName(disposition: string): string | null {
  const encoded = /filename\*\s*=\s*([\w-]*)'[\w-]*'([^;]+)/i.exec(disposition);
  if (encoded) {
    const value = encoded[2]!.trim();
    try {
      if (!encoded[1] || /^utf-?8$/i.test(encoded[1])) return decodeURIComponent(value);
      // ISO-8859-1 (RFC 8187's other charset): each %XX is one byte, one character.
      return value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    } catch {
      return value;
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(disposition);
  if (!plain) return null;
  return plain[1] !== undefined ? plain[1].replace(/\\(.)/g, "$1") : plain[2]!.trim();
}

/**
 * What a captured file is called: the site's own name, else (an NZB) its own
 * ``<meta type="name">``, else the path's last part; made safe, with the
 * kind's suffix.
 */
export function capturedName(disposition: string, pathname: string, kind: CaptureKind, head: string): string {
  let name = dispositionName(disposition);
  if (!name && kind === "nzb") name = /<meta\s+type="name"\s*>([^<]+)</i.exec(head)?.[1]?.trim() ?? null;
  if (!name) {
    const last = pathname.split("/").pop() ?? "";
    try {
      name = decodeURIComponent(last);
    } catch {
      name = last;
    }
  }
  name = name.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 200) || "download";
  if (name.toLowerCase().endsWith(SUFFIX[kind])) return name;
  // Another file type's extension (letters only, ".xml", ".bin") is replaced; anything else is part of
  // the name ("The.Odyssey.2026.2160p" keeps its ".2160p").
  return (/\.[a-z]{1,5}$/i.test(name) ? name.replace(/\.[a-z]{1,5}$/i, "") : name) + SUFFIX[kind];
}
