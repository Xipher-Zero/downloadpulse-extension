// SPDX-License-Identifier: GPL-2.0-or-later
// 1.0.8, WS-A5 (EXT-4): a browser download a page of another site started takes no
// SameSite=Strict cookie, as the browser's own cross-site request would not; same-site unchanged.
import {test} from "node:test";
import assert from "node:assert/strict";
import {cookiesFor, crossSite, registrable} from "../../src/background/cookies";

const jar = [
  {name: "STRICT", value: "s", domain: "files.example.com", path: "/", secure: true, httpOnly: true, hostOnly: true,
    session: true, sameSite: "strict", storeId: "0"},
  {name: "LAX", value: "l", domain: ".example.com", path: "/", secure: true, httpOnly: false, hostOnly: false,
    session: false, expirationDate: 2_000_000_000.5, sameSite: "lax", storeId: "0"},
  {name: "NONE", value: "n", domain: ".example.com", path: "/", secure: true, httpOnly: false, hostOnly: false,
    session: true, sameSite: "no_restriction", storeId: "0"},
  {name: "DEFAULT", value: "d", domain: ".example.com", path: "/", secure: true, httpOnly: false, hostOnly: false,
    session: true, sameSite: "unspecified", storeId: "0"},
];
(globalThis as unknown as {chrome: unknown}).chrome = {
  cookies: {getAll: async (query: {partitionKey?: object}) => (query.partitionKey ? [] : jar)},
};

const FILE = "https://files.example.com/dl/big.bin";
const names = async (initiator?: string) => (await cookiesFor(FILE, undefined, initiator)).cookies.map((c) => c.name);

test("registrable domain: two labels, three under a country's own second level, an address its own", () => {
  assert.equal(registrable("files.example.com"), "example.com");
  assert.equal(registrable("Example.COM."), "example.com");
  assert.equal(registrable("dl.cdn.example.co.uk"), "example.co.uk");
  assert.equal(registrable("www.example.com.au"), "example.com.au");
  assert.equal(registrable("a.b.example.de"), "example.de");
  assert.equal(registrable("127.0.0.1"), "127.0.0.1");
  assert.equal(registrable("[::1]"), "[::1]");
  assert.equal(registrable("localhost"), "localhost");
});

test("cross-site: another registrable domain or scheme; no page, or not a web page, is not", () => {
  assert.equal(crossSite(FILE, "https://www.example.com/downloads"), false);
  assert.equal(crossSite(FILE, "https://files.example.com/"), false);
  assert.equal(crossSite(FILE, "https://evil.example/page"), true);
  assert.equal(crossSite(FILE, "https://example.com.evil.example/"), true);
  assert.equal(crossSite(FILE, "http://www.example.com/"), true);   // schemeful, as Chromium judges it
  assert.equal(crossSite("https://a.example.co.uk/f", "https://b.other.co.uk/"), true);
  assert.equal(crossSite("http://127.0.0.1:1/f", "http://localhost:1/"), true);
  assert.equal(crossSite(FILE, ""), false);
  assert.equal(crossSite(FILE, undefined), false);
  assert.equal(crossSite(FILE, "about:blank"), false);
});

test("a download another site started: Strict cookies stay back, Lax/None/default go, nothing counted dropped", async () => {
  const found = await cookiesFor(FILE, undefined, "https://evil.example/page");
  assert.deepEqual(found.cookies.map((c) => c.name), ["LAX", "NONE", "DEFAULT"]);
  assert.equal(found.dropped, false);
});

test("same-site, or no page known: every cookie the browser would send goes, as before", async () => {
  assert.deepEqual(await names("https://www.example.com/downloads"), ["STRICT", "LAX", "NONE", "DEFAULT"]);
  assert.deepEqual(await names(""), ["STRICT", "LAX", "NONE", "DEFAULT"]);
  assert.deepEqual(await names(), ["STRICT", "LAX", "NONE", "DEFAULT"]);   // a video: no initiator
});
