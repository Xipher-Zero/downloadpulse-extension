// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {isLocal, isPrivateHost, readSession, ServerError, serverAddress, signInMayTravel, startPairing, submitJob} from "../../src/shared/server";

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

test("a video's sign-in travels only over HTTPS or to this computer, never plain HTTP on a network (review)", () => {
  for (const origin of ["https://dp.example.com", "https://192.168.1.20:8443", "http://127.0.0.1:8095", "http://localhost:8095"]) {
    assert.equal(signInMayTravel(origin), true, origin);
  }
  for (const origin of ["http://192.168.1.20:8095", "http://10.0.0.5", "http://nas.home.example.com", "http://203.0.113.9:8095", "not a url"]) {
    assert.equal(signInMayTravel(origin), false, origin);
  }
});

test("starting a pairing: a new DownloadPulse whose setup is unfinished is named so; other refusals stay what they were", async () => {
  const real = globalThis.fetch;
  const answering = (status: number, body: unknown) => {
    globalThis.fetch = async () => new Response(typeof body === "string" ? body : JSON.stringify(body),
      {status, headers: {"Content-Type": "application/json"}});
  };
  const fails = (failure: string) => (error: unknown) => error instanceof ServerError && error.failure === failure;
  try {
    answering(409, {detail: "Finish setting up DownloadPulse first, then connect again.", code: "browser.pairing.setup_incomplete", params: {}});
    await assert.rejects(startPairing("http://127.0.0.1:8095", "Firefox on Linux"), fails("setup_incomplete"));
    // Another refusal, or one with no readable body, is still the generic failure.
    answering(409, {detail: "Something else", code: "browser.pairing.other"});
    await assert.rejects(startPairing("http://127.0.0.1:8095", "Firefox on Linux"), fails("failed"));
    answering(500, "<html>proxy error</html>");
    await assert.rejects(startPairing("http://127.0.0.1:8095", "Firefox on Linux"), fails("failed"));
    // A server too old to pair is still "too old", whatever its body says.
    answering(404, {code: "browser.pairing.setup_incomplete"});
    await assert.rejects(startPairing("http://127.0.0.1:8095", "Firefox on Linux"), fails("too_old"));
  } finally {
    globalThis.fetch = real;
  }
});

test("a submission refused as too large (413) is \"source_too_large\", whatever its body (1.0.8, WS-A11)", async () => {
  const real = globalThis.fetch;
  const answering = (status: number, body: string, type: string) => {
    globalThis.fetch = async () => new Response(body, {status, headers: {"Content-Type": type}});
  };
  const source = {kind: "torrent" as const, filename: "a.torrent", torrent_base64: "AA=="};
  try {
    // A body cap in front of the route (DownloadPulse's own, or a proxy's): no JSON at all.
    answering(413, "<html><body>413 Request Entity Too Large</body></html>", "text/html");
    assert.deepEqual(await submitJob("http://127.0.0.1:8095", "t", "k", source),
      {ok: false, code: "source_too_large", retryable: false});
    answering(413, JSON.stringify({detail: "Request body too large"}), "application/json");
    assert.deepEqual(await submitJob("http://127.0.0.1:8095", "t", "k", source),
      {ok: false, code: "source_too_large", retryable: false});
    // DownloadPulse's structured refusal is still read as it was.
    answering(422, JSON.stringify({detail: {code: "invalid_source", retryable: false}}), "application/json");
    assert.deepEqual(await submitJob("http://127.0.0.1:8095", "t", "k", source),
      {ok: false, code: "invalid_source", retryable: false});
    answering(500, "<html>proxy error</html>", "text/html");
    assert.deepEqual(await submitJob("http://127.0.0.1:8095", "t", "k", source), {ok: false, code: "failed", retryable: false});
  } finally {
    globalThis.fetch = real;
  }
});
