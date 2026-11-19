// SPDX-License-Identifier: GPL-2.0-or-later
// Writes both installable archives into web-ext-artifacts/ (WS-E0 B8).
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
for (const browser of ["chromium", "firefox"]) {
  execFileSync("npx", ["web-ext", "build", "--source-dir", `dist/${browser}`, "--artifacts-dir", "web-ext-artifacts",
    "--filename", `downloadpulse-${browser}-${version}.zip`, "--overwrite-dest"], { stdio: "inherit" });
}
// The corresponding source (GPL; AMO's source upload): the commit's tree, lockfile and BUILDING.md
// included. Only from a Git checkout -- a source archive is itself the source, and is not re-archived.
let checkout = false;
try {
  checkout = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true";
} catch {
  checkout = false;
}
if (checkout) {
  execFileSync("git", ["archive", "--format=zip", "--prefix=downloadpulse-extension/", "-o",
    `web-ext-artifacts/downloadpulse-source-${version}.zip`, "HEAD"], { stdio: "inherit" });
} else {
  console.log("not a Git checkout: no source archive written (this is the source)");
}
