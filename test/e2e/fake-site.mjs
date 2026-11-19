// SPDX-License-Identifier: GPL-2.0-or-later
// A fake website for the submission-surface tests: links of every kind, a
// .torrent behind a sign-in cookie, a "sign-in page" answering for a
// .torrent, plain-text URLs and a video.
import http from "node:http";

export const TORRENT = Buffer.from("d4:infod6:lengthi1024e4:name8:file.iso12:piece lengthi16384e6:pieces20:"
  + "\0".repeat(20) + "ee", "latin1");

export async function fakeSite() {
  const state = {requests: []};
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://site");
    state.requests.push({path: url.pathname + url.search, cookie: req.headers.cookie ?? null});
    if (url.pathname === "/page") {
      res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
      return res.end(`<!doctype html><html><body style="font:16px sans-serif;margin:20px">
        <p><a id="zip" href="/files/archive.zip">archive.zip</a></p>
        <div id="mover" style="font:14px monospace"><a id="moverlink" href="/files/moved.zip">moved.zip</a>
          <span id="movertext">https://a.example/x.rar https://b.example/y.rar</span></div>
        <div style="display:flex;width:800px;font:16px sans-serif"><a id="row" style="flex:1 1 auto"
          href="/files/release-x86_64.AppImage">release-x86_64.AppImage</a><span>1 download · 235 MiB</span></div>
        <p style="width:150px;font:16px sans-serif"><a id="wrapped" href="/files/a-name-that-wraps.iso">a long file name that wraps onto lines.iso</a></p>
        <p><a id="about" href="/about">About this site</a></p>
        <p><a id="magnet" href="magnet:?xt=urn:btih:${"d".repeat(40)}&dn=thing">A magnet</a></p>
        <p><a id="torrent" href="/files/private.torrent?passkey=SECRETPASSKEY">private.torrent</a></p>
        <p><a id="login" href="/files/needs-login.torrent">needs-login.torrent</a></p>
        <p id="text">Mirror: https://203.0.113.20/releases/disc.iso today</p>
        <video id="video" width="320" height="180" style="background:#000"></video>
        <button id="full" onclick="document.querySelector('#video').requestFullscreen()">Fullscreen</button>
        <p><a id="thumb" href="/watch?v=inside"><video width="160" height="90" style="background:#222"></video></a></p>
        <div id="overlaid" style="position:relative;width:160px;height:90px"><video width="160" height="90" style="background:#333"></video>
          <a href="/watch?v=over" style="position:absolute;inset:0;z-index:1"></a></div>
        <div id="live" style="font:14px monospace">https://1fichier.com/?j93yc0n4g08jsox2nipk<br>https://rapidgator.net/file/119ce5/GF161126-HITC-RN.rar.html<br>https://gofile.io/d/AM5Js2xh</div>
        <textarea id="box" rows="3" cols="60">https://pixeldrain.com/u/a4J8buzm
https://send.now/ijn6gxxf9bj8</textarea>
        <p id="one">See https://example.org/about for details.</p>
        <div id="rows" style="font:14px monospace;width:700px"><div>https://datanodes.to/wcqpgqc6jdh8/GF161126-HITC-RN.rar</div><div>https://ddownload.com/pu8xjt8cajxq/GF161126-HITC-RN.rar</div><div style="height:60px"></div></div>
        <div style="height:1600px"></div>
      </body></html>`);
    }
    if (url.pathname === "/files/private.torrent") {
      if (!(req.headers.cookie ?? "").includes("site_session=signed-in")) {
        res.writeHead(403, {"Content-Type": "text/plain"});
        return res.end("forbidden");
      }
      res.writeHead(200, {"Content-Type": "application/x-bittorrent",
        "Content-Disposition": 'attachment; filename="private.torrent"'});
      return res.end(TORRENT);
    }
    if (url.pathname === "/files/needs-login.torrent") {
      res.writeHead(200, {"Content-Type": "text/html"});
      return res.end("<html><body>Please sign in</body></html>");
    }
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end("<html><body>other</body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {state, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r))};
}
