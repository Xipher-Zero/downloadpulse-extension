// SPDX-License-Identifier: GPL-2.0-or-later
// DownloadPulse's own window asking whether to send what a page's button was pressed for
// (1.0.8, WS-A3; background/confirm.ts): the site, the links, Send and Cancel. Only Send here
// sends; closing the window sends nothing.

import {localize, message} from "../shared/i18n";

/**
 * Send answers only once the window has been in front this long (as the browser's own
 * permission dialogs wait): a window that comes up under a click or a key press already on its
 * way -- the person's hands still on the page -- can't catch it.
 */
const ARMED_AFTER_MS = 600;

const id = new URLSearchParams(location.search).get("id") ?? "";
const send = document.querySelector<HTMLButtonElement>('[data-action="send"]')!;
const cancel = document.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
let armTimer = 0;

function arm(): void {
  send.disabled = true;
  clearTimeout(armTimer);
  armTimer = window.setTimeout(() => { send.disabled = false; }, ARMED_AFTER_MS);
}

let answered = false;
async function reply(yes: boolean): Promise<void> {
  if (answered) return;
  answered = true;
  send.disabled = cancel.disabled = true;
  // The background closes this window once it has the answer.
  await chrome.runtime.sendMessage({type: "dp-confirm-answer", id, send: yes});
  window.close();
}

async function start(): Promise<void> {
  localize(document);
  const question = await chrome.runtime.sendMessage({type: "dp-confirm-get", id}) as
    {kind: string; site: string; links: string[]} | null;
  if (!question) {
    window.close();
    return;
  }
  document.querySelector('[data-testid="site"]')!.textContent = message("confirmFrom", [question.site]);
  document.querySelector('[data-testid="count"]')!.textContent = message("confirmLinks", [String(question.links.length)]);
  const list = document.querySelector('[data-testid="links"]')!;
  for (const link of question.links) {
    const item = document.createElement("li");
    item.textContent = link;
    list.append(item);
  }
  send.addEventListener("click", (event) => { if (event.isTrusted) void reply(true); });
  cancel.addEventListener("click", () => void reply(false));
  addEventListener("keydown", (event) => { if (event.key === "Escape") void reply(false); });
  // Waits again whenever the window comes back to the front.
  addEventListener("focus", arm);
  addEventListener("blur", () => { clearTimeout(armTimer); send.disabled = true; });
  arm();
  cancel.focus();
}

void start();
