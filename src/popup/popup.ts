// SPDX-License-Identifier: GPL-2.0-or-later
// Toolbar popup (WS-E1): renders the stored connection or pending pairing,
// and acts only by asking the background. A remote server's access is
// requested here, on the person's click (L20).

import {connection, pairing} from "../shared/connection";
import {localize, message} from "../shared/i18n";
import {candidateOrigins, type Failure} from "../shared/server";

const FAILURE_KEYS: Record<Failure, string> = {
  unreachable: "failureUnreachable", certificate: "failureCertificate", not_downloadpulse: "failureNotDownloadPulse",
  too_old: "failureTooOld", denied: "failureDenied", expired: "failureExpired", permission: "failurePermission",
  unauthorized: "failureUnauthorized", failed: "failureFailed",
};

function show(state: string): HTMLElement {
  let shown: HTMLElement | null = null;
  for (const section of document.querySelectorAll<HTMLElement>("[data-state]")) {
    section.hidden = section.dataset["state"] !== state;
    if (!section.hidden) shown = section;
  }
  return shown!;
}

function text(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

async function render(): Promise<void> {
  const connected = await connection();
  const pending = await pairing();
  if (pending?.state === "waiting") {
    show("waiting");
    text('[data-testid="code"]', pending.userCode);
  } else if (pending?.state === "failed") {
    show("failed");
    text('[data-testid="failure"]', message(FAILURE_KEYS[pending.failure]));
  } else if (pending) {
    show(pending.state);
  } else if (connected) {
    show("connected");
    text('[data-testid="server"]', connected.server);
    text('[data-testid="account"]', connected.account);
    text('[data-testid="label"]', connected.label);
  } else {
    show("disconnected");
  }
}

async function connectRemote(form: HTMLFormElement): Promise<void> {
  const address = String(new FormData(form).get("server") ?? "");
  const origins = candidateOrigins(address);
  if (!origins.length) {
    show("failed");
    text('[data-testid="failure"]', message(FAILURE_KEYS.unreachable));
    return;
  }
  // Access to exactly that server, asked now, on this click (L20).
  const granted = await chrome.permissions.request({origins: origins.map((origin) => origin + "/*")});
  if (!granted) {
    show("failed");
    text('[data-testid="failure"]', message(FAILURE_KEYS.permission));
    return;
  }
  await chrome.runtime.sendMessage({type: "connect-remote", address});
}

localize(document);
for (const input of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
  input.placeholder = message(input.dataset["i18nPlaceholder"] ?? "");
}
document.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("button[data-action]")?.dataset["action"];
  if (action === "connect-local" || action === "cancel") void chrome.runtime.sendMessage({type: action});
});
document.querySelector<HTMLFormElement>('form[data-action="connect-remote"]')?.addEventListener("submit", (event) => {
  event.preventDefault();
  void connectRemote(event.currentTarget as HTMLFormElement);
});
chrome.storage.onChanged.addListener(() => void render());
void render();
