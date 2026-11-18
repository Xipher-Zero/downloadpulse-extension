"""S2 spike: report sink, plus a status endpoint the 'poll' variant fetches."""
import http.server, sys
PORT = int(sys.argv[1])
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _ok(self, b=b"ok"):
        self.send_response(200); self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self): self._ok(b'{"active":1}')
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        print("REPORT " + self.rfile.read(n).decode(), flush=True); self._ok()
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
