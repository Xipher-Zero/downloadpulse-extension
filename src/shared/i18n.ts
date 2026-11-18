// SPDX-License-Identifier: GPL-2.0-or-later
// All user-visible text comes from _locales via chrome.i18n (WS-E0 B4).

export function message(key: string, substitutions?: string[]): string {
  const text = substitutions ? chrome.i18n.getMessage(key, substitutions) : chrome.i18n.getMessage(key);
  return text || key;
}

// Languages written right to left (of DownloadPulse's 19: Arabic).
const RTL = new Set(["ar", "fa", "he", "ur", "ps", "sd", "ug", "yi", "dv"]);

/** Fills every [data-i18n] element in `root` and sets the document's language and direction. */
export function localize(root: Document): void {
  // The language whose catalog the browser shows (getUILanguage), and its
  // direction. Chromium's @@ui_locale/@@bidi_dir can follow the application
  // locale instead, which need not be the language the messages are in.
  const language = chrome.i18n.getUILanguage();
  root.documentElement.lang = language;
  root.documentElement.dir = RTL.has(language.split(/[-_]/)[0]!.toLowerCase()) ? "rtl" : "ltr";
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset["i18n"];
    if (key) el.textContent = message(key);
  }
  const title = root.querySelector<HTMLElement>("title[data-i18n]");
  if (title?.dataset["i18n"]) root.title = message(title.dataset["i18n"]);
}
