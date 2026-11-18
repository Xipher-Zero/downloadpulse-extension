// SPDX-License-Identifier: GPL-2.0-or-later
// The in-page surfaces (WS-E2 B3, B4, B6), in every frame: the hover icon
// beside a download link, the video-player button, and the quiet toast that
// answers a submission. Each is drawn in the top layer (popover) inside a
// closed shadow root, so no page style or overlay reaches it (spike S3).
//
// This script makes no network request, reads no storage and holds no
// secret (WS-E2 §3): it asks the background whether it may offer anything,
// and hands the background a URL to send.

import {isDownloadCandidate, urlAt} from "../shared/classify";
import {message} from "../shared/i18n";

const BUTTON = 22;
const HIDE_DELAY_MS = 300;
interface Offer { hover: boolean; video: boolean }
let offer: Offer | null = null;
let askedAt = 0;

/** What this frame may offer, as the background says (connected, and the person's settings for this site). */
async function mayOffer(): Promise<Offer> {
  if (offer !== null && Date.now() - askedAt < 5_000) return offer;
  askedAt = Date.now();
  try {
    const state = await chrome.runtime.sendMessage({type: "dp-state"}) as {hover?: boolean; video?: boolean} | undefined;
    offer = {hover: Boolean(state?.hover), video: Boolean(state?.video)};
  } catch {
    offer = {hover: false, video: false};
  }
  return offer;
}

const STYLE = `
  :host { all: initial; }
  button { all: unset; box-sizing: border-box; width: ${BUTTON}px; height: ${BUTTON}px; border-radius: 50%;
    display: grid; place-items: center; cursor: pointer; background: #2563eb; color: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,.35); }
  button:hover, button:focus-visible { background: #1d4ed8; outline: 2px solid #93c5fd; outline-offset: 1px; }
  svg { width: 14px; height: 14px; }
  .toast { font: 13px/1.35 system-ui, sans-serif; padding: 8px 12px; border-radius: 8px; max-width: 320px;
    color: #fff; background: #15803d; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
  .toast.error { background: #b91c1c; }`;
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

interface Layer { host: HTMLElement; root: ShadowRoot }

function layer(): Layer {
  const host = document.createElement("downloadpulse-layer");
  host.setAttribute("popover", "manual");
  Object.assign(host.style, {position: "fixed", inset: "auto", margin: "0", padding: "0", border: "0",
    background: "transparent", overflow: "visible", width: "auto", height: "auto"});
  const root = host.attachShadow({mode: "closed"});
  const style = document.createElement("style");
  style.textContent = STYLE;
  root.append(style);
  document.documentElement.append(host);
  return {host, root};
}

function place(target: Layer, left: number, top: number): void {
  const x = Math.max(2, Math.min(left, innerWidth - BUTTON - 2));
  const y = Math.max(2, Math.min(top, innerHeight - BUTTON - 2));
  Object.assign(target.host.style, {left: `${x}px`, top: `${y}px`});
  if (!target.host.matches(":popover-open")) target.host.showPopover();
}

function hide(target: Layer | null): void {
  if (target?.host.matches(":popover-open")) target.host.hidePopover();
}

function sendButton(label: string, onSend: () => void): Layer {
  const made = layer();
  const button = document.createElement("button");
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
let hideTimer = 0;

/** A pointer position and the path it was dispatched along, captured during dispatch
 * (``composedPath()`` is empty once dispatch has finished). */
interface Pointer { clientX: number; clientY: number; path: EventTarget[] }

function overHover(event: Pointer): boolean {
  return Boolean(hover && event.path.includes(hover.host));
}

function candidateAt(event: Pointer): {url: string; rect: DOMRect; rtl: boolean} | null {
  const anchor = event.path.find((node): node is HTMLAnchorElement =>
    node instanceof HTMLAnchorElement && Boolean(node.href));
  if (anchor) {
    if (!isDownloadCandidate(anchor.href, {download: anchor.hasAttribute("download"), type: anchor.type})) return null;
    // The line of a wrapped link the pointer is on.
    const line = [...anchor.getClientRects()].find((rect) => event.clientY >= rect.top && event.clientY <= rect.bottom)
      ?? anchor.getBoundingClientRect();
    return {url: anchor.href, rect: line, rtl: getComputedStyle(anchor).direction === "rtl"};
  }
  // Plain text that is a URL, under the pointer.
  const caret = (document as Document & {caretPositionFromPoint?(x: number, y: number):
    {offsetNode: Node; offset: number} | null}).caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest("a, input, textarea")) return null;
  const found = urlAt(node.textContent ?? "", offset);
  if (!found || !isDownloadCandidate(found.url)) return null;
  const span = document.createRange();
  span.setStart(node, found.start);
  span.setEnd(node, found.end);
  const rects = [...span.getClientRects()];
  const rect = rects.find((item) => event.clientY >= item.top && event.clientY <= item.bottom) ?? span.getBoundingClientRect();
  if (event.clientX < rect.left - 2 || event.clientX > rect.right + 2) return null;
  return {url: found.url, rect, rtl: getComputedStyle(node.parentElement!).direction === "rtl"};
}

function showHover(found: {url: string; rect: DOMRect; rtl: boolean}): void {
  hover ??= sendButton(message("hoverSend"), () => {
    void chrome.runtime.sendMessage({type: "dp-send", url: hoverUrl});
    hide(hover);
  });
  hoverUrl = found.url;
  hoverRect = found.rect;
  // Beside the link, never over it: its right in left-to-right text, its left in right-to-left.
  const left = found.rtl ? found.rect.left - BUTTON - 4 : found.rect.right + 4;
  place(hover, left, found.rect.top + found.rect.height / 2 - BUTTON / 2);
}

function scheduleHide(event: Pointer): void {
  const near = hoverRect && event.clientX >= hoverRect.left - BUTTON - 8 && event.clientX <= hoverRect.right + BUTTON + 8
    && event.clientY >= hoverRect.top - 6 && event.clientY <= hoverRect.bottom + 6;
  if (near || overHover(event)) {
    clearTimeout(hideTimer);
    hideTimer = 0;
    return;
  }
  if (!hideTimer) hideTimer = window.setTimeout(() => { hide(hover); hoverRect = null; hideTimer = 0; }, HIDE_DELAY_MS);
}

// ── the video button (B4; spike S3's detector) ─────────────────────────────

let video: Layer | null = null;
let announced = false;

function shadowOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  const firefox = (element as Element & {openOrClosedShadowRoot?: ShadowRoot | null}).openOrClosedShadowRoot;
  if (firefox !== undefined) return firefox;
  const dom = (chrome as unknown as {dom?: {openOrClosedShadowRoot?(element: Element): ShadowRoot | null}}).dom;
  return dom?.openOrClosedShadowRoot?.(element) ?? null;
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

function showVideo(element: HTMLVideoElement): void {
  video ??= sendButton(message("videoSend"), () => {
    // The frame's own address: the embed, or the page itself (S3).
    void chrome.runtime.sendMessage({type: "dp-send", url: location.href});
    hide(video);
  });
  const rect = element.getBoundingClientRect();
  place(video, rect.right - BUTTON - 10, rect.top + 10);
}

// ── pointer tracking ───────────────────────────────────────────────────────

let pending: Pointer | null = null;

async function track(event: Pointer): Promise<void> {
  const may = await mayOffer();
  if (!may.hover) hide(hover);
  if (!may.video) hide(video);
  if (!may.hover && !may.video) return;
  if (overHover(event) || (video && event.path.includes(video.host))) return;
  const found = may.hover ? candidateAt(event) : null;
  if (found) {
    clearTimeout(hideTimer);
    hideTimer = 0;
    showHover(found);
  } else {
    scheduleHide(event);
  }
  const element = may.video ? videoAt(document, event.clientX, event.clientY) : null;
  if (element) {
    announceVideo();
    showVideo(element);
  } else {
    hide(video);
  }
}

document.addEventListener("pointermove", (event) => {
  if (!pending) requestAnimationFrame(() => {
    const latest = pending;
    pending = null;
    if (latest) void track(latest);
  });
  pending = {clientX: event.clientX, clientY: event.clientY, path: event.composedPath()};
}, {passive: true, capture: true});

// A page with a video shows the URL-bar icon in Firefox even before a hover.
setTimeout(() => {
  if (document.querySelector("video")) void mayOffer().then((may) => may.video && announceVideo());
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
  toast.root.append(box);
  Object.assign(toast.host.style, {right: "16px", bottom: "16px", left: "auto", top: "auto"});
  if (!toast.host.matches(":popover-open")) toast.host.showPopover();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => hide(toast), 3500);
});
