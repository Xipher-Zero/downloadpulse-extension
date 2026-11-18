// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {captureKind, extractUrls, isDownloadCandidate, urlAt} from "../../src/shared/classify";

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
  // An indexer API link with no .nzb in its path is not recognised (a known limit, WS-E2 record).
  assert.equal(captureKind("https://i.example/api?t=get&id=5"), null);
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
