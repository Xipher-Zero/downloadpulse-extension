// SPDX-License-Identifier: GPL-2.0-or-later
// A fake website for the submission-surface tests: links of every kind, a
// .torrent behind a sign-in cookie, a "sign-in page" answering for a
// .torrent, plain-text URLs and a video.
import http from "node:http";

export const TORRENT = Buffer.from("d4:infod6:lengthi1024e4:name8:file.iso12:piece lengthi16384e6:pieces20:"
  + "\0".repeat(20) + "ee", "latin1");
// An NZB as a newznab indexer serves it: XML, its name in the head.
export const NZB = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" '
  + '"http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">\n<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><head>'
  + '<meta type="name">The.Odyssey.2026.2160p</meta></head><file poster="p" date="1" subject="s"><groups>'
  + '<group>alt.binaries.test</group></groups><segments><segment bytes="1" number="1">a@b</segment></segments></file></nzb>');

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
        <p><a id="redirecting" href="/files/redirecting.torrent">redirecting.torrent</a></p>
        <p><a id="endless" href="/files/endless.torrent">endless.torrent</a></p>
        <p><a id="public-http" href="http://203.0.113.9/files/public.torrent?passkey=SECRETPUBLIC">public.torrent</a></p>
        <p><a id="indexer" href="/cdn?t=get&amp;id=c59de97c&amp;apikey=SECRETINDEXERKEY">Get NZB</a></p>
        <p><a id="indexer-unnamed" href="/api?t=get&amp;id=nameless&amp;apikey=SECRETINDEXERKEY">Get</a></p>
        <p><a id="indexer-refused" href="/api?t=get&amp;id=over-limit&amp;apikey=SECRETINDEXERKEY">Get (limit)</a></p>
        <p id="indexer-limit">http://${req.headers.host}/api?t=get&amp;id=over-limit&amp;apikey=SECRETINDEXERKEY</p>
        <p id="indexer-text">http://${req.headers.host}/cdn?t=get&amp;id=c59de97c&amp;apikey=SECRETINDEXERKEY http://${req.headers.host}/api?t=get&amp;id=nameless&amp;apikey=SECRETINDEXERKEY</p>
        <p id="text">Mirror: https://203.0.113.20/releases/disc.iso today</p>
        <div style="position:relative;width:320px;height:180px"><video id="video" width="320" height="180" style="background:#000"></video>
          <svg id="play-icon" viewBox="0 0 24 24" width="40" height="40" style="position:absolute;left:140px;top:70px"><path d="M8 5v14l11-7z" fill="#fff"/></svg></div>
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
      <div id="many" style="font:12px monospace">${Array.from({length: 101}, (_, i) => `https://example.com/f/${i}.zip`).join("<br>")}</div>
        </body></html>`);
    }
    if (url.pathname === "/files/endless.torrent") {
      // No Content-Length, and no end (1 MB every 50 ms, for minutes): a reader that waits for the
      // whole body never finishes; one that counts as it reads stops at the 16 MB a .torrent may be.
      res.writeHead(200, {"Content-Type": "application/x-bittorrent"});
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      let sent = 0;
      const timer = setInterval(() => {
        if (res.destroyed || sent >= 4000) { clearInterval(timer); return res.destroyed || res.end(); }
        sent += 1;
        res.write(chunk);
      }, 50);
      res.on("close", () => clearInterval(timer));
      return;
    }
    if (url.pathname === "/files/redirecting.torrent") {
      // A redirect to another address (the reviewer's case: HTTPS to HTTP); the extension must not follow it.
      res.writeHead(302, {Location: `http://${req.headers.host}/files/redirect-target.torrent?passkey=SECRETREDIRECT`});
      return res.end();
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
    if ((url.pathname === "/cdn" || url.pathname === "/api") && url.searchParams.get("t") === "get") {
      // A newznab indexer: the NZB, or (its limit reached) an <error> document, both with 200.
      const id = url.searchParams.get("id");
      if (id === "over-limit") {
        res.writeHead(200, {"Content-Type": "application/xml"});
        return res.end('<?xml version="1.0" encoding="UTF-8"?><error code="429" description="Request limit reached"/>');
      }
      res.writeHead(200, {"Content-Type": "application/x-nzb",
        ...(id === "nameless" ? {} : {"Content-Disposition": 'attachment; filename="The.Odyssey.2026.1080p.nzb"'})});
      return res.end(NZB);
    }
    if (url.pathname === "/files/needs-login.torrent") {
      res.writeHead(200, {"Content-Type": "text/html"});
      return res.end("<html><body>Please sign in</body></html>");
    }
    // Browser downloads (1.0.2): a page of attachment links, and the attachments themselves.
    if (url.pathname === "/downloads") {
      res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
      return res.end(`<!doctype html><html><body>
        <p><a id="big" href="/dl/big.bin">big.bin</a></p>
        <p><a id="small" href="/dl/small.bin">small.bin</a></p>
        <p><a id="pdf" href="/dl/manual.pdf">manual.pdf</a></p></body></html>`);
    }
    if (url.pathname.startsWith("/dl/")) {
      const name = url.pathname.slice(4);
      // big: 8 MiB, trickled so it is still downloading when the extension acts on it.
      const size = name === "small.bin" ? 64 * 1024 : name === "manual.pdf" ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
      res.writeHead(200, {"Content-Type": name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
        "Content-Length": String(size), "Content-Disposition": `attachment; filename="${name}"`});
      if (name === "small.bin") return res.end(Buffer.alloc(size, 1));
      let sent = 0;
      const chunk = Buffer.alloc(64 * 1024, 2);
      const tick = setInterval(() => {
        if (res.destroyed || sent >= size) {
          clearInterval(tick);
          if (!res.destroyed) res.end();
          return;
        }
        res.write(chunk);
        sent += chunk.length;
      }, name === "big.bin" ? 40 : 5);
      res.on("close", () => clearInterval(tick));
      return undefined;
    }
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end("<html><body>other</body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {state, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r))};
}
