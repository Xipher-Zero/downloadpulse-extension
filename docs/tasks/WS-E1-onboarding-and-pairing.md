# WS-E1 — Onboarding and pairing client

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9).

**Repository:** `Xipher-Zero/downloadpulse-extension`, branch `main`, base `c2efae5`.

**Authority:**
- PLAN.md §3.1, and decisions L4–L8, L19, L20, L28;
- WS-S1 (`debridpulse.browser/1`, `BROWSER_CLIENT.md` in DebridPulse at `ceb1b63b`), including its rule that **every request uses `credentials: "omit"`**;
- spike S2 (background lifetime).

## 1. Mission

From the toolbar popup, a person connects this browser to their DownloadPulse, local or remote, by approving it on the server. The extension ends up holding its own browser token, verified against the server's protocol.

## 2. Locked behaviour

| # | Behaviour |
|---|---|
| B1 | **Not connected:** the popup shows one button, "Connect to a DownloadPulse instance". |
| B2 | **Connect** asks the browser for access to `http://127.0.0.1:8095` and `http://localhost:8095` (L20: at connect time, on the user's click), then probes `/api/health` on both. A DownloadPulse answer starts pairing against it. |
| B3 | **Not found:** two choices. "Check again" probes again. "Connect to a server" takes a URL (no scheme: `https://` is tried, then `http://`), asks for access to that origin only, checks for DownloadPulse, then pairs. |
| B4 | **Pairing** runs in the background (the popup closes when a tab opens). The extension: (1) starts a pairing with this browser's name (for example `Firefox on Linux`); (2) opens the server's approval page; (3) polls at the server's interval; (4) on approval, verifies the token with `GET /api/browser/v1/session`. Then it stores the server, token and the session's names. While waiting, the toolbar badge shows the state, and each update keeps the background alive (S2). |
| B5 | **Version check (L19):** a server that lacks the pairing API (`404`), or whose session doesn't name `debridpulse.browser/1`, is refused with "This DownloadPulse server is too old for browser connections; update it". |
| B6 | **Errors are stated plainly:** not reachable; not DownloadPulse; too old; refused (denied); expired; certificate not trusted (D7: open the server in a tab and accept its certificate, then connect again); permission declined. The popup always offers a way back to the start. |
| B7 | **Connected:** the popup shows the server and the account and browser names. No downloads list (WS-E3), no settings (WS-E4). |
| B8 | **Every request** to DownloadPulse uses `credentials: "omit"`, a timeout, and no third-party request. The token lives only in `chrome.storage.local`. A pending device code lives only in `chrome.storage.session`. Neither is ever logged. |
| B9 | **All text** comes from `_locales/en` (other languages: WS-E5). |

## 3. Preservation invariants

- WS-E0's structure, build, tests and CI are kept.
- Permissions grow only by `optional_host_permissions`, requested per origin on a click. There is still no `<all_urls>` (WS-E2 adds it with capture).
- No DebridPulse change.

## 4. Evidence anchors (verified at Gate 0)

- **Server contract**, DebridPulse `ceb1b63b`:
  - `POST /api/browser/v1/pairings` `{client_name}` → `{protocol, device_code, user_code, verification_path, expires_in, interval}`;
  - `POST …/pairings/poll` `{device_code}` → `{status}`: `pending`, `slow_down`, `denied`, `expired`, or `approved` with `{token, token_id, label}`;
  - `GET /api/browser/v1/session` → `{protocol, token, account, capabilities}`;
  - `/api/health` → `{status, version}`.
  - Extension origins are admitted only under `/api/browser/v1/`; `/api/health` is a GET, so it needs no exemption.
- **S2:** extension API calls keep the background alive; `fetch` alone does not.

## 5. Ownership

| Path | Owns |
|---|---|
| `src/shared/server.ts` | server URL normalization; the one DownloadPulse HTTP client (`credentials: "omit"`, timeouts, typed failures) |
| `src/shared/connection.ts` | the stored connection and pairing state (`chrome.storage`), its one reader and writer |
| `src/background/pairing.ts` | the pairing flow: start, approval tab, poll loop with badge, verification |
| `src/background/index.ts` | the message router (`probe`, `connect`, `cancel`) |
| `src/popup/` | the popup's states, rendered from storage; it acts only by messages |

## 6. Qualification (Gate 7, focused)

- **Unit** (`node --test`, built by esbuild): URL normalization; browser naming; error classification.
- **Chromium (Playwright), the extension loaded,** against a **fake DownloadPulse** (a small Node server speaking the contract above), covering:
  - local found → paired → connected;
  - not found → Check again;
  - remote URL;
  - denied;
  - expired;
  - too old (404);
  - wrong protocol.
- **Once against a real DebridPulse** (local, `ceb1b63b`), end to end, with approval in the real dialog.
- **Firefox:** the WS-E0 smoke test, plus `web-ext lint`.

## 7. Gate record

**Gate 0 (2026-11-18):** anchors in §4 verified against DebridPulse `ceb1b63b`.
- **Found on this host:** the operator's installed DebridPulse desktop Flatpak listens on `127.0.0.1:8095`.
- **The tests never touch it:**
  - the onboarding suite refuses to run while 8095 is held by anything but its own fake (proven: outside the namespace it fails with that message);
  - locally it runs in a private network namespace (`unshare -rn`);
  - CI runners have the port free.

**Design notes (Gates 2–6):**
- **Local probe access:** `host_permissions` for `http://127.0.0.1/*` and `http://localhost/*` (install-time). The probe is core onboarding behaviour, and an install-time grant means no permission prompt automation cannot answer.
- **Remote servers:** `optional_host_permissions`, requested per origin on the click (L20). `<all_urls>` is still absent (WS-E2).
- **The pairing loop** runs in the background (opening the approval tab closes the popup). It updates the badge every tick, which shows the state and keeps the background alive (S2).
- **Errors are typed:** `probe()` distinguishes DownloadPulse, something else, unreachable, and an https failure (certificate, D7: stated as "accept its certificate in a tab, then connect again").

**Gate 7:**

| Check | Result |
|---|---|
| `npm run check` | 0 errors; the one known Android-only lint warning |
| Unit (`npm run test:unit`: URL normalization) | 3 passed |
| Chromium smoke + onboarding e2e against a fake DownloadPulse (7 cases: local found → paired → verified → connected; nothing local → Check again → named server; denied; expired; too old (404); wrong protocol; not DownloadPulse) | 8 passed |
| Mutation: `credentials: "include"` with a DownloadPulse session cookie present | **failed**: the cookie rode along; restored |
| Guard: run outside the namespace with 8095 held | **refused**, as designed |
| **Real DebridPulse** `ceb1b63b` on 8095 (namespace, disposable config): Connect → the real sign-in → the real Connect a browser dialog (code matched) → approved → popup verified "Administrator" | **1 passed** |
| Firefox smoke | installed, no extension errors |

**Not run:**
- **the pairing flow in Firefox:** automation can't drive an extension popup there. It's a manual check before release, and the proof of `chrome.*` promises in Firefox (carried from WS-E0) comes with it;
- **a real HTTPS server with a self-signed certificate:** D7's wording only.
