// SPDX-License-Identifier: GPL-2.0-or-later
// Builds dist/chromium and dist/firefox from the same sources (WS-E0 B1).
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { manifest } from "../src/manifest.mjs";

const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root).pathname;
const { version } = JSON.parse(await readFile(path("package.json"), "utf8"));

const ENTRIES = {
  "background": "src/background/index.ts",
  "content": "src/content/index.ts",
  "popup/popup": "src/popup/popup.ts",
  "options/options": "src/options/options.ts",
};
const STATIC = [
  ["src/popup/popup.html", "popup/popup.html"],
  ["src/popup/popup.css", "popup/popup.css"],
  ["src/options/options.html", "options/options.html"],
  ["_locales", "_locales"],
  ["static/icons", "icons"],
];

for (const browser of ["chromium", "firefox"]) {
  const out = path(`dist/${browser}/`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await build({
    entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([k, v]) => [k, path(v)])),
    outdir: out, bundle: true, format: "iife", target: ["chrome120", "firefox140"],
    legalComments: "none", logLevel: "warning",
  });
  for (const [from, to] of STATIC) await cp(path(from), out + to, { recursive: true });
  await writeFile(out + "manifest.json", JSON.stringify(manifest(browser, version), null, 2) + "\n");
}
console.log(`built dist/chromium and dist/firefox (version ${version})`);
