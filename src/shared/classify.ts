// SPDX-License-Identifier: GPL-2.0-or-later
// Which URLs are downloads, decided locally with no network request
// (PLAN §3.3 as amended 2026-11-18: no server host list).

// Download file types: archives, disc images, installers, video, audio, and
// the descriptors DownloadPulse takes as files.
const DOWNLOAD_EXTENSIONS = new Set([
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "img", "dmg", "exe", "msi", "deb", "rpm",
  "apk", "appimage", "flatpak", "pkg", "mkv", "mp4", "avi", "mov", "webm", "m4v", "wmv", "mpg", "mpeg", "mp3",
  "flac", "m4a", "ogg", "opus", "wav", "aac", "epub", "pdf", "torrent", "nzb", "meta4", "par2",
]);
const MULTIPART = /\.(?:r\d{2}|\d{3}|part\d+\.rar)$/i;

export type CaptureKind = "torrent" | "nzb" | "metalink";

function extension(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function parsed(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** The file DownloadPulse takes as contents, captured before sending (S1), or null. */
/**
 * A newznab indexer's download link: the standard API's
 * ``?t=get&id=…&apikey=…`` (``…/api``; NZBGeek's ``…/cdn``). Its answer is the
 * NZB itself, and the link carries the person's indexer key, so it is
 * captured, never sent (operator, 2026-11-18). All three must be present, on a
 * path with no file extension: an explicit file type (``backup.iso?t=get&id=42``,
 * ``x.torrent?…``) is that file, never taken for an indexer link (review of
 * affeb5d, P2).
 */
export function isNewznabGet(url: URL): boolean {
  const key = [...url.searchParams.keys()].some((name) => name.toLowerCase() === "apikey");
  return (url.searchParams.get("t") ?? "").toLowerCase() === "get" && Boolean(url.searchParams.get("id")) && key
    && extension(url.pathname) === "";
}

/** ``href`` is an indexer's download link (isNewznabGet). */
export function isIndexerLink(href: string): boolean {
  const url = parsed(href);
  return Boolean(url && (url.protocol === "http:" || url.protocol === "https:") && isNewznabGet(url));
}

export function captureKind(href: string): CaptureKind | null {
  const url = parsed(href);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  if (isNewznabGet(url)) return "nzb";
  const kind = extension(decodeURIComponent(url.pathname));
  return kind === "torrent" ? "torrent" : kind === "nzb" ? "nzb" : kind === "meta4" ? "metalink" : null;
}

/** Whether a link is worth the hover icon. ``attributes``: the anchor's own, when it is one. */
export function isDownloadCandidate(href: string, attributes: {download?: boolean; type?: string} = {}): boolean {
  if (/^magnet:\?/i.test(href)) return true;
  const url = parsed(href);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return false;
  if (attributes.download) return true;
  const type = (attributes.type ?? "").toLowerCase();
  if (type && !type.startsWith("text/html") && !type.startsWith("application/xhtml")) return true;
  if (isNewznabGet(url)) return true;
  const path = decodeURIComponent(url.pathname);
  return DOWNLOAD_EXTENSIONS.has(extension(path)) || MULTIPART.test(path);
}

// A URL inside text: http(s) or magnet, ending before whitespace or quotes.
const URL_IN_TEXT = /(?:https?:\/\/|magnet:\?)[^\s<>"'`]+/gi;
const TRAILING = /[)\]}>.,;:!?'"»”’]+$/;

/** Every http(s) URL and magnet in a piece of text, trimmed of surrounding punctuation, in order, unique. */
export function extractUrls(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let value = match[0];
    // A closing bracket belongs to the URL only when it opened one inside it.
    while (TRAILING.test(value)) {
      const last = value.at(-1)!;
      const opener = ({")": "(", "]": "[", "}": "{"} as Record<string, string>)[last];
      if (opener && value.split(opener).length > value.split(last).length - 1) break;
      value = value.slice(0, -1);
    }
    if ((/^magnet:\?/i.test(value) || parsed(value)) && !found.includes(value)) found.push(value);
  }
  return found;
}

/** The URL under a text offset (plain text that is a URL), or null. */
export function urlAt(text: string, offset: number): {url: string; start: number; end: number} | null {
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0;
    const [url] = extractUrls(match[0]);
    if (url && offset >= start && offset <= start + url.length) return {url, start, end: start + url.length};
  }
  return null;
}
