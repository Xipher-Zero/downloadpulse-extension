// SPDX-License-Identifier: GPL-2.0-or-later
// The extension's translations (WS-E5), held to DownloadPulse's discipline:
// every English key in every locale, the same placeholders, nothing left in
// English unless recorded, each translation made from the CURRENT English
// (i18n/sources: sha256[:16] of the English it was made from), reviewed for
// its current text (i18n/review), and each critical key back-translated.
// Exit 1 on any failure; --report prints the per-locale counts.
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
const config = read("i18n/locales.json");
const english = read("_locales/en/messages.json");
const placeholders = (entry) => [...new Set((entry.message.match(/\$[A-Z_]+\$/g) ?? []).map((name) => name.toLowerCase()))].sort();
const errors = [];
const report = {};

for (const [folder, tag] of Object.entries(config.locales)) {
  const path = `_locales/${folder}/messages.json`;
  const row = report[folder] = {missing: 0, stale: 0, unreviewed: 0, noBackTranslation: 0};
  if (!existsSync(path)) {
    errors.push(`${folder}: no catalog`);
    row.missing = Object.keys(english).length;
    continue;
  }
  const catalog = read(path);
  const sources = existsSync(`i18n/sources/${folder}.json`) ? read(`i18n/sources/${folder}.json`) : {};
  const review = existsSync(`i18n/review/${folder}.json`) ? read(`i18n/review/${folder}.json`).entries ?? {} : {};
  for (const key of Object.keys(catalog)) if (!(key in english)) errors.push(`${folder}: ${key} is not an English key`);
  for (const [key, entry] of Object.entries(english)) {
    const translated = catalog[key];
    if (!translated || typeof translated.message !== "string" || !translated.message.trim()) {
      row.missing += 1;
      errors.push(`${folder}: ${key} missing`);
      continue;
    }
    if (JSON.stringify(placeholders(translated)) !== JSON.stringify(placeholders(entry))) {
      errors.push(`${folder}: ${key} placeholders ${placeholders(translated)} differ from ${placeholders(entry)}`);
    }
    if (JSON.stringify(Object.keys(translated.placeholders ?? {}).sort()) !== JSON.stringify(Object.keys(entry.placeholders ?? {}).sort())) {
      errors.push(`${folder}: ${key} placeholder definitions differ from English`);
    }
    const ledger = review[key];
    if (translated.message === entry.message && !config.sameAsEnglish.includes(key) && !ledger?.identical) {
      errors.push(`${folder}: ${key} is still English`);
    }
    if (sources[key] !== hash(entry.message)) {
      row.stale += 1;
      errors.push(`${folder}: ${key} was not made from the current English`);
    }
    if (!ledger || ledger.source !== hash(entry.message) || ledger.translation !== hash(translated.message)
        || !(ledger.provenance ?? []).some((item) => /review/.test(item))) {
      row.unreviewed += 1;
      errors.push(`${folder}: ${key} has no current review`);
    }
    if (config.critical.includes(key) && !(ledger?.backTranslation && (ledger.provenance ?? []).includes("ai-back-translation"))) {
      row.noBackTranslation += 1;
      errors.push(`${folder}: ${key} (critical) has no back-translation`);
    }
  }
}

if (process.argv.includes("--report")) console.table(report);
if (errors.length) {
  console.error(errors.slice(0, 40).join("\n") + (errors.length > 40 ? `\n… ${errors.length - 40} more` : ""));
  console.error(`${errors.length} localization error(s)`);
  process.exit(1);
}
console.log(`${Object.keys(config.locales).length} locales × ${Object.keys(english).length} keys: complete, current, reviewed`);
