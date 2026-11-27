// SPDX-License-Identifier: GPL-2.0-or-later
// 1.0.8 (WS-A4): the server's identity proof and the approval page's address.
import {test} from "node:test";
import assert from "node:assert/strict";
import {freshNonce, identityProof} from "../../src/shared/identity";
import {approvalUrl, readSession, ServerError, startPairing} from "../../src/shared/server";

test("the identity proof is DownloadPulse's own (accounts.browser_identity_proof), byte for byte", async () => {
  // Computed by the server's formula in Python: HMAC-SHA256(SHA-256(token), context \n nonce \n origin).
  assert.equal(await identityProof("dp_fake-token", "AAAAAAAAAAAAAAAAAAAAAA", "http://127.0.0.1:8095"),
    "a56c201c6034e58129804ed5dd31b2a7c29244808f5329482160729f1bdf0254");
  assert.notEqual(await identityProof("dp_fake-token", "AAAAAAAAAAAAAAAAAAAAAB", "http://127.0.0.1:8095"),
    await identityProof("dp_fake-token", "AAAAAAAAAAAAAAAAAAAAAA", "http://127.0.0.1:8095"));
  assert.notEqual(await identityProof("dp_fake-token", "AAAAAAAAAAAAAAAAAAAAAA", "http://localhost:8095"),
    await identityProof("dp_fake-token", "AAAAAAAAAAAAAAAAAAAAAA", "http://127.0.0.1:8095"));
});

test("a nonce is 128 fresh random bits, in the characters the server takes", () => {
  const nonces = new Set(Array.from({length: 50}, freshNonce));
  assert.equal(nonces.size, 50);
  for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
});

test("the approval page is on the server itself, never another site (EXT-3)", () => {
  const origin = "http://127.0.0.1:8095";
  assert.equal(approvalUrl(origin, "/?connect-browser=ABCD-EFGH"), "http://127.0.0.1:8095/?connect-browser=ABCD-EFGH");
  assert.equal(approvalUrl("https://dp.example.com", "/?connect-browser=X"), "https://dp.example.com/?connect-browser=X");
  for (const path of ["@evil.example/x", "//evil.example/x", "/\\evil.example/x", "\\\\evil.example/x",
    "https://evil.example/x", "evil.example", "", ":8096/x", "javascript:alert(1)"]) {
    assert.equal(approvalUrl(origin, path), null, path);
  }
});

test("a pairing whose approval page is off the server is refused before any tab opens", async () => {
  const real = globalThis.fetch;
  try {
    for (const path of ["@evil.example/x", "//evil.example/x"]) {
      globalThis.fetch = async () => new Response(JSON.stringify({protocol: "downloadpulse.browser/1", device_code: "d",
        user_code: "ABCD-EFGH", verification_path: path, expires_in: 600, interval: 2}), {status: 200});
      await assert.rejects(startPairing("http://127.0.0.1:8095", "Firefox on Linux"),
        (error: unknown) => error instanceof ServerError && error.failure === "failed");
    }
    globalThis.fetch = async () => new Response(JSON.stringify({protocol: "downloadpulse.browser/1", device_code: "d",
      user_code: "ABCD-EFGH", verification_path: "/?connect-browser=ABCD-EFGH", expires_in: 600, interval: 2}), {status: 200});
    assert.equal((await startPairing("http://127.0.0.1:8095", "Firefox")).approval_url,
      "http://127.0.0.1:8095/?connect-browser=ABCD-EFGH");
  } finally {
    globalThis.fetch = real;
  }
});

test("a sign-in goes to DownloadPulse on this computer only when it proves its identity; a server's is unchanged", async () => {
  const real = globalThis.fetch;
  const session = (identity: boolean) => async () => new Response(JSON.stringify({protocol: "downloadpulse.browser/1",
    token: {id: "tok-1", label: "L"}, account: {display_name: "Una"},
    capabilities: {...(identity ? {identity: 1} : {}), cookies: {sources: ["links"]}, referrer: {sources: ["links"]}}}),
  {status: 200});
  try {
    globalThis.fetch = session(false);
    assert.deepEqual([(await readSession("http://127.0.0.1:8095", "dp_t")).videoCookies,
      (await readSession("http://127.0.0.1:8095", "dp_t")).referrer], [false, true]);
    assert.equal((await readSession("https://dp.example.com", "dp_t")).videoCookies, true);
    globalThis.fetch = session(true);
    assert.equal((await readSession("http://127.0.0.1:8095", "dp_t")).videoCookies, true);
  } finally {
    globalThis.fetch = real;
  }
});
