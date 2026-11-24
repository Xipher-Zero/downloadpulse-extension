// SPDX-License-Identifier: GPL-2.0-or-later
// The toolbar icon: DownloadPulse's mark in the person's theme, drawn here
// (src/shared/logo-mark.ts); before any theme is known, the static icons.

import {appearance} from "../shared/appearance";
import {drawLogo, logoColours} from "../shared/logo-mark";

/** The mark at ``size`` px and ``alpha`` in the current theme, or null with none known yet. */
export async function themedIcon(size: number, alpha = 1): Promise<ImageData | null> {
  const value = await appearance();
  if (!value) return null;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d")!;
  drawLogo(context, size, logoColours(value), alpha);
  return context.getImageData(0, 0, size, size);
}

/** Show the still mark: themed when the theme is known, else the static icons. */
export async function restIcon(): Promise<void> {
  if (!chrome.action?.setIcon) return;   // a browser that cannot redraw the toolbar icon
  const [small, large] = await Promise.all([themedIcon(16), themedIcon(32)]);
  if (small && large) await chrome.action.setIcon({imageData: {16: small, 32: large}});
  else await chrome.action.setIcon({path: {16: "icons/icon-16.png", 32: "icons/icon-32.png"}});
}
