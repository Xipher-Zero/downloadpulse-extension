# DownloadPulse Extension — Product and Architecture Plan

**Document type:** planning and design record. This is **not** an implementation task. Each workstream in §9 becomes its own standalone, gated implementation task (Gates 0–9, hard stop at Gate 9), written to the DebridPulse handbooks.

**Status:** draft for operator review, 2026-11-17 (Arizona time).

**Repositories:**
- `Xipher-Zero/downloadpulse-extension`: this repository; the extension.
- `Xipher-Zero/debridpulse`: the DownloadPulse server (the product is being renamed from DebridPulse; its repository and code still use the old name).

**Authority:** the operator's product decisions recorded in §2 are locked. DebridPulse source establishes existing behaviour. Facts marked **verified** were read in the DebridPulse checkout at `b032be9c` (tree `9b279913`, branch `1.0.14`) on 2026-11-17. Everything else is a lead to verify at the relevant task's Gate 0.

**Governing handbooks:**
- *DebridPulse — Development and Architecture*: core ownership; Rules C1–C3, D3, T1–T3, U1–U3; §6A standing contracts.
- *DebridPulse — Prompt Authoring and Gates*: §4 invariants, §4.7 localization, §6 gates, the test budget.

---

## 1. What this is for

**Need.** People find downloads in their browser: links, magnets, `.torrent` and `.nzb` files, file-hoster pages, media pages. Today they copy each one into DownloadPulse's Quick Add by hand.

**Outcome.** A browser extension for **Firefox** and **Chromium-based browsers** (Chrome, Edge, Brave and others) that:
- connects once to the user's DownloadPulse, local or remote;
- sends a download there in one click, from where the user already is;
- shows what it sent, with progress and simple controls.

DownloadPulse then decides everything else, as it does for Quick Add. In the operator's words: outside onboarding this is URL detection and submission. The extension holds no acquisition logic.

**Architectural position.**
- The extension is a **client**: a presentation and submission surface (Development and Architecture §2, §9). It owns no transfer state, routing or recovery.
- On the server it is served by a **browser adapter** beside the existing *arr adapters, consuming core through the existing external-client contract (§5).

---

## 2. Locked product decisions (operator, 2026-11-17)

| # | Decision |
|---|---|
| L1 | **Name:** "DownloadPulse" (Extension/Plugin), the intended release name of the product. |
| L2 | **Its own repository**, separate from DebridPulse. One codebase builds both browsers' packages. |
| L3 | **Licence:** GPL-2.0-or-later, as DebridPulse. |
| L4 | **Onboarding** starts from the toolbar dropdown on first use: one button, "Connect to a DownloadPulse instance" (§3.1). |
| L5 | **Local first:** onboarding probes the local computer for a Standalone install on port **8095**. 8095 is the Docker default and the desktop application's default Local Port (verified: `AppSettings.desktop_local_port = 8095`). |
| L6 | **No local install found:** offer two choices. (1) Make sure the local instance is running, then probe again, as often as needed. (2) Connect to a remote server by entering its URL. |
| L7 | **Authentication by pairing**, never a password typed into the extension. The user signs in, if their server requires it, on the server's own page in a browser tab, and approves the connection there (§5.1). |
| L8 | **One token per browser**, named by the user (for example `Laptop-Firefox`). Submissions are attributed to the **signed-in user's account** and to that token, so provenance identifies both the person and the browser. |
| L9 | **Who may connect a browser:** any account that may submit downloads. Only **ReadOnly** accounts are excluded. |
| L10 | **The token is the extension's only credential**: submit, status, pause/resume of its own transfers, and requesting removal (withdrawal). |
| L11 | **Right-click** "Download with DownloadPulse" on links and on selected text. Selected text is scanned for one or more URLs (fuzzy extraction). |
| L12 | **Hover icon:** a small download icon beside a detected download URL, only while the pointer is over it. It sits to the right of the URL (to the left in RTL) and **never covers the URL**. |
| L13 | **Which URLs get the hover icon:** download links and plain-text URLs meant as downloads, using reasonable, established discrimination (§3.3), **not** every link. |
| L14 | **Current page / media:** in **Firefox**, an icon inside the URL bar (a page action) on pages DownloadPulse can take; in **both** browsers, a hover button on video players. **No send-this-page button in the toolbar popup.** (Chromium allows no extension items in the address bar's own menu.) |
| L15 | **`.torrent`, `.nzb` and `.metalink` files:** the file is fetched as the browser would fetch it, then its **contents** are sent to DownloadPulse. This matters for private trackers and indexers that require the user's own login (§3.4). |
| L16 | **The toolbar dropdown lists only transfers this extension submitted**, each with progress, ETA, a single pause/resume toggle and a removal button. |
| L17 | **Active indicator:** the toolbar icon shows a rotating ring **only while at least one download is active**; otherwise it is static and the extension idles. |
| L18 | **Browser notifications:** on completion, on failure, and when a download needs the user's attention. |
| L19 | **Server version check:** the extension detects a server that doesn't support what it needs and says so plainly. |
| L20 | **Remote servers:** the extension asks the browser for permission to reach the server's address when the user connects, not for every address in advance. Self-signed HTTPS gets a stated answer (§7, D7). |
| L21 | **Languages:** the extension supports the same languages as DebridPulse: English plus 18. |
| L22 | **Settings live in the extension only.** Nothing is added to DebridPulse's own Settings for the extension. |
| L23 | **Server side, a browser adapter** like the *arr qBittorrent and SABnzbd adapters, **not** a change to core. Core may expose further facts to external adapters where a proven general need exists (Rule C1). |
| L24 | **Store accounts, the Firefox add-on ID and the privacy policy:** the operator will arrange these. |
| L25 | **Stack:** TypeScript, a small build, one codebase producing both packages, Playwright (Chromium) and `web-ext` (Firefox). |
| L26 | **Token ownership:** every user (except ReadOnly) may create and revoke **only their own** tokens. **Only an Admin** may revoke another user's tokens. (Resolves D2.) |
| L27 | **ETA is provided to external clients**, typed and labelled as an estimate. The current contract that withholds it, and the test that enforces that, are retired. |

**Non-goals for the first version:**
- interactive file selection, provider choice or routing control from the browser;
- operating on transfers the extension did not submit;
- any change to DebridPulse's Settings pages;
- telemetry.

---

## 3. Extension behaviour

### 3.1 Onboarding (L4–L8)

States, in order:
1. **Not connected.** The dropdown shows the single "Connect to a DownloadPulse instance" button.
2. **Probing local.** The extension checks `http://127.0.0.1:8095/api/health` (and `localhost`). A DownloadPulse answer means a local instance; the extension continues to pairing against it (§5.1). A Standalone install has no sign-in, so its pairing page needs no password; an install with sign-in shows its own sign-in page in the tab.
3. **Not found.** Two choices, as L6:
   - "Make sure DownloadPulse is running on this computer", with a Check again button that repeats step 2;
   - "Connect to a DownloadPulse server" asks for a URL. It requests the browser permission for that origin (L20), confirms a DownloadPulse server answers there and that it supports the required protocol (L19), then pairs.
4. **Pairing.** A tab opens on the server's approval page. The dropdown waits ("Waiting for approval in the DownloadPulse tab…") and offers Cancel. The token name field is pre-filled from the browser and OS (for example `Firefox on Linux`) and the user can edit it.
5. **Connected.** The token is stored and onboarding ends. The dropdown switches to the downloads list (§3.5).

**Errors each state must explain plainly:**
- not reachable;
- not DownloadPulse;
- server too old (L19);
- pairing expired or refused;
- account not allowed to submit (L9: ReadOnly);
- certificate not trusted (D7).

### 3.2 Submission surfaces (L11–L15)

| Surface | Browsers | What is sent |
|---|---|---|
| Right-click a link | both | that link |
| Right-click selected text | both | every URL extracted from the selection: one, or a batch |
| Hover icon beside a download URL | both | that URL |
| Hover button on a video player | both | the page URL, as a media submission |
| URL-bar icon (page action) | Firefox | the page URL, as a media submission, shown only on pages DownloadPulse can take |
| Right-click a `.torrent` / `.nzb` / `.metalink` link | both | the file's contents (§3.4) |

Each submission:
- carries a client-generated idempotency key, so a retry after a timeout is never a second download;
- confirms quietly (a short toast in the page, or the icon badge) without opening the dropdown;
- shows any refusal with its reason, from the server's typed error code (localized, §8).

### 3.3 Which URLs count as downloads (L13)

A URL is a download candidate when any of these holds, checked locally without network requests:
- a `magnet:` URI;
- the path ends in a download file type: `.torrent`, `.nzb`, `.metalink`/`.meta4`, archives, disc images, installers, video and audio files;
- the link has a `download` attribute, or a non-HTML `type` attribute;
- the host is in the server's supported-host list (file hosters and media sites its services claim; §5.6).

Plain-text URLs on the page are recognised when the pointer is over them, without rewriting the page. The extension makes **no request** to a link's target to decide; that would be slow, and it would leak the user's browsing to those sites.

The hover icon is drawn in its own isolated layer (a shadow root) beside the URL's box, mirrored for RTL, and removed when the pointer leaves. It never covers the URL.

### 3.4 Capturing `.torrent`, `.nzb` and `.metalink` (L15)

An extension cannot read the bytes of a file the browser has saved to disk. The extension therefore fetches the file itself, carrying the user's login for that site, and sends its contents. Whether the site's cookies go along depends on each browser's third-party cookie rules. **Settled by spike S1 (2026-11-17, [`spikes/S1-cookie-capture.md`](spikes/S1-cookie-capture.md)):** a fetch from the background script carries the file site's own login cookies (every SameSite variant) in Chromium 151 and Firefox 153/160, even with third-party cookies blocked. A content-script fetch is blocked cross-origin. The capture mechanism is the background fetch; it needs host permission for any site (§3.7). The contents go to the server as an upload; the file's URL may contain a passkey and is never sent or kept (Rule D3).

### 3.5 Downloads list, controls, indicator, notifications (L16–L18)

- **The list:** the extension's own jobs, read from the protocol by change cursor, with:
  - name;
  - state;
  - progress (percent, and bytes when known);
  - an ETA, labelled as an estimate (§6A of the architecture handbook);
  - a pause/resume toggle;
  - Remove (withdraw).

  States come from the server; the extension never infers them.
- **Polling:** only while something is active, or while the dropdown is open. It stops when nothing is active.
- **Ring:** while at least one job is active, the background script runs an animation loop that advances the ring frame and polls. Every icon update is an extension API call, which keeps a Chromium service worker alive for exactly that period. When nothing is active, the loop ends and the background sleeps. **Settled by spike S2** ([`spikes/S2-background-lifetime.md`](spikes/S2-background-lifetime.md)): icon updates keep the background alive in Chromium 151 and Firefox 153/160, at 1 and 10 frames per second; polling alone does not. State that must survive a stop lives in extension storage.
- **Notifications:** on a transition to completed, failed, or needing attention. Each opens the dropdown when clicked.

### 3.6 Extension settings (L22)

- the server's address, and Reconnect;
- Disconnect, which also revokes this browser's token on the server (L26: a user revokes their own tokens);
- the hover icon on or off, globally and per site;
- notifications on or off, per kind;
- the language: follow the browser by default.

### 3.7 Permissions and privacy

- **The content script** runs on all sites, for L12 and L14; the background also holds all-sites host permission, to capture files from any tracker or indexer (L15, spike S1). Both stores then show their "read and change data on all websites" warning, and review is stricter. The script reads only link and selection data around the pointer and sends nothing anywhere except the user's own submissions to the user's own server.
- **The server origin:** permission is requested at connect time (L20).
- **Other permissions:** `contextMenus`, `notifications`, `storage`; `downloads` only if spike S1 needs it.
- **The token** is kept in extension local storage only, never synced, never in content scripts or page-visible storage, and never logged.
- **No telemetry**, no third-party requests.

---

## 4. Supported browsers

- **Firefox:** current release and ESR. Manifest V3 with an event page, `browser_specific_settings.gecko` (its add-on ID, L24) and a page action for L14.
- **Chromium:** Chrome, Edge, Brave and others. Manifest V3 with a service worker.
- **Shared code:** one codebase, using the WebExtension polyfill; a per-browser manifest is generated at build time.

---

## 5. Server side: the browser adapter (DebridPulse)

### 5.0 Existing contract (verified at `b032be9c`)

- **The protocol:** External Client Protocol v1, `debridpulse.external/1`. Documented in `docs/architecture/EXTERNAL_CLIENT_PROTOCOL.md`; contract in `backend/external/service.py` (`ExternalClients`); routes in `backend/api/external_routes.py` under `/api/external/v1`.
  - **Routes:** `capabilities`; `jobs` (submit, list, inspect); `jobs/{id}/withdraw`; `jobs/{id}/controls` (advisory pause/resume); `jobs/{id}/delivery` and `delivery/ack`.
  - **Capability:** all of these require `external.client` (`auth/permissions.py`).
- **Who holds it:** only the **Integration** role. Admin does not (§1 of the protocol); User does not.
- **Tokens:** an Integration token (`dp_…`) is the credential. `list`, `create` and `revoke` account tokens (`api/account_routes.py`) are classified **Admin-only**.
- **Capabilities answer:** includes `"events": {"supported": False}` (polling only) and a per-client active-job limit.
- **Submission kinds:** `links` (1–100), `magnet`, `nzb_link`, `nzb` (upload), `torrent` (upload). Not supported: **Metalink uploads, Media Downloads as a kind**, link files.
- **Questions only an operator can answer** refuse the submission. Example: private-LAN consent gives `local_network_confirmation_required`.
- **Job status** includes `progress` (`percent`, `completed_bytes`/`total_bytes`). It has **no ETA**: external adapters carry no estimate, by deliberate contract (DebridPulse test `test_v114_transfer_eta.py::test_external_adapters_carry_no_estimate`).
- **Jobs deliver into Integration Delivery Profiles** and expect acknowledgement (§4 and §6–7 of the protocol). This is a design for *arr hand-off.
- **Adapter precedent:** `backend/external/arr.py` with `api/arr_sabnzbd.py` and `api/arr_qbittorrent.py`, which "decide from the native external contract alone… no table, no queue, no worker". **The browser adapter follows this shape (L23).**

### 5.1 Pairing (L7)

**Requirement:** a browser obtains its own token after the user approves it on the server, without the extension handling a password, for password, OpenID Connect and Standalone installs alike.

**Pattern:** a device-authorization flow, after RFC 8628:
1. The extension requests a pairing (unauthenticated) and receives a secret device code, a short user-visible code, and the approval URL.
2. It opens the approval URL in a tab.
3. The user signs in if the server requires it, sees the browser name and the short code, edits the token name and approves. The approval is a session-authenticated, CSRF-checked action.
4. The extension polls with the device code and, once approved, receives its token **once**.

**Trust boundary (Rules T1–T3), to be traced at Gate 1:**
- the request and poll endpoints are **unauthenticated** and must read only pairing records, never accounts;
- they must be rate-limited, with codes that are single-use, expire in minutes and carry enough entropy;
- the approval runs as the signed-in user, and only an account allowed to submit (L9) may approve.

**This is new authority and a new durable record.** A Gate 2 decision covers where pairing state lives (memory versus database) and its persistence consequences.

### 5.2 Browser tokens for the signed-in user (L8–L10)

**Requirement:** a token owned by the approving user's own account (Admin or User, never ReadOnly), named by the user, through which submissions are attributed to that account and that token.

**Gap:** today only Integration accounts hold `external.client`, and only an Admin creates tokens.

**Hard invariant (least privilege):** a browser token carries **only the browser adapter's operations**, never the account's session powers. A token on an Admin account must not reach any Admin API.

**Token management (L26):**
- every non-ReadOnly user lists, creates and revokes **their own** tokens, browser tokens included;
- an Admin may also revoke any user's tokens;
- no user may see or touch another user's tokens.

Source at `b032be9c` classifies token list, create and revoke as Admin-only (`api/account_routes.py`, `auth/permissions.py`). WS-S1 therefore adds the self-service path for a user's own tokens, server-side authorization included. The account UI that exposes it is the user's own account view, not a Settings page (L22).

**Composition:** client binding and isolation, and rotation semantics, of the existing protocol.

### 5.3 What a browser submission is to DownloadPulse

**Requirement:** a browser submission behaves like the user's own **Quick Add**:
- a user-owned transfer in the normal Downloads list, under the user's normal download folder and rules;
- once complete, it is done: no delivery profile, no acknowledgement and no expiry handling.

The adapter maps the browser's operations onto the native external contract (or the existing submission owners) **without** a second lifecycle (Rule C3, no shadow state).

**Composition questions for Gate 1:**
- How does a user-owned transfer relate to the client's "demand" record, so that L16's list and L10's controls stay client-scoped?
- How do withdrawal and advisory pause apply when the user also operates the same transfer from the DebridPulse UI?

### 5.4 Submission kinds (L14, L15)

- Add **Media Downloads** (page URL to the media downloader) and **Metalink upload** for browser clients.
- `links`, `magnet` and uploaded `torrent`/`nzb` are reused as they are.

**Composition:**
- **Submission-wide specialized authority** and **per-root claimant union** (§6A of the architecture handbook) for mixed batches from a selection.
- **Private-LAN consent:** a browser client acts for a human. Whether that human may give private-LAN consent from the browser is decision D4.

### 5.5 ETA for external clients (L16)

**Requirement:** each job shows an ETA.

**Gap:** external adapters carry no estimate today, and a test enforces its absence (named in §5.0). The operator has ruled that contract unjustified (L27).

**Contract:**
- expose the existing transfer estimate owner's value to external clients, typed and labelled as an estimate, never in an exact field (§6A);
- no second estimator;
- the test that forbids an estimate is replaced by one proving the labelled estimate is present and comes from the one estimate owner (Prompt Authoring §4.2: retire superseded semantics in the same change).

### 5.6 Supported-host list (L13)

**Requirement:** the extension needs the hosts and media sites the server's configured services claim, to decide where the hover icon applies.

**Contract:** a minimal, client-readable projection: domain patterns only, no account, credential or provider-configuration detail (Rule T3). It is refreshed periodically and cached by the extension.

### 5.7 Version and capability discovery (L19)

The extension reads the server's capabilities and protocol version, and refuses plainly when they lack what it needs. **The browser adapter is a protocol revision**, version to be set at its Gate 2. The extension requires that revision.

---

## 6. Composition check (standing contracts touched)

| Contract | How this plan composes |
|---|---|
| Core owns transfers, routing and recovery (§2–3, Rule C1) | Extension: client only. Adapter: no lifecycle, routing or recovery of its own. Any core addition (facts for adapters) is justified as a general capability at its task's Gate 2. |
| One owner, no shadow state (Rule C3, U1) | Job state is only the server's. The extension caches for display and never infers. The adapter is a projection over core and the external contract. |
| Trust boundaries (Rules T1–T3) | Pairing endpoints are unauthenticated: trace their reads and writes. Browser tokens are least-privilege. The host list is a minimal projection. |
| No credential leakage (Rule D3) | Tokens, passkey-bearing file URLs, cookies and signed links are never logged, persisted as provenance or sent where not needed. |
| Estimates typed and labelled (§6A) | ETA is a labelled estimate field. |
| Submission-wide specialized authority, per-root union (§6A) | Batches from selections go through the existing intake rules unchanged. |
| External protocol invariants | Client binding and isolation, client-scoped idempotency, demand-only withdrawal and advisory controls all hold for browser clients. |
| Localization (Prompt Authoring §4.7) | The server's new user-facing text follows §4.7: the approval page, typed error codes and any persisted events. The extension follows §8. |
| Terminology | DownloadPulse product name; Download Activity; Multimeta (never "Multilink"). |

---

## 7. Open decisions (INPUT REQUIRED before the named workstream's Gate 2)

| ID | Decision | Options |
|---|---|---|
| D1 | Where pairing state lives (WS-S1) | in memory: lost on restart, simplest; **or** a durable table: a schema change, with backup/restore coverage |
| D2 | **Resolved 2026-11-17 → L26:** own tokens only; Admin may revoke others' | — |
| D3 | The browser-submission model (§5.3) | adapter over the external job contract with a "browser client" mode; **or** the adapter submitting through the same owner as Quick Add, attributed to the token |
| D4 | Private-LAN consent from the browser | refuse as v1 does (the user uses Quick Add); **or** allow the signed-in human to consent per submission in the extension |
| D5 | Extension catalogs | the extension owns its own message catalog in the same key/translation discipline; **or** shared terms are taken from DebridPulse's catalogs at build time |
| D6 | Firefox add-on ID | email form on a domain the operator controls (L24) |
| D7 | Self-signed HTTPS servers | the user accepts the certificate in a browser tab first (the browser's own exception) and the extension says so; **or** HTTP only on private networks |
| D8 | Active-job limit | the protocol's per-client limit applies to a browser; confirm the number or raise it for browser clients |

---

## 8. Localization (L21)

- The extension UI is translated into DebridPulse's 19 languages, English canonical, with semantic keys. Browsers' own `_locales` format, generated from the extension's catalog source (D5).
- Typed server error codes are mapped to the extension's own messages; English `detail` is never shown as the message.
- Content-script UI (the hover icon's accessible name, toasts) is localized and mirrored for RTL.
- **Locales:**
  - **at release:** zero missing or stale keys for every locale the extension advertises;
  - **during development:** debt is listed per locale, with English fallback per key (Prompt Authoring §4.7).

---

## 9. Workstreams and order

Each workstream becomes a **standalone implementation task**, written to the Prompt Authoring handbook: locked decisions, invariants, verify-at-Gate-0 anchors, proportional Gates 0–9, a focused test plan within the 15-minute budget, and a **Gate 9 hard stop**.

**Server (DebridPulse; in the 1.0.x line, after 1.0.14 or as decided):**
- **WS-S1:** pairing (§5.1) and browser tokens (§5.2), including self-service token management (L26). Needs D1.
- **WS-S2:** browser adapter: submission model (§5.3, D3), kinds (§5.4, D4), ETA (§5.5), host list (§5.6), version and capabilities (§5.7). Depends on WS-S1.

**Extension (this repository):**
- **WS-E0:** scaffold: TypeScript build, both manifests, lint, `web-ext lint`, Playwright harness, CI packaging. No features. Can start now.
- **WS-E1:** onboarding and pairing client (§3.1). Depends on WS-S1.
- **WS-E2:** submission surfaces (§3.2–3.4). Depends on WS-S2. Spikes S1 and S3 are answered; their untested items are carried here.
- **WS-E3:** downloads list, controls, indicator and notifications (§3.5). Depends on WS-S2. Spike S2 is answered; its untested items are carried here.
- **WS-E4:** settings, permissions and privacy (§3.6–3.7).
- **WS-E5:** localization (§8, D5).
- **WS-E6:** store packaging and listings (L24, D6, privacy policy). Depends on the website and accounts.

---

## 10. Spikes (evidence before design; no product code)

All three were approved by the operator on 2026-11-17. **All three were answered** the same day: [`spikes/S1-cookie-capture.md`](spikes/S1-cookie-capture.md), [`spikes/S2-background-lifetime.md`](spikes/S2-background-lifetime.md), [`spikes/S3-page-action-and-video-button.md`](spikes/S3-page-action-and-video-button.md).

| ID | Question | Settles |
|---|---|---|
| S1 | Can the extension fetch a `.torrent`/`.nzb` from a site requiring login, with the user's cookies, in Firefox and in Chromium (third-party cookie rules)? | §3.4, WS-E2 |
| S2 | Does an icon-animation loop keep Firefox's MV3 event page alive for its duration, as it does a Chromium service worker? | §3.5, WS-E3 |
| S3 | A page action shown only on matching sites in Firefox, and a reliable hover button on common video players (in-page `<video>`, iframes, shadow DOM). | L14, WS-E2 |

---

## 11. Qualification approach

- **Extension:**
  - unit tests for URL extraction and download discrimination (§3.3), against fixtures;
  - Playwright with the unpacked extension in Chromium against a local DownloadPulse, for onboarding and submission;
  - `web-ext lint` and a Firefox smoke run.
- **Server:** focused contract tests per workstream for the new adapter routes:
  - pairing, including expiry, reuse and rate limits;
  - token least privilege: a browser token on an Admin account is refused on Admin routes;
  - client isolation, the submission model, ETA labelling and the host-list projection;
  - each with one failure path.

  No broad suite by default; at most one justified broad pass per task (Prompt Authoring §4.4).

---

## 12. Revision log

- 2026-11-17: first draft from planning session 1.
- 2026-11-17: operator review.
  - D2 resolved as L26: own tokens only; Admin may revoke others'.
  - ETA provided to external clients (L27); the withholding contract and its test are retired.
  - Spikes S1–S3 approved.
- 2026-11-17: S1 answered: capture by background fetch; all-sites host permission (§3.4, §3.7).
- 2026-11-17: S2 answered: icon updates keep the background alive in both browsers; polling alone does not (§3.5).
- 2026-11-17: S3 answered: the Firefox page action follows a runtime host list; the video detector and top-layer button work through overlays, closed shadow DOM and cross-origin frames (L14).
- 2026-11-17: WS-E0 (scaffold) implemented, awaiting Gate 9 review: [`tasks/WS-E0-scaffold.md`](tasks/WS-E0-scaffold.md). The Firefox minimum is 140 (ESR).
