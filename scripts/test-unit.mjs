// SPDX-License-Identifier: GPL-2.0-or-later
// Unit tests: test/unit/*.test.ts bundled by esbuild, run by node --test.
import {build} from "esbuild";
import {execFileSync} from "node:child_process";
import {mkdtempSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const out = mkdtempSync(join(tmpdir(), "dp-ext-unit-"));
try {
  const entries = readdirSync("test/unit").filter((name) => name.endsWith(".test.ts")).map((name) => join("test/unit", name));
  await build({entryPoints: entries, outdir: out, bundle: true, platform: "node", format: "esm",
    outExtension: {".js": ".mjs"}, logLevel: "warning"});
  execFileSync(process.execPath, ["--test", ...readdirSync(out).map((name) => join(out, name))], {stdio: "inherit"});
} finally {
  rmSync(out, {recursive: true, force: true});
}
