# WS-E4 — Settings, Disconnect, and a revoked browser

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9).

**Repositories:**
- this extension, base `0123a3d`;
- **DebridPulse `1.0.14`**, base `ceb1b63b`, for one route.

**Authority:**
- PLAN.md §3.6, and decisions L22, L26;
- the operator's "Proceed", 2026-11-18;
- DebridPulse `BROWSER_CLIENT.md`.

## 1. Mission

The extension's own settings, which are never DownloadPulse's (L22):
- **the connection,** with **Disconnect** that also revokes this browser's token on the server (L26);
- **the in-page buttons:** on or off globally, and per site;
- **which notifications** to raise.

A browser disconnected *in DownloadPulse* says so and forgets its token.

## 2. Behaviour

| # | Behaviour |
|---|---|
| B1 | **Options page:** the connection (server, account, browser), Open DownloadPulse, and Disconnect with its consequence; "On web pages" (the hover button, the video button, sites without buttons: add or remove, a site matching its subdomains); Notifications (finishes, fails, needs attention). |
| B2 | **The popup** gains a Settings link and a per-site switch for the current tab ("Download buttons on example.com"). |
| B3 | **Disconnect:** `DELETE /api/browser/v1/session` (B6), then the token, the shown connection and the cached downloads are forgotten here. If the server can't be reached, the extension still forgets the token, and says to remove the browser under My Account › Connected browsers. |
| B4 | **Revoked in DownloadPulse:** a 401 on the job list or on a send forgets the connection, and the popup says "DownloadPulse no longer accepts this browser. Connect it again." |
| B5 | **Content scripts still read no storage:** the background answers each frame's `dp-state` with `{connected, hover, video}` for its tab's site. A frame keeps that answer for up to 5 s. |
| B6 | **DebridPulse:** `DELETE /api/browser/v1/session` revokes the token carrying the request (`browser.client`; a session gets 403), journaled as disconnected by its owner. This is `api/browser_routes.py` and `auth/permissions.py` only: no `transfers/`, `application/`, `providers/` or `executors/` change. |

## 3. Gate record

**Gate 7:**

| Check | Result |
|---|---|
| DebridPulse: the new route's test (own server: self-revoke → 401; another browser untouched; journal "by its owner"; a session → 403) plus pairing, browser jobs and access control | 56 passed |
| DebridPulse pre-push: every module importing `auth.permissions`, `api.browser_routes` or `main` (40 modules, `-m "not real_runtime"`) | **872 passed** |
| Extension `npm run check` | 0 errors; the known Android-only warning |
| Extension e2e, settings (4) | 4 passed |
| What those 4 prove | Disconnect → one `DELETE` on the server, "Disconnected…", the popup back at Connect, the IndexedDB token gone; a token revoked server-side → the popup says so; hover off → no hover button while the video button stays; a site on the off-list → neither; removing it → back; "When a download finishes" off → no completion notification, while a failure still raises one |
| Mutation: the per-site list ignored | the per-site test **failed**, as required; restored |
| Whole extension suite (smoke, onboarding, surfaces, downloads, settings) | 26 passed; unit 7; Firefox smoke passed |
| **Real DebridPulse** (working tree with B6): connect → send → listed → Disconnect from the options page → the browser is gone from the real Connected browsers | **passed** |

**Not run (manual):**
- the popup's per-site switch: in automation, the popup opened as a tab is itself the active tab;
- the options page in Firefox.

**Not offered:** a language setting. Extension text follows the browser's language (`chrome.i18n`), which an extension cannot switch at runtime.
