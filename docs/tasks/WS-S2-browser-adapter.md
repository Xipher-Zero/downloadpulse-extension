# WS-S2 — The browser adapter (DebridPulse)

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9). **This document stops at Gate 2 for operator design review**: it extends the external-client owner (`external/service.py`) for a second kind of client.

**Repository:** `Xipher-Zero/debridpulse`, branch `1.0.14` (L29), base `550d3415` (WS-S1).

**Authority:**
- PLAN.md §5.3–§5.7, and decisions L10, L13–L16, L19, L23, L27;
- WS-S1 (browser tokens; `BROWSER_CLIENT.md`);
- *Development and Architecture* Rules C1–C3 and T1–T3, §6A;
- *Prompt Authoring and Gates* §4 and §4.7.

## 1. Mission

A connected browser (a WS-S1 browser token) can:
- **submit** links, magnets, `.torrent`/`.nzb`/`.metalink` contents and media pages, with a retry never becoming a second download;
- **list** only the downloads *it* submitted, with state, progress and a labelled **ETA**;
- **pause/resume** and **remove** (withdraw) those downloads;
- **read** which hosts and sites this server's services claim, so the extension knows where to offer its hover icon.

Each submission behaves like that person's own **Quick Add**: a transfer in their normal Downloads, under their normal folder and rules. There is no delivery profile and no acknowledgement.

## 2. Evidence anchors (Gate 0, verified at `550d3415`)

| # | Fact | Where |
|---|---|---|
| A1 | Quick Add records a demand of `(account_id, credential_id)` for every submission (`_demand`). A browser token's submissions are therefore attributed to the person and to that browser with no change. | `api/routes.py:962-966`, `transfers/models.py:323` |
| A2 | Core already submits every kind needed: `submit_links` (with `acquisition_scopes`: Media Downloads), `submit_magnet`, `submit_torrent`, `submit_nzb`, `submit_nzb_link`, `submit_meta4` (Metalink). | `application/service.py:541-734` |
| A3 | **External jobs are bound to delivery profiles.** `_intent` requires a `category`, the category selects a profile, and a submission with none is refused (`unknown_category`). Jobs then carry delivery states and acknowledgement. | `external/service.py:356-383` |
| A4 | The external owner already gives a client everything else a browser needs:
- client-scoped idempotency (`_submit_keyed`, `_reserve`);
- a change-cursor listing (`jobs`);
- per-client isolation (`_owned`);
- demand-only withdrawal (`withdraw`);
- **advisory pause/resume** (`control` → `_adjudicate`): a hold owned by the control, generation-fenced, recorded pending before the transition, declined on `shared_interest`, `globally_paused` or `paused_independently`;
- per-client limits. | `external/service.py:245-1100` |
| A5 | `client_of(principal)` reads the principal's `client_id`. A browser token has its own (WS-S1). | `external/service.py:113` |
| A6 | The one estimate owner is `acquisition_eta`. `test_external_adapters_carry_no_estimate` reads *"Deferred, not done"*: the external surfaces' missing ETA is a **deferral, not a ban**. | `tests/test_v114_transfer_eta.py:1015` |
| A7 | Private-LAN consent counts only from a caller holding `transfers.operate` (`_local_network_answer`). A browser token holds no such capability. | `api/routes.py:969-977` |
| A8 | Supported hosts are owned per provider: AllDebrid's dynamic `v4.1/user/hosts` runtime state (validated domains and native regexps), and Debrid-Link's `domains()`. The media downloader matches by extractor, not by domain list. | `providers/alldebrid/host_runtime.py`, `providers/debridlink/host_runtime.py:96`, `providers/media/` |

## 3. Design (Gate 2; for operator review)

### D3: the submission model. Recommended: (A) a browser is a profile-less external client

| | (A) Extend the external owner (recommended) | (B) A separate adapter over Quick Add |
|---|---|---|
| What changes | `ExternalClients` admits a second kind of client, a **browser** client. Its jobs have **no category, no profile and no delivery**: admission submits through the same core methods Quick Add uses, with the job's reserved demand, into the person's normal download folder. | New routes call `submit_*` directly; listing, idempotency, controls and limits are built again for browsers. |
| Reused unchanged | idempotency, change-cursor listing, isolation, withdrawal, advisory pause/resume with its fences, limits, recovery of interrupted controls | demand attribution only |
| Rule C3 (one owner, no shadow state) | kept: one external-job owner | broken: a second job store, a second idempotency store and a second advisory pause |
| Cost | `_intent`/admission branch on the client kind; the job view omits delivery for browser jobs | larger, and duplicative |

**Concretely, for (A):**
- **New column:** `external_jobs` gains `kind` (`integration` | `browser`), added by the existing idempotent migration path.
- **Browser jobs:**
  - **Submission:** no `category`, profile or delivery. Sources are admitted through `submit_links`/`submit_magnet`/`submit_torrent`/`submit_nzb`/`submit_nzb_link`/`submit_meta4`, with the job's reserved demand (attributed to the person and the token, A1).
  - **The job view:** reports `phase`, `progress` and the **ETA** (§3.3); delivery fields are absent; acknowledgement is refused (`not_applicable`).
- **Unchanged:** Integration jobs' behaviour and contract.
- **Routes:** `api/browser_routes.py` adds the browser API under `/api/browser/v1/` (capability `browser.client`, from WS-S1):
  - `POST /jobs` (submit, idempotency key required);
  - `GET /jobs` (change cursor, own jobs only);
  - `GET /jobs/{id}`;
  - `POST /jobs/{id}/withdraw`;
  - `POST /jobs/{id}/controls` `{kind: pause|resume, request_key}`;
  - `GET /hosts`;
  - `GET /session` (existing).

  Each route is a thin call into `ExternalClients`, as the *arr adapters are.
- **Pause/resume semantics** are the external protocol's advisory ones, exactly. A browser pauses a download only while **its own request is the only one** that needs it. Otherwise the answer is `shared_interest`, and the extension says so (PLAN L16).

### Submission kinds (PLAN §5.4)

| Browser `source.kind` | Core path | Notes |
|---|---|---|
| `links` (1–100) | `submit_links` | from right-click on links and selections |
| `magnet` | `submit_magnet` | |
| `torrent` (base64) | `submit_torrent` | captured by background fetch (spike S1) |
| `nzb` (base64), `nzb_link` | `submit_nzb`, `submit_nzb_link` | |
| `metalink` (base64) | `submit_meta4` | **new external kind** |
| `media` (page URL) | `submit_links` with the Media Downloads acquisition scope | **new external kind**; the URL-bar icon and the video-player button |

The intake owner (`external/intake.py`) gains `metalink` and `media` normalization, with the same bounds and redaction rules as its existing kinds.

### D4: private-LAN consent from a browser. Recommended: refuse, as v1 does

A link to a private-LAN address is refused with the existing `local_network_confirmation_required`. The extension then says to use Quick Add in DownloadPulse.

**Why:** consent is an operator decision (A7). Letting a browser token answer it would widen the token beyond the browser client. The installation's existing "Skip Local Connection Confirmation" setting still pre-authorizes such hosts, as for Integrations.

**Alternative:** add a per-submission `allow_local_network` that a browser token may set. That widens WS-S1's fence, so it isn't recommended.

### 3.3 ETA (L27)

- **Where:** the browser job view, and the **external protocol's job view generally**, carry `estimate: {seconds, kind: "estimate"}` from `acquisition_eta`, the one owner, or `null` when unknown. It is never in an exact field (§6A).
- **The no-estimate test:** `test_external_adapters_carry_no_estimate` is replaced by one proving the external view reads the one owner.
- **Decision point:** the operator ruled the never-provide contract unjustified. Should the **\*arr adapters'** `timeleft` (SABnzbd) and `eta` (qBittorrent) also report the estimate in this task? **Recommended: yes.** It is the same owner and two small mappings. Otherwise they remain deferred.

### 3.4 Supported hosts (PLAN §5.6)

`GET /api/browser/v1/hosts` returns a **minimal projection**:
- `{"domains": [...], "media": bool, "revision": "<hash>"}`;
- the registrable domains the configured, enabled services currently claim (AllDebrid's last-known-good runtime domains, Debrid-Link's domains), de-duplicated;
- `media: true` when Media Downloads is enabled. The extension then offers the video-player button and the URL-bar icon wherever it finds a video. There is no media domain list: the media downloader matches by extractor (A8).

**Rule T3:** no regexps, no provider names, no account or credential data, no configuration. **Rule C1:** this needs one neutral fact from providers: *"which domains do you claim?"* It is added to the provider applicability contract as an optional, read-only fact. Providers that don't claim domains return nothing.

### 3.5 Protocol and version (PLAN L19)

`debridpulse.browser/1` (from WS-S1) gains these routes.
- **Capabilities:** `GET /session` adds `capabilities: {sources: [...], controls: [...], estimate: true, hosts: true}`.
- **Version check:** the extension requires `debridpulse.browser/1` with those capabilities.

## 4. Trust boundaries (Gate 1; Rules T1–T3)

| Surface | Principal | Reads | Writes | Must never |
|---|---|---|---|---|
| Browser job routes | browser token (`browser.client`) | its own client's jobs (`_owned` by `client_id`) | jobs, demands; advisory holds on its own sole-interest transfers | read or operate another client's job or any transfer directly; choose provider, folder, priority or route |
| `GET /hosts` | browser token | the providers' claimed domains | nothing | reveal provider names, regexps, accounts, configuration |
| Submission payloads | browser token | upload bytes (bounded, as Quick Add's limits) | staged input as core already stages it | log a source URL with a passkey or credentials (Rule D3; intake redaction) |

## 5. Scope and prohibited work

**In scope:**
- §3 design (A);
- the two new intake kinds;
- the ETA (and the \*arr mapping, if approved);
- the hosts projection;
- capabilities;
- tests;
- docs: `BROWSER_CLIENT.md`, `EXTERNAL_CLIENT_PROTOCOL.md` (estimate; browser jobs).

**Prohibited:**
- any change to Integration jobs' delivery or acknowledgement;
- any change to core transfer lifecycle, routing or recovery;
- new settings;
- monkeypatching;
- `CHANGELOG.md`.

## 6. Qualification plan (focused)

**New focused tests** (separate-process server, as WS-S1):
- submit each kind → job, demand attributed to the person and token;
- an idempotent retry → same job;
- list only own jobs (another browser's and an Integration's are invisible);
- withdraw;
- pause/resume honoured when the job's demand is the transfer's only one, `shared_interest` otherwise;
- ETA present and labelled, `null` when unknown;
- hosts projection shape, containing no regexp or provider name;
- a private-LAN link refused with its code (D4);
- acknowledge refused on a browser job;
- Integration jobs unchanged (the existing external tests).

**Broad run:** the affected-module set, once. **Plus** the existing external/arr suites and the ETA tests.

## 7. Decisions for the operator (this Gate 2 stop)

1. **D3:** (A), browsers as profile-less external clients. Recommended.
2. **D4:** refuse private-LAN links from a browser. Recommended.
3. **ETA for the \*arr adapters** too (`timeleft`/`eta`). Recommended yes.
4. **The hosts projection** as §3.4: claimed domains plus a `media` flag, with a new optional provider fact.

## 8. Gate record

**Gate 2 approved** by the operator, 2026-11-18:
1. **D3:** (A), profile-less external browser jobs.
2. **D4, as the operator stated it:** *"Local Network Connections & Skip Local Connection Confirmation settings govern this and it's already built into DP. Do not bypass or change DP core where controls already exist."*
   - A browser's private-LAN link is admitted exactly where those settings pre-authorize it (as for an Integration), and otherwise refused with the existing `local_network_confirmation_required`.
   - No consent path is added, and the existing control is not changed.
3. **ETA:** included for the \*arr adapters too.
4. **Hosts:** the §3.4 projection.

**Operator correction, 2026-11-18 (binding for all of WS-S2):** *"I am very hesitant to approve anything that modifies providers/routes/candidacy/classification … for an external submission surface."*
- **The hosts projection (§3.4) is withdrawn** from WS-S2: no provider fact, no `GET /hosts`. The extension's hover icon uses local heuristics only (PLAN §3.3, amended).
- **Media Downloads is not a separate source kind.** A media page URL is submitted as a link, and core's existing provider-neutral routing decides, as for Quick Add.
- **Metalink** is not new to DebridPulse. Only the *external intake* lacked a case for it; the case calls the existing `submit_meta4`.
- **Binding rule.** WS-S2 edits only the external adapter layer (`external/`) and its HTTP adapters (`api/browser_routes.py`, `api/arr_sabnzbd.py`, `api/arr_qbittorrent.py`), plus tests and docs. **Any edit in `transfers/`, `application/`, `providers/` or `executors/` is a hard stop, reported to the operator before it is made.** Core is only *read*, through its existing entry points: the `submit_*` methods, the demand ledger, the pause owner, and `acquisition_eta`.

**Gates 3–6 (2026-11-18).** Implemented in the external adapter layer only:
- `external/store.py`: `external_jobs.kind`, through the canonical `_ensure_column` migration;
- `external/intake.py`: the `.meta4` case, calling the existing `submit_meta4`;
- `external/service.py`: browser intent, reservation, plan, finish and view; delivery and acknowledge refused for browser jobs (`not_applicable`); `estimate` in every job view, read at view time from `engine.acquisition_etas` and never stored;
- `api/browser_routes.py`: 5 routes, each a thin call into `ExternalClients`; refusals use `external_routes._call`, the one mapping;
- `api/arr_sabnzbd.py` / `api/arr_qbittorrent.py`: `timeleft` / `eta` from the job's estimate;
- `auth/permissions.py`: the 5 routes classified `browser.client`.

**Binding-rule audit:** **zero** edits in `transfers/`, `application/`, `providers/` or `executors/`.

**Gate 7 (focused):**

| Check | Result |
|---|---|
| `tests/test_browser_jobs.py` (new, 7 tests; separate-process server) | 7 passed |
| What they prove | idempotent submit/replay/conflict; own-jobs isolation; attribution (person + token in `/api/requests`); every kind Quick Add takes (links, magnet, torrent, `.meta4`; `.metalink` refused); no category/profile/delivery; the external API closed to a browser; withdraw; pause honoured as the client's own hold (`paused_by: client`), resume honoured, another browser 404; D4 private-LAN refused under confirmation and admitted with Skip on; session capabilities |
| Mutation: the browser branch of the job view removed | the submit test **failed**, as required; restored |
| Broad run, once (58 modules importing a changed module, plus error-code, localization and ETA tests; `-m "not real_runtime"`) | 1,437 passed, 1 failed: WS-S1's exact `/session` expectation, now including `capabilities` (intended), updated |
| Both browser suites after that | 21 passed |
| ruff F821/F822/F823, `compileall` | clean |

**Not run:**
- a live estimate (it needs a real download in progress), proven instead by the one-owner source check and the pure mapping tests;
- `shared_interest`, which is the existing owner's tested behaviour, unchanged;
- `nzb` / `nzb_link` live (the same owner paths as Integrations).

**ETA:** `test_external_adapters_carry_no_estimate` is replaced by `test_external_surfaces_report_the_one_estimate_owners_figure` (L27).
