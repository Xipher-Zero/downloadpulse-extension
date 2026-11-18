// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {candidateOrigins, isLocal} from "../../src/shared/server";

test("an address without a scheme is tried as https, then http, as an origin only", () => {
  assert.deepEqual(candidateOrigins("nas.local:8095"), ["https://nas.local:8095", "http://nas.local:8095"]);
  assert.deepEqual(candidateOrigins("  dp.example.com/some/path?q=1 "), ["https://dp.example.com", "http://dp.example.com"]);
});

test("a scheme given is kept, and only http(s) is accepted", () => {
  assert.deepEqual(candidateOrigins("http://192.168.1.5:8095/"), ["http://192.168.1.5:8095"]);
  assert.deepEqual(candidateOrigins("https://dp.example.com"), ["https://dp.example.com"]);
  assert.deepEqual(candidateOrigins("ftp://dp.example.com"), []);
  assert.deepEqual(candidateOrigins("javascript:alert(1)"), []);
});

test("credentials in the address and empty input give no origin", () => {
  assert.deepEqual(candidateOrigins("https://user:pass@dp.example.com"), []);
  assert.deepEqual(candidateOrigins("   "), []);
});

test("DownloadPulse on this computer is any loopback origin, whatever its port; anything else is a server", () => {
  for (const origin of ["http://127.0.0.1:8095", "http://localhost:8095", "http://localhost:33381", "http://[::1]:9000"]) {
    assert.equal(isLocal(origin), true, origin);
  }
  for (const origin of ["https://downloadpulse.example.com", "http://192.168.1.20:8095", "http://127.0.0.1.example.com", "not a url"]) {
    assert.equal(isLocal(origin), false, origin);
  }
});
