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
