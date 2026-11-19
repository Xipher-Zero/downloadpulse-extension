// SPDX-License-Identifier: GPL-2.0-or-later
// The toolbar dropdown (WS-E1, WS-E3, WS-E4; operator correctives
// 2026-11-18): the connection or the pending pairing, this browser's sent
// downloads, and the extension's settings as a view of the dropdown itself.
// Built a second time as the browser's settings page for the extension
// (body[data-standalone="settings"], scripts/build.mjs): the same settings.
// It acts only by asking the background. A remote server's access is
// requested here, on the person's click (L20).

import {appearance, applyAppearance} from "../shared/appearance";
import {connection, pairing, setPairing} from "../shared/connection";
import {glyph, placeGlyphs, type GlyphName} from "../shared/glyphs";
import {localize, message} from "../shared/i18n";
import {candidateOrigins, isLocal, type Failure, type Job} from "../shared/server";
import {isOffSite, saveSettings, settings, siteOf, type Settings} from "../shared/settings";

const FAILURE_KEYS: Record<Failure, string> = {
  unreachable: "failureUnreachable", certificate: "failureCertificate", not_downloadpulse: "failureNotDownloadPulse",
  too_old: "failureTooOld", denied: "failureDenied", expired: "failureExpired", permission: "failurePermission",
  unauthorized: "failureUnauthorized", failed: "failureFailed",
};
// How long the last look at DownloadPulse says anything: older, it is looked at again.
const REACH_FRESH_MS = 15_000;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const standalone = document.body.dataset["standalone"] === "settings";
let view: "main" | "settings" = standalone ? "settings" : "main";

function show(state: string): void {
  for (const section of document.querySelectorAll<HTMLElement>("[data-state]")) {
    section.hidden = view !== "main" || section.dataset["state"] !== state;
  }
  $("[data-view='settings']").hidden = view !== "settings";
  $("[data-action='back']").hidden = view !== "settings" || standalone;
  $("[data-action='settings']").hidden = view === "settings";
}

function text(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

/** The server as a person knows it: DownloadPulse on this computer is named, never its loopback address. */
function serverName(server: string): string {
  return isLocal(server) ? message("popupLocalInstance") : server;
}

// ── the connection's status ─────────────────────────────────────────────

async function renderReach(): Promise<void> {
  const element = document.querySelector<HTMLElement>('[data-testid="reach"]');
  if (!element) return;
  const reach = (await chrome.storage.session.get("reach"))["reach"] as {ok: boolean; at: number} | undefined;
  const state = !reach || Date.now() - reach.at > REACH_FRESH_MS ? "checking" : reach.ok ? "ok" : "unreachable";
  element.dataset["reach"] = state;
  text('[data-testid="reach-text"]', message(state === "ok" ? "popupConnected" : state === "unreachable"
    ? "popupUnreachable" : "popupChecking"));
}

// ── Sent Downloads (WS-E3) ──────────────────────────────────────────────

const notes = new Map<string, string>();   // a control's declined reason, shown beneath its row
const DECLINED: Record<string, string> = {
  shared_interest: "controlSharedInterest", globally_paused: "controlGloballyPaused",
  paused_independently: "controlPausedElsewhere", already_settled: "controlSettled", not_connected: "sendNotConnected",
};
const unsettled = (job: Job): boolean => ["accepted", "queued", "processing"].includes(job.phase);

/** The state's words and DownloadPulse's colour for it (its transfer-status semantics). */
function state(job: Job): {key: string; tone: string} {
  if (job.phase === "completed") return {key: "jobDone", tone: "none"};
  if (job.phase === "failed") return {key: "jobFailed", tone: "failed"};
  if (job.phase === "withdrawn") return {key: "jobRemoved", tone: "none"};
  if (job.reason === "paused") return {key: job.paused_by === "client" ? "jobPausedHere" : "jobPausedServer", tone: "paused"};
  if (job.actionability === "operator") return {key: "jobNeedsAttention", tone: "queued"};
  if (job.reason === "downloading") return {key: "jobDownloading", tone: "downloading"};
  if (job.phase === "processing") return {key: "jobWorking", tone: "processing"};
  return {key: "jobQueued", tone: "queued"};
}

function percent(job: Job): number | null {
  const value = job.progress?.effective?.percent ?? job.progress?.percent;
  return typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;
}

/** L27, compact: DownloadPulse's estimate as "ETA: H:MM:SS / M:SS", "ETA: ∞" while it has no figure; nothing without one. */
function estimate(job: Job): string {
  if (!job.estimate) return "";
  // The time is isolated left-to-right so a right-to-left language keeps its order.
  if (job.estimate.indeterminate || job.estimate.seconds === null) return message("etaShort", ["⁦∞⁩"]);
  const total = Math.max(0, Math.round(job.estimate.seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = hours ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`;
  return message("etaShort", [`⁦${time}⁩`]);
}

function jobName(job: Job): string {
  const source = job.source ?? {};
  // DownloadPulse's own title first: it follows the transfer (a media
  // download's resolved title replaces its link's placeholder).
  return job.name || job.display_name || String(source["name"] ?? "") || String((source["hosts"] as string[] | undefined)?.[0] ?? "")
    || String(source["kind"] ?? "");
}

function glyphButton(name: GlyphName, label: string, tone: string, data: Record<string, string>): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `dp-glyph-btn dp-glyph-btn--${tone}`;
  element.setAttribute("aria-label", message(label));
  element.title = message(label);
  Object.assign(element.dataset, data);
  element.append(glyph(name));
  return element;
}

function span(className: string, value: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = value;
  return element;
}

function renderJobs(jobs: Job[]): void {
  const list = $<HTMLUListElement>('[data-testid="jobs"]');
  $('[data-testid="list-empty"]').hidden = jobs.length > 0;
  // A control keeps its focus across a refresh.
  const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-job-action]");
  const keep = focused ? [focused.dataset["job"], focused.dataset["jobAction"]] : null;
  const locale = chrome.i18n.getUILanguage();
  const share = new Intl.NumberFormat(locale, {style: "percent", maximumFractionDigits: 0});
  list.replaceChildren(...jobs.map((job) => {
    const {key, tone} = state(job);
    const row = document.createElement("li");
    row.className = "dp-job";
    row.dataset["jobId"] = job.id;
    row.dataset["phase"] = job.phase;
    row.dataset["tone"] = tone;
    const name = span("dp-job__name", jobName(job));
    name.title = jobName(job);
    const line = document.createElement("div");
    line.className = "dp-job__line";
    const status = document.createElement("span");
    status.className = "dp-job__state";
    status.dataset["testid"] = "state";
    status.append(span("dp-job__status", message(key)));
    const eta = unsettled(job) ? estimate(job) : "";
    if (eta) status.append(" · ", span("dp-job__eta", eta));
    line.append(status);
    row.append(name, line);
    if (unsettled(job)) {
      const controls = document.createElement("span");
      controls.className = "dp-job__controls";
      const pausedHere = job.reason === "paused" && job.paused_by === "client";
      controls.append(
        glyphButton(pausedHere ? "play" : "pause", pausedHere ? "jobResume" : "jobPause", "blue",
          {job: job.id, jobAction: pausedHere ? "resume" : "pause"}),
        glyphButton("trash2", "jobRemove", "danger", {job: job.id, jobAction: "remove"}));
      line.append(controls);
      const value = percent(job);
      const progress = document.createElement("div");
      progress.className = "dp-job__progress";
      const bar = document.createElement("span");
      bar.className = "dp-job__bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      const fill = document.createElement("span");
      fill.className = "dp-job__fill";
      if (value !== null) {
        bar.setAttribute("aria-valuenow", String(Math.round(value)));
        fill.style.inlineSize = `${value}%`;
      }
      bar.append(fill);
      const pct = span("dp-job__pct", value !== null ? share.format(Math.round(value) / 100) : "");
      pct.dataset["testid"] = "percent";
      progress.append(bar, pct);
      row.append(progress);
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
  if (keep) list.querySelector<HTMLElement>(`[data-job="${CSS.escape(keep[0] ?? "")}"][data-job-action="${keep[1]}"]`)?.focus();
}

async function act(id: string, action: string): Promise<void> {
  notes.delete(id);
  const request = action === "remove" ? {type: "dp-withdraw", id} : {type: "dp-control", id, kind: action};
  const answer = await chrome.runtime.sendMessage(request) as {ok: boolean; reason?: string} | undefined;
  if (answer && !answer.ok) notes.set(id, message(DECLINED[answer.reason ?? ""] ?? "controlFailed"));
  await renderList();
}

/**
 * Clear: the finished entries leave this browser's list (as a browser's own
 * download list clears), and nothing else -- DownloadPulse keeps them, and an
 * entry DownloadPulse changes afterwards (its change cursor moves) is listed again.
 */
const CLEARED = "jobsCleared";
const finished = (job: Job): boolean => !unsettled(job);

async function listed(): Promise<Job[]> {
  const stored = await chrome.storage.session.get(["jobs", CLEARED]);
  const jobs = (stored["jobs"] ?? {}) as Record<string, Job>;
  const cleared = (stored[CLEARED] ?? {}) as Record<string, number>;
  return Object.values(jobs).filter((job) => !(job.id in cleared) || job.cursor > cleared[job.id]!)
    .sort((a, b) => b.cursor - a.cursor);
}

async function clearFinished(): Promise<void> {
  const cleared = ((await chrome.storage.session.get(CLEARED))[CLEARED] ?? {}) as Record<string, number>;
  for (const job of (await listed()).filter(finished)) cleared[job.id] = job.cursor;
  await chrome.storage.session.set({[CLEARED]: cleared});
}

async function renderList(): Promise<void> {
  const jobs = await listed();
  renderJobs(jobs);
  // Nothing finished to clear: the control stays in its place, disabled.
  $<HTMLButtonElement>('[data-testid="clear-list"]').disabled = !jobs.some(finished);
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

// ── settings (WS-E4), a view of the dropdown ────────────────────────────

/** This tab's site, with the download buttons on or off there. */
async function renderSiteSwitch(offSites: string[]): Promise<void> {
  const label = $('[data-testid="site-switch"]');
  const [tab] = standalone ? [] : await chrome.tabs.query({active: true, currentWindow: true});
  const site = /^https?:/.test(tab?.url ?? "") ? siteOf(tab!.url!) : "";
  label.hidden = !site;
  if (!site) return;
  label.dataset["site"] = site;
  text('[data-testid="site-text"]', message("popupSiteOn", [site]));
  $<HTMLInputElement>('[data-testid="site-on"]').checked = !isOffSite(tab!.url!, offSites);
}

async function renderSettings(): Promise<void> {
  const connected = await connection();
  $("[data-connection='connected']").hidden = !connected;
  $("[data-connection='disconnected']").hidden = Boolean(connected);
  if (connected) {
    text('[data-testid="settings-server"]', serverName(connected.server));
    text('[data-testid="settings-account"]', connected.account);
    text('[data-testid="settings-label"]', connected.label);
  }
  const chosen = await settings();
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-setting]")) {
    input.checked = Boolean(chosen[input.dataset["setting"] as "inPage" | "hover" | "video"]);
  }
  // Off, what the master switch governs is not shown at all.
  $('[data-testid="in-page-options"]').hidden = !chosen.inPage;
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-notify]")) {
    input.checked = Boolean(chosen.notify[input.dataset["notify"] as keyof Settings["notify"]]);
  }
  $('[data-testid="off-sites"]').replaceChildren(...chosen.offSites.map((site) => {
    const item = document.createElement("li");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "dp-btn dp-btn--sm";
    remove.textContent = message("optionsRemoveSite");
    remove.dataset["removeSite"] = site;
    item.append(span("", site), remove);
    return item;
  }));
  await renderSiteSwitch(chosen.offSites);
}

function note(key: string): void {
  const element = $('[data-testid="connection-note"]');
  element.textContent = message(key);
  element.hidden = false;
}

// ── the whole dropdown ──────────────────────────────────────────────────

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
    text('[data-testid="server"]', serverName(connected.server));
    text('[data-testid="account"]', connected.account);
    text('[data-testid="label"]', connected.label);
    await renderReach();
    await renderList();
    await focusNotified();
  } else {
    show("disconnected");
  }
  if (view === "settings") await renderSettings();
}

async function connectRemote(form: HTMLFormElement): Promise<void> {
  const address = String(new FormData(form).get("server") ?? "");
  const origins = candidateOrigins(address);
  if (!origins.length) {
    await setPairing({state: "failed", failure: "unreachable"});
    return;
  }
  // Access to exactly that server, asked now, on this click (L20).
  const granted = await chrome.permissions.request({origins: origins.map((origin) => origin + "/*")});
  if (!granted) {
    await setPairing({state: "failed", failure: "permission"});
    return;
  }
  await chrome.runtime.sendMessage({type: "connect-remote", address});
}

// Found on this computer: the person chooses it (the default) or a remote server.
let chosen: "local" | "remote" = "local";

function choose(choice: "local" | "remote", focus = false): void {
  chosen = choice;
  for (const card of document.querySelectorAll<HTMLElement>("[data-choice]")) {
    const on = card.dataset["choice"] === choice;
    card.setAttribute("aria-checked", String(on));
    card.tabIndex = on ? 0 : -1;
    if (on && focus) card.focus();
  }
  // Both panels keep their place in the slot (its height is the taller one's); the one
  // not chosen is inert -- no clicks, focus or reading -- and not drawn.
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    const on = panel.dataset["panel"] === choice;
    panel.inert = !on;
    panel.classList.toggle("dp-found__panel--off", !on);
  }
  if (choice === "remote" && !focus) $<HTMLInputElement>("#server-found").focus();
}

document.addEventListener("keydown", (event) => {
  // The radio group's arrows, as the wizard's: either way flips between the two.
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-choice]");
  if (!card || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  choose(card.dataset["choice"] === "local" ? "remote" : "local", true);
});
// Enter in the address field connects, as the Connect button does.
$<HTMLFormElement>("#remote-found").addEventListener("submit", (event) => {
  event.preventDefault();
  void connectRemote(event.currentTarget as HTMLFormElement);
});

async function openDownloadPulse(): Promise<void> {
  await chrome.runtime.sendMessage({type: "dp-open"});
  if (!standalone) window.close();
}

// The person's DownloadPulse appearance, as soon as it is known (and whenever it changes).
void appearance().then((value) => applyAppearance(document.documentElement, value));
localize(document);
placeGlyphs(document);
choose("local");
// The address hint's examples are literal (an address is no word to translate), each set
// apart in the theme's literal colour (operator, 2026-11-18): the sentence is translated
// around two markers, which become the examples' own elements.
{
  const hint = $('[data-testid="remote-hint"]');
  const parts = message("remoteAddressHint", ["\u0001", "\u0002"]).split(/(\u0001|\u0002)/);
  hint.replaceChildren(...parts.map((part) => {
    if (part !== "\u0001" && part !== "\u0002") return document.createTextNode(part);
    return span("dp-literal", part === "\u0001" ? "downloadpulse.example.com" : "192.168.1.20:8095");
  }));
}
// The right-click way names the menu item as the menu itself says it, in every language.
text('[data-testid="welcome-right-click"]', message("welcomeRightClick", [message("menuSend")]));
for (const input of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
  input.placeholder = message(input.dataset["i18nPlaceholder"] ?? "");
}
for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
  element.setAttribute("aria-label", message(element.dataset["i18nAria"] ?? ""));
}
for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-label]")) {
  element.setAttribute("aria-label", message(element.dataset["i18nLabel"] ?? ""));
  element.title = message(element.dataset["i18nLabel"] ?? "");
}
document.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset["setting"]) void saveSettings({[input.dataset["setting"]]: input.checked});
  if (input.dataset["notify"]) {
    void settings().then((chosen) => saveSettings({notify: {...chosen.notify, [input.dataset["notify"]!]: input.checked}}));
  }
  if (input.dataset["testid"] === "site-on") {
    const site = input.closest<HTMLElement>("[data-site]")?.dataset["site"] ?? "";
    void settings().then((chosen) => saveSettings({offSites: input.checked
      ? chosen.offSites.filter((item) => item !== site) : [...chosen.offSites, site]}));
  }
});
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const card = target.closest<HTMLElement>("[data-choice]");
  if (card) {
    choose(card.dataset["choice"] as "local" | "remote");
    return;
  }
  const job = target.closest<HTMLElement>("button[data-job-action]");
  if (job) {
    void act(job.dataset["job"] ?? "", job.dataset["jobAction"] ?? "");
    return;
  }
  const site = target.closest<HTMLElement>("[data-remove-site]")?.dataset["removeSite"];
  if (site) {
    void settings().then((chosen) => saveSettings({offSites: chosen.offSites.filter((item) => item !== site)}));
    return;
  }
  const button = target.closest<HTMLElement>("button[data-action]");
  const action = button?.dataset["action"];
  if (action === "settings" || action === "back") {
    view = action === "settings" ? "settings" : "main";
    $('[data-testid="connection-note"]').hidden = true;
    void render().then(() => $<HTMLElement>(view === "settings" ? "[data-action='back']" : "[data-action='settings']").focus());
  } else if (action === "details") {
    const open = button!.getAttribute("aria-expanded") !== "true";
    button!.setAttribute("aria-expanded", String(open));
    $("#facts").hidden = !open;
  } else if (action === "clear-list") {
    void clearFinished();
  } else if (action === "open") {
    void openDownloadPulse();
  } else if (action === "connect-chosen") {
    if (chosen === "remote") {
      const form = $<HTMLFormElement>("#remote-found");
      if (form.reportValidity()) void connectRemote(form);
    } else {
      void pairing().then((pending) => {
        if (pending?.state === "found") void chrome.runtime.sendMessage({type: "pair-local", origin: pending.server});
      });
    }
  } else if (action === "disconnect") {
    void chrome.runtime.sendMessage({type: "dp-disconnect"}).then((answer: {revoked?: boolean} | undefined) =>
      note(answer?.revoked ? "optionsDisconnected" : "optionsDisconnectedLocally"));
  } else if (action === "connect-local" || action === "cancel") {
    void chrome.runtime.sendMessage({type: action});
  }
});
// Every server form: after something or nothing was found here, and after any failure.
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-action="connect-remote"]')) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void connectRemote(event.currentTarget as HTMLFormElement);
  });
}
$<HTMLFormElement>("form[data-action='add-site']").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>("#site");
  const site = siteOf(input.value);
  if (!site) return;
  void settings().then((chosen) => saveSettings({offSites: [...chosen.offSites, site]})).then(() => { input.value = ""; });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "appearance" in changes) void appearance().then((value) => applyAppearance(document.documentElement, value));
  // The status alone changes every look: redraw only it, so the list (and a focused control) stays put.
  if (Object.keys(changes).every((key) => key === "reach")) void renderReach();
  else void render();
});
void render();
if (!standalone) {
  // While the dropdown is open, the list and the status are kept fresh (WS-E3 B1).
  void chrome.runtime.sendMessage({type: "dp-popup-open"});
  setInterval(() => void chrome.runtime.sendMessage({type: "dp-popup-open"}), 4000);
  setInterval(() => void renderReach(), 5000);
}
