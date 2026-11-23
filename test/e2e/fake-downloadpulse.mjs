// SPDX-License-Identifier: GPL-2.0-or-later
// A fake DownloadPulse speaking the browser pairing contract (DebridPulse
// BROWSER_CLIENT.md §1-2), for the onboarding tests. A test sets ``mode``
// and answers the pending pairing as a person would on the server.
import http from "node:http";

export async function fakeDownloadPulse({port = 0, mode = "current"} = {}) {
  const state = {mode, pairings: new Map(), lastClientName: "", sessionAuth: [], jobs: [], refuse: null,
    views: new Map(), seq: 0, listPolls: [], controls: [], declineControl: null,
    desktop: false, shows: 0, down: false, keys: new Map(), dropNext: false, submits: 0, videoCookies: true, referrer: true,
    settleAs: null,
    appearance: {mode: "dark", dark_palette: "debridpulse-dark", light_palette: "debridpulse-light"}};
  // A job's public view (DebridPulse BROWSER_CLIENT.md §2a), moved by ``setJob``.
  const touch = (view) => { view.cursor = ++state.seq; state.views.set(view.id, view); return view; };
  const server = http.createServer(async (req, res) => {
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    });
    const send = (status, value, type = "application/json") => {
      res.writeHead(status, {"Content-Type": type});
      res.end(type === "application/json" ? JSON.stringify(value) : value);
    };
    const url = new URL(req.url, "http://fake");
    if (state.mode === "not-downloadpulse") return send(200, "<html>a router</html>", "text/html");
    // ``proxy``: a sign-in gate in front of DownloadPulse, redirecting everything to its login.
    if (state.mode === "proxy") { res.writeHead(302, {Location: "/login"}); return res.end(); }
    // ``down``: answering, but not DownloadPulse's API (as a stopped or restarting server's proxy would).
    if (state.down && url.pathname.startsWith("/api/browser/v1/")) return send(503, {detail: "Service Unavailable"});
    if (url.pathname === "/api/health") return send(200, {status: "ok", version: "1.0.14"});
    if (url.pathname === "/") return send(200, "<html><body>approval page</body></html>", "text/html");
    if (url.pathname === "/api/browser/v1/pairings" && req.method === "POST") {
      if (state.mode === "too-old") return send(404, {detail: "Not Found"});
      // An older DownloadPulse refuses an extension origin before routing.
      if (state.mode === "forbidden-origin") return send(403, "Forbidden origin", "text/plain");
      state.lastClientName = body.client_name;
      const userCode = `ABCD-${String(state.pairings.size + 1).padStart(4, "0")}`;
      const deviceCode = `device-${userCode}`;
      state.pairings.set(deviceCode, {userCode, status: "pending"});
      return send(200, {protocol: state.mode === "previous-name" ? "debridpulse.browser/1" : "downloadpulse.browser/1", device_code: deviceCode, user_code: userCode,
        verification_path: `/?connect-browser=${userCode}`, expires_in: 600, interval: 2});
    }
    if (url.pathname === "/api/browser/v1/pairings/poll" && req.method === "POST") {
      const pairing = state.pairings.get(body.device_code);
      if (!pairing) return send(200, {status: "expired"});
      if (pairing.status === "approved") {
        state.pairings.delete(body.device_code);
        return send(200, {status: "approved", token: "dp_fake-token", token_id: "tok-1", label: "Laptop-Chrome"});
      }
      if (pairing.status !== "pending") state.pairings.delete(body.device_code);
      return send(200, {status: pairing.status, interval: 2});
    }
    if (url.pathname === "/api/browser/v1/session" && req.method === "DELETE") {
      state.disconnects = (state.disconnects ?? 0) + 1;
      if (req.headers.authorization !== "Bearer dp_fake-token") return send(401, {detail: "Unauthorized"});
      state.revoked = true;
      return send(200, {ok: true});
    }
    if (state.revoked && url.pathname.startsWith("/api/browser/v1/") && !url.pathname.startsWith("/api/browser/v1/pairings")) {
      return send(401, {detail: "Unauthorized"});
    }
    if (url.pathname === "/api/browser/v1/application/show" && req.method === "POST") {
      // The installed desktop application brings its window forward; a server has none.
      if (state.mode === "too-old") return send(404, {detail: "Not Found"});
      if (state.desktop) state.shows += 1;
      return send(200, {desktop: state.desktop});
    }
    if (url.pathname === "/api/browser/v1/session") {
      state.sessionAuth.push({authorization: req.headers.authorization, cookie: req.headers.cookie ?? null});
      if (req.headers.authorization !== "Bearer dp_fake-token") return send(401, {detail: "Unauthorized"});
      return send(200, {protocol: state.mode === "wrong-protocol" ? "downloadpulse.browser/0"
        : state.mode === "previous-name" ? "debridpulse.browser/1" : "downloadpulse.browser/1",
        token: {id: "tok-1", label: "Laptop-Chrome"}, account: {display_name: "Una"},
        ...(state.appearance ? {appearance: state.appearance} : {}),
        // A DownloadPulse that takes the links' cookies says so (``videoCookies``; an older one says
        // nothing); 1.0.2 also takes the page they came from (``referrer``).
        ...(state.videoCookies || state.referrer ? {capabilities: {
          ...(state.videoCookies ? {cookies: {max_count: 300, max_bytes: 32768, sources: ["links"]}} : {}),
          ...(state.referrer ? {referrer: {max_length: 2048, sources: ["links"]}} : {})}} : {})});
    }
    if (url.pathname === "/api/browser/v1/jobs" && req.method === "POST") {
      if (req.headers.authorization !== "Bearer dp_fake-token") return send(401, {detail: "Unauthorized"});
      if (state.refuse) return send(422, {detail: {code: state.refuse, message: "refused", retryable: false}});
      state.submits += 1;
      // DebridPulse's idempotency: the same key answers the same job (200), never a second one.
      const known = state.keys.get(body.idempotency_key);
      if (known) return send(200, state.views.get(known));
      state.jobs.push({body, cookie: req.headers.cookie ?? null});
      const id = `job_${state.jobs.length}`;
      state.keys.set(body.idempotency_key, id);
      // ``dropNext``: the job is made, but no answer comes before the extension's 8 s timeout
      // (a connection reset alone is retried by the browser itself, so it would prove nothing).
      if (state.dropNext) {
        state.dropNext = false;
        touch({id, submitted_at: new Date().toISOString(), display_name: body.display_name ?? "", name: "placeholder",
          source: {kind: body.source?.kind}, phase: "accepted", reason: "awaiting_resolution", actionability: "wait",
          paused_by: null, progress: null, estimate: null});
        return setTimeout(() => req.socket.destroy(), 9500);
      }
      touch({id, submitted_at: new Date().toISOString(), display_name: body.display_name ?? "",
        name: body.display_name || "placeholder",
        source: {kind: body.source?.kind}, phase: "accepted", reason: "awaiting_resolution", actionability: "wait",
        paused_by: null, progress: null, estimate: null});
      // ``settleAs``: the job settles at once, before the answer (a fast failure), as DownloadPulse may.
      if (state.settleAs) touch({...state.views.get(id), ...state.settleAs});
      return send(201, {...state.views.get(id), phase: "accepted", reason: "awaiting_resolution"});
    }
    if (url.pathname === "/api/browser/v1/jobs" && req.method === "GET") {
      if (req.headers.authorization !== "Bearer dp_fake-token") return send(401, {detail: "Unauthorized"});
      const after = Number(url.searchParams.get("after") ?? 0);
      state.listPolls.push(Date.now());
      const jobs = [...state.views.values()].filter((view) => view.cursor > after).sort((a, b) => a.cursor - b.cursor);
      const answer = {jobs, next_cursor: jobs.length ? jobs.at(-1).cursor : after, more: false};
      // ``listDelay``: the listing is read now and answered later (a slow server, a slow link).
      if (state.listDelay) return setTimeout(() => send(200, answer), state.listDelay);
      return send(200, answer);
    }
    const control = /^\/api\/browser\/v1\/jobs\/([^/]+)\/(controls|withdraw)$/.exec(url.pathname);
    if (control && req.method === "POST") {
      const view = state.views.get(decodeURIComponent(control[1]));
      if (!view) return send(404, {detail: {code: "job_not_found"}});
      if (control[2] === "withdraw") {
        touch({...view, phase: "withdrawn", reason: "withdrawn_by_client", actionability: "none"});
        return send(200, {ok: true});
      }
      state.controls.push(body);
      if (state.declineControl) return send(200, {disposition: "declined", reason: state.declineControl});
      touch(body.kind === "pause" ? {...view, reason: "paused", paused_by: "client"}
        : {...view, reason: "downloading", paused_by: null});
      return send(200, {disposition: "honored", reason: body.kind === "pause" ? "paused" : "resumed"});
    }
    return send(404, {detail: "Not Found"});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    state, port: server.address().port,
    setJob(id, fields) {
      return touch({...state.views.get(id), ...fields});
    },
    answer(status) {
      for (const pairing of state.pairings.values()) if (pairing.status === "pending") pairing.status = status;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
