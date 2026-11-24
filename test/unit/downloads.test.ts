// SPDX-License-Identifier: GPL-2.0-or-later
// 1.0.2: which browser downloads go to DownloadPulse (src/shared/downloads.ts).
import assert from "node:assert/strict";
import {test} from "node:test";
import {decide, downloadsUsable, fileType} from "../../src/shared/downloads";

const ON = {capture: true, captureMinMB: 1, captureSkipTypes: ["pdf", "jpg"]};
const MB = 1024 * 1024;
const big = {url: "https://files.example.test/pub/archive.zip", totalBytes: 50 * MB, state: "in_progress"};

test("an ordinary large download goes to DownloadPulse", () => {
  assert.equal(decide(big, ON), "capture");
  // Its size not known yet: it goes (the browser often knows only later).
  assert.equal(decide({...big, totalBytes: 0}, ON), "capture");
  assert.equal(decide({...big, totalBytes: -1}, ON), "capture");
});

test("off, or not a fresh http(s) download of this browser's own: it stays", () => {
  assert.equal(decide(big, {...ON, capture: false}), "off");
  assert.equal(decide({...big, incognito: true}, ON), "off");
  assert.equal(decide({...big, state: "complete"}, ON), "finished");
  assert.equal(decide({...big, byExtensionId: "another-extension"}, ON), "extension");
  for (const url of ["blob:https://example.test/1234", "data:text/plain,hi", "file:///home/me/a.zip", "ftp://h/a.zip"]) {
    assert.equal(decide({...big, url}, ON), "scheme", url);
  }
  // The address it finally answered at decides.
  assert.equal(decide({...big, url: "https://a.test/go", finalUrl: "blob:https://a.test/x"}, ON), "scheme");
});

test("files DownloadPulse takes as contents stay with the browser", () => {
  for (const name of ["show.torrent", "ep.nzb", "iso.meta4", "iso.metalink"]) {
    assert.equal(decide({...big, url: `https://indexer.test/get/${name}`}, ON), "contents", name);
    assert.equal(decide({...big, url: "https://indexer.test/get?id=1", filename: `/home/me/Downloads/${name}`}, ON),
      "contents", name);
  }
});

test("the person's minimum size and file types", () => {
  assert.equal(decide({...big, totalBytes: MB - 1}, ON), "small");
  assert.equal(decide({...big, totalBytes: MB}, ON), "capture");
  assert.equal(decide({...big, totalBytes: 10}, {...ON, captureMinMB: 0}), "capture");
  assert.equal(decide({...big, url: "https://a.test/doc/Report.PDF"}, ON), "type");
  assert.equal(decide({...big, filename: "C:\\\\Users\\\\me\\\\photo.jpg"}, ON), "type");
  assert.equal(decide({...big, url: "https://a.test/doc/report.pdf.zip"}, ON), "capture");
});

test("a file's type comes from its name, else its address", () => {
  assert.equal(fileType({url: "https://a.test/x/Setup.EXE"}), "exe");
  assert.equal(fileType({url: "https://a.test/download?id=7", filename: "/tmp/Movie.mkv"}), "mkv");
  assert.equal(fileType({url: "https://a.test/download?id=7"}), "");
  assert.equal(fileType({url: "https://a.test/a%20b.tar.gz"}), "gz");
  assert.equal(fileType({url: "not a url"}), "");
});

test("a download is held only where the browser's downloads API has all of it (none on Firefox for Android)", () => {
  const fn = async () => undefined;
  const full = {onCreated: {}, pause: fn, resume: fn, search: fn, cancel: fn, erase: fn} as never;
  assert.equal(downloadsUsable(full), true);
  assert.equal(downloadsUsable(undefined), false);
  // Only starting a download (no list to pause or take back): nothing could be held.
  assert.equal(downloadsUsable({download: fn} as never), false);
  assert.equal(downloadsUsable({...(full as object), pause: undefined} as never), false);
});
