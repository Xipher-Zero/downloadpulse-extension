// SPDX-License-Identifier: GPL-2.0-or-later
// A fake DownloadPulse speaking the browser pairing contract (DebridPulse
// BROWSER_CLIENT.md §1-2), for the onboarding tests. A test sets ``mode``
// and answers the pending pairing as a person would on the server.
import http from "node:http";

export async function fakeDownloadPulse({port = 0, mode = "current"} = {}) {
  const state = {mode, pairings: new Map(), lastClientName: "", sessionAuth: [], jobs: [], refuse: null};
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
    if (url.pathname === "/api/health") return send(200, {status: "ok", version: "1.0.14"});
    if (url.pathname === "/") return send(200, "<html><body>approval page</body></html>", "text/html");
    if (url.pathname === "/api/browser/v1/pairings" && req.method === "POST") {
      if (state.mode === "too-old") return send(404, {detail: "Not Found"});
      state.lastClientName = body.client_name;
      const userCode = `ABCD-${String(state.pairings.size + 1).padStart(4, "0")}`;
      const deviceCode = `device-${userCode}`;
      state.pairings.set(deviceCode, {userCode, status: "pending"});
      return send(200, {protocol: "debridpulse.browser/1", device_code: deviceCode, user_code: userCode,
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
    if (url.pathname === "/api/browser/v1/session") {
      state.sessionAuth.push({authorization: req.headers.authorization, cookie: req.headers.cookie ?? null});
      if (req.headers.authorization !== "Bearer dp_fake-token") return send(401, {detail: "Unauthorized"});
      return send(200, {protocol: state.mode === "wrong-protocol" ? "debridpulse.browser/0" : "debridpulse.browser/1",
        token: {id: "tok-1", label: "Laptop-Chrome"}, account: {display_name: "Una"}});
    }
    if (url.pathname === "/api/browser/v1/jobs" && req.method === "POST") {
      if (req.headers.authorization !== "Bearer dp_fake-token") return send(401, {detail: "Unauthorized"});
      if (state.refuse) return send(422, {detail: {code: state.refuse, message: "refused", retryable: false}});
      state.jobs.push({body, cookie: req.headers.cookie ?? null});
      return send(201, {id: `job_${state.jobs.length}`, phase: "accepted"});
    }
    return send(404, {detail: "Not Found"});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    state, port: server.address().port,
    answer(status) {
      for (const pairing of state.pairings.values()) if (pairing.status === "pending") pairing.status = status;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
