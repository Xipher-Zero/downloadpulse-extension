// SPDX-License-Identifier: GPL-2.0-or-later
// The extension's glyphs: DownloadPulse's own Lucide geometry (DebridPulse
// frontend/static/operator-title.js, its LUCIDE set), drawn as DownloadPulse
// draws them -- 24 viewBox, stroke currentColor, width 2, round caps and
// joins -- and built with DOM calls (no markup strings).

type Shape = [tag: "path" | "rect" | "circle", attributes: Record<string, string>];

const GEOMETRY = {
  settings: [
    ["path", {d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],
    ["circle", {cx: "12", cy: "12", r: "3"}],
  ],
  pause: [
    ["rect", {x: "14", y: "3", width: "5", height: "18", rx: "1"}],
    ["rect", {x: "5", y: "3", width: "5", height: "18", rx: "1"}],
  ],
  play: [["path", {d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]],
  trash2: [
    ["path", {d: "M3 6h18"}], ["path", {d: "M8 6V4h8v2"}], ["path", {d: "m19 6-1 14H6L5 6"}],
    ["path", {d: "M10 11v5"}], ["path", {d: "M14 11v5"}],
  ],
  chevronRight: [["path", {d: "m9 18 6-6-6-6"}]],
  triangleAlert: [["path", {d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],
    ["path", {d: "M12 9v4"}], ["path", {d: "M12 17h.01"}]],
  circleX: [["circle", {cx: "12", cy: "12", r: "10"}], ["path", {d: "m15 9-6 6"}], ["path", {d: "m9 9 6 6"}]],
  plug: [["path", {d: "M12 22v-5"}], ["path", {d: "M9 8V2"}], ["path", {d: "M15 8V2"}],
    ["path", {d: "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"}]],
  monitor: [["rect", {width: "20", height: "14", x: "2", y: "3", rx: "2"}], ["path", {d: "M8 21h8"}], ["path", {d: "M12 17v4"}]],
  server: [
    ["rect", {width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2"}],
    ["rect", {width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2"}],
    ["path", {d: "M6 6h.01"}], ["path", {d: "M6 18h.01"}],
  ],
  chevronLeft: [["path", {d: "m15 18-6-6 6-6"}]],
  // More than one server (WS-X1): connect another, the lists' ▾, rename, the default, the grab handle.
  plus: [["path", {d: "M5 12h14"}], ["path", {d: "M12 5v14"}]],
  chevronDown: [["path", {d: "m6 9 6 6 6-6"}]],
  pencil: [["path", {d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],
    ["path", {d: "m15 5 4 4"}]],
  star: [["path", {d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],
  gripVertical: [["circle", {cx: "9", cy: "12", r: "1"}], ["circle", {cx: "9", cy: "5", r: "1"}], ["circle", {cx: "9", cy: "19", r: "1"}],
    ["circle", {cx: "15", cy: "12", r: "1"}], ["circle", {cx: "15", cy: "5", r: "1"}], ["circle", {cx: "15", cy: "19", r: "1"}]],
} satisfies Record<string, Shape[]>;

export type GlyphName = keyof typeof GEOMETRY;

const SVG = "http://www.w3.org/2000/svg";

export function glyph(name: GlyphName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [key, value] of Object.entries({viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false"})) {
    svg.setAttribute(key, value);
  }
  svg.dataset["glyph"] = name;
  for (const [tag, attributes] of GEOMETRY[name] as Shape[]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}

/** Fills every [data-glyph-slot] element with its glyph. */
export function placeGlyphs(root: ParentNode): void {
  for (const slot of root.querySelectorAll<HTMLElement>("[data-glyph-slot]")) {
    slot.replaceChildren(glyph(slot.dataset["glyphSlot"] as GlyphName));
  }
}
