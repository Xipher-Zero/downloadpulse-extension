// SPDX-License-Identifier: GPL-2.0-or-later
// The in-page surfaces (WS-E2 B3, B4, B6), in every frame: the hover icon
// beside a download link, the video-player button, and the quiet toast that
// answers a submission. Each is drawn in the top layer (popover) inside a
// closed shadow root, so no page style or overlay reaches it (spike S3).
//
// This script makes no network request, reads no storage and holds no
// secret (WS-E2 §3): it asks the background whether it may offer anything,
// and hands the background a URL to send.

import {parseAppearance} from "../shared/appearance";
import {extractUrls, isDownloadCandidate, isIndexerLink, urlAt} from "../shared/classify";
import {message} from "../shared/i18n";
import {pageColours, type PageColours} from "../shared/page-theme";

const BUTTON = 22;
const HIDE_DELAY_MS = 300;
const GAP = 8;   // between a link's text and the icon
const SLACK = 4; // around a link's text, still on it
const TOAST_MS = 3500;
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
const STYLE = `
  :host { all: initial; }
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

/** Every layer in the theme's colours (custom properties cross into the closed shadow root). */
function paint(colours: PageColours): void {
  for (const made of layers) colour(made, colours);
}

function colour(made: Layer, colours: PageColours): void {
  for (const [name, value] of Object.entries({primary: colours.primary, "primary-border": colours.primaryBorder,
    "primary-text": colours.primaryText, focus: colours.focus, surface: colours.surface, text: colours.text,
    border: colours.border, success: colours.success, error: colours.error})) {
    made.host.style.setProperty(`--dp-${name}`, value);
  }
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

/** A layer the extension draws on a page, and whether it is shown -- its own record, never read back from the page. */
interface Layer { host: HTMLElement; root: ShadowRoot; shown: boolean }

function layer(): Layer {
  const host = document.createElement("downloadpulse-layer");
  host.setAttribute("popover", "manual");
  Object.assign(host.style, {position: "fixed", inset: "auto", margin: "0", padding: "0", border: "0",
    background: "transparent", overflow: "visible", width: "auto", height: "auto"});
  const root = host.attachShadow({mode: "closed"});
  const style = document.createElement("style");
  style.textContent = STYLE;
  root.append(style);
  const made = {host, root, shown: false};
  layers.push(made);
  colour(made, offer?.colours ?? pageColours(null, prefersDark() ? "dark" : "light"));
  return made;
}

function place(target: Layer, left: number, top: number): void {
  const x = Math.max(2, Math.min(left, innerWidth - BUTTON - 2));
  const y = Math.max(2, Math.min(top, innerHeight - BUTTON - 2));
  Object.assign(target.host.style, {left: `${x}px`, top: `${y}px`});
  reveal(target);
}

/**
 * Shown by putting the layer into the page and withdrawn by taking it out
 * (operator, 2026-11-18), with the extension's own record of which: the
 * browser's popover state is never read back to decide. The top layer is only
 * how it stays above the page.
 */
function reveal(target: Layer): void {
  if (!target.host.isConnected) document.documentElement.append(target.host);
  target.shown = true;
  try {
    if (!target.host.matches(":popover-open")) target.host.showPopover();
  } catch {
    // already in the top layer: it is in the page and drawn either way
  }
}

/** Withdraw a layer: out of the page entirely (operator, 2026-11-18), never left there hidden. */
function withdraw(target: Layer | null): void {
  if (!target) return;
  target.shown = false;
  try {
    if (target.host.matches(":popover-open")) target.host.hidePopover();
  } catch {
    // a page that moved or removed the layer
  }
  target.host.remove();
}

function sendButton(label: string, onSend: () => void): Layer {
  const made = layer();
  const button = document.createElement("button");
  // Pressing it must not take the page's selection away (the batch button sends it).
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.type = "button";
  button.append(arrow());
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSend();
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

async function offerSelection(): Promise<void> {
  const may = await mayOffer();
  const found = may.hover ? selected() : null;
  const urls = found ? extractUrls(found.text) : [];
  const worth = urls.length >= 2 || urls.some((url) => /^magnet:\?/i.test(url) || isDownloadCandidate(url));
  if (!found || !worth) {
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
// which a page's selectionchange need not report), settled for a moment.
function selectionChanged(): void {
  clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => void offerSelection(), 250);
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
  scrollTimer = window.setTimeout(() => void offerSelection(), 200);
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
    const hoverShown = Boolean(hover?.shown);
    const batchShown = Boolean(batch?.shown);
    if (hoverShown && hoverAnchor && moved(hoverAnchor(), hoverAt)) withdrawPointerSurfaces();
    if (video?.shown && (!videoElement || moved(videoElement.getBoundingClientRect(), videoBox))) withdraw(video);
    if (batchShown && moved(selected()?.rect ?? null, batchAt)) {
      withdraw(batch);
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => void offerSelection(), 200);
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
  Object.assign(toast.host.style, {right: "16px", bottom: "16px", left: "auto", top: "auto"});
  reveal(toast);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => withdraw(toast), TOAST_MS + 300);
});
