// SPDX-License-Identifier: GPL-2.0-or-later
// All user-visible text comes from _locales via chrome.i18n (WS-E0 B4).

export function message(key: string): string {
  const text = chrome.i18n.getMessage(key);
  return text || key;
}

/** Fills every [data-i18n] element in `root` and sets the document's language and direction. */
export function localize(root: Document): void {
  root.documentElement.lang = chrome.i18n.getMessage("@@ui_locale").replace("_", "-");
  root.documentElement.dir = chrome.i18n.getMessage("@@bidi_dir") === "rtl" ? "rtl" : "ltr";
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset["i18n"];
    if (key) el.textContent = message(key);
  }
  const title = root.querySelector<HTMLElement>("title[data-i18n]");
  if (title?.dataset["i18n"]) root.title = message(title.dataset["i18n"]);
}
