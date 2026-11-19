// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {captureKind, extractUrls, isDownloadCandidate, urlAt, videoAddress} from "../../src/shared/classify";

test("download candidates: magnets, download file types, the download attribute, a non-HTML type", () => {
  assert.equal(isDownloadCandidate("magnet:?xt=urn:btih:abc"), true);
  for (const href of ["https://h.example/a/file.ZIP", "https://h.example/x.part2.rar", "https://h.example/x.r01",
    "https://h.example/ubuntu.iso?mirror=1", "https://h.example/files/My%20Show.mkv", "https://h.example/a.torrent"]) {
    assert.equal(isDownloadCandidate(href), true, href);
  }
  for (const href of ["https://h.example/", "https://h.example/about", "https://h.example/page.html",
    "javascript:void(0)", "mailto:a@b.example", "https://h.example/zip"]) {
    assert.equal(isDownloadCandidate(href), false, href);
  }
  assert.equal(isDownloadCandidate("https://h.example/get?id=1", {download: true}), true);
  assert.equal(isDownloadCandidate("https://h.example/get?id=1", {type: "application/octet-stream"}), true);
  assert.equal(isDownloadCandidate("https://h.example/get?id=1", {type: "text/html"}), false);
});

test("capture: .torrent, .nzb and .meta4 links only, over http(s)", () => {
  assert.equal(captureKind("https://t.example/dl/123/file.torrent?passkey=secret"), "torrent");
  assert.equal(captureKind("https://i.example/getnzb/5/Some.Release.NZB"), "nzb");
  // An indexer's newznab download link is an NZB, though its path has no .nzb (operator, 2026-11-18).
  assert.equal(captureKind("https://i.example/api?t=get&id=5&apikey=K"), "nzb");
  assert.equal(captureKind("https://m.example/file.meta4"), "metalink");
  assert.equal(captureKind("https://m.example/file.metalink"), null);
  assert.equal(captureKind("https://m.example/file.zip"), null);
  assert.equal(captureKind("magnet:?xt=urn:btih:abc"), null);
});

test("URLs in selected text: trimmed of punctuation, brackets kept when they belong, unique, in order", () => {
  const text = "Get it (https://a.example/f.zip), mirror: https://b.example/wiki/Foo_(bar). "
    + "Also magnet:?xt=urn:btih:abc&dn=x and https://a.example/f.zip again; <https://c.example/x.iso>";
  assert.deepEqual(extractUrls(text), ["https://a.example/f.zip", "https://b.example/wiki/Foo_(bar)",
    "magnet:?xt=urn:btih:abc&dn=x", "https://c.example/x.iso"]);
  assert.deepEqual(extractUrls("no links here"), []);
});

test("the URL under a text offset", () => {
  const text = "see https://a.example/f.zip now";
  assert.deepEqual(urlAt(text, 10), {url: "https://a.example/f.zip", start: 4, end: 27});
  assert.equal(urlAt(text, 1), null);
});

test("an indexer's newznab download link (?t=get&id=) is an NZB to capture, whatever its path", () => {
  for (const href of ["https://api.nzbgeek.info/cdn?t=get&id=c59de97c&apikey=K", "https://indexer.example/api?t=GET&id=1&apikey=K"]) {
    assert.equal(isDownloadCandidate(href), true, href);
    assert.equal(captureKind(href), "nzb", href);
  }
  // Other newznab calls (a search, a get without an id) are not downloads.
  for (const href of ["https://indexer.example/api?t=search&q=x&apikey=K", "https://indexer.example/api?t=get&apikey=K"]) {
    assert.equal(isDownloadCandidate(href), false, href);
    assert.equal(captureKind(href), null, href);
  }
});

test("an explicit file type is that file, whatever its query; an indexer link needs t=get, an id and its key (review P2)", () => {
  // The reviewer's cases: fetched as NZBs, refused, and never sent.
  assert.equal(captureKind("https://files.example/backup.iso?t=get&id=42"), null);
  assert.equal(isDownloadCandidate("https://files.example/backup.iso?t=get&id=42"), true);   // sent as the link it is
  assert.equal(captureKind("https://t.example/x.torrent?t=get&id=42&apikey=K"), "torrent");
  assert.equal(captureKind("https://files.example/backup.iso?t=get&id=42&apikey=K"), null);
  // Extensionless: all three newznab signs, or it is not an indexer link.
  assert.equal(captureKind("https://i.example/api?t=get&id=5"), null);
  assert.equal(captureKind("https://i.example/api?t=get&apikey=K"), null);
  assert.equal(captureKind("https://i.example/api?t=search&id=5&apikey=K"), null);
  assert.equal(captureKind("https://i.example/cdn?t=get&id=5&ApiKey=K"), "nzb");
});

test("a stray % in a path is read as written, never an error (review, 2026-11-19)", () => {
  assert.equal(captureKind("https://example.com/50%off/file.torrent"), "torrent");
  assert.equal(isDownloadCandidate("https://example.com/50%off/file.zip"), true);
  assert.equal(isDownloadCandidate("https://example.com/50%off/page"), false);
});

test("a video's address is the frame's current one, on the origin the browser reports for it (single-page sites)", () => {
  // YouTube: loaded at the home page, then navigated in place to a video.
  assert.equal(videoAddress("https://www.youtube.com/watch?v=abc#t=1", "https://www.youtube.com/"),
    "https://www.youtube.com/watch?v=abc");
  assert.equal(videoAddress(undefined, "https://player.example/embed/1#x"), "https://player.example/embed/1");
  for (const named of ["https://other.example/watch?v=abc", "http://www.youtube.com/watch?v=abc", "javascript:alert(1)", "not a url"]) {
    assert.equal(videoAddress(named, "https://www.youtube.com/"), null, named);
  }
  assert.equal(videoAddress("chrome-extension://x/a", "chrome-extension://x/"), null);
});
