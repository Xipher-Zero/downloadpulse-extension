// SPDX-License-Identifier: GPL-2.0-or-later
// WS-X1 (1.0.8): more than one server -- the names, the order, the default, the cap, and the
// 1.0.7 upgrade -- against an in-memory chrome.storage and IndexedDB.
import {test} from "node:test";
import assert from "node:assert/strict";
import {cleanName, displayNames, displayOrder, moved, nameFromHost, nameProblem} from "../../src/shared/servers";

// ── the browser, in memory ────────────────────────────────────────────
const area = () => {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys?: string | string[] | null) => {
      if (keys === null || keys === undefined) return structuredClone(data);
      return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data)
        .map((key) => [key, structuredClone(data[key])]));
    },
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
};
const local = area(), session = area();
const secrets = new Map<string, unknown>();
const request = <T>(result: () => T) => {
  const value: {result?: T; onsuccess?: () => void} = {};
  queueMicrotask(() => { value.result = result(); value.onsuccess?.(); });
  return value;
};
(globalThis as unknown as {indexedDB: unknown}).indexedDB = {
  open: () => {
    const opened: {result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void} = {};
    queueMicrotask(() => {
      opened.result = {
        close: () => undefined,
        transaction: () => {
          const tx: {oncomplete?: () => void; objectStore: () => unknown} = {
            objectStore: () => ({
              get: (key: string) => { const r = request(() => secrets.get(key)); queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.())); return r; },
              put: (value: unknown, key: string) => { const r = request(() => secrets.set(key, value)); queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.())); return r; },
              delete: (key: string) => { const r = request(() => secrets.delete(key)); queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.())); return r; },
            }),
          };
          return tx;
        },
        createObjectStore: () => undefined,
      };
      opened.onsuccess?.();
    });
    return opened;
  },
};
(globalThis as unknown as {chrome: unknown}).chrome = {storage: {local, session}};

const connection = await import("../../src/shared/connection");
const {saveConnection, servers, defaultServer, setDefaultServer, setServerOrder, renameServer, forgetConnection, upgradeConnections,
  serverForId, revocationToken, token, successor} = connection;
const consent = {version: 3, deviceName: false, at: 1};
const reset = () => {
  for (const key of Object.keys(local.data)) delete local.data[key];
  for (const key of Object.keys(session.data)) delete session.data[key];
  secrets.clear();
  local.data["consent"] = consent;
};
const saved = (server: string) => ({server, tokenId: "t", label: "Brave on Linux", account: "xz"});

// ── the rules ─────────────────────────────────────────────────────────
test("a name from the host: loopback is localhost, a long name its first label, unique by a number, at most 24", () => {
  assert.equal(nameFromHost("http://127.0.0.1:8095", []), "localhost");
  assert.equal(nameFromHost("http://localhost:9000", ["localhost"]), "localhost 2");
  assert.equal(nameFromHost("http://localhost:9001", ["localhost", "Localhost 2"]), "localhost 3");
  assert.equal(nameFromHost("https://seed.example.net", []), "seed.example.net");
  assert.equal(nameFromHost("https://downloads.a-very-long-domain-name.example", []), "downloads");
  assert.equal(nameFromHost("http://192.168.100.200:8080", []), "192.168.100.200");
  assert.ok([...nameFromHost("https://" + "x".repeat(40) + ".com", [])].length <= 24);
});

test("a typed name: trimmed, at most 24 characters, never blank, never another's (any case)", () => {
  assert.equal(cleanName("   Home    box  "), "Home box");
  assert.equal(cleanName("A seedbox with a very long name indeed"), "A seedbox with a very lo");
  assert.equal(nameProblem("   ", []), "blank");
  assert.equal(nameProblem("HOME", ["Home"]), "duplicate");
  assert.equal(nameProblem("Home 2", ["Home"]), null);
});

test("the display order keeps the stored one, drops what is gone, appends what is new; moving clamps", () => {
  assert.deepEqual(displayOrder(["a", "b", "c"], undefined), ["a", "b", "c"]);
  assert.deepEqual(displayOrder(["a", "b", "c"], ["c", "x", "a", "c"]), ["c", "a", "b"]);
  assert.deepEqual(moved(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moved(["a", "b", "c"], "a", 9), ["b", "c", "a"]);
  assert.deepEqual(moved(["a", "b"], "z", 0), ["a", "b"]);
  // Chosen names win over derived ones, which never take a chosen one's place.
  assert.deepEqual(displayNames(["http://localhost:1", "http://localhost:2"], {"http://localhost:2": "localhost"}),
    {"http://localhost:1": "localhost 2", "http://localhost:2": "localhost"});
  assert.equal(successor(["a", "b", "c"], "b"), "c");
  assert.equal(successor(["a", "b", "c"], "c"), "a");
  assert.equal(successor(["a"], "a"), null);
});

// ── the storage ───────────────────────────────────────────────────────
test("saving: a new server joins the end, named from its host; the first is the default; a fourth is refused", async () => {
  reset();
  await saveConnection(saved("http://127.0.0.1:8095"), "tok-a");
  await saveConnection(saved("https://seed.example.net"), "tok-b");
  await saveConnection(saved("https://nas.home.arpa"), "tok-c");
  assert.deepEqual((await servers()).map((item) => [item.name, item.isDefault]),
    [["localhost", true], ["seed.example.net", false], ["nas.home.arpa", false]]);
  await assert.rejects(saveConnection(saved("https://fourth.example"), "tok-d"), (error: Error) => error.message === "too_many");
  assert.equal((await servers()).length, 3);
  assert.equal(secrets.get("token@https://fourth.example"), undefined);
  // Connected again (renewed): its place, name and ID are kept; not a fourth.
  const before = (await servers())[1]!;
  await renameServer(before.server, "Seedbox");
  await saveConnection(saved("https://seed.example.net"), "tok-b2");
  const after = (await servers())[1]!;
  assert.deepEqual([after.name, after.id, secrets.get("token@https://seed.example.net")], ["Seedbox", before.id, "tok-b2"]);
});

test("the default and the order are separate; removing the default hands it to the next in display order", async () => {
  reset();
  for (const server of ["https://a.example", "https://b.example", "https://c.example"]) await saveConnection(saved(server), "tok");
  await setServerOrder(["https://c.example", "https://a.example", "https://b.example"]);
  assert.equal(await defaultServer(), "https://a.example");
  await setDefaultServer("https://c.example");
  assert.deepEqual((await servers()).map((item) => item.server), ["https://c.example", "https://a.example", "https://b.example"]);
  await forgetConnection(false, "https://c.example");
  assert.equal(await defaultServer(), "https://a.example");
  assert.deepEqual(local.data["serverOrder"], ["https://a.example", "https://b.example"]);
  assert.equal(secrets.get("token@https://c.example"), undefined);
  // A non-default one goes: the default stays.
  await forgetConnection(false, "https://b.example");
  assert.equal(await defaultServer(), "https://a.example");
  // The last revoked there: the popup is told; with others left it is not.
  await forgetConnection(true, "https://a.example");
  assert.deepEqual(session.data["pairing"], {state: "failed", failure: "unauthorized"});
});

test("renaming: refused blank or taken, kept otherwise", async () => {
  reset();
  await saveConnection(saved("https://a.example"), "tok");
  await saveConnection(saved("https://b.example"), "tok");
  assert.equal(await renameServer("https://b.example", " "), "blank");
  assert.equal(await renameServer("https://b.example", "A.EXAMPLE"), "duplicate");
  assert.equal(await renameServer("https://b.example", "  Seedbox "), null);
  assert.equal((await servers())[1]!.name, "Seedbox");
});

test("a page's server ID: only a saved server's, never an address", async () => {
  reset();
  await saveConnection(saved("https://a.example"), "tok");
  const [one] = await servers();
  assert.equal(await serverForId(one!.id), "https://a.example");
  assert.equal(await serverForId("https://a.example"), null);
  assert.equal(await serverForId("not-an-id"), null);
  assert.equal(await serverForId(undefined), null);
});

test("upgrade from 1.0.7: the server in use stays the default, named from its host, nothing else changes", async () => {
  reset();
  const server = "http://127.0.0.1:8095";
  local.data["connections"] = {[server]: {server, tokenId: "tok-1", label: "Laptop-Chrome", account: "Una"}};
  local.data["activeServer"] = server;
  secrets.set(`token@${server}`, "dp_fake-token");
  // Read before the upgrade is written: already the same view.
  assert.deepEqual((await servers()).map((item) => [item.name, item.isDefault]), [["localhost", true]]);
  await upgradeConnections();
  assert.deepEqual(local.data["serverOrder"], [server]);
  assert.deepEqual(local.data["serverNames"], {[server]: "localhost"});
  assert.equal(typeof (local.data["serverIds"] as Record<string, string>)[server], "string");
  assert.equal(local.data["activeServer"], server);
  assert.deepEqual(local.data["connections"], {[server]: {server, tokenId: "tok-1", label: "Laptop-Chrome", account: "Una"}});
  const id = (local.data["serverIds"] as Record<string, string>)[server];
  await upgradeConnections();                                      // safe to repeat: the same ID
  assert.equal((local.data["serverIds"] as Record<string, string>)[server], id);
  assert.equal(await token(server), "dp_fake-token");
});

test("EXT-6: the token that revokes is there while held for the disclosure, never for plain HTTP across the internet", async () => {
  reset();
  await saveConnection(saved("https://a.example"), "tok-a");
  local.data["consent"] = {version: 1, deviceName: false, at: 1};         // held: the disclosure changed
  assert.equal(await token("https://a.example"), null);
  assert.equal(await revocationToken("https://a.example"), "tok-a");
  local.data["connections"] = {...(local.data["connections"] as object),
    "http://dp.example.com": {server: "http://dp.example.com", tokenId: "t", label: "", account: ""}};
  secrets.set("token@http://dp.example.com", "tok-public");
  assert.equal(await revocationToken("http://dp.example.com"), null);
});

test("a server without a page ID gets one when the servers are read, kept (never an empty ID)", async () => {
  reset();
  await saveConnection(saved("https://a.example"), "tok");
  await saveConnection(saved("https://b.example"), "tok");
  local.data["serverIds"] = {"https://a.example": "id-a"};
  const read = await servers();
  assert.equal(read[0]!.id, "id-a");
  assert.ok(read[1]!.id);
  assert.equal((local.data["serverIds"] as Record<string, string>)["https://b.example"], read[1]!.id);
  assert.equal(await serverForId(read[1]!.id), "https://b.example");
});

test("Disconnect's answer: revoked; already removed (DownloadPulse's own 401 or 404); anything else is not known to be done", async () => {
  const {disconnectBrowser} = await import("../../src/shared/server");
  const answer = (status: number, body: string, type: string) => {
    (globalThis as unknown as {fetch: unknown}).fetch = async () => new Response(body, {status, headers: {"Content-Type": type}});
  };
  answer(200, "{\"ok\":true}", "application/json");
  assert.equal(await disconnectBrowser("https://a.example", "tok"), "revoked");
  answer(401, JSON.stringify({code: "auth.unauthorized"}), "application/json");
  assert.equal(await disconnectBrowser("https://a.example", "tok"), "already");
  answer(404, JSON.stringify({code: "account.browser_token_not_found"}), "application/json");
  assert.equal(await disconnectBrowser("https://a.example", "tok"), "already");
  answer(404, JSON.stringify({detail: "Not Found"}), "application/json");
  await assert.rejects(disconnectBrowser("https://a.example", "tok"));
  answer(404, "<html>not here</html>", "text/html");
  await assert.rejects(disconnectBrowser("https://a.example", "tok"));
  answer(401, "<html>Sign in</html>", "text/html");
  await assert.rejects(disconnectBrowser("https://a.example", "tok"));
  answer(500, "{}", "application/json");
  await assert.rejects(disconnectBrowser("https://a.example", "tok"));
});
