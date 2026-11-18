// S3 spike content script (all frames): find the video under a point, through
// overlays and open/closed shadow roots; draw a top-layer button; check it is on top.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  function shadowOf(el) {
    if (el.shadowRoot) return el.shadowRoot;
    if ("openOrClosedShadowRoot" in el) return el.openOrClosedShadowRoot;          // Firefox content scripts
    if (api.dom && api.dom.openOrClosedShadowRoot) return api.dom.openOrClosedShadowRoot(el);  // Chromium
    return null;
  }
  function videoAt(root, x, y, depth = 0) {
    for (const el of root.elementsFromPoint(x, y)) {
      if (el.localName === "video") return el;
      const sr = shadowOf(el);
      if (sr && sr !== root && depth < 8) { const v = videoAt(sr, x, y, depth + 1); if (v) return v; }
    }
    return null;
  }
  let button = null;
  function showButton(video) {
    if (!button) {
      button = document.createElement("div");
      button.setAttribute("popover", "manual");
      const sr = button.attachShadow({mode: "closed"});
      sr.innerHTML = "<span style='display:block;width:28px;height:28px;background:#3b82f6;border-radius:6px'></span>";
      document.documentElement.append(button);
    }
    const r = video.getBoundingClientRect();
    Object.assign(button.style, {position: "fixed", inset: "auto", margin: "0", padding: "0", border: "0",
      width: "28px", height: "28px", left: `${r.right - 36}px`, top: `${r.top + 8}px`, background: "transparent", overflow: "visible"});
    if (!button.matches(":popover-open")) button.showPopover();
    const cx = r.right - 22, cy = r.top + 22;
    return document.elementFromPoint(cx, cy) === button;
  }
  const isTop = window === window.top;
  const results = [];
  function probe(label, x, y) {
    const v = videoAt(document, x, y);
    results.push({fixture: label, found: !!v, buttonOnTop: v ? showButton(v) : null});
    if (button) button.hidePopover();
  }
  const hoverSeen = new Set();
  document.addEventListener("pointermove", (e) => {          // the real event path (driven by Playwright in Chromium)
    const v = videoAt(document, e.clientX, e.clientY); if (!v) return;
    const onTop = showButton(v);
    const fx = (e.composedPath().find(n => n.dataset && n.dataset.fx) || {dataset: {fx: isTop ? "?" : "frame:" + location.hostname}}).dataset.fx;
    if (!hoverSeen.has(fx)) { hoverSeen.add(fx); api.runtime.sendMessage({s3hover: {fixture: fx, buttonOnTop: onTop}}); }
  }, {passive: true});
  setTimeout(() => {
    if (isTop) {
      for (const fx of document.querySelectorAll("[data-fx]")) {
        const label = fx.dataset.fx; if (label.startsWith("iframe")) continue;
        const r = fx.getBoundingClientRect(); probe(label, r.left + r.width / 2, r.top + r.height / 2);
      }
    } else {
      probe(location.hostname === "127.0.0.1" ? "iframe-same (in frame)" : "iframe-cross (in frame)", 160, 90);
    }
    api.runtime.sendMessage({s3: {frame: location.href, isTop, results}});
  }, 3500);
})();
