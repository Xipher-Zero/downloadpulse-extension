# WS-S1 — Browser pairing and self-service browser tokens (DebridPulse)

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9). **This document stops at Gate 2 for operator design review**, because it creates new authority:
- unauthenticated endpoints;
- a credential deliberately narrower than its account.

**Repository:** `Xipher-Zero/debridpulse`, branch `1.0.14` (L29), base `b032be9c` (tree `9b279913`).

**Authority:**
- PLAN.md §5.1, §5.2, §5.7, and decisions L7–L10, L22, L26, L28;
- *Development and Architecture* Rules C1–C3, D3, T1–T3, U1 and §10;
- *Prompt Authoring and Gates* §4 and §4.7.

## 1. Mission

A browser extension obtains its **own token, after a signed-in person approves it on the server**, without the extension ever handling a password. That token:
- is owned by the approving person's account (Admin or User), so provenance shows the person and the browser;
- can do **only** what a browser client needs, never what its account's session can;
- is listed and revocable by its owner from the Account dialog, and by an Admin from Accounts.

**Out of scope:** what a browser token can submit and read. That is WS-S2, the browser adapter. WS-S1 delivers the credential, its fence, and one route proving it works (§4, B9).

## 2. Evidence anchors (Gate 0, verified at `b032be9c`)

| # | Fact | Where |
|---|---|---|
| A1 | Capabilities are **per role**: `capabilities(principal)` returns `ROLE_CAPABILITIES[role]`. Nothing narrows a principal below its role. | `backend/auth/permissions.py:66-84` |
| A2 | Every routed action is classified once in `ACTIONS`; unclassified means denied. `PUBLIC` means no credential needed. | `auth/permissions.py:91+` |
| A3 | Tokens: `account_tokens(id, account_id, label, verifier, created_at, revoked_at, client_id, last_seen_at)`. Only a SHA-256 verifier is stored; the raw secret `dp_…` is shown once. | `auth/accounts.py:111-126, 1451-1560` |
| A4 | `create_token` refuses non-Integration accounts (`account.tokens_integration_only`). `resolve_token` accepts only an active **Integration** account's token. | `auth/accounts.py:1475, 1521-1550` |
| A5 | A bearer request becomes `Principal.integration_token(account, token_id, client_id)`, in every authentication mode, **including open (standalone) mode**. An invalid bearer is refused and never falls back to the standalone Admin. | `auth/middleware.py:325-337`, `auth/models.py:96-104` |
| A6 | Token list/create/revoke routes are Admin-only (`_A`). | `auth/permissions.py:164-166`, `api/account_routes.py:198-222` |
| A7 | Session mutations require CSRF (`X-CSRF-Token`); sessions resolve before the bearer path. | `auth/middleware.py:305-318` |
| A8 | `PUBLIC_PATHS` is an explicit set in `auth/policy.py` (`is_public_path`). | `auth/policy.py:30` |
| A9 | Rate limiting exists: `FailureThrottle`, `DualWindowRateLimiter`. | `auth/throttle.py:24, 116` |
| A10 | A person's own account is managed in the **Account dialog** (`auth.js` `openAccountDialog`; views `profile`, `password`, `clear`). The Integration token UI is in Settings → Accounts (`ui-settings-page.js:4561-4700`). | `frontend/static/auth.js:405+` |
| A11 | Sign-in returns to the full original path **including the query** (`currentReturnPath`; server `safe_return_path`). | `auth.js:78-86`, `api/auth_routes.py:842` |
| A12 | Persisted events go through `db.event_journal.record(db, JournalEvent(...))`, inside the caller's transaction. | `db/event_journal.py:210` |
| A13 | Localization: `frontend/static/i18n` holds 20 files (19 locales and the runtime); terms are in `frontend/i18n/terms`, review notes in `frontend/i18n/review`. | tree |

## 3. Trust-boundary inventory (Gate 1; Rules T1–T3)

| Surface | Effective principal | Reads | Writes | Must never |
|---|---|---|---|---|
| **P1** `POST /api/browser/v1/pairings` (start) | **anonymous** (PUBLIC) | nothing durable | one in-memory pending pairing | read accounts or tokens; reveal anything about the installation beyond "pairing started" |
| **P2** `POST /api/browser/v1/pairings/poll` | **anonymous** (PUBLIC), holding the secret device code | the in-memory pairing named by that code | consumes it on success | accept the short user code here; issue a token twice; distinguish "never existed" from "expired" |
| **P3** `GET /api/browser/v1/pairings/{user_code}` (approval view) | **signed-in session** (or the standalone Admin in open mode) | the pending pairing's client name and expiry | nothing | show the device code |
| **P4** `POST …/{user_code}/approve` and `…/deny` | **session + CSRF**, account role Admin or User | the pending pairing | approve: one `account_tokens` row (kind browser), plus a journal event; deny: discard | approve for an account other than the caller's; be reachable with a bearer token |
| **P5** Own browser tokens: list, revoke | **session**, any non-ReadOnly human | the caller's own browser tokens | revoke only the caller's own | list or revoke another account's tokens |
| **P6** Admin: list and revoke a person's browser tokens | **Admin session** | that account's browser tokens | revoke | create a browser token for someone else |
| **P7** `GET /api/browser/v1/session` | **browser token** | its own token label, account display name, protocol | nothing | be reachable by any other credential kind |
| **Browser token, everywhere else** | browser token | — | — | reach any route except P7 (and WS-S2's later routes): no session API, no Admin API, no `external.client` |

**Adversarial preflight** (each failure mode and its control):

1. **Brute-forcing the user code to hijack a pending pairing.**
   - The user code only *identifies* a pairing for the approving human. Approval needs that human's session.
   - The token goes only to the holder of the 256-bit **device code**, so an attacker who guesses a user code can at most approve someone else's pairing *as themselves*, gaining nothing.
   - P3 and P4 are additionally rate-limited per session.
2. **Phishing: an attacker starts a pairing and sends the victim the approval link.** If the victim approves, the attacker gets a token on the victim's account. This is the known device-flow risk. Controls:
   - the approval view shows the requesting client's name, **the time it was requested**, and the user code, which the extension also shows;
   - a plain warning: "Only approve if you started this in your own browser just now";
   - the token is narrow (browser capabilities only) and revocable;
   - the approval is journaled with the requester's address.
3. **Flooding P1.** In-memory pairings are capped (64 pending installation-wide, 10-minute expiry, oldest expired first), and P1 is rate-limited per peer address. Overflow returns a typed refusal. No durable write occurs before approval.
4. **A token outliving its owner's rights.** `resolve_token` re-checks at **every request** that the account is active and its role is still Admin or User. Demotion to ReadOnly, deactivation or deletion stops the token at once; existing revocation cascades (A4, the account deactivation path) are kept.
5. **A browser token on an Admin account reaching Admin routes.** The capability set of a browser-token principal is **replaced**, not intersected, by `BROWSER_CLIENT` alone (§4, B2). One function, `capabilities()`, decides it, and a test walks every classified action.
6. **Open (standalone) mode.** Anyone who reaches the server is already the Admin there (A5). Pairing works the same way: approval acts as the standalone Admin. The browser token is still narrow, so it never grants more than the open server already does.
7. **CSRF on approval.** P4 is a session mutation, so the existing CSRF check applies (A7). Bearer credentials cannot reach P4: `ACTIONS` gives P4 a session-only capability.
8. **Leaking secrets** (Rule D3).
   - The device code and the raw token are never logged, journaled or stored in raw form.
   - The token is stored as a verifier only (A3).
   - The device code lives only in memory, as a hash key.
   - The journal records the token's ID and label, never its secret.
9. **A restart mid-pairing.** The pairing is lost (L28). The extension's poll gets "expired or unknown" and offers Connect again. No token exists until approval.

## 4. Design (Gate 2; for operator review)

| # | Behaviour |
|---|---|
| B1 | **Token kind.** `account_tokens` gains a `kind` column: `integration` (default; existing rows) or `browser`. It is a schema addition with an idempotent `_ensure_column` migration, like `client_id` and `last_seen_at`. Backup/restore carries it as part of the table. |
| B2 | **The browser fence.** A new capability, `BROWSER_CLIENT`. `Principal` gains `credential_kind`. When `credential_kind == "browser"`, `capabilities()` returns exactly `{BROWSER_CLIENT}`, whatever the role. No role holds `BROWSER_CLIENT`, so no session can reach browser routes. |
| B3 | **Resolution.** `resolve_token` accepts an active Integration account's `integration` token (unchanged), **or** an active Admin or User account's `browser` token. Every other combination is refused. The principal it builds names the account, token ID, kind and client ID. The browser token's client ID is its own ID, as for an Integration token, so WS-S2 fences jobs per browser. |
| B4 | **Pairing (P1–P4)** lives in a new module, `auth/browser_pairing.py`, as in-memory state (L28):
- 256-bit device code; 8-character user code from an unambiguous alphabet (`XXXX-XXXX`);
- client name (≤ 64 characters, from the extension), created time, 10-minute expiry, the requester's address;
- status `pending` / `approved(token)` / `denied`.

The token is created **at approval**, inside one transaction with its journal event, and handed to the poller **once**; the pairing is then deleted. A token approved but never collected expires with its pairing and is **revoked**. |
| B5 | **Rate limits.**
- P1: per peer address, 10 per 10 minutes;
- P2: poll interval of at least 2 s, else `slow_down`;
- P3/P4: per session, 30 per 10 minutes.

The limiters are the existing ones (A9); no new limiter type. |
| B6 | **Approval UI.** The extension opens `/?connect-browser=<user code>`. A sign-in in between returns to that path (A11). A new bounded owner, `ui-browser-pairing.js`, opens one modal at boot when the parameter is present. It shows the client name, the request time, the code and the warning (§3, item 2), with an editable token name (defaulting to the client name) and Approve/Deny. It then removes the parameter from the address bar. ReadOnly accounts see "This account can't connect a browser". |
| B7 | **Own tokens (P5)** are a new view, **"Connected browsers"**, in the Account dialog (A10), beside profile/password: the browser tokens' names, created times, last-seen times, and Revoke. It is **not** a Settings page (L22). It is hidden for ReadOnly accounts. |
| B8 | **Admin (P6):** Settings → Accounts' existing per-account token detail also lists a person's **browser** tokens, with Revoke and no Create. Integration token behaviour is unchanged. |
| B9 | **P7** `GET /api/browser/v1/session` returns `{protocol: "debridpulse.browser/1", token: {id, label}, account: {display_name}}` to a browser token only. WS-S2 extends `debridpulse.browser/1`; the extension uses P7 to verify its pairing and the server's protocol (PLAN L19). |
| B10 | **Localization (§4.7).** Every new user-visible string (approval modal, Connected browsers view, Admin list additions, typed refusals) is added to all 19 catalogs with semantic keys. Typed error codes: `browser.pairing.*` and `account.browser_token.*`. Journal events carry codes and parameters, never prose built from secrets. |
| B11 | **Journal.**
- `security.browser_connected`: account, token ID, label, requester address;
- `security.browser_disconnected`: token ID, by whom, own or Admin.

Both are written in the same transaction as the change. |
| B12 | **Documentation.**
- `docs/architecture/BROWSER_CLIENT.md`: the pairing protocol, the fence, revocation;
- `docs/UI_FRONTEND_ARCHITECTURE.md`: the new `ui-browser-pairing.js` owner in the owner map;
- `EXTERNAL_CLIENT_PROTOCOL.md` §1: browser tokens are not external clients.

**Excluded:** the `CHANGELOG.md` entry; it is written at the release pass. |

**Simpler alternatives considered** (Rule C1; the "surface simpler design early" standard):
- **Paste a token by hand** (no pairing). Rejected by L7: the operator wants no hand-copied credentials. It would also still need B1–B3 and B7–B8.
- **Reuse Integration tokens on a hidden per-user Integration account.** Rejected: attribution would name a synthetic account, not the person (L8). It also multiplies accounts, and the Integration capability set is far broader than a browser needs.
- **Scope strings on every token** (a general OAuth-style scope system). Rejected: speculative generalization (Rule C1). One `kind` with one fixed capability set covers the proven need.

## 5. Scope and prohibited work

**In scope:** B1–B12.

**Prohibited:**
- any browser-adapter submission, listing or controls (WS-S2);
- ETA (L27, WS-S2);
- any change to Integration-token behaviour, *arr adapters or the external protocol's routes;
- any Settings page or field for the extension (L22);
- monkeypatching in production or tests;
- `CHANGELOG.md`.

**Mobile scope note:** 1.0.14 work has been mobile-only (<780 px). **The approval modal and the Connected browsers view are new surfaces at every width, by the operator's explicit scope (L4–L8, L26).** Existing ≥780 layouts are untouched.

## 6. Qualification plan (Gate 7; focused, within the 15-minute budget)

**New focused tests**, each with its failure path:
- the fence: a browser token on an Admin account is refused (`403`) on every classified non-browser action, walking `ACTIONS`;
- a browser token reaches P7, and P7 refuses an Integration token and a session;
- `resolve_token` refuses a browser token once its account is ReadOnly, deactivated or deleted, or the token is revoked;
- pairing:
  - start → approve → poll issues the token exactly once;
  - a second poll is refused;
  - expiry → refused, and an uncollected approved token is revoked;
  - deny → refused;
  - a wrong device code → refused, indistinguishable from expired;
  - the 64-pairing cap gives a typed refusal;
  - P1's rate limit;
- approval requires a session and CSRF; a bearer token on P4 is refused; a ReadOnly session is refused;
- own-token list/revoke cannot touch another account's token; Admin list/revoke works and offers no create;
- the journal events are written and contain no secret;
- the browser contract (Playwright, focused): the approval modal from `/?connect-browser=` approves, and Connected browsers lists and revokes.

**Existing suites that import the changed modules**, run once (the pre-push standard): the auth, permissions, account routes and route-ownership contract tests, and the localization catalog contract tests.

**No full suite.** At most one justified broad pass.

## 7. Open decisions (operator, at this Gate 2 stop)

None block the design. **Review points:**
1. Acceptance of the device-flow phishing risk with the §3 item 2 controls. This is the standard trade-off of every device-pairing flow; the alternative is L7's rejected token pasting.
2. Whether an Admin should see the **names** of other people's browser tokens (B8). L26 lets Admins revoke them, which needs at least a list.

## 8. Gate record

**Gate 2 approved** by the operator, 2026-11-17 ("Proceed").

**Gate 2 amendment, B13: extension origins.** Measured in Chromium 151 and Firefox 153: an extension background's POST carries `Origin: chrome-extension://…` / `moz-extension://…`. The general web-security boundary refused that (`Forbidden origin`).

Amendment:
- the boundary admits an extension-scheme origin **only under `/api/browser/v1/`**;
- every route there is credential-free (start, poll) or admits a browser token alone, sent as an explicit Bearer header, a capability no session holds;
- a web page cannot claim an extension origin;
- outside the prefix an extension origin is refused as before (tested).

The extension must send `credentials: "omit"` (recorded for WS-E1).

**Corrections made during Gates 3–7:**
- **Test-only seam removed.** `PairingStore(clock=…)` violated the no-test-seams rule, so the store reads `time.monotonic` directly. Consequence: **10-minute expiry and the revocation of an approved but uncollected token are reviewed, not run** (each needs 10 real minutes).
- **Defect found by the tests.** The Admin route `revoke_account_token` passed no actor, so an Admin's disconnect was journaled as "by its owner". The route now passes the acting Admin.
- **Layout.** An "Admin's view" of a person's browsers lives in that person's **Account Details** dialog (`showAccountDetails`), not the Accounts table, so no table layout changes at any width.
- **Dead code.** `PairingStore.clear()` was unused and has been removed.

**No Monkeypatching / No Layering audit.**
- Zero `monkeypatch` in `test_browser_pairing.py`. The live proofs run the real backend in a separate process, with real sign-ins.
- New production names and their necessity:
  - `auth/browser_pairing.py`: `PairingStore`, the one owner of pending pairings (state and lock); `Pairing`, its record; `PairingRefused`, typed refusals; `normalized_user_code`, the accepted input forms; `_device_key`, the hashed key; `pairing_store`, the one instance.
  - `api/browser_routes.py`: 8 route handlers; two limiter instances of the existing `DualWindowRateLimiter`; three small private helpers (`_pairing_refused`, `_answer_allowed`, `_public_browser`).
  - `auth/accounts.py`: `issue_browser_token`, a new function of the canonical owner; `revoke_token(kind=, actor_id=)` and `resolve_token` (now also returning the kind), both changed in place; `BROWSER_ROLES`; `TOKEN_KIND_*`.
  - `auth/permissions.py`: two capabilities and the fence branch inside `capabilities()`.
  - `auth/middleware.py`: `browser_extension_request()`, one predicate used once.
  - `auth/models.py`: `Principal.credential_kind`.
- No wrapper, adapter, factory, proxy or compatibility layer. No production parameter exists only for tests.

**Gate 7 (2026-11-18, Arizona time), focused qualification.**

| Check | Result |
|---|---|
| `tests/test_browser_pairing.py` (new; 14 tests: the fence over `ACTIONS`, live pairing, denial, approval guards, the token's fence, origins, who disconnects what, demotion to ReadOnly, the start rate limit) | 14 passed |
| Mutation: the browser fence removed from `capabilities()` | **3 fence tests failed**, as required; restored |
| Broad run, once: every test module importing a changed module, plus the UI, settings, Help and localization contract tests (157 modules, `-m "not real_runtime"`) | first run: 2,143 passed, **5 failed**; all five fixed (below) |
| The five, after the fixes, plus every suite the fixes touched | test_localization_catalogs + test_error_codes: 85 passed; browser pairing, access control, external client, PWA manifest, UI shell: 120 passed; the other `style.css?v=` pins: passed |
| `frontend/browser/browser-pairing.spec.js` (new; approval from `/?connect-browser=`, Connected browsers list and Disconnect, Deny, an answered link), against a local password-auth backend | 2 passed |
| Mutation: the approval owner's `start()` disabled | **failed**, as required; restored |
| `node .github/localization/validate.mjs` | 0 errors; 0 translation and review debt in all 18 supported locales |
| ruff F821/F822/F823, `compileall`, `node --check` (changed scripts and spec) | clean |

**The five first-run failures and their fixes:**
1. `test_error_codes`: each refusal's English `detail` must equal its catalog English. The server now sends the catalog text exactly (final periods; one `rate_limited` text, not two).
2. `test_localization_catalogs`, the debt test: the 44 new keys had no review-ledger entries.
3. `test_localization_catalogs`, the literal census: `PairingRefused` raises must name `code=` as a keyword.
4. `test_pwa_manifest_contract`: it pins the exact public-path set. The two pairing paths are intended additions, so the test's set is updated.
5. `test_ui_shell_contract` (and 3 others): they pin `style.css?v=43`, which was deliberately bumped to 44.

**Localization (B10).**
- **English:** 44 keys, with metadata (category, context, owner, criticality, declared `{name}` arguments).
- **The 18 target locales:**
  - translated by three translators (6 locales each);
  - **independently reviewed** by three other reviewers, who fixed 9 keys (id 1; tr 2; uk 3; zh-Hans 3);
  - the 3 critical-warning keys were **back-translated blind**, by a context given only the target text under neutral IDs, never the English, then compared with the English by this task's author. All 54 match in meaning.
- **The ledgers** record `ai-generated` and `ai-review` for every key, plus `ai-back-translation` with its text for the critical keys. No human review is claimed.
- **Labels instead of loanwords:** where the plain word equals English ("Browser", "Code"), translators used a fuller label ("Anfragender Browser", "Koppelcode", "Code de vérification") rather than recording an intentional identity.

**Not run, disclosed:**
- the 10-minute pairing expiry, and the revocation of an approved but uncollected token, which need 10 real minutes (§8 above);
- the 64-pending cap, which can't be reached within one window from one loopback peer, because the per-peer limit (10) stops it first;
- `real_runtime` tests, which aren't affected by this change;
- the full Browser Runtime suite, by the test budget. CI runs both full suites after the push.

**Gate 8:** self-review against §3–§6, including the audit above. The design was followed except for the recorded amendment (B13) and corrections.
