# WS-E3 — Downloads list, controls, the ring, notifications

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9).

**Repository:** `Xipher-Zero/downloadpulse-extension`, branch `main`, base `2614e8b`.

**Authority:**
- PLAN.md §3.5, and decisions L16–L18, L27;
- spike S2 (background lifetime);
- DebridPulse `BROWSER_CLIENT.md` §2a, the browser jobs API at `ceb1b63b`.

## 1. Mission

The popup lists the downloads **this browser** sent, with:
- state;
- progress;
- a labelled ETA;
- one pause/resume toggle;
- Remove.

While any of them is active, the toolbar icon shows a rotating ring. Completion, failure and needs-attention each raise a browser notification.

## 2. Locked behaviour

| # | Behaviour |
|---|---|
| B1 | **One monitor** in the background reads `GET /api/browser/v1/jobs` by change cursor (`after`) into a non-secret cache in `chrome.storage.session`. It runs while any cached job is unsettled, or while the popup is open, every 2 s, and stops when neither holds. It starts: after a send; when the popup opens; at browser start; and from a one-minute alarm while unsettled jobs exist (the background may have been stopped). |
| B2 | **The ring:** while at least one job is active (`accepted`, `queued`, `processing`, not paused), the toolbar icon is redrawn as a rotating ring (OffscreenCanvas, about 8 frames per second). Those icon updates keep the background alive (S2). Otherwise it is the static icon. |
| B3 | **The list** (popup, when connected), newest first, each row: the name; the state in words; a progress bar and percent (`progress.effective.percent`, else `percent`); the ETA, **labelled as an estimate** ("about 5 min left", "estimating…" when indeterminate, nothing when there is none; L27); a pause/resume toggle (only while unsettled; *resume* when this browser paused it, `paused_by: client`); Remove. Settled rows stay, marked done, failed or removed. |
| B4 | **Controls:** pause/resume sends `{kind, request_key}` (a fresh UUID). A declined control is said in words beneath the row: `shared_interest` → "Other requests need this download, so it can't be paused from here"; `globally_paused`; `paused_independently`; `already_settled`. Remove sends withdraw; the row then reads "Removed". |
| B5 | **Notifications** on a job's *transition* into: completed ("Downloaded: name"); failed ("Failed: name"); needs attention (`actionability: operator` while unsettled, "Needs attention in DownloadPulse: name"). Once per job and state. Clicking one opens DownloadPulse's Downloads in a tab (an extension cannot open its own popup from a notification). |
| B6 | **Display names:** every send names its job (`display_name`): a link's decoded file name, a magnet's `dn`, a captured file's name. |
| B7 | **Permissions:** `notifications`, `alarms`. |
| B8 | **All text** comes from `_locales/en`. Numbers and durations use `Intl` in the browser's language. |

## 3. Qualification (Gate 7)

**Chromium e2e** against the fake DownloadPulse (now serving the job list, controls and withdraw, with jobs a test can move through phases):
- the list shows a sent job with its name, state, percent and ETA label;
- pause → paused / resume → running;
- a declined pause shows its reason;
- Remove → removed;
- completion and failure each raise **one** notification (`chrome.notifications.getAll`);
- the monitor polls while a job is active and stops once all are settled (the fake records the polls).

**Manual:** the ring's look, and notification clicks.

**Real DebridPulse:** a sent link is listed with its real phase.

## 4. Gate record

**Recorded deviation:** PLAN §3.5 says a notification click "opens the dropdown". An extension cannot open its own popup from a notification (Chromium allows `action.openPopup()` only with a user gesture or by policy). A click opens DownloadPulse's own page on the connected server instead (B5).

**Gate 7:**

| Check | Result |
|---|---|
| `npm run check` | 0 errors; the known Android-only warning |
| Unit | 7 passed |
| Chromium e2e, downloads (5; fake DownloadPulse, private network namespace) | 5 passed |
| What those 5 prove | a hover-sent download listed as `archive.zip` (B6 display name), with state, `42%` (`effective` over `percent`), "about 5 min left", and "estimating time left" when indeterminate; pause then resume (fresh keys) and "Paused from this browser"; a declined pause shows the `shared_interest` sentence; Remove → "Removed", controls gone; completion raises exactly one notification (`dp:<id>:completed`), a further change of that job none; the monitor keeps polling with the popup closed while a job is active, and stops once all are settled |
| Mutation: the monitor's stop condition removed | the lifetime test **failed**, as required; restored |
| Whole suite (smoke, onboarding, surfaces, downloads) | 21 passed |
| **Real DebridPulse** `ceb1b63b`: connect → hover-send → the popup lists `file.iso` in a real state | **passed** |
| Firefox smoke | passed |

**Not run (manual before release):**
- the ring's appearance (an icon cannot be read back);
- notification clicks;
- failure and needs-attention notifications in a real browser session (the transition logic is the same as completion's, which is tested);
- the list in Firefox.
