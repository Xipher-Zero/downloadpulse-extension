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

/**
 * A page that tries to drive the extension's buttons itself (1.0.8, WS-A3; the audit's repro):
 * it defines the custom element the extension's layer used to be (taking its closed shadow root
 * through attachInternals), restyles every element the extension may add with !important, and
 * ``window.attack()`` fakes a hover, a selection and the presses, on whatever it can reach.
 * ``tamper``: what it does to a layer the person's own hover brings up --
 *   "inline": its own inline !important look on the host (fade, scale, filter);
 *   "move": the host moved (its inline left, every frame) to where the page wants a press;
 *   "cover": its own popover raised over the button, letting the press through (pointer-events: none);
 *   "anchor": CSS anchor positioning, switched on later (``html.go``), to carry the button onto its "OK" box;
 *   "flicker": that popover raised over the button 5 frames in 6, leaving it bare one frame in six.
 */
function hostilePage(tamper) {
  return `<!doctype html><html><head><style>
  downloadpulse-layer, :root > div, :root > div[popover], :root > div:popover-open {
    opacity: 0 !important; visibility: hidden !important; transform: scale(30) !important; scale: 30 !important;
    filter: opacity(0) !important; clip-path: inset(50%) !important; zoom: 8 !important; display: none !important;
    width: 100vw !important; height: 100vh !important; padding: 300px !important; left: 0 !important; top: 0 !important;
    --dp-primary: transparent !important; --dp-primary-border: transparent !important; --dp-primary-text: transparent !important;
    transition: opacity 99s !important; pointer-events: none !important; }
  :root > div::before { content: "PLAY" !important; display: block !important; position: fixed !important; inset: 0 !important;
    background: #0a0 !important; }
  </style></head><body style="font:16px sans-serif;margin:20px">
  <p><a id="magnet" href="magnet:?xt=urn:btih:${"a".repeat(40)}&amp;dn=attacker">attacker magnet</a></p>
  <p><a id="torrent" href="/files/private.torrent?passkey=SECRETPASSKEY">private.torrent</a></p>
  <p id="sel">https://evil.example/a.zip https://evil.example/b.zip magnet:?xt=urn:btih:${"1".repeat(40)}</p>
  ${tamper === "anchor" ? `<style>#ok { anchor-name: --ok; } html.go > div { position-anchor: --ok !important;
    position-area: center !important; justify-self: center !important; align-self: center !important; }</style>
    <div id="ok" style="position:fixed;left:500px;top:500px;width:80px;height:40px;background:#ccc">OK</div>` : ""}
  <div id="decoy" popover="manual" style="position:fixed;inset:0;width:100vw;height:100vh;margin:0;border:0;padding:0;
    background:#0a0;pointer-events:none"></div>
  <script>
  window.__internals = [];
  window.__hosts = [];
  customElements.define("downloadpulse-layer", class extends HTMLElement {
    constructor() { super(); window.__internals.push(this.attachInternals()); }
  });
  const tamper = ${JSON.stringify(tamper)};
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1 || node === document.head || node === document.body || window.__hosts.includes(node)) continue;
      window.__hosts.push(node);
      if (tamper === "inline") {
        for (const [name, value] of [["opacity", "0"], ["transform", "scale(20)"], ["filter", "opacity(0)"], ["visibility", "hidden"]]) {
          node.style.setProperty(name, value, "important");
        }
      }
      if (tamper === "move") {
        // A few pixels along, every frame: still where the person's pointer is headed, now over what the page chooses.
        const base = window.__placedLeft = parseFloat(node.style.left);
        const move = () => { node.style.setProperty("left", (base + 6) + "px", "important"); requestAnimationFrame(move); };
        move();
      }
      if (tamper === "cover") setTimeout(() => document.getElementById("decoy").showPopover(), 50);
      if (tamper === "flicker" && !window.__flicker) {
        window.__flicker = true;
        const decoy = document.getElementById("decoy");
        let frame = 0;
        const step = () => {
          const on = frame++ % 6 < 5;
          if (on && !decoy.matches(":popover-open")) decoy.showPopover();
          if (!on && decoy.matches(":popover-open")) decoy.hidePopover();
          requestAnimationFrame(step);
        };
        setTimeout(step, 50);
      }
    }
  }).observe(document.documentElement, {childList: true});
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  function press() {
    let pressed = 0;
    for (const internals of window.__internals) {
      for (const button of internals.shadowRoot?.querySelectorAll("button") ?? []) { button.click(); pressed += 1; }
    }
    for (const host of window.__hosts) {
      const r = host.getBoundingClientRect();
      const at = {bubbles: true, composed: true, clientX: r.left + 5, clientY: r.top + 5, detail: 1};
      host.dispatchEvent(new PointerEvent("pointerdown", at));
      host.dispatchEvent(new PointerEvent("pointerup", at));
      host.dispatchEvent(new MouseEvent("click", at));
      host.click();
      if (host.shadowRoot) for (const button of host.shadowRoot.querySelectorAll("button")) { button.click(); pressed += 1; }
      pressed += 1;
    }
    return pressed;
  }
  window.attack = async () => {
    let pressed = 0;
    for (const id of ["magnet", "torrent"]) {
      const link = document.getElementById(id);
      const r = link.getClientRects()[0];
      const at = {bubbles: true, composed: true, clientX: r.left + 5, clientY: r.top + r.height / 2};
      for (const type of ["pointerover", "pointerenter", "pointermove", "mousemove"]) link.dispatchEvent(new PointerEvent(type, at));
      document.dispatchEvent(new PointerEvent("pointermove", at));
      await sleep(800);
      pressed += press();
    }
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("sel"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
    document.dispatchEvent(new KeyboardEvent("keyup", {bubbles: true, key: "Shift"}));
    await sleep(1200);
    pressed += press();
    // A layer taken out again, put back and shown by the page itself.
    for (const host of window.__hosts) {
      if (!host.isConnected) document.documentElement.append(host);
      try { host.showPopover(); } catch {}
    }
    await sleep(500);
    pressed += press();
    // Keys on whatever has focus.
    for (const key of ["Enter", " "]) {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, composed: true}));
      document.activeElement?.dispatchEvent(new KeyboardEvent("keyup", {key, bubbles: true, composed: true}));
    }
    await sleep(300);
    return {internals: window.__internals.length, hosts: window.__hosts.length, pressed};
  };
  </script></body></html>`;
}

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
    if (url.pathname === "/hostile") {
      res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
      return res.end(hostilePage(url.searchParams.get("tamper") ?? ""));
    }
    if (url.pathname === "/select") {
      // Links to select as a person does (1.0.8: a selection is offered only after the person's own input).
      const u = (i) => `https://files.example/pack/part${i}.rar`;
      res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
      return res.end(`<!doctype html><html><body style="font:16px sans-serif;margin:20px">
        <p id="intro">Release notes, then the parts.</p>
        <div id="block" style="font:14px monospace">${u(1)}<br>${u(2)}<br>${u(3)}</div>
        <p id="para" style="font:14px monospace">${u(4)} ${u(5)}</p>
        <p><span id="all" style="user-select:all;font:14px monospace">${u(6)} ${u(7)}</span></p>
        <p><button id="select-all" onclick="const r = document.createRange(); r.selectNodeContents(document.getElementById('block'));
          getSelection().removeAllRanges(); getSelection().addRange(r);">Select all links</button></p>
        <p id="blank" style="height:120px"></p>
        </body></html>`);
    }
    if (url.pathname === "/kbd") {
      res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
      return res.end(`<!doctype html><html><body style="font:16px sans-serif;margin:20px">
        <p><a id="magnet" href="magnet:?xt=urn:btih:${"c".repeat(40)}&amp;dn=keys">a magnet</a></p></body></html>`);
    }
    if (url.pathname === "/magnets") {
      // More magnets than one selection sends (each its own job, 1.0.8).
      res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
      return res.end(`<!doctype html><html><body style="font:12px monospace;margin:20px">
        <p><a id="one" href="magnet:?xt=urn:btih:${"e".repeat(40)}&amp;dn=one">one more</a></p>
        <div id="all">${Array.from({length: 101}, (_, i) => `magnet:?xt=urn:btih:${i.toString(16).padStart(40, "0")}`).join("<br>")}</div>
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
        <p><a id="pdf" href="/dl/manual.pdf">manual.pdf</a></p>
        <p><a id="unsized" href="/dl/unsized.bin">unsized.bin</a></p>
        <p><a id="big-127" href="http://127.0.0.1:${server.address().port}/dl/big.bin">big.bin on 127.0.0.1</a></p></body></html>`);
    }
    if (url.pathname.startsWith("/dl/")) {
      const name = url.pathname.slice(4);
      // big and manual.pdf: 12 MiB (over the 10 MB default); big trickled so it is still downloading when the extension acts on it.
      // unsized.bin: as big, but sent without its length (1.0.4), so the browser does not know its size.
      const size = name === "small.bin" ? 64 * 1024 : 12 * 1024 * 1024;
      res.writeHead(200, {"Content-Type": name.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
        ...(name === "unsized.bin" ? {} : {"Content-Length": String(size)}),
        "Content-Disposition": `attachment; filename="${name}"`});
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
      }, name === "manual.pdf" ? 5 : 26);   // big: about 5 s in all, as the 8 MiB file took at 40 ms
      res.on("close", () => clearInterval(tick));
      return undefined;
    }
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end("<html><body>other</body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {state, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r))};
}
