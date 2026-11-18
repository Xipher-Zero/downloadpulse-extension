"""S1 spike: a 'tracker' that needs a login cookie, and a report sink."""
import http.server, json, sys, threading
from urllib.parse import urlparse
PORT = int(sys.argv[1]); REPORTS = []
COOKIES = ["sess_lax=1; Path=/; SameSite=Lax", "sess_strict=1; Path=/; SameSite=Strict",
           "sess_none=1; Path=/; SameSite=None; Secure", "sess_default=1; Path=/"]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="text/html", extra=()):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code); self.send_header("Content-Type", ctype)
        for k, v in extra: self.send_header(k, v)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/login":
            self._send(200, f"<html><body><h1>tracker</h1><a id=same href='http://127.0.0.1:{PORT}/file.torrent'>same-site torrent</a>"
                            f"<a id=cross href='http://localhost:{PORT}/file.torrent'>cross-site torrent</a></body></html>",
                       extra=[("Set-Cookie", c) for c in COOKIES])
        elif path == "/file.torrent":
            got = sorted(p.split("=")[0].strip() for p in (self.headers.get("Cookie") or "").split(";") if "=" in p)
            self._send(200, json.dumps({"host": self.headers.get("Host"), "cookies": got}), "application/json")
        else:
            self._send(404, "no")
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = self.rfile.read(n).decode()
        REPORTS.append(body); print("REPORT " + body, flush=True); self._send(200, "ok", "text/plain")
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
