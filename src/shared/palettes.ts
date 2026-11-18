// SPDX-License-Identifier: GPL-2.0-or-later
// DownloadPulse's palettes, as the extension draws with them: each mode's
// palettes (DebridPulse services/account_appearance.py CATALOG, in its order;
// the first is the native one) and, for each, the values of the tokens the
// extension uses, from DebridPulse's own stylesheets: the native values in
// frontend/static/design-tokens.css, a palette's own in ui-theme-palettes.css.
// Taken from DebridPulse b91c6674 (operator, 2026-11-18: DownloadPulse
// says which palettes a person uses, by ID; the extension carries their
// colours). A palette ID not listed here is drawn as its mode's native one.

export type Mode = "dark" | "light";
export type Tokens = Record<"bg-app" | "surface-1" | "text-primary" | "text-secondary" | "text-muted"
  | "border-default" | "accent-purple" | "accent-purple-bright" | "accent-rgb" | "accent-contrast", string>;

export const PALETTES: Record<Mode, Record<string, Tokens>> = {
  dark: {
    "debridpulse-dark": {"bg-app": "#050814", "surface-1": "#0b1224", "text-primary": "#f7f8ff", "text-secondary": "#b3bcda", "text-muted": "#7c87aa", "border-default": "#26324d", "accent-purple": "#9b45ff", "accent-purple-bright": "#b45cff", "accent-rgb": "155, 69, 255", "accent-contrast": "#ffffff"},
    "catppuccin-mocha": {"bg-app": "#11111b", "surface-1": "#1e1e2e", "text-primary": "#cdd6f4", "text-secondary": "#bac2de", "text-muted": "#9399b2", "border-default": "#313244", "accent-purple": "#cba6f7", "accent-purple-bright": "#cba6f7", "accent-rgb": "203, 166, 247", "accent-contrast": "#11111b"},
    "dracula": {"bg-app": "#191a21", "surface-1": "#282a36", "text-primary": "#f8f8f2", "text-secondary": "#d9dae6", "text-muted": "#9aa3cc", "border-default": "#44475a", "accent-purple": "#bd93f9", "accent-purple-bright": "#bd93f9", "accent-rgb": "189, 147, 249", "accent-contrast": "#191a21"},
    "gruvbox-dark": {"bg-app": "#1d2021", "surface-1": "#282828", "text-primary": "#ebdbb2", "text-secondary": "#d5c4a1", "text-muted": "#a89984", "border-default": "#3c3836", "accent-purple": "#d3869b", "accent-purple-bright": "#d3869b", "accent-rgb": "211, 134, 155", "accent-contrast": "#1d2021"},
    "everforest-dark": {"bg-app": "#232a2e", "surface-1": "#2d353b", "text-primary": "#d3c6aa", "text-secondary": "#b9b49c", "text-muted": "#a3aea6", "border-default": "#475258", "accent-purple": "#a7c080", "accent-purple-bright": "#a7c080", "accent-rgb": "167, 192, 128", "accent-contrast": "#232a2e"},
    "rose-pine": {"bg-app": "#13111c", "surface-1": "#1f1d2e", "text-primary": "#e0def4", "text-secondary": "#b3afcc", "text-muted": "#908caa", "border-default": "#363250", "accent-purple": "#ebbcba", "accent-purple-bright": "#ebbcba", "accent-rgb": "235, 188, 186", "accent-contrast": "#191724"},
    "kanagawa-wave": {"bg-app": "#16161d", "surface-1": "#1f1f28", "text-primary": "#dcd7ba", "text-secondary": "#c8c093", "text-muted": "#9a9888", "border-default": "#363646", "accent-purple": "#7e9cd8", "accent-purple-bright": "#7fb4ca", "accent-rgb": "126, 156, 216", "accent-contrast": "#16161d"},
    "ayu-mirage": {"bg-app": "#181c26", "surface-1": "#242936", "text-primary": "#cccac2", "text-secondary": "#a9adb6", "text-muted": "#8f99ab", "border-default": "#343c4c", "accent-purple": "#ffcc66", "accent-purple-bright": "#ffcc66", "accent-rgb": "255, 204, 102", "accent-contrast": "#1f2430"},
    "synthwave-84": {"bg-app": "#171520", "surface-1": "#262335", "text-primary": "#ffffff", "text-secondary": "#d6cdf0", "text-muted": "#a3a8d6", "border-default": "#3d3260", "accent-purple": "#ff7edb", "accent-purple-bright": "#ff7edb", "accent-rgb": "255, 126, 219", "accent-contrast": "#171520"},
    "oxocarbon-dark": {"bg-app": "#161616", "surface-1": "#262626", "text-primary": "#f2f4f8", "text-secondary": "#dde1e6", "text-muted": "#a2a9b0", "border-default": "#393939", "accent-purple": "#78a9ff", "accent-purple-bright": "#82cfff", "accent-rgb": "120, 169, 255", "accent-contrast": "#161616"},
  },
  light: {
    "debridpulse-light": {"bg-app": "#f4f7fc", "surface-1": "#ffffff", "text-primary": "#111a34", "text-secondary": "#526184", "text-muted": "#7b88a8", "border-default": "#dce4f1", "accent-purple": "#8428ed", "accent-purple-bright": "#9637f5", "accent-rgb": "132, 40, 237", "accent-contrast": "#ffffff"},
    "catppuccin-latte": {"bg-app": "#e6e9ef", "surface-1": "#eff1f5", "text-primary": "#4c4f69", "text-secondary": "#5c5f77", "text-muted": "#6c6f85", "border-default": "#ccd0da", "accent-purple": "#8839ef", "accent-purple-bright": "#8839ef", "accent-rgb": "136, 57, 239", "accent-contrast": "#eff1f5"},
    "nord-light": {"bg-app": "#e5e9f0", "surface-1": "#eceff4", "text-primary": "#2e3440", "text-secondary": "#3b4252", "text-muted": "#4c566a", "border-default": "#c9d1dd", "accent-purple": "#5e81ac", "accent-purple-bright": "#5e81ac", "accent-rgb": "94, 129, 172", "accent-contrast": "#eceff4"},
    "gruvbox-light": {"bg-app": "#f2e5bc", "surface-1": "#fbf1c7", "text-primary": "#3c3836", "text-secondary": "#504945", "text-muted": "#665c54", "border-default": "#d5c4a1", "accent-purple": "#8f3f71", "accent-purple-bright": "#8f3f71", "accent-rgb": "143, 63, 113", "accent-contrast": "#fbf1c7"},
    "rose-pine-dawn": {"bg-app": "#f2e9e1", "surface-1": "#faf4ed", "text-primary": "#464261", "text-secondary": "#5d5880", "text-muted": "#66617f", "border-default": "#dfd5cd", "accent-purple": "#a3546b", "accent-purple-bright": "#97495f", "accent-rgb": "163, 84, 107", "accent-contrast": "#fffaf3"},
    "everforest-light": {"bg-app": "#efebd4", "surface-1": "#fdf6e3", "text-primary": "#4f5b62", "text-secondary": "#5c6a72", "text-muted": "#5f6c60", "border-default": "#e0dcc7", "accent-purple": "#8da101", "accent-purple-bright": "#556d00", "accent-rgb": "141, 161, 1", "accent-contrast": "#1e2326"},
    "ayu-light": {"bg-app": "#ebeef0", "surface-1": "#fcfcfc", "text-primary": "#5c6166", "text-secondary": "#5c6166", "text-muted": "#5f6a75", "border-default": "#dde2e6", "accent-purple": "#f29718", "accent-purple-bright": "#9a5600", "accent-rgb": "242, 151, 24", "accent-contrast": "#1f2430"},
    "flexoki-light": {"bg-app": "#f2f0e5", "surface-1": "#fffcf0", "text-primary": "#100f0f", "text-secondary": "#403e3c", "text-muted": "#66655f", "border-default": "#dad8ce", "accent-purple": "#bc5215", "accent-purple-bright": "#9d4310", "accent-rgb": "188, 82, 21", "accent-contrast": "#fffcf0"},
    "oxocarbon-light": {"bg-app": "#dde1e6", "surface-1": "#f2f4f8", "text-primary": "#161616", "text-secondary": "#393939", "text-muted": "#525252", "border-default": "#a2a9b0", "accent-purple": "#0f62fe", "accent-purple-bright": "#0043ce", "accent-rgb": "15, 98, 254", "accent-contrast": "#ffffff"},
    "bluloco-light": {"bg-app": "#e8e8e8", "surface-1": "#f9f9f9", "text-primary": "#383a42", "text-secondary": "#4f525c", "text-muted": "#5f626c", "border-default": "#d5d7d8", "accent-purple": "#275fe4", "accent-purple-bright": "#1f53cf", "accent-rgb": "39, 95, 228", "accent-contrast": "#ffffff"},
  },
};

export const NATIVE: Record<Mode, string> = {dark: "debridpulse-dark", light: "debridpulse-light"};
