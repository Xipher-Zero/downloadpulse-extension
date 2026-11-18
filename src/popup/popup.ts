// SPDX-License-Identifier: GPL-2.0-or-later
// Toolbar popup (WS-E1): renders the stored connection or pending pairing,
// and acts only by asking the background. A remote server's access is
// requested here, on the person's click (L20).

import {connection, pairing} from "../shared/connection";
import {localize, message} from "../shared/i18n";
import {candidateOrigins, type Failure, type Job} from "../shared/server";

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

// ── this browser's downloads (WS-E3) ────────────────────────────────────

const notes = new Map<string, string>();   // a control's declined reason, shown beneath its row
const DECLINED: Record<string, string> = {
  shared_interest: "controlSharedInterest", globally_paused: "controlGloballyPaused",
  paused_independently: "controlPausedElsewhere", already_settled: "controlSettled", not_connected: "sendNotConnected",
};
const unsettled = (job: Job): boolean => ["accepted", "queued", "processing"].includes(job.phase);

function stateKey(job: Job): string {
  if (job.phase === "completed") return "jobDone";
  if (job.phase === "failed") return "jobFailed";
  if (job.phase === "withdrawn") return "jobRemoved";
  if (job.reason === "paused") return job.paused_by === "client" ? "jobPausedHere" : "jobPausedServer";
  if (job.actionability === "operator") return "jobNeedsAttention";
  if (job.reason === "downloading") return "jobDownloading";
  if (job.phase === "processing") return "jobWorking";
  return "jobQueued";
}

function percent(job: Job): number | null {
  const value = job.progress?.effective?.percent ?? job.progress?.percent;
  return typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;
}

/** L27: the estimate, labelled as one; nothing when there is none. */
function estimate(job: Job): string {
  if (!job.estimate) return "";
  if (job.estimate.indeterminate || job.estimate.seconds === null) return message("etaEstimating");
  const seconds = job.estimate.seconds;
  const locale = chrome.i18n.getUILanguage();
  const unit = (value: number, name: "hour" | "minute" | "second") =>
    new Intl.NumberFormat(locale, {style: "unit", unit: name, unitDisplay: "short"}).format(value);
  const amount = seconds >= 3600 ? `${unit(Math.floor(seconds / 3600), "hour")} ${unit(Math.floor(seconds % 3600 / 60), "minute")}`
    : seconds >= 60 ? unit(Math.ceil(seconds / 60), "minute") : unit(seconds, "second");
  return message("etaAbout", [amount]);
}

function jobName(job: Job): string {
  const source = job.source ?? {};
  return job.display_name || String(source["name"] ?? "") || String((source["hosts"] as string[] | undefined)?.[0] ?? "")
    || String(source["kind"] ?? "");
}

function button(label: string, action: string, id: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "dp-button dp-button--small";
  element.textContent = message(label);
  element.dataset["job"] = id;
  element.dataset["jobAction"] = action;
  return element;
}

function renderJobs(jobs: Job[]): void {
  const list = document.querySelector<HTMLUListElement>('[data-testid="jobs"]')!;
  const empty = document.querySelector<HTMLElement>('[data-testid="list-empty"]')!;
  empty.hidden = jobs.length > 0;
  list.replaceChildren(...jobs.map((job) => {
    const row = document.createElement("li");
    row.className = "dp-job";
    row.dataset["jobId"] = job.id;
    row.dataset["phase"] = job.phase;
    const name = document.createElement("span");
    name.className = "dp-job__name";
    name.textContent = jobName(job);
    const state = document.createElement("span");
    state.className = "dp-job__state";
    state.dataset["testid"] = "state";
    const share = percent(job);
    const eta = unsettled(job) ? estimate(job) : "";
    state.textContent = [message(stateKey(job)), share !== null && unsettled(job) ? `${Math.round(share)}%` : "", eta]
      .filter(Boolean).join(" · ");
    row.append(name, state);
    if (share !== null && unsettled(job)) {
      const bar = document.createElement("progress");
      bar.max = 100;
      bar.value = share;
      row.append(bar);
    }
    if (unsettled(job)) {
      const controls = document.createElement("div");
      controls.className = "dp-job__controls";
      const pausedHere = job.reason === "paused" && job.paused_by === "client";
      controls.append(button(pausedHere ? "jobResume" : "jobPause", pausedHere ? "resume" : "pause", job.id),
        button("jobRemove", "remove", job.id));
      row.append(controls);
    }
    const note = notes.get(job.id);
    if (note) {
      const said = document.createElement("p");
      said.className = "dp-job__note";
      said.textContent = note;
      row.append(said);
    }
    return row;
  }));
}

async function act(id: string, action: string): Promise<void> {
  notes.delete(id);
  const request = action === "remove" ? {type: "dp-withdraw", id} : {type: "dp-control", id, kind: action};
  const answer = await chrome.runtime.sendMessage(request) as {ok: boolean; reason?: string} | undefined;
  if (answer && !answer.ok) notes.set(id, message(DECLINED[answer.reason ?? ""] ?? "controlFailed"));
  await render();
}

/** Opened from a notification: show that download (once). */
async function focusNotified(): Promise<void> {
  const fromUrl = new URLSearchParams(location.search).get("job");
  const stored = (await chrome.storage.session.get("focusJob"))["focusJob"] as string | undefined;
  const id = fromUrl || stored;
  if (!id) return;
  const row = document.querySelector<HTMLElement>(`li[data-job-id="${CSS.escape(id)}"]`);
  if (!row) return;
  if (stored) await chrome.storage.session.remove("focusJob");
  row.classList.add("dp-job--focus");
  row.scrollIntoView({block: "nearest"});
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
    // DownloadPulse itself: the server, or the standalone application on this computer.
    document.querySelector<HTMLAnchorElement>('[data-testid="open-server"]')!.href = `${connected.server}/`;
    const jobs = ((await chrome.storage.session.get("jobs"))["jobs"] ?? {}) as Record<string, Job>;
    renderJobs(Object.values(jobs).sort((a, b) => b.cursor - a.cursor));
    await focusNotified();
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
  const job = (event.target as HTMLElement).closest<HTMLElement>("button[data-job-action]");
  if (job) {
    void act(job.dataset["job"] ?? "", job.dataset["jobAction"] ?? "");
    return;
  }
  const action = (event.target as HTMLElement).closest<HTMLElement>("button[data-action]")?.dataset["action"];
  if (action === "connect-local" || action === "cancel") void chrome.runtime.sendMessage({type: action});
});
document.querySelector<HTMLFormElement>('form[data-action="connect-remote"]')?.addEventListener("submit", (event) => {
  event.preventDefault();
  void connectRemote(event.currentTarget as HTMLFormElement);
});
chrome.storage.onChanged.addListener(() => void render());
void render();
// While the popup is open, the list is kept fresh (WS-E3 B1).
void chrome.runtime.sendMessage({type: "dp-popup-open"});
setInterval(() => void chrome.runtime.sendMessage({type: "dp-popup-open"}), 4000);
