// SPDX-License-Identifier: GPL-2.0-or-later
// The extension's settings page (WS-E4): the connection and Disconnect, the
// in-page surfaces (globally and per site), and the notifications. These are
// this browser's own settings, never DownloadPulse's (L22).

import {connection} from "../shared/connection";
import {localize, message} from "../shared/i18n";
import {saveSettings, settings, siteOf, type Settings} from "../shared/settings";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

async function render(): Promise<void> {
  const connected = await connection();
  $("[data-connection='connected']").hidden = !connected;
  $("[data-connection='disconnected']").hidden = Boolean(connected);
  if (connected) {
    $('[data-testid="server"]').textContent = connected.server;
    $('[data-testid="account"]').textContent = connected.account;
    $('[data-testid="label"]').textContent = connected.label;
    $<HTMLAnchorElement>('[data-testid="open-server"]').href = `${connected.server}/`;
  }
  const chosen = await settings();
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-setting]")) {
    input.checked = Boolean(chosen[input.dataset["setting"] as "hover" | "video"]);
  }
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-notify]")) {
    input.checked = Boolean(chosen.notify[input.dataset["notify"] as keyof Settings["notify"]]);
  }
  $('[data-testid="off-sites"]').replaceChildren(...chosen.offSites.map((site) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = site;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "dp-button";
    remove.textContent = message("optionsRemoveSite");
    remove.dataset["removeSite"] = site;
    item.append(name, remove);
    return item;
  }));
}

function note(key: string): void {
  const element = $('[data-testid="connection-note"]');
  element.textContent = message(key);
  element.hidden = false;
}

localize(document);
for (const input of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
  input.placeholder = message(input.dataset["i18nPlaceholder"] ?? "");
}
document.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset["setting"]) void saveSettings({[input.dataset["setting"]]: input.checked});
  if (input.dataset["notify"]) {
    void settings().then((chosen) => saveSettings({notify: {...chosen.notify, [input.dataset["notify"]!]: input.checked}}));
  }
});
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const site = target.closest<HTMLElement>("[data-remove-site]")?.dataset["removeSite"];
  if (site) void settings().then((chosen) => saveSettings({offSites: chosen.offSites.filter((item) => item !== site)}));
  if (target.closest("[data-action='disconnect']")) {
    void chrome.runtime.sendMessage({type: "dp-disconnect"}).then((answer: {revoked?: boolean} | undefined) =>
      note(answer?.revoked ? "optionsDisconnected" : "optionsDisconnectedLocally"));
  }
});
$<HTMLFormElement>("form[data-action='add-site']").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>("#site");
  const site = siteOf(input.value);
  if (!site) return;
  void settings().then((chosen) => saveSettings({offSites: [...chosen.offSites, site]})).then(() => { input.value = ""; });
});
chrome.storage.onChanged.addListener(() => void render());
void render();
