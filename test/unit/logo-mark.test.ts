// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {logoColours, mix} from "../../src/shared/logo-mark";
import {PALETTES} from "../../src/shared/palettes";

test("the toolbar mark's colours follow the theme as DebridPulse's ui-logo.css colours the logo", () => {
  // No theme known, and DownloadPulse Dark: the logo's own colours.
  const own = {surface: "#080b18", arrow: ["#b532ff", "#7855ff", "#08a8ff"], ekg: ["#b532ff", "#00d4ff", "#149fff"]};
  assert.deepEqual(logoColours(null), own);
  assert.deepEqual(logoColours({mode: "dark", dark_palette: "debridpulse-dark", light_palette: "debridpulse-light"}), own);
  // DownloadPulse Light lifts the square to white; the arrow and line keep their colours.
  assert.deepEqual(logoColours({mode: "light", dark_palette: "debridpulse-dark", light_palette: "debridpulse-light"}),
    {...own, surface: "#ffffff"});
  // An alternative palette: its first surface, its accents (the arrow's middle the even mix of its bright accents).
  const nord = PALETTES.light["nord-light"]!;
  assert.deepEqual(logoColours({mode: "light", dark_palette: "debridpulse-dark", light_palette: "nord-light"}), {
    surface: nord["surface-1"],
    arrow: [nord["accent-purple-bright"], mix(nord["accent-purple-bright"], nord["accent-blue-bright"]), nord["accent-blue-bright"]],
    ekg: [nord["accent-purple-bright"], nord["accent-blue-bright"], nord["accent-blue"]]});
  // A palette this extension doesn't know: its mode's native one.
  assert.deepEqual(logoColours({mode: "dark", dark_palette: "a-future-palette", light_palette: "x"}), own);
});

test("mix is CSS color-mix in srgb at 50%", () => {
  assert.equal(mix("#000000", "#ffffff"), "#808080");
  assert.equal(mix("#bd93f9", "#ff79c6"), "#de86e0");
});
