// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {isLocal, isPrivateHost, readSession, ServerError, serverAddress} from "../../src/shared/server";

const addr = (input: string) => {
  const found = serverAddress(input);
  return found && [found.origin, found.transport];
};

test("no silent downgrade: an address without a scheme is HTTPS, except this computer's (store review)", () => {
  assert.deepEqual(addr("dp.example.com/some/path?q=1"), ["https://dp.example.com", "https"]);
  assert.deepEqual(addr("nas.local:8095"), ["https://nas.local:8095", "https"]);
  assert.deepEqual(addr("192.168.1.20:8095"), ["https://192.168.1.20:8095", "https"]);
  assert.deepEqual(addr("localhost:8095"), ["http://localhost:8095", "local"]);
  assert.deepEqual(addr("127.0.0.1:8095"), ["http://127.0.0.1:8095", "local"]);
  assert.equal(serverAddress("192.168.1.20:8095")!.schemeGiven, false);
});

test("plain HTTP: this computer; a private network only as a choice (lan-http); never the internet", () => {
  assert.deepEqual(addr("http://127.0.0.1:8095/"), ["http://127.0.0.1:8095", "local"]);
  for (const host of ["192.168.1.20:8095", "10.0.0.5", "172.16.4.1", "172.31.9.9", "169.254.1.1", "nas", "nas.local", "box.lan",
    "dp.home.arpa", "[fd12:3456::1]", "[fe80::1]"]) {
    assert.equal(serverAddress(`http://${host}`)!.transport, "lan-http", host);
  }
  for (const host of ["dp.example.com", "8.8.8.8", "172.32.0.1", "11.0.0.1", "[2001:db8::1]"]) {
    assert.equal(serverAddress(`http://${host}`)!.transport, "public-http", host);
  }
  assert.equal(serverAddress("https://192.168.1.20")!.transport, "https");
});

test("only http(s), no credentials, nothing empty", () => {
  for (const input of ["ftp://dp.example.com", "javascript:alert(1)", "https://user:pass@dp.example.com", "   "]) {
    assert.equal(serverAddress(input), null, input);
  }
});

test("private hosts", () => {
  for (const host of ["10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.0.1", "printer", "nas.local", "fd00::1", "fe80::2"]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  // Tailscale's addresses and names are the person's network (operator, 2026-11-19); the range's neighbours aren't.
  for (const host of ["100.64.0.1", "100.101.102.103", "100.127.255.254", "nas.tailnet-1234.ts.net"]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ["example.com", "1.1.1.1", "172.15.0.1", "192.169.0.1", "2001:db8::1", "100.63.255.255", "100.128.0.1",
    "ts.net.example.com"]) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test("DownloadPulse on this computer is any loopback origin, whatever its port; anything else is a server", () => {
  for (const origin of ["http://127.0.0.1:8095", "http://localhost:8095", "http://localhost:33381", "http://[::1]:9000",
    "http://127.0.0.2:8095", "http://127.255.0.9"]) {
    assert.equal(isLocal(origin), true, origin);
  }
  for (const origin of ["https://downloadpulse.example.com", "http://192.168.1.20:8095", "http://127.0.0.1.example.com", "not a url"]) {
    assert.equal(isLocal(origin), false, origin);
  }
});

test("no request ever goes over plain HTTP across the internet, whatever asks (the request helper's guard)", async () => {
  // Refused before fetching: an unreachable host would otherwise fail as "unreachable", not "insecure_refused".
  await assert.rejects(readSession("http://203.0.113.9:8095", "dp_key"),
    (error: unknown) => error instanceof ServerError && error.failure === "insecure_refused");
});
