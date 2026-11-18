"""S3 spike: fixture pages on 127.0.0.1 and 127.0.0.2 (localhost = 127.0.0.1), plus a report sink."""
import http.server, sys, threading
PORT = int(sys.argv[1])
BOX = "width:320px;height:180px;margin:12px;position:relative;display:inline-block;background:#222"
PAGE = f"""<!doctype html><html><head><meta charset=utf-8><title>fixtures</title></head><body style="margin:0;width:1400px">
<div data-fx="plain" style="{BOX}"><video width=320 height=180></video></div>
<div data-fx="overlay" style="{BOX}"><video width=320 height=180></video>
  <div style="position:absolute;inset:0;z-index:2147483647;background:rgba(255,0,0,.1)"></div></div>
<div data-fx="shadow-open" style="{BOX}"></div>
<div data-fx="shadow-closed" style="{BOX}"></div>
<div data-fx="iframe-same" style="{BOX}"><iframe src="http://127.0.0.1:{PORT}/frame" width=320 height=180 style="border:0"></iframe></div>
<div data-fx="iframe-cross" style="{BOX}"><iframe src="http://127.0.0.2:{PORT}/frame" width=320 height=180 style="border:0"></iframe></div>
<div data-fx="late" style="{BOX}"></div>
<div data-fx="no-video" style="{BOX}"><div style="width:320px;height:180px"></div></div>
<script>
const v = () => Object.assign(document.createElement('video'), {{width: 320, height: 180}});
document.querySelector('[data-fx=shadow-open]').attachShadow({{mode: 'open'}}).append(v());
document.querySelector('[data-fx=shadow-closed]').attachShadow({{mode: 'closed'}}).append(v());
setTimeout(() => document.querySelector('[data-fx=late]').append(v()), 2000);
</script></body></html>"""
FRAME = "<!doctype html><html><body style='margin:0'><video width=320 height=180></video></body></html>"
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, b, t="text/html"):
        b = b.encode(); self.send_response(200); self.send_header("Content-Type", t)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self._send(FRAME if self.path.startswith("/frame") else PAGE)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        print("REPORT " + self.rfile.read(n).decode(), flush=True); self._send("ok", "text/plain")
for host in ("127.0.0.1", "127.0.0.2"):
    s = http.server.ThreadingHTTPServer((host, PORT), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
threading.Event().wait()
