// SPDX-License-Identifier: GPL-2.0-or-later
// The colours of what the extension draws on web pages (the hover icon, the
// video button, the toasts), in the person's DownloadPulse theme (operator,
// 2026-11-18). A page can't read the extension's stylesheet, so its colours are
// resolved here, from the same truths as the dropdown: DownloadPulse's native
// values for each mode (design-tokens.css, ui-language-tokens.css) and, for an
// alternative palette, DownloadPulse's derivations from its accents
// (ui-theme-palettes.css body[data-dp-palette]).

import type {Appearance} from "./appearance";
import {NATIVE, PALETTES, type Mode} from "./palettes";

export interface PageColours {
  mode: Mode;
  /** The send button: DownloadPulse's primary button material. */
  primary: string;
  primaryBorder: string;
  primaryText: string;
  focus: string;
  /** A toast: the surface, its text and edge, and the state colours. */
  surface: string;
  text: string;
  border: string;
  success: string;
  error: string;
}

const NATIVE_PRIMARY: Record<Mode, {primary: string; border: string}> = {
  dark: {
    primary: "radial-gradient(ellipse 125% 92% at 18% -10%, rgba(255,255,255,.23) 0%, rgba(255,255,255,.075) 35%, transparent 61%), linear-gradient(145deg, #8d48db 0%, #763fc9 52%, #6249bd 100%)",
    border: "rgba(160,94,221,.78)",
  },
  light: {
    primary: "radial-gradient(ellipse 125% 92% at 18% -10%, rgba(255,255,255,.34) 0%, rgba(255,255,255,.10) 35%, transparent 61%), linear-gradient(145deg, #8950d4 0%, #7646c9 52%, #6551c3 100%)",
    border: "#9c68d8",
  },
};
const STATES: Record<Mode, {success: string; error: string}> = {
  dark: {success: "#00E676", error: "#ff5264"},
  light: {success: "#01783B", error: "#e64255"},
};

/** The page colours for ``value``; with none yet, DownloadPulse's native palette of ``fallback``. */
export function pageColours(value: Appearance | null, fallback: Mode): PageColours {
  const mode = value?.mode ?? fallback;
  const chosen = value ? (mode === "dark" ? value.dark_palette : value.light_palette) : NATIVE[mode];
  const id = PALETTES[mode][chosen] ? chosen : NATIVE[mode];
  const tokens = PALETTES[mode][id]!;
  const native = id === NATIVE[mode];
  return {
    mode,
    primary: native ? NATIVE_PRIMARY[mode].primary
      : `linear-gradient(145deg, ${tokens["accent-purple-bright"]} 0%, ${tokens["accent-purple"]} 100%)`,
    primaryBorder: native ? NATIVE_PRIMARY[mode].border : tokens["accent-purple-bright"],
    primaryText: tokens["accent-contrast"],
    focus: native ? `rgba(${tokens["accent-rgb"]}, ${mode === "dark" ? ".28" : ".19"})`
      : `color-mix(in srgb, ${tokens["accent-purple"]} 30%, transparent)`,
    surface: tokens["surface-1"],
    text: tokens["text-primary"],
    border: tokens["border-default"],
    ...STATES[mode],
  };
}
