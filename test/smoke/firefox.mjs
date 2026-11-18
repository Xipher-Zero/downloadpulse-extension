// SPDX-License-Identifier: GPL-2.0-or-later
// Firefox smoke test (WS-E0 B7): the package installs as a temporary add-on
// and no extension script raises an error. Firefox's console is routed to
// stdout (devtools.console.stdout.chrome), so an uncaught error in any
// extension script fails the run. Firefox binary: $FIREFOX, else Playwright's
// pinned Firefox, else `firefox` on PATH.
//
// web-ext runs in its own process group so the whole tree (web-ext and
// Firefox) is stopped together, and an install deadline turns a Firefox that
// never connects into a failure with its log, never a hang.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/firefox");
const require = createRequire(import.meta.url);
function firefoxBinary() {
  if (process.env.FIREFOX) return process.env.FIREFOX;
  try { return require("playwright-core").firefox.executablePath(); } catch { return "firefox"; }
}
// web-ext's package `exports` hide its bin script; take it from this repository's node_modules.
const WEB_EXT = fileURLToPath(new URL("../../node_modules/web-ext/bin/web-ext.js", import.meta.url));
const INSTALL_DEADLINE_MS = 60_000;   // Firefox start + temporary install
const OBSERVE_MS = 10_000;            // after install: time for the background to run

const child = spawn(process.execPath, [WEB_EXT, "run", "--source-dir", EXT, "--firefox", firefoxBinary(),
  "--no-input", "--no-reload", "--arg=-headless",
  "--pref=devtools.console.stdout.chrome=true", "--pref=devtools.console.stdout.content=true", "--verbose"],
  { stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
let installedAt = 0;
const onData = (d) => {
  log += d;
  if (!installedAt && /Installed .* as a temporary add-on/.test(log)) {
    installedAt = Date.now();
    setTimeout(stop, OBSERVE_MS);
  }
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);
let stopped = false;
function stop() {
  if (stopped) return; stopped = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 5_000).unref();
}
const deadline = setTimeout(stop, INSTALL_DEADLINE_MS);
await new Promise((r) => child.on("exit", r));
clearTimeout(deadline);
stop();   // web-ext may exit early; never leave the rest of its process group running

const ours = log.split("\n").filter((l) => l.includes("moz-extension://") && /error|exception/i.test(l));
if (!installedAt || ours.length) {
  console.error(installedAt ? "Firefox smoke: errors from the extension:"
    : `Firefox smoke: the add-on was not installed (web-ext exited, or ${INSTALL_DEADLINE_MS / 1000} s passed).`);
  console.error((ours.length ? ours : log.split("\n").slice(-40)).join("\n"));
  process.exit(1);
}
console.log("Firefox smoke: installed as a temporary add-on; no extension errors.");
