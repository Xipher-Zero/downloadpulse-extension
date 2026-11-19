// SPDX-License-Identifier: GPL-2.0-or-later
// DownloadPulse's mark, drawn for the toolbar in the person's theme (operator,
// 2026-11-18). The geometry is DebridPulse's logo.svg (its arrow and EKG paths,
// in its own 128-unit space); the toolbar shows its square full-bleed, inside
// the outline, as the static icons do. The colours follow ui-logo.css: the
// native palettes keep the logo's own (the square white in Light); an
// alternative palette draws the square in its first surface and the arrow and
// line in its accents. The glow is left out: at 16 px it only blurs.

import type {Appearance} from "./appearance";
import {NATIVE, PALETTES} from "./palettes";

export interface LogoColours {
  surface: string;
  arrow: [string, string, string];
  ekg: [string, string, string];
}

const NATIVE_COLOURS = {arrow: ["#b532ff", "#7855ff", "#08a8ff"], ekg: ["#b532ff", "#00d4ff", "#149fff"]} as const;

/** An even mix of two #rrggbb colours (CSS color-mix in srgb, 50%). */
export function mix(a: string, b: string): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
  return "#" + [0, 1, 2].map((at) => Math.round((channel(a, at) + channel(b, at)) / 2).toString(16).padStart(2, "0")).join("");
}

/** The mark's colours for ``value``; null: DownloadPulse Dark's own. */
export function logoColours(value: Appearance | null): LogoColours {
  const mode = value?.mode ?? "dark";
  const chosen = value ? (mode === "dark" ? value.dark_palette : value.light_palette) : NATIVE[mode];
  const id = PALETTES[mode][chosen] ? chosen : NATIVE[mode];
  if (id === NATIVE[mode]) {
    return {surface: mode === "dark" ? "#080b18" : "#ffffff", arrow: [...NATIVE_COLOURS.arrow], ekg: [...NATIVE_COLOURS.ekg]};
  }
  const t = PALETTES[mode][id]!;
  return {surface: t["surface-1"],
    arrow: [t["accent-purple-bright"], mix(t["accent-purple-bright"], t["accent-blue-bright"]), t["accent-blue-bright"]],
    ekg: [t["accent-purple-bright"], t["accent-blue-bright"], t["accent-blue"]]};
}

const ARROW = "M55 30c0-2.8 2.2-5 5-5h8c2.8 0 5 2.2 5 5v27h10.2c3.8 0 5.8 4.5 3.2 7.2L67.2 84.8a4.4 4.4 0 0 1-6.4 0"
  + "L41.6 64.2c-2.6-2.7-.6-7.2 3.2-7.2H55V30z";
const EKG = "M 24 90 L 28 90 C 30 90 31.5 87.8 33.5 87.8 C 35.5 87.8 37 90 38.5 90 L 41 78 L 65 102 L 77 90 L 81 90"
  + " C 84 90 86.5 85.5 89.5 85.5 C 92.5 85.5 95 90 98 90 L 104 90";
// The square inside its outline, in the logo's space: what the toolbar shows.
const INNER = {x: 16, y: 15.5, size: 97};

/** Draw the mark at ``size`` px, at ``alpha`` (the breath while downloads are active). */
export function drawLogo(context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, size: number,
                         colours: LogoColours, alpha = 1): void {
  context.clearRect(0, 0, size, size);
  context.save();
  context.globalAlpha = alpha;
  const radius = size * 0.18;
  context.beginPath();
  context.roundRect(0, 0, size, size, radius);
  context.fillStyle = colours.surface;
  context.fill();
  context.clip();
  const scale = size / INNER.size;
  context.setTransform(scale, 0, 0, scale, -INNER.x * scale, -INNER.y * scale);
  const gradient = (x1: number, y1: number, x2: number, y2: number, stops: [number, string][]) => {
    const g = context.createLinearGradient(x1, y1, x2, y2);
    for (const [at, colour] of stops) g.addColorStop(at, colour);
    return g;
  };
  context.fillStyle = gradient(64, 24, 64, 86, [[0, colours.arrow[0]], [0.48, colours.arrow[1]], [1, colours.arrow[2]]]);
  context.fill(new Path2D(ARROW));
  context.strokeStyle = gradient(24, 78, 104, 102, [[0, colours.ekg[0]], [0.45, colours.ekg[1]], [1, colours.ekg[2]]]);
  context.lineWidth = 3.4 * Math.max(1, 16 / size * 1.4);   // a hair heavier at 16 px, so the line holds
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke(new Path2D(EKG));
  context.restore();
}
