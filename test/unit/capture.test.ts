// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {capturedName, dispositionName, isIndexerRefusal} from "../../src/shared/capture";

test("only a newznab <error> answer is refused; an NZB in any form DownloadPulse accepts passes (review P2)", () => {
  for (const refusal of ['<?xml version="1.0" encoding="UTF-8"?><error code="429" description="Request limit reached"/>',
    '<error code="100" description="Incorrect user credentials"/>', '\ufeff<?xml version="1.0"?>\n<error code="300"></error>']) {
    assert.equal(isIndexerRefusal(refusal), true, refusal);
  }
  for (const nzb of [
    '<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file/></nzb>',
    // The reviewer's case: a namespace-prefixed root, which DownloadPulse's parser accepts.
    '<?xml version="1.0"?><n:nzb xmlns:n="http://www.newzbin.com/DTD/2003/nzb"><n:file/></n:nzb>',
    '<?xml version="1.0"?>\n<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "x"><!-- made by x --><nzb><file/></nzb>',
    '<nzb><head><meta type="name">error handling.mkv</meta></head></nzb>',
  ]) {
    assert.equal(isIndexerRefusal(nzb), false, nzb);
  }
});

test("Content-Disposition: filename* is decoded, a plain filename is kept literal (review P3)", () => {
  // The reviewer's case: a plain name with "%" made decodeURIComponent throw and the capture fail.
  assert.equal(dispositionName('attachment; filename="100% Complete.nzb"'), "100% Complete.nzb");
  assert.equal(dispositionName("attachment; filename=100% Complete.nzb"), "100% Complete.nzb");
  assert.equal(dispositionName("attachment; filename*=UTF-8''100%25%20Complete.nzb"), "100% Complete.nzb");
  assert.equal(dispositionName("attachment; filename=\"fallback.nzb\"; filename*=UTF-8''The%20Odyssey.nzb"), "The Odyssey.nzb");
  assert.equal(dispositionName("attachment; filename*=iso-8859-1''caf%E9.nzb"), "caf\u00e9.nzb");
  assert.equal(dispositionName("attachment; filename*=UTF-8''bad%E9%.nzb"), "bad%E9%.nzb");   // malformed: kept, never thrown
  assert.equal(dispositionName('attachment; filename="a \\"quoted\\" name.nzb"'), 'a "quoted" name.nzb');
  assert.equal(dispositionName("inline"), null);
});

test("a captured file's name: the site's, the NZB's own, the path's; dotted names kept, suffix added", () => {
  assert.equal(capturedName('attachment; filename="100% Complete.nzb"', "/cdn", "nzb", ""), "100% Complete.nzb");
  assert.equal(capturedName("", "/api", "nzb", '<nzb><head><meta type="name">The.Odyssey.2026.2160p</meta></head></nzb>'),
    "The.Odyssey.2026.2160p.nzb");
  assert.equal(capturedName("", "/dl/50%25%20off%ZZ", "torrent", ""), "50%25%20off%ZZ.torrent");   // malformed path: literal
  assert.equal(capturedName('attachment; filename="release.xml"', "/x", "nzb", ""), "release.nzb");
});
