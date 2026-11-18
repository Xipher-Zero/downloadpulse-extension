// SPDX-License-Identifier: GPL-2.0-or-later
// Firefox smoke test (WS-E0 B7): the package installs as a temporary add-on
// and its background script runs without error. Firefox's console is routed
// to stdout (devtools.console.stdout.chrome), so an uncaught error in any
// extension script fails the run. Firefox binary: $FIREFOX or `firefox`.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const EXT = resolve(process.env.DP_EXT_DIR || "dist/firefox");
const FIREFOX = process.env.FIREFOX || "firefox";
const RUN_MS = 15_000;

const child = spawn("npx", ["web-ext", "run", "--source-dir", EXT, "--firefox", FIREFOX,
  "--no-input", "--no-reload", "--arg=-headless",
  "--pref=devtools.console.stdout.chrome=true", "--pref=devtools.console.stdout.content=true", "--verbose"],
  { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });
const timer = setTimeout(() => child.kill("SIGINT"), RUN_MS);
await new Promise((r) => child.on("exit", r));
clearTimeout(timer);

const installed = /Installed .* as a temporary add-on/.test(log);
const ours = log.split("\n").filter((l) => l.includes("moz-extension://") && /error|exception/i.test(l));
if (!installed || ours.length) {
  console.error(installed ? "Firefox smoke: errors from the extension:" : "Firefox smoke: the add-on was not installed.");
  console.error((ours.length ? ours : log.split("\n").slice(-30)).join("\n"));
  process.exit(1);
}
console.log("Firefox smoke: installed as a temporary add-on; no extension errors.");
