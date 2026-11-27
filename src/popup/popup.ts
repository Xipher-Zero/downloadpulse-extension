// SPDX-License-Identifier: GPL-2.0-or-later
// The toolbar dropdown (WS-E1, WS-E3, WS-E4; operator correctives
// 2026-11-18): the connection or the pending pairing, this browser's sent
// downloads, and the extension's settings as a view of the dropdown itself.
// Built a second time as the browser's settings page for the extension
// (body[data-standalone="settings"], scripts/build.mjs): the same settings.
// It acts only by asking the background. A remote server's access is
// requested here, on the person's click (L20).

import {appearance, applyAppearance} from "../shared/appearance";
import {
  choosePlainHttp, connection, connections, connectionState, defaultServer, forgetConnection, pairing, renameServer, servers,
  serverOrder, setDefaultServer, setPairing, setServerOrder, successor, type Server,
} from "../shared/connection";
import {MAX_SERVERS, moved, NAME_MAX} from "../shared/servers";
import {isStateKey, stateKey} from "../shared/server-state";
import {glyph, placeGlyphs, type GlyphName} from "../shared/glyphs";
import {localize, message} from "../shared/i18n";
import {consented, recordConsent} from "../shared/consent";
import {effectiveAddress, isLocal, isSharedAddressRange, type Failure, type Job} from "../shared/server";
import {fileTypes, isOffSite, saveSettings, settings, siteOf, type Settings} from "../shared/settings";

const FAILURE_KEYS: Record<Failure, string> = {
  unreachable: "failureUnreachable", certificate: "failureCertificate", not_downloadpulse: "failureNotDownloadPulse",
  too_old: "failureTooOld", denied: "failureDenied", expired: "failureExpired", permission: "failurePermission",
  unauthorized: "failureUnauthorized", failed: "failureFailed",
  https_only: "failureHttpsOnly", insecure_refused: "failureInsecureRefused", blocked: "failureBlocked",
  setup_incomplete: "failureSetupIncomplete", too_many: "failureTooMany",
};
const PRIVACY_URL = "https://github.com/Xipher-Zero/downloadpulse-extension/blob/main/PRIVACY.md";

// A screen of the dropdown's own before anything is sent: the disclosure, or the plain-HTTP choice.
let screen: "disclosure" | "insecure" | null = null;
let insecureTarget = "";
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

type Reach = "ok" | "checking" | "unreachable";

/** Each server's last look, by origin: answered, not answered, or too old to say (checking). */
async function reaches(list: readonly Server[]): Promise<Record<string, Reach>> {
  const stored = await chrome.storage.session.get(list.map((item) => stateKey(item.server, "reach")));
  return Object.fromEntries(list.map((item) => {
    const reach = stored[stateKey(item.server, "reach")] as {ok: boolean; at: number} | undefined;
    return [item.server, !reach || Date.now() - reach.at > REACH_FRESH_MS ? "checking" : reach.ok ? "ok" : "unreachable"];
  }));
}

/**
 * The status row. One server: as 1.0.7 (its dot and its words). Two or more (WS-X1): a dot per
 * server in display order -- reachability only, never an identity colour -- and the summary
 * ("Connected", "2 of 3 connected", "Unreachable"); the list's dots follow.
 */
async function renderReach(): Promise<void> {
  const element = document.querySelector<HTMLElement>('[data-testid="reach"]');
  if (!element) return;
  const list = await servers();
  if (!list.length) return;
  const states = await reaches(list);
  reachNow = states;
  const dots = $('[data-testid="dots"]');
  if (list.length === 1) {
    const state = states[list[0]!.server]!;
    if (dots.children.length !== 1 || (dots.firstElementChild as HTMLElement).dataset["reach"]) {
      const dot = span("dp-conn__dot", "");
      dot.setAttribute("aria-hidden", "true");
      dots.replaceChildren(dot);
    }
    element.dataset["reach"] = state;
    text('[data-testid="reach-text"]', message(state === "ok" ? "popupConnected" : state === "unreachable"
      ? "popupUnreachable" : "popupChecking"));
    return;
  }
  dots.replaceChildren(...list.map((item) => {
    const dot = span("dp-conn__dot dp-conn__dot--server", "");
    dot.dataset["reach"] = states[item.server]!;
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }));
  const values = Object.values(states);
  const ok = values.filter((state) => state === "ok").length;
  const unreachable = values.filter((state) => state === "unreachable").length;
  const overall = ok === values.length ? "ok" : unreachable === values.length ? "unreachable" : unreachable === 0 ? "checking" : "partial";
  element.dataset["reach"] = overall;
  text('[data-testid="reach-text"]', overall === "ok" ? message("popupConnected") : overall === "unreachable"
    ? message("serverUnreachable") : overall === "checking" ? message("popupChecking")
      : message("popupSomeConnected", [String(ok), String(values.length)]));
  for (const block of document.querySelectorAll<HTMLElement>("li.dp-server[data-server]")) {
    const state = states[block.dataset["server"] ?? ""] ?? "checking";
    block.querySelector<HTMLElement>(".dp-server__dot")!.dataset["reach"] = state;
    block.querySelector<HTMLElement>(".dp-server__unreachable")!.hidden = state !== "unreachable";
  }
}

// The last look at each server (renderReach): what the ▾ lists may choose.
let reachNow: Record<string, Reach> = {};

// ── more than one server (WS-X1): the expanded list ─────────────────────

let renaming: {server: string; problem: "blank" | "duplicate" | null} | null = null;
let dragging: {server: string; pointer: number; moved: boolean} | null = null;
// After the list is drawn again: this server's handle (a keyboard move) or rename field gets the focus.
let refocus: {server: string; what: "handle" | "rename" | "pencil" | "star"} | null = null;

function announce(value: string): void {
  const region = $('[data-testid="announce"]');
  region.textContent = "";
  // A fresh text node each time, so the same words are announced again.
  window.setTimeout(() => { region.textContent = value; }, 30);
}

function serverBlock(item: Server, state: Reach, many: boolean): HTMLLIElement {
  const block = document.createElement("li");
  block.className = "dp-server";
  block.dataset["server"] = item.server;
  block.setAttribute("aria-label", item.name);
  const top = document.createElement("div");
  top.className = "dp-server__top";
  if (many) {
    const handle = glyphButton("gripVertical", "", "bare", {action: "server-move", server: item.server});
    handle.classList.add("dp-server__handle");
    handle.setAttribute("aria-label", message("serverMoveLabel", [item.name]));
    handle.title = message("serverMoveLabel", [item.name]);
    top.append(handle);
  }
  const dot = span("dp-server__dot", "");
  dot.dataset["reach"] = state;
  dot.setAttribute("aria-hidden", "true");
  top.append(dot);
  if (renaming?.server === item.server) {
    const field = document.createElement("input");
    field.type = "text";
    field.className = "dp-server__field";
    field.maxLength = NAME_MAX;
    field.value = item.name;
    field.spellcheck = false;
    field.autocomplete = "off";
    field.dataset["rename"] = item.server;
    field.dataset["testid"] = "rename";
    field.setAttribute("aria-label", message("serverNameLabel"));
    if (renaming.problem) field.setAttribute("aria-invalid", "true");
    top.append(field);
  } else {
    top.append(span("dp-server__name", item.name));
    const pencil = glyphButton("pencil", "", "bare", {action: "server-rename", server: item.server});
    pencil.classList.add("dp-server__rename");
    pencil.setAttribute("aria-label", message("serverRename", [item.name]));
    pencil.title = message("serverRename", [item.name]);
    top.append(pencil);
  }
  const away = span("dp-server__unreachable", message("serverUnreachable"));
  away.hidden = state !== "unreachable";
  top.append(away);
  const star = glyphButton("star", item.isDefault ? "serverDefault" : "serverMakeDefault", "bare",
    {action: "server-default", server: item.server});
  star.classList.add("dp-server__star");
  star.setAttribute("aria-pressed", String(item.isDefault));
  top.append(star);
  block.append(top);
  if (renaming?.server === item.server && renaming.problem) {
    const problem = span("dp-server__problem", message(renaming.problem === "blank" ? "serverNameBlank" : "serverNameTaken"));
    problem.setAttribute("role", "alert");
    problem.dataset["testid"] = "rename-problem";
    block.append(problem);
  }
  block.append(span("dp-server__line", serverName(item.server)));
  const who = document.createElement("span");
  who.className = "dp-server__line dp-server__who";
  who.append(span("dp-server__label", message("popupAccount")), " ", span("", item.account), " · ",
    span("dp-server__label", message("popupBrowser")), " ", span("", item.label));
  block.append(who);
  return block;
}

/** The expanded list: one block per server, in display order (drawn again unless one is being moved or renamed). */
let serversDrawn = "";

function renderServers(list: readonly Server[], states: Record<string, Reach>, force = false): void {
  const container = $<HTMLUListElement>('[data-testid="servers"]');
  const field = document.activeElement;
  if (dragging) return;
  if (!force && renaming && field instanceof HTMLInputElement && field.dataset["rename"] !== undefined) return;
  // Drawn again only when something it shows changed (the list refreshes every few seconds),
  // and the focus stays on the same control of the same server.
  const drawn = JSON.stringify([list, states, renaming]);
  if (drawn === serversDrawn && !refocus) return;
  serversDrawn = drawn;
  const was = (field as HTMLElement | null)?.closest<HTMLElement>("li.dp-server[data-server]");
  if (!refocus && was && container.contains(was)) {
    const what = field?.classList.contains("dp-server__handle") ? "handle" : field?.classList.contains("dp-server__rename") ? "pencil"
      : field?.classList.contains("dp-server__star") ? "star" : null;
    if (what) refocus = {server: was.dataset["server"] ?? "", what};
  }
  container.replaceChildren(...list.map((item) => serverBlock(item, states[item.server] ?? "checking", list.length > 1)));
  if (refocus) {
    const {server, what} = refocus;
    refocus = null;
    const block = container.querySelector<HTMLElement>(`li[data-server="${CSS.escape(server)}"]`);
    const target = block?.querySelector<HTMLElement>(what === "handle" ? ".dp-server__handle" : what === "rename"
      ? ".dp-server__field" : what === "pencil" ? ".dp-server__rename" : ".dp-server__star");
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }
}

async function moveServer(server: string, by: number): Promise<void> {
  const order = await serverOrder();
  const at = order.indexOf(server);
  if (at < 0 || at + by < 0 || at + by >= order.length) return;
  const next = moved(order, server, at + by);
  refocus = {server, what: "handle"};
  await setServerOrder(next);
  await movedSay(server, next);
}

async function movedSay(server: string, order: readonly string[]): Promise<void> {
  const name = (await servers()).find((item) => item.server === server)?.name ?? "";
  announce(message("serverMoved", [name, String(order.indexOf(server) + 1), String(order.length)]));
}

async function commitRename(field: HTMLInputElement): Promise<void> {
  const server = field.dataset["rename"] ?? "";
  if (renaming?.server !== server) return;
  if (committing) return;
  committing = true;
  try {
    const typed = field.value;
    const problem = await renameServer(server, typed);
    if (problem) {
      renaming = {server, problem};
      refocus = {server, what: "rename"};
      renderServers(await servers(), reachNow, true);
      const again = document.querySelector<HTMLInputElement>(`[data-rename="${CSS.escape(server)}"]`);
      if (again) again.value = typed;
      return;
    }
    renaming = null;
    refocus = {server, what: "pencil"};
    renderServers(await servers(), reachNow, true);
  } finally {
    committing = false;
  }
}
let committing = false;

// ── the ▾ lists: Quick Add's, Open DownloadPulse's (WS-X1) ─────────────

function closeMenus(focusAnchor = false): void {
  for (const menu of document.querySelectorAll<HTMLElement>("[data-menu]")) {
    if (menu.hidden) continue;
    menu.hidden = true;
    const anchor = document.querySelector<HTMLElement>(`[aria-controls="${menu.id}"]`);
    anchor?.setAttribute("aria-expanded", "false");
    if (focusAnchor) anchor?.focus();
  }
}

/** A list of the servers in display order (a dot, the name, ★ on the default); ``usable`` says which may be chosen. */
async function openMenu(kind: "quick" | "open", anchor: HTMLElement, usable: (state: Reach) => boolean,
                        choose: (server: string) => void): Promise<void> {
  const menu = $(`[data-menu="${kind}"]`);
  if (!menu.hidden) return closeMenus(true);
  closeMenus();
  const list = await servers();
  const states = await reaches(list);
  menu.id = `menu-${kind}`;
  anchor.setAttribute("aria-controls", menu.id);
  menu.replaceChildren(...list.map((item) => {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "dp-menu__item";
    entry.setAttribute("role", "menuitem");
    entry.dataset["server"] = item.server;
    const state = states[item.server] ?? "checking";
    const dot = span("dp-server__dot", "");
    dot.dataset["reach"] = state;
    dot.setAttribute("aria-hidden", "true");
    entry.append(dot, span("dp-menu__name", item.name));
    if (item.isDefault) {
      const star = glyph("star");
      star.classList.add("dp-menu__star");
      entry.append(star);
    }
    if (state === "unreachable") entry.append(span("dp-menu__away", message("serverUnreachable")));
    if (!usable(state)) entry.setAttribute("aria-disabled", "true");
    entry.addEventListener("click", () => {
      if (entry.getAttribute("aria-disabled") === "true") return;
      closeMenus();
      choose(item.server);
    });
    return entry;
  }));
  menu.hidden = false;
  anchor.setAttribute("aria-expanded", "true");
  (menu.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? menu.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
}

document.addEventListener("keydown", (event) => {
  const item = (event.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]');
  if (!item) return;
  const items = [...item.parentElement!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenus(true);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const at = items.indexOf(item);
    items[(at + step + items.length) % items.length]?.focus();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    items[event.key === "Home" ? 0 : items.length - 1]?.focus();
  } else if (event.key === "Tab") {
    closeMenus();
  }
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest("[data-menu]") && !target.closest('[aria-haspopup="menu"]')) closeMenus();
});

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

/** A download in the list, with the server it is on (WS-X1: the list is every server's, merged). */
interface Listed { job: Job; server: string }

/** The notes' key: two servers may each have a job of the same ID. */
const noteKey = (server: string, id: string): string => `${server}\n${id}`;

function renderJobs(entries: Listed[], names: Record<string, string> | null): void {
  const list = $<HTMLUListElement>('[data-testid="jobs"]');
  $('[data-testid="list-empty"]').hidden = entries.length > 0;
  // A control keeps its focus across a refresh.
  const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-job-action]");
  const keep = focused ? [focused.dataset["job"], focused.dataset["jobAction"], focused.dataset["server"]] : null;
  const locale = chrome.i18n.getUILanguage();
  const share = new Intl.NumberFormat(locale, {style: "percent", maximumFractionDigits: 0});
  list.replaceChildren(...entries.map(({job, server}) => {
    const {key, tone} = state(job);
    const row = document.createElement("li");
    row.className = "dp-job";
    row.dataset["jobId"] = job.id;
    row.dataset["server"] = server;
    row.dataset["phase"] = job.phase;
    row.dataset["tone"] = tone;
    const title = span("dp-job__name", jobName(job));
    title.title = jobName(job);
    // Two or more servers: each row names the server its download is on.
    let name: HTMLElement = title;
    if (names) {
      name = document.createElement("div");
      name.className = "dp-job__head";
      const tag = span("dp-job__server", names[server] ?? "");
      tag.dataset["testid"] = "job-server";
      name.append(title, tag);
    }
    const line = document.createElement("div");
    line.className = "dp-job__line";
    const status = document.createElement("span");
    status.className = "dp-job__state";
    status.dataset["testid"] = "state";
    status.append(span("dp-job__status", message(key)));
    const eta = unsettled(job) ? estimate(job) : "";
    if (eta) status.append(" · ", span("dp-job__eta", eta));
    line.append(status);
    if (job.phase === "completed") {
      // Done, as DownloadPulse shows a finished transfer: the bar full in its completion
      // green, and "Done" in green where the percent was (operator, 2026-11-18).
      const progress = document.createElement("div");
      progress.className = "dp-job__progress";
      const bar = document.createElement("span");
      bar.className = "dp-job__bar";
      bar.setAttribute("role", "progressbar");
      for (const [name_, value] of [["aria-valuemin", "0"], ["aria-valuemax", "100"], ["aria-valuenow", "100"]]) {
        bar.setAttribute(name_!, value!);
      }
      const fill = document.createElement("span");
      fill.className = "dp-job__fill";
      fill.style.inlineSize = "100%";
      bar.append(fill);
      const done = span("dp-job__pct dp-job__done", message(key));
      done.dataset["testid"] = "state";
      progress.append(bar, done);
      row.append(name, progress);
    } else {
      row.append(name, line);
    }
    if (unsettled(job)) {
      const controls = document.createElement("span");
      controls.className = "dp-job__controls";
      // The person may resume any paused download of theirs, whoever paused it, as they can
      // in DownloadPulse -- not everything paused at once (operator, 2026-11-22).
      const resumable = job.reason === "paused" && job.paused_by !== "administrator";
      controls.append(
        glyphButton(resumable ? "play" : "pause", resumable ? "jobResume" : "jobPause", "blue",
          {job: job.id, server, jobAction: resumable ? "resume" : "pause"}),
        glyphButton("trash2", "jobRemove", "danger", {job: job.id, server, jobAction: "remove"}));
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
    if (!unsettled(job)) {
      // A finished download leaves this list alone (as Clear does for all of them): the
      // footer's trash, on the title line, shown while the row is hovered or focused.
      const forget = glyphButton("trash2", "listRemove", "danger", {job: job.id, server, jobAction: "forget"});
      forget.classList.add("dp-job__forget");
      row.append(forget);
    }
    const note = notes.get(noteKey(server, job.id));
    if (note) {
      const said = document.createElement("p");
      said.className = "dp-job__note";
      said.textContent = note;
      row.append(said);
    }
    return row;
  }));
  if (keep) {
    list.querySelector<HTMLElement>(`[data-job="${CSS.escape(keep[0] ?? "")}"][data-server="${CSS.escape(keep[2] ?? "")}"]`
      + `[data-job-action="${keep[1]}"]`)?.focus();
  }
}

/** A row's control, sent to that job's own server (WS-X1). */
async function act(id: string, server: string, action: string): Promise<void> {
  notes.delete(noteKey(server, id));
  if (action === "forget") return forget(id, server);
  const request = action === "remove" ? {type: "dp-withdraw", id, server} : {type: "dp-control", id, kind: action, server};
  const answer = await chrome.runtime.sendMessage(request) as {ok: boolean; reason?: string} | undefined;
  if (answer && !answer.ok) notes.set(noteKey(server, id), message(DECLINED[answer.reason ?? ""] ?? "controlFailed"));
  await renderList();
}

/**
 * Clear: the finished entries leave this browser's list (as a browser's own
 * download list clears), and nothing else -- DownloadPulse keeps them, and an
 * entry DownloadPulse changes afterwards (its change cursor moves) is listed again.
 */
const finished = (job: Job): boolean => !unsettled(job);

/** One server's list keys (each server's own: server-state.ts). */
const listKeys = (server: string): {jobs: string; cleared: string} =>
  ({jobs: stateKey(server, "jobs"), cleared: stateKey(server, "jobsCleared")});

/**
 * Every server's downloads, merged (WS-X1), less what the person cleared. One server: its
 * change order, as 1.0.7. Two or more: newest sent first (servers' change cursors are their own).
 */
async function listed(): Promise<Listed[]> {
  const order = await serverOrder();
  const keys = order.flatMap((server) => Object.values(listKeys(server)));
  const stored = keys.length ? await chrome.storage.session.get(keys) : {};
  const entries = order.flatMap((server) => {
    const jobs = (stored[listKeys(server).jobs] ?? {}) as Record<string, Job>;
    const cleared = (stored[listKeys(server).cleared] ?? {}) as Record<string, number>;
    return Object.values(jobs).filter((job) => !(job.id in cleared) || job.cursor > cleared[job.id]!)
      .map((job) => ({job, server}));
  });
  if (order.length < 2) return entries.sort((a, b) => b.job.cursor - a.job.cursor);
  const sent = (entry: Listed): number => Date.parse(entry.job.submitted_at ?? "") || 0;
  return entries.sort((a, b) => sent(b) - sent(a) || b.job.cursor - a.job.cursor);
}

/** Clear: every server's finished entries leave this browser's list (WS-X1). */
async function clearFinished(): Promise<void> {
  const done = (await listed()).filter((entry) => finished(entry.job));
  const servers_ = [...new Set(done.map((entry) => entry.server))];
  if (!servers_.length) return;
  const stored = await chrome.storage.session.get(servers_.map((server) => listKeys(server).cleared));
  const writes: Record<string, Record<string, number>> = {};
  for (const {job, server} of done) {
    const key = listKeys(server).cleared;
    writes[key] ??= {...((stored[key] ?? {}) as Record<string, number>)};
    writes[key][job.id] = job.cursor;
  }
  await chrome.storage.session.set(writes);
}

/** One finished entry leaves this browser's list, as Clear does for all of them. */
async function forget(id: string, server: string): Promise<void> {
  const keys = listKeys(server);
  const entry = (await listed()).find((item) => item.job.id === id && item.server === server);
  if (!entry || !finished(entry.job)) return;
  const cleared = ((await chrome.storage.session.get(keys.cleared))[keys.cleared] ?? {}) as Record<string, number>;
  cleared[id] = entry.job.cursor;
  await chrome.storage.session.set({[keys.cleared]: cleared});
  // The focus moves on to the list's next entry, or to the footer's Clear.
  const rows = [...document.querySelectorAll<HTMLElement>("li[data-job-id]")];
  const next = rows[rows.findIndex((item) => item.dataset["jobId"] === id && item.dataset["server"] === server) + 1];
  await renderList();
  const target = next ? document.querySelector<HTMLElement>(`li[data-job-id="${CSS.escape(next.dataset["jobId"] ?? "")}"]`
    + `[data-server="${CSS.escape(next.dataset["server"] ?? "")}"] button`) : null;
  (target ?? $<HTMLElement>('[data-testid="clear-list"]')).focus();
}

async function renderList(): Promise<void> {
  const entries = await listed();
  const list = await servers();
  renderJobs(entries, list.length > 1 ? Object.fromEntries(list.map((item) => [item.server, item.name])) : null);
  // Nothing finished to clear: the control stays in its place, disabled.
  $<HTMLButtonElement>('[data-testid="clear-list"]').disabled = !entries.some((entry) => finished(entry.job));
}

/** Opened from a notification: show that download (once). */
async function focusNotified(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const stored = await chrome.storage.session.get(["focusJob", "focusServer"]);
  const id = params.get("job") || stored["focusJob"] as string | undefined;
  const server = params.get("server") || stored["focusServer"] as string | undefined;
  if (!id) return;
  const row = document.querySelector<HTMLElement>(`li[data-job-id="${CSS.escape(id)}"]`
    + (server ? `[data-server="${CSS.escape(server)}"]` : ""));
  if (!row) return;
  if (stored["focusJob"]) await chrome.storage.session.remove(["focusJob", "focusServer"]);
  row.classList.add("dp-job--focus");
  row.scrollIntoView({block: "nearest"});
}

// ── browser downloads (1.0.2) ───────────────────────────────────────────

const CAPTURE_OFFER = "captureOffer";
const DOWNLOADS: chrome.permissions.Permissions = {permissions: ["downloads"]};

/** Whether the setup offer is waiting (set by pairing.ts when a connection is first made). */
async function captureOffered(): Promise<boolean> {
  return Boolean((await chrome.storage.local.get(CAPTURE_OFFER))[CAPTURE_OFFER]);
}

/**
 * Whether this browser has no downloads an extension may take (Firefox for Android): it does
 * not know the "downloads" permission at all, so asking whether it is granted fails.
 */
function captureUnavailable(): Promise<boolean> {
  return chrome.permissions.contains(DOWNLOADS).then(() => false, () => true);
}

/** Said where the switch would be: this browser keeps its downloads. */
function sayUnavailable(): void {
  const note = $('[data-testid="capture-note"]');
  note.textContent = message("optionsDownloadsUnavailable");
  note.hidden = false;
}

/** Every switch for it shows what is stored (and whether the browser still allows it). */
async function renderCapture(chosen?: Settings): Promise<void> {
  const current = chosen ?? await settings();
  const unavailable = await captureUnavailable();
  const allowed = !unavailable && await chrome.permissions.contains(DOWNLOADS).catch(() => false);
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-capture-switch]")) {
    input.checked = current.capture && allowed;
    input.disabled = false;
    input.closest("label")!.hidden = unavailable;
  }
  $('[data-testid="capture-hint"]').hidden = unavailable;
  if (unavailable) sayUnavailable();
  const min = $<HTMLInputElement>("[data-capture-min]");
  const types = $<HTMLInputElement>("[data-capture-types]");
  if (document.activeElement !== min) min.value = String(current.captureMinMB);
  if (document.activeElement !== types) types.value = current.captureSkipTypes.join(", ");
  min.disabled = types.disabled = false;
  $('[data-testid="capture-options"]').hidden = !(current.capture && allowed);
}

/**
 * Turn it on or off from a click (the browser asks for the "downloads" permission only from the
 * person's own gesture, so the request is the first thing done). Off gives the permission back.
 * Answers whether it is now on.
 */
function setCapture(on: boolean, note: HTMLElement | null): Promise<boolean> {
  // Off: saved first, so the downloads held for DownloadPulse resume (capture.ts) while the
  // permission to resume them is still there; then it is given back.
  const asked = on ? chrome.permissions.request(DOWNLOADS)
    : saveSettings({capture: false}).then(() => chrome.runtime.sendMessage({type: "dp-settle-held"}))
      .then(() => chrome.permissions.remove(DOWNLOADS)).then(() => false);
  settingsEdits += 1;
  return asked.catch(() => false).then(async (answer) => {
    // Granted where the browser has no downloads list an extension can pause: the background,
    // which would hold them, says so (and gives the permission back, capture.ts).
    const unusable = on && answer && !(await chrome.runtime.sendMessage({type: "dp-capture-usable"})
      .then((usable: unknown) => usable === true, () => false));
    const granted = answer && !unusable;
    const now = on && granted;
    if (note) {
      note.hidden = !(on && !granted);
      if (on && !granted) note.textContent = message(unusable ? "optionsDownloadsUnavailable" : "optionsDownloadsDenied");
    }
    await saveSettings({capture: now, captureAsked: true});
    await chrome.storage.local.remove(CAPTURE_OFFER);
    await renderCapture();
    return now;
  });
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
  const switchInput = $<HTMLInputElement>('[data-testid="site-on"]');
  switchInput.checked = !isOffSite(tab!.url!, offSites);
  switchInput.disabled = false;
}

// The settings' own edits so far: a render whose read began before the latest one
// never puts the earlier state back (the edit's own save redraws it).
let settingsEdits = 0;

/** Settings, two or more servers (WS-X1): a block per server, titled with its name, its trash icon at the end. */
function settingsBlock(item: Server): HTMLLIElement {
  const block = document.createElement("li");
  block.className = "dp-settings__server";
  block.dataset["server"] = item.server;
  const title = document.createElement("p");
  title.className = "dp-settings__server-title";
  title.append(span("", item.name));
  if (item.isDefault) {
    const star = glyph("star");
    star.classList.add("dp-settings__star");
    const marker = span("dp-settings__default", "");
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", message("serverDefault"));
    marker.title = message("serverDefault");
    marker.append(star);
    title.append(" ", marker);
  }
  const facts = document.createElement("dl");
  facts.className = "dp-facts";
  for (const [label, value] of [["popupServer", serverName(item.server)], ["popupAccount", item.account], ["popupBrowser", item.label]]) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = message(label!);
    const detail = document.createElement("dd");
    detail.textContent = value!;
    row.append(term, detail);
    facts.append(row);
  }
  const trash = glyphButton("trash2", "", "danger", {action: "disconnect", server: item.server});
  trash.classList.add("dp-settings__trash");
  trash.setAttribute("aria-label", message("disconnectServer", [item.name]));
  trash.title = message("disconnectServer", [item.name]);
  block.append(title, facts, trash);
  return block;
}

let settingsDrawn = "";

async function renderSettings(): Promise<void> {
  const list = await servers();
  const connected = list[0] ?? null;
  const many = list.length > 1;
  $("[data-connection='connected']").hidden = !connected || many;
  $("[data-connection='multi']").hidden = !many;
  $("[data-connection='disconnected']").hidden = Boolean(connected);
  text("#connection-title", message(many ? "optionsConnections" : "optionsConnection"));
  if (connected && !many) {
    text('[data-testid="settings-server"]', serverName(connected.server));
    text('[data-testid="settings-account"]', connected.account);
    text('[data-testid="settings-label"]', connected.label);
    $("[data-connection='connected'] [data-action='disconnect']").dataset["server"] = connected.server;
  }
  // Not drawn again while the dialog is open: its return target stays in place.
  if (many && !$<HTMLDialogElement>("dialog.dp-dialog").open) {
    const drawn = JSON.stringify(list);
    if (drawn !== settingsDrawn) {
      settingsDrawn = drawn;
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".dp-settings__trash")?.dataset["server"];
      $('[data-testid="settings-servers"]').replaceChildren(...list.map(settingsBlock));
      if (focused) document.querySelector<HTMLElement>(`.dp-settings__trash[data-server="${CSS.escape(focused)}"]`)?.focus();
    }
  } else if (!many) {
    settingsDrawn = "";
  }
  const edits = settingsEdits;
  const chosen = await settings();
  if (edits !== settingsEdits) return;
  // The switches are disabled in the markup until they show what is stored: nothing
  // can be switched while it still shows a state that is not the person's.
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-setting]")) {
    input.checked = Boolean(chosen[input.dataset["setting"] as "inPage" | "hover" | "video" | "videoCookies"]);
    input.disabled = false;
  }
  // Off, what the master switch governs is not shown at all.
  $('[data-testid="in-page-options"]').hidden = !chosen.inPage;
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-notify]")) {
    input.checked = Boolean(chosen.notify[input.dataset["notify"] as keyof Settings["notify"]]);
    input.disabled = false;
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
  await renderCapture(chosen);
}

function note(said: string): void {
  const element = $('[data-testid="connection-note"]');
  element.textContent = said;
  element.hidden = false;
}

// ── Disconnect (WS-X1): the confirmation dialog, for every server ──────

let dialogFor: {server: string; name: string; next: string | null; from: HTMLElement | null; index: number} | null = null;

function dialogStep(step: "confirm" | "busy" | "unreachable"): void {
  const dialog = $<HTMLDialogElement>("dialog.dp-dialog");
  dialog.dataset["step"] = step;
  const cancel = $<HTMLButtonElement>('[data-testid="dialog-cancel"]');
  const go = $<HTMLButtonElement>('[data-testid="dialog-confirm"]');
  cancel.disabled = go.disabled = step === "busy";
  go.textContent = message(step === "busy" ? "dialogDisconnecting" : step === "unreachable" ? "dialogRemoveAnyway" : "optionsDisconnect");
}

async function openDisconnect(server: string, from: HTMLElement | null): Promise<void> {
  const list = await servers();
  const target = list.find((item) => item.server === server);
  if (!target) return;
  const many = list.length > 1;
  // One server: it has no name of its own on any screen, so it is DownloadPulse.
  const name = many ? target.name : message("extName");
  const nextServer = many && target.isDefault ? successor(list.map((item) => item.server), server) : null;
  const next = list.find((item) => item.server === nextServer)?.name ?? null;
  dialogFor = {server, name, next, from, index: list.indexOf(target)};
  fillDialog("confirm", target);
  dialogStep("confirm");
  const dialog = $<HTMLDialogElement>("dialog.dp-dialog");
  if (!dialog.open) dialog.showModal();
  $<HTMLButtonElement>('[data-testid="dialog-cancel"]').focus();
}

function fillDialog(step: "confirm" | "unreachable", target: Server): void {
  if (!dialogFor) return;
  const {name, next} = dialogFor;
  const address = new URL(target.server).host;
  text('[data-testid="dialog-title"]', message(step === "confirm" ? "dialogDisconnectTitle" : "dialogUnreachableTitle", [name]));
  text('[data-testid="dialog-account"]', message(step === "confirm" ? "dialogDisconnectAccount" : "dialogUnreachableAccount",
    [target.account, address]));
  text('[data-testid="dialog-after"]', message(step === "confirm" ? "dialogDisconnectAfter" : "dialogUnreachableAnyway", [name]));
  const notice = $('[data-testid="dialog-default"]');
  notice.hidden = !next;
  notice.textContent = next ? message("dialogDefaultNote", [name, next]) : "";
}

/** The dialog's red button: Disconnect (revoke, then forget), or Remove anyway (forget here only). */
async function confirmDisconnect(): Promise<void> {
  const dialog = $<HTMLDialogElement>("dialog.dp-dialog");
  if (!dialogFor) return dialog.close();
  const {server, name, next} = dialogFor;
  const force = dialog.dataset["step"] === "unreachable";
  dialogStep("busy");
  const answer = await chrome.runtime.sendMessage({type: "dp-disconnect", server, force})
    .catch(() => undefined) as {result?: string} | undefined;
  if (answer?.result === "unreachable") {
    // Nothing has been removed: the person chooses.
    const target = (await servers()).find((item) => item.server === server);
    if (!target) return dialog.close();
    fillDialog("unreachable", target);
    dialogStep("unreachable");
    $<HTMLButtonElement>('[data-testid="dialog-cancel"]').focus();
    return;
  }
  const left = (await servers()).length;
  if (answer?.result === "none") {
    // Already gone from this browser (removed elsewhere meanwhile): nothing to say about it.
    dialog.close();
    await render();
    returnFocus();
    return;
  }
  const said = answer?.result === "revoked"
    ? message(left > 0 ? "noteDisconnectedFrom" : "optionsDisconnected", [name])
    : message("noteRemovedLocally", [name]);
  dialog.close();
  note(next ? `${said} ${message("noteNewDefault", [next])}` : said);
  // In the dropdown, nothing is left to set without a connection: back to the screen that
  // connects (operator, 2026-11-22). The standalone settings page stays, saying so.
  if (!standalone && left === 0) {
    view = "main";
    await render();
  } else {
    await render();
  }
  returnFocus();
}

/** When the dialog closes: back on the trash icon, or the next block's if that server was removed. */
function returnFocus(): void {
  if (!dialogFor) return;
  const {server, from, index} = dialogFor;
  dialogFor = null;
  if (from?.isConnected && (from.dataset["server"] ?? server) === server && from.offsetParent) return from.focus();
  const trashes = [...document.querySelectorAll<HTMLElement>('[data-view="settings"] [data-action="disconnect"]')]
    .filter((button) => button.offsetParent);
  (trashes.find((button) => button.dataset["server"] === server) ?? trashes[index] ?? trashes.at(-1))?.focus();
}

// ── the whole dropdown ──────────────────────────────────────────────────

/** The default server's connection (the one the held-connection screens settle). */
async function defaultConnection(): Promise<Awaited<ReturnType<typeof connection>>> {
  const server = await defaultServer();
  return server ? connection(server) : null;
}

async function render(): Promise<void> {
  for (const held of Object.values(await connections())) {
    if ((await connectionState(held)) !== "insecure") continue;
    // Plain HTTP across the internet: never usable. Settled first on every redraw, each step
    // safe to repeat, so a popup closed half-way (or reloaded) leaves nothing half done:
    // the refusal recorded, then that server's connection forgotten by name.
    const before = await pairing();
    if (!(before?.state === "failed" && before.failure === "insecure_refused")) {
      await setPairing({state: "failed", failure: "insecure_refused"});
    }
    await forgetConnection(false, held.server);
  }
  const connected = await defaultConnection();
  const list = await servers();
  const pending = await pairing();
  // Adding a server (WS-X1): the pairing screens offer a way back to the main view.
  for (const button of document.querySelectorAll<HTMLElement>("[data-adding]")) button.hidden = list.length === 0;
  if (screen && !connected && pending?.state !== "waiting" && pending?.state !== "probing") {
    show(screen);
    if (view === "settings") await renderSettings();
    return;
  }
  if (pending?.state === "waiting") {
    show("waiting");
    text('[data-testid="code"]', pending.userCode);
  } else if (pending?.state === "failed") {
    show("failed");
    text('[data-testid="failure"]', message(FAILURE_KEYS[pending.failure]));
  } else if (pending) {
    show(pending.state);
  } else if (connected && (await connectionState(connected)) !== "ok") {
    // A saved connection the gate holds (connection.ts): the screen that settles it, sending nothing.
    // (An insecure one was settled at the top of render.)
    const state = await connectionState(connected);
    if (state === "plain-http") showInsecure(connected.server);
    show(state === "consent" ? "disclosure" : "insecure");
  } else if (connected && await captureOffered() && !(await captureUnavailable())) {
    // Just connected: whether browser downloads go to DownloadPulse, asked once.
    show("capture-offer");
  } else if (connected) {
    show("connected");
    await renderCapture();
    text('[data-testid="server"]', serverName(connected.server));
    text('[data-testid="account"]', connected.account);
    text('[data-testid="label"]', connected.label);
    renderMany(list);
    await renderReach();
    renderServers(list, reachNow);
    await renderList();
    await focusNotified();
  } else {
    show("disconnected");
  }
  if (view === "settings") await renderSettings();
}

async function connectRemote(form: HTMLFormElement): Promise<void> {
  const typed = String(new FormData(form).get("server") ?? "");
  const target = await effectiveAddress(typed);
  if (!target) return setPairing({state: "failed", failure: "unreachable"});
  if (target.transport === "public-http") return setPairing({state: "failed", failure: "insecure_refused"});
  if (target.transport === "lan-http") {
    // Plain HTTP on a private network: only after the person has read what that means.
    showInsecure(target.origin);
    screen = "insecure";
    return render();
  }
  return connectTo(target.origin, typed, false);
}

/** ``address``: as the person typed it (the background reads whether a scheme was given). */
async function connectTo(origin: string, address: string, insecure: boolean): Promise<void> {
  // Access to exactly that server, asked now, on this click (L20).
  const granted = await chrome.permissions.request({origins: [origin + "/*"]});
  if (!granted) return setPairing({state: "failed", failure: "permission"});
  await chrome.runtime.sendMessage({type: "connect-remote", address, insecure});
}

/** The plain-HTTP warning for ``origin`` (its address in the literal colour). */
function showInsecure(origin: string): void {
  insecureTarget = origin;
  const hint = $('[data-testid="insecure-text"]');
  const parts = message("insecureText", ["\u0001"]).split("\u0001");
  hint.replaceChildren(document.createTextNode(parts[0] ?? ""), span("dp-literal", origin), document.createTextNode(parts[1] ?? ""));
  // Tailscale's range is also carrier-grade NAT's: said, so the person knows which one this is.
  $('[data-testid="insecure-shared-range"]').hidden = !isSharedAddressRange(new URL(origin).hostname);
}

/**
 * What changes with two or more servers (WS-X1), on the main view: the details become the
 * server list, Add gets its ▾, the capture switch names the default, Open lists the servers.
 * [+] is there with any number, disabled at the cap.
 */
function renderMany(list: readonly Server[]): void {
  const many = list.length > 1;
  const add = $<HTMLButtonElement>('[data-testid="add-server"]');
  const full = list.length >= MAX_SERVERS;
  add.setAttribute("aria-disabled", String(full));
  add.setAttribute("aria-label", message(full ? "addServerLimit" : "addServer"));
  add.title = message(full ? "addServerLimit" : "addServer");
  const toggle = $<HTMLElement>("[data-action='details']");
  toggle.setAttribute("aria-controls", many ? "servers" : "facts");
  const open = toggle.getAttribute("aria-expanded") === "true";
  $("#facts").hidden = many || !open;
  $("#servers").hidden = !many || !open;
  $('[data-testid="quick-more"]').hidden = !many;
  $("form[data-action='quick-add']").classList.toggle("dp-quick__form--split", many);
  const chosen = list.find((item) => item.isDefault);
  text('[data-testid="capture-main-label"]', many && chosen ? message("captureToggleNamed", [chosen.name]) : message("captureToggle"));
  const openButton = $('[data-testid="open-server"]');
  $(".dp-foot__more").hidden = !many;
  if (many) {
    openButton.setAttribute("aria-haspopup", "menu");
    openButton.setAttribute("aria-expanded", String(!$('[data-menu="open"]').hidden));
    openButton.title = message("openChoose");
  } else {
    openButton.removeAttribute("aria-haspopup");
    openButton.removeAttribute("aria-expanded");
    openButton.removeAttribute("title");
  }
  if (!many) closeMenus();
}

/** Connecting begins with the disclosure until the person has agreed to it. */
async function startConnecting(): Promise<void> {
  if (await consented()) {
    await chrome.runtime.sendMessage({type: "connect-local"});
    return;
  }
  screen = "disclosure";
  await render();
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

async function openDownloadPulse(server?: string): Promise<void> {
  await chrome.runtime.sendMessage({type: "dp-open", ...(server ? {server} : {})});
  if (!standalone) window.close();
}

// The person's DownloadPulse appearance, as soon as it is known (and whenever it changes).
void appearance().then((value) => applyAppearance(document.documentElement, value));
localize(document);
placeGlyphs(document);
for (const link of document.querySelectorAll<HTMLAnchorElement>(".dp-disclosure__policy")) link.href = PRIVACY_URL;
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
  if (input.dataset["captureSwitch"] !== undefined) {
    // First, in the gesture itself: the permission request (setCapture).
    void setCapture(input.checked, input.dataset["testid"] === "capture-setting"
      ? $('[data-testid="capture-note"]') : null);
    return;
  }
  if (input.dataset["captureMin"] !== undefined) {
    settingsEdits += 1;
    void saveSettings({captureMinMB: Number(input.value)});
    return;
  }
  if (input.dataset["captureTypes"] !== undefined) {
    settingsEdits += 1;
    const typed = fileTypes(input.value);
    input.value = typed.join(", ");
    void saveSettings({captureSkipTypes: typed});
    return;
  }
  if (input.dataset["testid"] === "device-name" && input.checked) {
    // Firefox: the browser and system are technical data, sent only with its optional consent.
    const firefox = (globalThis as unknown as {browser?: {permissions?: {request(r: {data_collection: string[]}): Promise<boolean>}}}).browser;
    if (firefox?.permissions && /Firefox\//.test(navigator.userAgent)) {
      void firefox.permissions.request({data_collection: ["technicalAndInteraction"]})
        .then((granted) => { if (!granted) input.checked = false; }, () => { input.checked = false; });
    }
  }
  // What the person chose, read now: never after an await, when a redraw may have changed the box.
  const checked = input.checked;
  if (input.dataset["setting"] || input.dataset["notify"] || input.dataset["testid"] === "site-on") settingsEdits += 1;
  if (input.dataset["setting"]) void saveSettings({[input.dataset["setting"]]: checked});
  if (input.dataset["notify"]) {
    const kind = input.dataset["notify"];
    void saveSettings((chosen) => ({notify: {...chosen.notify, [kind]: checked}}));
  }
  if (input.dataset["testid"] === "site-on") {
    const site = input.closest<HTMLElement>("[data-site]")?.dataset["site"] ?? "";
    void saveSettings((chosen) => ({offSites: checked
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
    void act(job.dataset["job"] ?? "", job.dataset["server"] ?? "", job.dataset["jobAction"] ?? "");
    return;
  }
  const site = target.closest<HTMLElement>("[data-remove-site]")?.dataset["removeSite"];
  if (site) {
    void saveSettings((chosen) => ({offSites: chosen.offSites.filter((item) => item !== site)}));
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
    const many = button!.getAttribute("aria-controls") === "servers";
    $("#facts").hidden = many || !open;
    $("#servers").hidden = !many || !open;
  } else if (action === "clear-list") {
    void clearFinished();
  } else if (action === "open") {
    // Two or more servers: [Open ▾] lists them; one: it opens, as before.
    if (button!.getAttribute("aria-haspopup") === "menu") {
      void openMenu("open", button!, () => true, (server) => void openDownloadPulse(server));
    } else {
      void openDownloadPulse();
    }
  } else if (action === "quick-more") {
    // Add to another server: an unreachable one can't be chosen (a send never falls back).
    void openMenu("quick", button!, (reach) => reach !== "unreachable", (server) => quickAdd(server));
  } else if (action === "add-server") {
    if (button!.getAttribute("aria-disabled") === "true") return;
    // Already agreed to: the pairing starts at discovery, skipping the welcome and the disclosure.
    void startConnecting();
  } else if (action === "add-cancel") {
    screen = null;
    void chrome.runtime.sendMessage({type: "cancel"});
  } else if (action === "server-default") {
    const server = button!.dataset["server"] ?? "";
    refocus = {server, what: "star"};
    void setDefaultServer(server);
  } else if (action === "server-rename") {
    const server = button!.dataset["server"] ?? "";
    renaming = {server, problem: null};
    refocus = {server, what: "rename"};
    void servers().then((list) => renderServers(list, reachNow, true));
  } else if (action === "dialog-cancel") {
    $<HTMLDialogElement>("dialog.dp-dialog").close();
  } else if (action === "dialog-confirm") {
    void confirmDisconnect();
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
    // Never removed silently (WS-X1): the dialog says what happens, and the person confirms.
    $('[data-testid="connection-note"]').hidden = true;
    void openDisconnect(button!.dataset["server"] ?? "", button!);
  } else if (action === "connect-local") {
    void startConnecting();
  } else if (action === "agree") {
    const named = $<HTMLInputElement>('[data-testid="device-name"]').checked;
    screen = null;
    // Already connected (paired before the disclosure, or it changed): agreeing unlocks that connection.
    void Promise.all([recordConsent(named), defaultConnection()]).then(([, connected]) =>
      connected ? render() : chrome.runtime.sendMessage({type: "connect-local"}));
  } else if (action === "screen-back") {
    screen = null;
    void render();
  } else if (action === "insecure-continue") {
    screen = null;
    // A saved connection held for its plain HTTP: the choice is recorded; else connect with it.
    void defaultConnection().then((connected) => connected ? choosePlainHttp(connected.server).then(render)
      : connectTo(insecureTarget, insecureTarget, true));
  } else if (action === "cancel") {
    void chrome.runtime.sendMessage({type: action});
  } else if (action === "capture-yes") {
    void setCapture(true, $('[data-testid="capture-offer-note"]')).then((on) => { if (on) void render(); });
  } else if (action === "capture-no") {
    void setCapture(false, null).then(() => render());
  }
});
// Every server form: after something or nothing was found here, and after any failure.
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-action="connect-remote"]')) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void connectRemote(event.currentTarget as HTMLFormElement);
  });
}
let quickTimer = 0;
// Quick Add is one row: a pasted list's line breaks become spaces, never dropped -- a text
// field strips newlines from its value, which would join the addresses (review, 2026-11-19).
$<HTMLInputElement>("#quick").addEventListener("paste", (event) => {
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  if (!/[\r\n]/.test(pasted)) return;
  event.preventDefault();
  const input = event.currentTarget as HTMLInputElement;
  const spaced = pasted.replace(/\s*[\r\n]+\s*/g, " ").trim();
  input.setRangeText(spaced, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
  input.dispatchEvent(new Event("input", {bubbles: true}));
});
$<HTMLFormElement>("form[data-action='quick-add']").addEventListener("submit", (event) => {
  event.preventDefault();
  quickAdd();
});

/** Quick Add: to ``server``, else (Add itself) the default. */
function quickAdd(server?: string): void {
  const input = $<HTMLInputElement>("#quick");
  const button = $<HTMLButtonElement>("form[data-action='quick-add'] button");
  const result = $('[data-testid="quick-result"]');
  if (!input.value.trim()) return;
  button.disabled = true;
  void (chrome.runtime.sendMessage({type: "dp-quick-add", text: input.value, ...(server ? {server} : {})}) as
      Promise<{ok: boolean; text: string} | undefined>)
    .then((answer) => {
      const ok = Boolean(answer?.ok);
      result.textContent = answer?.text ?? message("sendFailed");
      result.title = result.textContent;
      result.dataset["ok"] = String(ok);
      if (ok) input.value = "";         // a failure keeps what was typed, to correct or try again
      clearTimeout(quickTimer);
      quickTimer = window.setTimeout(() => { result.textContent = ""; result.title = ""; delete result.dataset["ok"]; }, 4000);
    })
    .finally(() => { button.disabled = false; });
}
$<HTMLFormElement>("form[data-action='add-site']").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>("#site");
  const site = siteOf(input.value);
  if (!site) return;
  void saveSettings((chosen) => ({offSites: [...chosen.offSites, site]})).then(() => { input.value = ""; });
});
// ── the server list's keys and pointer (WS-X1) ─────────────────────────
document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.dataset["rename"] !== undefined) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename(target);
    } else if (event.key === "Escape") {
      event.preventDefault();
      const server = target.dataset["rename"]!;
      renaming = null;
      refocus = {server, what: "pencil"};
      void servers().then((list) => renderServers(list, reachNow, true));
    }
    return;
  }
  // The grab handle: Alt+Up / Alt+Down moves that server by one place, announced.
  const handle = target.closest<HTMLElement>(".dp-server__handle");
  if (handle && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    void moveServer(handle.dataset["server"] ?? "", event.key === "ArrowUp" ? -1 : 1);
  }
});
document.addEventListener("focusout", (event) => {
  const field = event.target as HTMLElement;
  // Leaving the rename field keeps what was typed (Esc is the way out without it).
  if (field instanceof HTMLInputElement && field.dataset["rename"] !== undefined && renaming?.server === field.dataset["rename"]
      && field.isConnected) {
    void commitRename(field);
  }
});
document.addEventListener("pointerdown", (event) => {
  const handle = (event.target as HTMLElement).closest<HTMLElement>(".dp-server__handle");
  if (!handle || event.button !== 0) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  dragging = {server: handle.dataset["server"] ?? "", pointer: event.pointerId, moved: false};
  handle.closest("li")!.classList.add("dp-server--dragging");
});
document.addEventListener("pointermove", (event) => {
  if (!dragging || event.pointerId !== dragging.pointer) return;
  const container = $('[data-testid="servers"]');
  const block = container.querySelector<HTMLElement>(`li[data-server="${CSS.escape(dragging.server)}"]`);
  if (!block) return;
  // The block goes where the pointer is among the others' middles.
  const others = [...container.querySelectorAll<HTMLElement>("li[data-server]")].filter((item) => item !== block);
  const before = others.find((item) => {
    const box = item.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2;
  });
  if (before ? block.nextElementSibling === before : block === container.lastElementChild) return;
  container.insertBefore(block, before ?? null);
  dragging.moved = true;
});
function endDrag(event: PointerEvent): void {
  if (!dragging || event.pointerId !== dragging.pointer) return;
  const {server, moved: changed} = dragging;
  dragging = null;
  const container = $('[data-testid="servers"]');
  container.querySelector(".dp-server--dragging")?.classList.remove("dp-server--dragging");
  if (!changed) return;
  const order = [...container.querySelectorAll<HTMLElement>("li[data-server]")].map((item) => item.dataset["server"] ?? "");
  refocus = {server, what: "handle"};
  void setServerOrder(order).then(() => movedSay(server, order));
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
{
  const dialog = $<HTMLDialogElement>("dialog.dp-dialog");
  // Esc cancels -- except while it disconnects, when both buttons wait too.
  dialog.addEventListener("cancel", (event) => { if (dialog.dataset["step"] === "busy") event.preventDefault(); });
  // Closed by Cancel or Esc: the focus goes back. (After a disconnect, confirmDisconnect returns it once the views are redrawn.)
  dialog.addEventListener("close", () => { if (dialog.dataset["step"] !== "busy") returnFocus(); });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "appearance" in changes) void appearance().then((value) => applyAppearance(document.documentElement, value));
  // The status alone changes every look: redraw only it, so the list (and a focused control) stays put.
  if (Object.keys(changes).every((key) => isStateKey(key, "reach"))) void renderReach();
  else void render();
});
void render();
if (!standalone) {
  // While the dropdown is open, the list and the status are kept fresh (WS-E3 B1).
  void chrome.runtime.sendMessage({type: "dp-popup-open"});
  setInterval(() => void chrome.runtime.sendMessage({type: "dp-popup-open"}), 4000);
  setInterval(() => void renderReach(), 5000);
}
