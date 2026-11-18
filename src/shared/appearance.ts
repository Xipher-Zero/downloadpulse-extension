// SPDX-License-Identifier: GPL-2.0-or-later
// The person's DownloadPulse appearance, the extension's pages drawn in it
// (operator, 2026-11-18). DownloadPulse is its truth: its browser session
// answers the mode and each mode's palette, by ID (BROWSER_CLIENT.md); the
// extension keeps the last answer (not a secret) and carries the palettes'
// colours (palettes.ts). Before any answer -- not connected, or an older
// DownloadPulse -- the pages follow the browser's light or dark preference.

import {NATIVE, PALETTES, type Mode} from "./palettes";

export interface Appearance {
  mode: Mode;
  dark_palette: string;
  light_palette: string;
}

const KEY = "appearance";

/** The appearance DownloadPulse said, if it said a well-formed one. */
export function parseAppearance(value: unknown): Appearance | null {
  const given = value as Partial<Appearance> | null;
  if (!given || (given.mode !== "dark" && given.mode !== "light")) return null;
  if (typeof given.dark_palette !== "string" || typeof given.light_palette !== "string") return null;
  return {mode: given.mode, dark_palette: given.dark_palette, light_palette: given.light_palette};
}

export async function appearance(): Promise<Appearance | null> {
  return parseAppearance((await chrome.storage.local.get(KEY))[KEY]);
}

export async function saveAppearance(value: unknown): Promise<void> {
  const parsed = parseAppearance(value);
  if (parsed) await chrome.storage.local.set({[KEY]: parsed});
}

const PROPERTIES = ["bg-app", "surface-1", "text-primary", "text-secondary", "text-muted", "border-default",
  "accent-purple", "accent-purple-bright", "accent-rgb", "accent-contrast", "focus-ring"];

/** Draw ``root`` in ``value``: its mode, and that mode's palette (an unknown palette is the mode's native one). */
export function applyAppearance(root: HTMLElement, value: Appearance | null): void {
  for (const name of PROPERTIES) root.style.removeProperty(`--dp-${name}`);
  if (!value) {
    delete root.dataset["mode"];
    delete root.dataset["palette"];
    return;
  }
  const chosen = value.mode === "dark" ? value.dark_palette : value.light_palette;
  const palette = PALETTES[value.mode][chosen] ? chosen : NATIVE[value.mode];
  root.dataset["mode"] = value.mode;
  root.dataset["palette"] = palette;
  const tokens = PALETTES[value.mode][palette]!;
  for (const [name, colour] of Object.entries(tokens)) root.style.setProperty(`--dp-${name}`, colour);
  root.style.setProperty("--dp-focus-ring", `0 0 0 3px rgba(${tokens["accent-rgb"]}, ${value.mode === "dark" ? ".28" : ".19"})`);
}
