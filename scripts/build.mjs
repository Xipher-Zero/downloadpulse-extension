// SPDX-License-Identifier: GPL-2.0-or-later
// Builds dist/chromium and dist/firefox from the same sources (WS-E0 B1).
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { manifest } from "../src/manifest.mjs";

const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root).pathname;
const { version } = JSON.parse(await readFile(path("package.json"), "utf8"));
// Which build a browser runs, at a glance in its extensions page (Chromium's
// version_name; Firefox has none): the commit, "+" when built from changes.
let commit = "";
try {
  commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
  if (execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()) commit += "+";
} catch {
  commit = "";
}

const ENTRIES = {
  "background": "src/background/index.ts",
  "content": "src/content/index.ts",
  "popup/popup": "src/popup/popup.ts",
  "confirm/confirm": "src/confirm/confirm.ts",
};
const STATIC = [
  ["src/popup/popup.css", "popup/popup.css"],
  ["src/confirm/confirm.html", "confirm/confirm.html"],
  ["_locales", "_locales"],
  ["static/icons", "icons"],
  ["static/fonts", "fonts"],
  ["LICENSE", "LICENSE"],
];

// A test build only (DP_CONFIRM_EVERYWHERE=1, into dist/test-confirm): an in-page press is confirmed in
// DownloadPulse's own window in every browser, as Firefox always does (background/confirm.ts), so
// that flow can be driven in Chromium's end-to-end tests. Never in a package (scripts/package.mjs uses dist/).
const confirmEverywhere = process.env.DP_CONFIRM_EVERYWHERE === "1";
const DIST = confirmEverywhere ? "dist/test-confirm" : "dist";

for (const browser of ["chromium", "firefox"]) {
  const out = path(`${DIST}/${browser}/`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await build({
    entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([k, v]) => [k, path(v)])),
    outdir: out, bundle: true, format: "iife", target: ["chrome120", "firefox140"],
    legalComments: "none", logLevel: "warning",
    define: {__DP_CONFIRM_EVERYWHERE__: confirmEverywhere ? "true" : "false"},
  });
  for (const [from, to] of STATIC) await cp(path(from), out + to, { recursive: true });
  // DownloadPulse's mark, drawn inline so its colours follow the theme
  // (DebridPulse frontend/static/logo.svg, coloured as ui-logo.css colours
  // it): decorative beside the wordmark, so without its title or description.
  const logo = (await readFile(path("static/brand/logo.svg"), "utf8")).trim()
    .replace(/<title[^>]*>[\s\S]*?<\/title>\s*/, "").replace(/<desc[^>]*>[\s\S]*?<\/desc>\s*/, "")
    .replace(' role="img" aria-labelledby="title desc"', ' class="dp-brand__logo" aria-hidden="true" focusable="false"');
  if (!logo.startsWith("<svg ") || /<script|on[a-z]+=|<title|<desc/i.test(logo) || !logo.includes('aria-hidden="true"')) {
    throw new Error("the logo could not be prepared for inlining");
  }
  const popupPage = (await readFile(path("src/popup/popup.html"), "utf8")).replace("<span data-logo-slot></span>", logo);
  if (!popupPage.includes("dp-brand__logo")) throw new Error("popup.html has no logo slot");
  await writeFile(out + "popup/popup.html", popupPage);
  // The browser's settings page for the extension is the dropdown's own
  // settings view, from the same markup and script (operator, 2026-11-18).
  const optionsPage = popupPage
    .replace('href="popup.css"', 'href="../popup/popup.css"')
    .replace('src="popup.js"', 'src="../popup/popup.js"')
    .replace('<title data-i18n="extName">', '<title data-i18n="optionsTitle">')
    .replace("<body>", '<body data-standalone="settings">');
  if (!optionsPage.includes('data-standalone="settings"') || !optionsPage.includes("../popup/popup.js")) {
    throw new Error("the settings page could not be made from popup.html");
  }
  await mkdir(out + "options", { recursive: true });
  await writeFile(out + "options/options.html", optionsPage);
  const made = manifest(browser, version);
  if (browser === "chromium" && commit) made.version_name = `${version} (${commit})`;
  await writeFile(out + "manifest.json", JSON.stringify(made, null, 2) + "\n");
}
console.log(`built ${DIST}/chromium and ${DIST}/firefox (version ${version})`);
