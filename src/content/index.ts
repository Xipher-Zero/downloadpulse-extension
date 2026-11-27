// SPDX-License-Identifier: GPL-2.0-or-later
// The in-page surfaces (WS-E2 B3, B4, B6), in every frame: the hover icon
// beside a download link, the video-player button, and the quiet toast that
// answers a submission. Each is drawn in the top layer (popover) inside a
// closed shadow root, so no page style or overlay reaches it (spike S3).
//
// This script makes no network request, reads no storage and holds no
// secret (WS-E2 §3): it asks the background whether it may offer anything,
// and hands the background a URL to send.
//
// The page it runs in is not trusted to drive it (1.0.8, WS-A3): a button is
// placed, shown and pressed only by the person's own input (``isTrusted``),
// its host is a built-in element whose look and place no page style or script
// can change unnoticed, and a press counts only on a button that was drawn,
// unhidden and uncovered, where the person pressed, for long enough to be seen.
// Where the browser can't say whether a button is covered (Gecko), a frame
// offers no buttons, nor a page with anything of its own in the top layer.

import {parseAppearance} from "../shared/appearance";
import {extractUrls, isDownloadCandidate, isIndexerLink, urlAt} from "../shared/classify";
import {message} from "../shared/i18n";
import {pageColours, type PageColours} from "../shared/page-theme";

const BUTTON = 22;
const HIDE_DELAY_MS = 300;
const GAP = 8;   // between a link's text and the icon
const SLACK = 4; // around a link's text, still on it
const TOAST_MS = 3500;
/**
 * A press counts only on a button that had stood still where it is drawn this long when the person
 * pressed it (operator, 2026-11-27): about the quickest a person reacts to something that appears
 * (simple visual reaction time is some 200-250 ms), so a press this soon can't be aimed at the
 * button -- it was already on its way to whatever the button came up over. A person who sees the
 * button and moves to it takes longer, so they never meet this.
 */
const STILL_MS = 200;
/** A selection made this soon after the person's own pointer or key input is theirs; later, the page's. */
const INPUT_WINDOW_MS = 1000;
interface Offer { hover: boolean; video: boolean; colours: PageColours }
const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
let offer: Offer | null = null;
let askedAt = 0;
let asking: Promise<Offer> | null = null;

/** What this frame may offer, as the background says (connected, and the person's settings for this site).
 * Kept for 5 s; once that has passed, every caller waits for the one fresh answer (never the expired one). */
function mayOffer(): Promise<Offer> {
  if (offer !== null && Date.now() - askedAt < 5_000) return Promise.resolve(offer);
  asking ??= ask().finally(() => { asking = null; });
  return asking;
}

async function ask(): Promise<Offer> {
  let fresh: Offer;
  try {
    const state = await chrome.runtime.sendMessage({type: "dp-state"}) as
      {hover?: boolean; video?: boolean; appearance?: unknown} | undefined;
    fresh = {hover: Boolean(state?.hover), video: Boolean(state?.video),
      colours: pageColours(parseAppearance(state?.appearance), prefersDark() ? "dark" : "light")};
  } catch {
    fresh = {hover: false, video: false, colours: pageColours(null, prefersDark() ? "dark" : "light")};
  }
  offer = fresh;
  askedAt = Date.now();
  paint(fresh.colours);
  return fresh;
}

// The page surfaces in the person's DownloadPulse theme (src/shared/page-theme.ts):
// the send button is DownloadPulse's primary button material, a toast its
// surface with the state colour along its edge. Set on each layer's host.
// The host's look and place (1.0.8, WS-A3): set here with !important, which outranks any page rule
// or inline style on the host (an important declaration inside a shadow tree wins over the outer
// one), so a page can't hide, fade, scale, clip or cover the button. Where it stands is its inline
// left/top, also !important, checked against the extension's own record before a press counts.
const HOST_STYLE: Record<string, string> = {
  position: "fixed", margin: "0", padding: "0", border: "0", background: "transparent", overflow: "visible",
  width: "auto", height: "auto", "min-width": "0", "min-height": "0", "max-width": "none", "max-height": "none",
  "box-sizing": "content-box", "box-shadow": "none", outline: "none", float: "none", opacity: "1", visibility: "visible",
  transform: "none", translate: "none", scale: "none", rotate: "none", "offset-path": "none", zoom: "1",
  filter: "none", "backdrop-filter": "none", "clip-path": "none", clip: "auto", mask: "none", "-webkit-mask-box-image": "none",
  "mix-blend-mode": "normal", "z-index": "2147483647", "pointer-events": "auto", transition: "none", animation: "none",
  "content-visibility": "visible", contain: "none", "will-change": "auto", perspective: "none",
  // Anchor positioning and self-alignment move an absolutely placed box without touching its left/top
  // (review, 2026-11-27); view transitions and anchors let a page draw over or beside it as its own.
  "position-area": "none", "inset-area": "none", "position-anchor": "auto", "position-try-fallbacks": "none",
  "position-try-order": "normal", "position-visibility": "always", "anchor-name": "none", "anchor-scope": "none",
  "justify-self": "auto", "align-self": "auto", "place-self": "auto", "view-transition-name": "none",
  "writing-mode": "horizontal-tb",
};
const HOST_RULES = Object.entries(HOST_STYLE).map(([name, value]) => `${name}: ${value} !important;`).join(" ");
const STYLE = `
  :host { all: initial; }
  :host(:popover-open) { ${HOST_RULES} display: block !important; }
  :host(:not(:popover-open)) { display: none !important; }
  :host::before, :host::after { content: none !important; display: none !important; }
  :host::backdrop { display: none !important; background: none !important; }
  button { all: unset; box-sizing: border-box; width: ${BUTTON}px; height: ${BUTTON}px; border-radius: 50%;
    display: grid; place-items: center; cursor: pointer; background: var(--dp-primary);
    border: 1px solid var(--dp-primary-border); color: var(--dp-primary-text);
    box-shadow: 0 1px 4px rgba(0,0,0,.35); transition: filter .14s ease; }
  button:hover { filter: brightness(1.08); }
  button:focus-visible { box-shadow: 0 0 0 3px var(--dp-focus); }
  svg { width: 13px; height: 13px; }
  .count { position: absolute; inset-block-start: -7px; inset-inline-end: -9px; min-width: 15px; height: 15px;
    padding: 0 4px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center;
    font: 700 10px/1 system-ui, sans-serif; color: var(--dp-text); background: var(--dp-surface);
    border: 1px solid var(--dp-primary-border); }
  .batch { position: relative; }
  .toast { font: 13px/1.35 system-ui, sans-serif; padding: 8px 12px; border-radius: 8px; max-width: 320px;
    color: var(--dp-text); background: var(--dp-surface); border: 1px solid var(--dp-border);
    border-inline-start: 4px solid var(--dp-success); box-shadow: 0 4px 16px rgba(0,0,0,.3); cursor: pointer;
    /* It fades out as it is withdrawn from the page (TOAST_MS + 300 ms: removed). */
    animation: dp-toast-leave .3s ease ${TOAST_MS}ms forwards; }
  @keyframes dp-toast-leave { to { opacity: 0; visibility: hidden; } }
  .toast.error { border-inline-start-color: var(--dp-error); }`;
const layers: Layer[] = [];

/** Every layer in the theme's colours. */
function paint(colours: PageColours): void {
  for (const made of layers) colour(made, colours);
}

/** The theme's colours as the layer's own custom properties, set inside its shadow root with
 * !important: a page rule on the host (``--dp-primary: transparent !important``) can't blank the button. */
function colour(made: Layer, colours: PageColours): void {
  made.colours.textContent = `:host { ${Object.entries({primary: colours.primary, "primary-border": colours.primaryBorder,
    "primary-text": colours.primaryText, focus: colours.focus, surface: colours.surface, text: colours.text,
    border: colours.border, success: colours.success, error: colours.error})
    // The extension's own palette values; anything that could end the declaration is left out.
    .filter(([, value]) => !/[;{}<>\\]/.test(value))
    .map(([name, value]) => `--dp-${name}: ${value} !important;`).join(" ")} }`;
}
const SVG = "http://www.w3.org/2000/svg";

/** The download arrow, built from elements (no markup strings in a page). */
function arrow(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of [["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"],
    ["stroke-width", "2.5"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]]) {
    svg.setAttribute(name!, value!);
  }
  for (const d of ["M12 4v12", "m6 11 6 6 6-6", "M5 20h14"]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * A layer the extension draws on a page, and whether it is shown -- its own record, never read
 * back from the page: where it put it (``at``), where it is drawn (``drawn``: the box the browser
 * reports, looked at every frame) and since when it has been drawn there (``placedAt``), since when
 * it has been up (``shownAt``), since when the browser has seen it drawn and uncovered
 * (``seenSince``), and the person's last press on its button (``pressedAt``).
 */
interface Layer {
  host: HTMLElement; root: ShadowRoot; colours: HTMLStyleElement; shown: boolean;
  at: Record<string, string>; drawn: DOMRect | null; placedAt: number; shownAt: number; seenSince: number | null;
  pressedAt: number;
}

/**
 * Whether the browser can say a layer is drawn uncovered (Intersection Observer v2, Chromium):
 * then it is watched, and a press counts only while it is. Elsewhere (Gecko) the page's own
 * top-layer elements are compared instead (``coveredByPage``).
 */
const seesCover = typeof IntersectionObserverEntry !== "undefined" && "isVisible" in IntersectionObserverEntry.prototype;
/**
 * Whether this frame may draw buttons at all. In a frame, the page around it can fade or cover it
 * where nothing inside the frame can see (an iframe at opacity 0, a decoy above it): only where the
 * browser itself says a button is drawn uncovered (Chromium) are buttons offered in frames
 * (operator, 2026-11-27). Elsewhere a frame offers none; right-click and Firefox's URL-bar icon still send.
 */
const buttonsHere = seesCover || window === window.top;
const sight = seesCover ? new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const made = layers.find((item) => item.host === entry.target);
    if (!made) continue;
    const seen = entry.isIntersecting && (entry as IntersectionObserverEntry & {isVisible?: boolean}).isVisible === true;
    made.seenSince = seen ? (made.seenSince ?? entry.time) : null;
  }
}, {threshold: [0, 1], trackVisibility: true, delay: 100} as IntersectionObserverInit) : null;

/** Its look and place, set on the host itself as well, !important (a page's own rules lose to both). */
function harden(made: Layer): void {
  for (const [name, value] of [...Object.entries(HOST_STYLE), ...Object.entries(made.at)]) {
    made.host.style.setProperty(name, value, "important");
  }
}

function layer(): Layer {
  // A built-in element (1.0.8, WS-A3): a page can define a custom element of any name the
  // extension might use, run its own code as it is made and take its closed shadow root
  // (attachInternals); it can define no element called div.
  const host = document.createElement("div");
  host.setAttribute("popover", "manual");
  const root = host.attachShadow({mode: "closed"});
  const style = document.createElement("style");
  style.textContent = STYLE;
  const colours = document.createElement("style");
  root.append(style, colours);
  const made: Layer = {host, root, colours, shown: false, at: {inset: "auto"}, drawn: null, placedAt: 0, shownAt: 0,
    seenSince: null, pressedAt: -Infinity};
  layers.push(made);
  colour(made, offer?.colours ?? pageColours(null, prefersDark() ? "dark" : "light"));
  harden(made);
  sight?.observe(host);
  return made;
}

/** Where a layer stands: its own record, set on the host (!important). Moved, it must stand still again before a press counts. */
function stand(target: Layer, at: Record<string, string>): void {
  for (const [name, value] of Object.entries(at)) target.host.style.setProperty(name, value, "important");
  // Kept as the browser writes it (it rounds a length), to compare with what the host says later.
  const written = Object.fromEntries(Object.keys(at).map((name) => [name, target.host.style.getPropertyValue(name)]));
  if (JSON.stringify(written) !== JSON.stringify(target.at)) target.placedAt = performance.now();
  target.at = written;
  harden(target);
}

/**
 * Where the layer is drawn now, as the browser lays it out -- whatever moved it (its place, a page
 * rule, a zoom): changed, it has just been placed there, and must stand still again before a press
 * counts. Answers whether it moved.
 */
function settle(target: Layer): boolean {
  const box = target.host.getBoundingClientRect();
  const was = target.drawn;
  if (was && Math.abs(box.left - was.left) <= 1 && Math.abs(box.top - was.top) <= 1
      && Math.abs(box.width - was.width) <= 1 && Math.abs(box.height - was.height) <= 1) return false;
  target.drawn = box;
  // Seen uncovered only from now on, where it now stands.
  if (target.seenSince !== null) target.seenSince = performance.now();
  target.placedAt = performance.now();
  return true;
}

/** A send button: placed and shown, only where this frame may draw one and nothing of the page's is in the top layer it can't see past. */
function place(target: Layer, left: number, top: number): void {
  if (!buttonsHere || (!seesCover && pageTopLayerOpen())) {
    withdraw(target);
    return;
  }
  // A page that zooms its root (html { zoom: 1.5 }) zooms the layer too, its place with it: the place
  // is given in the root's zoomed pixels, so the button stands where it was meant to (review, 2026-11-27).
  const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
  const x = Math.max(2, Math.min(left, innerWidth - BUTTON * zoom - 2));
  const y = Math.max(2, Math.min(top, innerHeight - BUTTON * zoom - 2));
  stand(target, {left: `${x / zoom}px`, top: `${y / zoom}px`, right: "auto", bottom: "auto"});
  reveal(target);
  settle(target);
}

/**
 * Shown by putting the layer into the page and withdrawn by taking it out
 * (operator, 2026-11-18), with the extension's own record of which: the
 * browser's popover state is never read back to decide. The top layer is only
 * how it stays above the page.
 */
function reveal(target: Layer): void {
  if (!target.host.isConnected) document.documentElement.append(target.host);
  const fresh = !target.shown;
  if (fresh) target.placedAt = target.shownAt = performance.now();
  harden(target);
  target.shown = true;
  try {
    if (!target.host.matches(":popover-open")) target.host.showPopover();
  } catch {
    // already in the top layer: it is in the page and drawn either way
  }
  // Up again: watched afresh, so the browser says anew whether it is drawn uncovered (it reports only
  // changes, and one taken out and put back between two looks has not changed for it).
  if (fresh && sight) {
    target.seenSince = null;
    sight.unobserve(target.host);
    sight.observe(target.host);
  }
}

/** Withdraw a layer: out of the page entirely (operator, 2026-11-18), never left there hidden. */
function withdraw(target: Layer | null): void {
  if (!target) return;
  target.shown = false;
  target.seenSince = null;
  target.drawn = null;
  try {
    if (target.host.matches(":popover-open")) target.host.hidePopover();
  } catch {
    // a page that moved or removed the layer
  }
  target.host.remove();
}

// ── what the person saw (1.0.8, WS-A3) ────────────────────────────────────

const TOP_LAYER = [":popover-open", ":modal", ":fullscreen"];
const SHADOW_DEPTH = 8;

/**
 * Whether anything of the page's own is in the top layer (a popover, a modal dialog, fullscreen),
 * in its shadow trees too: drawn above the extension's layers or not, the extension can't tell
 * where the browser can't say (Gecko). Shadow trees nested deeper than it looks count as such.
 */
function pageTopLayerScan(): boolean {
  const ours = new Set<Element>(layers.map((item) => item.host));
  const look = (root: Document | ShadowRoot, depth: number): boolean => {
    for (const selector of TOP_LAYER) {
      try {
        for (const element of root.querySelectorAll(selector)) if (!ours.has(element)) return true;
      } catch {
        // a selector this browser does not know
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const inner = ours.has(node as Element) ? null : shadowOf(node as Element);
      if (!inner) continue;
      if (depth >= SHADOW_DEPTH || look(inner, depth + 1)) return true;
    }
    return false;
  };
  return look(document, 0);
}

/** ``pageTopLayerScan``, its full walk at most every 100 ms (it is asked every frame a button is up); the page's own document every time. */
let scannedAt = -Infinity;
let scanned = false;
function pageTopLayerOpen(): boolean {
  const ours = new Set<Element>(layers.map((item) => item.host));
  for (const selector of TOP_LAYER) {
    try {
      for (const element of document.querySelectorAll(selector)) if (!ours.has(element)) return true;
    } catch {
      // a selector this browser does not know
    }
  }
  const now = performance.now();
  if (now - scannedAt >= 100) {
    scanned = pageTopLayerScan();
    scannedAt = now;
  }
  return scanned;
}

/** When the page last put something of its own into the top layer (above any layer already there). */
let pageRaisedAt = -Infinity;
const raised = (event: Event) => {
  if (layers.some((item) => item.host === event.target)) return;
  if ((event as Event & {newState?: string}).newState === "closed") return;
  if (event.type !== "fullscreenchange" && !(event.target instanceof HTMLElement && (event.target.hasAttribute("popover")
    || event.target instanceof HTMLDialogElement))) return;
  pageRaisedAt = performance.now();
};
for (const type of ["beforetoggle", "toggle", "fullscreenchange"]) addEventListener(type, raised, {capture: true});

/**
 * Where the browser can't say whether a layer is covered (Gecko): covered, as far as the extension
 * can tell, while anything of the page's own is in the top layer, or once the page has put anything
 * there since the layer went up -- drawn above it, even if it lets the press through
 * (``pointer-events: none``). (While a button is up, one found makes it go: ``watch``.)
 */
function coveredByPage(made: Layer): boolean {
  if (pageRaisedAt >= made.shownAt) return true;
  scannedAt = -Infinity;
  return pageTopLayerOpen();
}

/** Whether a computed look is as the extension drew it: shown, opaque, unscaled, unfiltered, unclipped. */
function drawnPlainly(style: CSSStyleDeclaration): boolean {
  const none = (name: string) => ["", "none"].includes(style.getPropertyValue(name).trim());
  return style.display !== "none" && style.visibility === "visible" && Number(style.opacity) >= 0.99
    && ["transform", "translate", "scale", "rotate", "filter", "clip-path", "mask-image", "offset-path", "position-area"].every(none)
    && ["", "normal"].includes(style.getPropertyValue("mix-blend-mode").trim())
    && ["", "1", "normal"].includes(style.getPropertyValue("zoom").trim());
}

/**
 * Whether a press on ``made``'s ``button`` is the person's, on the button as the extension drew it
 * (1.0.8, WS-A3): their own input (never a page's ``click()``), on the layer the extension shows,
 * still in its place in the page and the top layer, drawn where it was when they pressed and as
 * drawn (opaque, unscaled, unhidden), uncovered, standing still long enough before the press to
 * have been seen, and where they pressed. Anything else does nothing.
 */
function genuine(made: Layer, button: HTMLButtonElement, event: MouseEvent): boolean {
  if (!event.isTrusted || !made.shown || !buttonsHere) return false;
  const host = made.host;
  if (!host.isConnected || host.parentNode !== document.documentElement) return false;
  try {
    if (!host.matches(":popover-open")) return false;
  } catch {
    return false;
  }
  const now = performance.now();
  // Drawn where it was: moved by anything since the last look (a frame ago, or the press), it doesn't count.
  if (settle(made)) return false;
  // Where the extension put it, unchanged (a page's script may rewrite the host's inline style).
  if (Object.entries(made.at).some(([name, value]) => host.style.getPropertyValue(name) !== value)) return false;
  const hostStyle = getComputedStyle(host);
  // The button itself: no page rule reaches into its shadow root, only what it inherits from the host
  // (its own hover brightens it with a filter, so only these are looked at there).
  const buttonStyle = getComputedStyle(button);
  if (hostStyle.position !== "fixed" || !drawnPlainly(hostStyle) || buttonStyle.visibility !== "visible"
      || Number(buttonStyle.opacity) < 0.99) return false;
  // The page's own root: its opacity, clip and mask don't reach the top layer (either engine, measured
  // 2026-11-27); its filter does in Gecko (opacity(0) hides a top-layer box there, not in Chromium).
  const rootStyle = getComputedStyle(document.documentElement);
  if (rootStyle.display === "none" || (!seesCover && /opacity|url\(/.test(rootStyle.filter))) return false;
  const shown = button as HTMLButtonElement & {checkVisibility?(options?: object): boolean};
  if (shown.checkVisibility && !shown.checkVisibility({visibilityProperty: true, contentVisibilityAuto: true})) return false;
  const box = button.getBoundingClientRect();
  if (box.width < BUTTON / 2 || box.width > BUTTON * 2 || box.height < BUTTON / 2 || box.height > BUTTON * 2) return false;
  const drawn = made.drawn!;
  if (box.left < drawn.left - 1 || box.right > drawn.right + 1 || box.top < drawn.top - 1 || box.bottom > drawn.bottom + 1) return false;
  let pressed: number;
  if (event.detail === 0) {
    // A key on the focused button (Enter, Space): the person's focus is on it, pressed now.
    if (made.root.activeElement !== button) return false;
    pressed = now;
  } else {
    // A pointer: pressed and released on the button itself, where it is drawn.
    pressed = made.pressedAt;
    if (now - pressed > 10_000) return false;
    if (event.clientX < box.left - 1 || event.clientX > box.right + 1 || event.clientY < box.top - 1 || event.clientY > box.bottom + 1) {
      return false;
    }
  }
  // Standing still where it is drawn, long enough before the press to have been seen there.
  if (pressed - made.placedAt < STILL_MS) return false;
  // Seen uncovered by the browser, without a break, for as long as it has to stand still before the
  // press (a page flicking a cover over it, leaving it bare a frame now and then, never gets there),
  // and nothing of the page's put into the top layer meanwhile.
  if (sight) return made.seenSince !== null && pressed - made.seenSince >= STILL_MS && pageRaisedAt < pressed - STILL_MS;
  return !coveredByPage(made);
}

function sendButton(label: string, onSend: () => void): Layer {
  const made = layer();
  const button = document.createElement("button");
  button.addEventListener("pointerdown", (event) => {
    if (!event.isTrusted) return;
    // Pressing it must not take the page's selection away (the batch button sends it).
    event.preventDefault();
    // Where it is drawn as it is pressed: moved since the last frame, it has only just stood there.
    settle(made);
    made.pressedAt = performance.now();
  });
  button.type = "button";
  button.append(arrow());
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const person = genuine(made, button, event);
    made.pressedAt = -Infinity;
    if (person) onSend();
  });
  made.root.append(button);
  return made;
}

// ── the hover icon (B3) ────────────────────────────────────────────────────

let hover: Layer | null = null;
let hoverUrl = "";
let hoverRect: DOMRect | null = null;
let hoverAnchor: (() => DOMRect) | null = null;   // where the hovered link is drawn now
let hoverAt: DOMRect | null = null;               // ... and where it was when the icon was placed
let hideTimer = 0;

/** A pointer position and the path it was dispatched along, captured during dispatch
 * (``composedPath()`` is empty once dispatch has finished). */
interface Pointer { clientX: number; clientY: number; path: EventTarget[] }

function overHover(event: Pointer): boolean {
  return Boolean(hover && event.path.includes(hover.host));
}

/**
 * Where a link is drawn on the pointer's line: the union of its visible text
 * on that line (the glyphs, not the link's box, which a page may stretch
 * across a whole row), else its image, else its box.
 */
function renderedLine(anchor: HTMLAnchorElement, y: number): DOMRect {
  const pieces: DOMRect[] = [];
  const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    // Text the page hides (a screen-reader-only label, a collapsed part) is not where the link is drawn.
    const holder = node.parentElement as (Element & {checkVisibility?(options?: object): boolean}) | null;
    if (holder?.checkVisibility && !holder.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (rect.width > 1 && rect.height > 1) pieces.push(rect);
  }
  // Its images and icons are drawn content too (a file icon before its name).
  for (const image of anchor.querySelectorAll("img, svg, picture, video")) {
    const shown = image as Element & {checkVisibility?(options?: object): boolean};
    if (shown.checkVisibility && !shown.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
    const rect = image.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) pieces.push(rect);
  }
  if (!pieces.length) return anchor.getBoundingClientRect();
  // The line under the pointer (a wrapped link has several), else the nearest one.
  const distance = (rect: DOMRect) => (y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0);
  const nearest = Math.min(...pieces.map(distance));
  const line = pieces.filter((rect) => distance(rect) === nearest);
  const top = Math.min(...line.map((rect) => rect.top)), bottom = Math.max(...line.map((rect) => rect.bottom));
  const left = Math.min(...line.map((rect) => rect.left)), right = Math.max(...line.map((rect) => rect.right));
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Whether a link gets the hover button: a download candidate, but not an
 * indexer's download link -- the indexer already draws its own download icon
 * in a dense row, and right-click (or a selection) sends it, captured
 * (operator, 2026-11-18).
 */
function hoverable(href: string, attributes?: {download?: boolean; type?: string}): boolean {
  return isDownloadCandidate(href, attributes) && !isIndexerLink(href);
}

/** A candidate under the pointer: its URL, where it is drawn, and how to find where it is drawn now. */
interface Found { url: string; rect: DOMRect; rtl: boolean; anchor: () => DOMRect }

function candidateAt(event: Pointer): Found | null {
  const anchor = event.path.find((node): node is HTMLAnchorElement =>
    node instanceof HTMLAnchorElement && Boolean(node.href));
  if (anchor) {
    if (!hoverable(anchor.href, {download: anchor.hasAttribute("download"), type: anchor.type})) return null;
    // Only on what the link draws (its text, or its image), not the rest of a box a
    // page stretches across a row (operator, 2026-11-18: along a release row the
    // icon stayed up), with a little slack, and the way across to the icon.
    const line = renderedLine(anchor, event.clientY);
    const rtl = getComputedStyle(anchor).direction === "rtl";
    const reach = GAP + BUTTON + SLACK;
    const left = line.left - (rtl ? reach : SLACK), right = line.right + (rtl ? SLACK : reach);
    if (event.clientX < left || event.clientX > right || event.clientY < line.top - SLACK || event.clientY > line.bottom + SLACK) {
      return null;
    }
    return {url: anchor.href, rect: line, rtl, anchor: () => anchor.getBoundingClientRect()};
  }
  // Plain text that is a URL, under the pointer.
  const caret = (document as Document & {caretPositionFromPoint?(x: number, y: number):
    {offsetNode: Node; offset: number} | null}).caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest("a, input, textarea")) return null;
  const found = urlAt(node.textContent ?? "", offset);
  if (!found || !hoverable(found.url)) return null;
  const span = document.createRange();
  span.setStart(node, found.start);
  span.setEnd(node, found.end);
  const rects = [...span.getClientRects()];
  const rect = rects.find((item) => event.clientY >= item.top && event.clientY <= item.bottom) ?? span.getBoundingClientRect();
  if (event.clientX < rect.left - 2 || event.clientX > rect.right + 2) return null;
  return {url: found.url, rect, rtl: getComputedStyle(node.parentElement!).direction === "rtl",
    anchor: () => span.getBoundingClientRect()};
}

function showHover(found: Found): void {
  hover ??= sendButton(message("hoverSend"), () => {
    void chrome.runtime.sendMessage({type: "dp-send", url: hoverUrl});
    withdraw(hover);
  });
  hoverUrl = found.url;
  hoverRect = found.rect;
  hoverAnchor = found.anchor;
  hoverAt = found.anchor();
  watch();
  // Beside the link's text, never over it, a constant GAP away: after it in
  // left-to-right text, before it in right-to-left.
  const left = found.rtl ? found.rect.left - BUTTON - GAP : found.rect.right + GAP;
  place(hover, left, found.rect.top + found.rect.height / 2 - BUTTON / 2);
}

function scheduleHide(event: Pointer): void {
  const near = hoverRect && event.clientX >= hoverRect.left - BUTTON - GAP - 4 && event.clientX <= hoverRect.right + BUTTON + GAP + 4
    && event.clientY >= hoverRect.top - 6 && event.clientY <= hoverRect.bottom + 6;
  if (near || overHover(event)) {
    clearTimeout(hideTimer);
    hideTimer = 0;
    return;
  }
  if (!hideTimer) hideTimer = window.setTimeout(() => { withdraw(hover); hoverRect = null; hideTimer = 0; }, HIDE_DELAY_MS);
}

// ── the video button (B4; spike S3's detector) ─────────────────────────────

let video: Layer | null = null;
let announced = false;

function shadowOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  // Only an HTML element can hold a shadow root; Chromium's chrome.dom lookup throws for any
  // other (an SVG icon over a video, as on KeepLinks), which stopped the video search there.
  if (!(element instanceof HTMLElement)) return null;
  const firefox = (element as Element & {openOrClosedShadowRoot?: ShadowRoot | null}).openOrClosedShadowRoot;
  if (firefox !== undefined) return firefox;
  const dom = (chrome as unknown as {dom?: {openOrClosedShadowRoot?(element: HTMLElement): ShadowRoot | null}}).dom;
  try {
    return dom?.openOrClosedShadowRoot?.(element) ?? null;
  } catch {
    return null;
  }
}

function videoAt(root: Document | ShadowRoot, x: number, y: number, depth = 0): HTMLVideoElement | null {
  for (const element of root.elementsFromPoint(x, y)) {
    if (element instanceof HTMLVideoElement) return element;
    const inner = shadowOf(element);
    if (inner && inner !== root && depth < 8) {
      const found = videoAt(inner, x, y, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function announceVideo(): void {
  if (announced) return;
  announced = true;
  void chrome.runtime.sendMessage({type: "dp-has-video"});
}

/**
 * A preview, not this page's video (operator, 2026-11-18: YouTube's home page
 * plays thumbnails inline): it sits inside a link, or the pointer over it is on
 * a link to another page. The video belongs to that link; this page's address
 * -- what the button sends -- is not it.
 */
function isPreview(element: HTMLVideoElement, event: Pointer): boolean {
  const here = location.href.split("#")[0];
  const elsewhere = (node: EventTarget | Element | null) => node instanceof HTMLAnchorElement && Boolean(node.href)
    && node.href.split("#")[0] !== here;
  if (elsewhere(element.closest("a[href]"))) return true;
  return event.path.some(elsewhere);
}

let videoBox: DOMRect | null = null;            // the frame the button stands beside
let videoElement: HTMLVideoElement | null = null;

/**
 * The video button stands outside the frame, a GAP to the right of its top
 * corner (operator, 2026-11-18: inside, it covered the picture). Fullscreen, or
 * with no room to the right of the frame, it is not drawn at all.
 */
function showVideo(element: HTMLVideoElement): void {
  const rect = element.getBoundingClientRect();
  const left = rect.right + GAP;
  if (document.fullscreenElement || left + BUTTON > innerWidth - 2) {
    withdraw(video);
    return;
  }
  video ??= sendButton(message("videoSend"), () => {
    // The frame's own address: the embed, or the page itself (S3) -- its CURRENT address: a
    // single-page site (YouTube) changes it in place, which the browser's own record of the
    // frame does not follow (2026-11-19: videos were sent as the site's home page).
    void chrome.runtime.sendMessage({type: "dp-send-video", url: location.href});
    withdraw(video);
  });
  videoBox = rect;
  videoElement = element;
  place(video, left, Math.max(rect.top, 2));
  watch();
}

/** Still with the video: on its frame, or crossing the gap to its button. */
function nearVideo(event: Pointer): boolean {
  if (!videoBox || !video?.shown) return false;
  return event.clientX >= videoBox.left && event.clientX <= videoBox.right + GAP + BUTTON + SLACK
    && event.clientY >= videoBox.top - SLACK && event.clientY <= videoBox.bottom + SLACK;
}

// ── pointer tracking ───────────────────────────────────────────────────────

let pending: Pointer | null = null;

async function track(event: Pointer): Promise<void> {
  const may = await mayOffer();
  if (!may.hover) withdraw(hover);
  if (!may.video) withdraw(video);
  if (!may.hover && !may.video) return;
  if (overHover(event) || (video && event.path.includes(video.host))) return;
  // A selection's batch button is up: it is the one offer, no single link's beside it (operator, 2026-11-18).
  const found = may.hover && !batch?.shown ? candidateAt(event) : null;
  if (found) {
    clearTimeout(hideTimer);
    hideTimer = 0;
    showHover(found);
  } else {
    scheduleHide(event);
  }
  const under = may.video ? videoAt(document, event.clientX, event.clientY) : null;
  const element = under && !isPreview(under, event) ? under : null;
  if (element) {
    announceVideo();
    showVideo(element);
  } else if (!nearVideo(event)) {
    withdraw(video);
  }
}

document.addEventListener("fullscreenchange", () => { if (document.fullscreenElement) withdraw(video); });

document.addEventListener("pointermove", (event) => {
  // Only the person's own pointer places a button (a page's synthetic events never do).
  if (!event.isTrusted) return;
  if (!pending) requestAnimationFrame(() => {
    const latest = pending;
    pending = null;
    if (latest) void track(latest);
  });
  pending = {clientX: event.clientX, clientY: event.clientY, path: event.composedPath()};
}, {passive: true, capture: true});

// The icons follow the pointer; where it can no longer be followed -- the page
// scrolls under them, the pointer leaves the page or enters a frame, the
// window or tab goes away -- they go (operator, 2026-11-18).
function withdrawPointerSurfaces(): void {
  withdraw(hover);
  hoverRect = null;
  hoverAnchor = null;
  withdraw(video);
  clearTimeout(hideTimer);
  hideTimer = 0;
}
addEventListener("scroll", withdrawPointerSurfaces, {passive: true, capture: true});
document.addEventListener("pointerout", (event) => { if (!event.relatedTarget) withdrawPointerSurfaces(); }, {passive: true});
addEventListener("blur", () => { withdrawPointerSurfaces(); withdraw(batch); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { withdrawPointerSurfaces(); withdraw(batch); } });

// ── a selection of links (operator, 2026-11-18) ────────────────────────────
// Selected text holding links gets a send button at its end, with their count:
// the right-click "selection" item, for pages that block right-click. Shown
// for two or more links, or one that is a download or a magnet.

let batch: Layer | null = null;
let batchText = "";
let batchAt: DOMRect | null = null;   // where the selection's end was when the button was placed
let selectionTimer = 0;
/** The selection the person made (by their own pointer or keys), the only one offered again after a scroll or move. */
let chosenText = "";

/** Whether ``rect`` (of ``element``) is drawn and inside the window: only there can a button stand by it. */
function onScreen(rect: DOMRect, element: Element | null): boolean {
  const shown = element as (Element & {checkVisibility?(options?: object): boolean}) | null;
  if (shown?.checkVisibility && !shown.checkVisibility({visibilityProperty: true, opacityProperty: true})) return false;
  return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

/**
 * Where a selection ends on screen: the last box of its last visible text.
 * (A range's own boxes include whole elements it spans -- a container, a
 * trailing block -- which are not where its text ends.)
 */
function selectionEnd(range: Range): {rect: DOMRect; holder: Element} | null {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode! : root, NodeFilter.SHOW_TEXT);
  const piece = document.createRange();
  let found: {rect: DOMRect; holder: Element} | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!range.intersectsNode(node) || !node.textContent?.trim() || !node.parentElement) continue;
    const holder = node.parentElement as Element & {checkVisibility?(options?: object): boolean};
    if (holder.checkVisibility && !holder.checkVisibility({visibilityProperty: true, opacityProperty: true})) continue;
    piece.selectNodeContents(node);
    if (node === range.startContainer) piece.setStart(node, range.startOffset);
    if (node === range.endContainer) piece.setEnd(node, range.endOffset);
    const boxes = [...piece.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
    if (boxes.length) found = {rect: boxes.at(-1)!, holder};
  }
  return found;
}

function selected(): {text: string; rect: DOMRect; rtl: boolean} | null {
  const field = document.activeElement;
  if ((field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) && field.selectionStart !== null
      && field.selectionEnd !== null && field.selectionEnd > field.selectionStart) {
    // A text box's selection has no boxes of its own: the button stands at the box's top end, while the box is on screen.
    const box = field.getBoundingClientRect();
    if (!onScreen(box, field)) return null;
    return {text: field.value.slice(field.selectionStart, field.selectionEnd),
      rect: new DOMRect(box.right - BUTTON - GAP, box.top + GAP, 0, BUTTON), rtl: false};
  }
  const chosen = getSelection();
  if (!chosen || chosen.isCollapsed || !chosen.rangeCount) return null;
  const end = selectionEnd(chosen.getRangeAt(chosen.rangeCount - 1));
  // Only where the selection's last visible text is drawn and in view (a page's hidden copy field, or an end scrolled away, offers nothing).
  if (!end || !onScreen(end.rect, end.holder)) return null;
  return {text: chosen.toString(), rect: end.rect, rtl: getComputedStyle(end.holder).direction === "rtl"};
}

/** Whether anything is selected at all, on screen or not (a text box's selection too). */
function anySelection(): boolean {
  const field = document.activeElement;
  if ((field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) && field.selectionStart !== null
      && field.selectionEnd !== null && field.selectionEnd > field.selectionStart) return true;
  const chosen = getSelection();
  return Boolean(chosen && !chosen.isCollapsed && chosen.rangeCount);
}

/**
 * The batch button for the selection: offered for one the person just made (``byPerson``), and
 * otherwise only again for that same one (after a scroll or a move) -- never for a selection a
 * page's script made on its own (1.0.8, WS-A3).
 */
async function offerSelection(byPerson: boolean): Promise<void> {
  const may = await mayOffer();
  const found = may.hover ? selected() : null;
  const urls = found ? extractUrls(found.text) : [];
  const worth = urls.length >= 2 || urls.some((url) => /^magnet:\?/i.test(url) || isDownloadCandidate(url));
  if (!anySelection()) chosenText = "";
  if (found && worth && byPerson) chosenText = found.text;
  if (!found || !worth || found.text !== chosenText) {
    withdraw(batch);
    return;
  }
  batch ??= sendButton(message("selectionSend"), () => {
    void chrome.runtime.sendMessage({type: "dp-send-selection", text: batchText});
    withdraw(batch);
  });
  batchText = found.text;
  withdrawPointerSurfaces();   // the batch button stands alone
  const button = batch.root.querySelector("button")!;
  button.classList.add("batch");
  let count = button.querySelector(".count");
  if (!count) {
    count = document.createElement("span");
    count.className = "count";
    count.setAttribute("aria-hidden", "true");
    button.append(count);
  }
  count.textContent = String(urls.length);
  const left = found.rtl ? found.rect.left - BUTTON - GAP : found.rect.right + GAP;
  place(batch, left, found.rect.top + found.rect.height / 2 - BUTTON / 2);
  batchAt = found.rect;
  watch();
}

// A page's selection (selectionchange), and a text box's own (its select event,
// which a page's selectionchange need not report), settled for a moment. The
// browser reports a selection a page's script makes just as it does the person's,
// so it is the person's only when it follows their own pointer or keys.
let lastInput = -Infinity;
let selectionByPerson = false;
const input = (event: Event) => { if (event.isTrusted) lastInput = performance.now(); };
for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "keydown", "keyup", "touchstart", "touchend"]) {
  document.addEventListener(type, input, {passive: true, capture: true});
}
function selectionChanged(event: Event): void {
  const direct = event.type === "mouseup" || event.type === "keyup";
  selectionByPerson ||= event.isTrusted && (direct || performance.now() - lastInput < INPUT_WINDOW_MS);
  clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    const byPerson = selectionByPerson;
    selectionByPerson = false;
    void offerSelection(byPerson);
  }, 250);
}
document.addEventListener("selectionchange", selectionChanged);
document.addEventListener("select", selectionChanged, {capture: true});
document.addEventListener("mouseup", selectionChanged, {passive: true, capture: true});
document.addEventListener("keyup", selectionChanged, {passive: true, capture: true});
// Scrolling moves the selection under a button fixed to the window: it goes at
// once, and comes back where the selection's end now is once scrolling settles.
let scrollTimer = 0;
addEventListener("scroll", () => {
  withdraw(batch);
  clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => void offerSelection(false), 200);
}, {passive: true, capture: true});

// ── keeping the icons on what they belong to ───────────────────────────────
// A page can move its content without a scroll event reaching the extension
// (its own scroller, a smooth-scroll script, a transform). So while an icon is
// shown, each frame looks at where its link or selection is drawn now: moved,
// the icon goes at once (the selection's comes back where it settles).

let watching = false;
const moved = (a: DOMRect | null, b: DOMRect | null) =>
  !a || !b || Math.abs(a.left - b.left) > 1 || Math.abs(a.top - b.top) > 1 || Math.abs(a.width - b.width) > 1;

function watch(): void {
  if (watching) return;
  watching = true;
  const look = () => {
    // Where each button is drawn, every frame: moved (by anything), it must stand still again before a press counts.
    for (const made of [hover, batch, video]) if (made?.shown) settle(made);
    // Where the browser can't say a button is covered: anything of the page's in the top layer, and the buttons go.
    if (!seesCover && (hover?.shown || batch?.shown || video?.shown) && pageTopLayerOpen()) {
      withdrawPointerSurfaces();
      withdraw(batch);
    }
    const hoverShown = Boolean(hover?.shown);
    const batchShown = Boolean(batch?.shown);
    if (hoverShown && hoverAnchor && moved(hoverAnchor(), hoverAt)) withdrawPointerSurfaces();
    if (video?.shown && (!videoElement || moved(videoElement.getBoundingClientRect(), videoBox))) withdraw(video);
    if (batchShown && moved(selected()?.rect ?? null, batchAt)) {
      withdraw(batch);
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => void offerSelection(false), 200);
    }
    if (hover?.shown || batch?.shown || video?.shown) requestAnimationFrame(look);
    else watching = false;
  };
  requestAnimationFrame(look);
}

// A page with a video shows the URL-bar icon in Firefox even before a hover.
setTimeout(() => {
  // Only a video that is this page's own: shown, player-sized, not inside a link (a preview).
  const own = [...document.querySelectorAll("video")].some((element) => {
    const shown = element as HTMLVideoElement & {checkVisibility?(options?: object): boolean};
    const box = element.getBoundingClientRect();
    return (!shown.checkVisibility || shown.checkVisibility({visibilityProperty: true}))
      && box.width >= 320 && box.height >= 180 && !element.closest("a[href]");
  });
  if (own) void mayOffer().then((may) => may.video && announceVideo());
}, 1500);

// ── the toast (B6) ─────────────────────────────────────────────────────────

let toast: Layer | null = null;
let toastTimer = 0;

chrome.runtime.onMessage.addListener((request: {type?: string; text?: string; ok?: boolean}, sender) => {
  if (sender.id !== chrome.runtime.id || request.type !== "dp-toast") return;
  toast ??= layer();
  toast.root.querySelector(".toast")?.remove();
  const box = document.createElement("div");
  box.className = request.ok ? "toast" : "toast error";
  box.setAttribute("role", request.ok ? "status" : "alert");
  box.textContent = String(request.text ?? "");
  box.addEventListener("click", () => withdraw(toast));
  toast.root.append(box);
  stand(toast, {right: "16px", bottom: "16px", left: "auto", top: "auto"});
  reveal(toast);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => withdraw(toast), TOAST_MS + 300);
});
