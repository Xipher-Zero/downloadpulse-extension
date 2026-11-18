# Spike S2 — Keeping the background alive while the ring animates

**Question (PLAN §10, S2):** does an icon-animation loop keep Firefox's Manifest V3 event page alive for its duration, as it is expected to keep a Chromium service worker alive? This settles PLAN L17 and §3.5.

**Status:** answered, 2026-11-17 (Arizona time). Evidence only; no product code.

**Harness:** [`spikes/s2/`](../../spikes/s2/) (throwaway; `run.sh` and `run-chromium-raw.sh` reproduce each run).

## Method

**The oracle doesn't keep the background alive.**
- On install, the background script picks a random instance ID, sends one start report, sets an alarm for 105 s, and runs its loop for 90 s with **no network calls** of its own (except in the `poll` variant, which is what is under test).
- The alarm wakes the background and reports its instance ID.
  - **The same ID** means the background stayed alive throughout.
  - **A new ID** means the browser stopped it and the alarm started a fresh one.

**Variants**, run separately:

| Variant | Loop every | What it does each step |
|---|---|---|
| `none` (control) | 1 s | counts in memory only |
| `icon10` | 100 ms | `action.setIcon` with a rotated ring, 10 frames per second |
| `icon1` | 1 s | the same, 1 frame per second |
| `poll` | 2 s | fetches a status endpoint, no icon update |

**Browsers:**
- Firefox 153: Playwright's build, via `web-ext`;
- **Firefox 160**: stock Flathub build, via `web-ext`; the control and `icon1` only;
- Chromium 151: launched **directly, with no automation connection**.

A first Chromium run under Playwright kept even the control alive: its DevTools connection to the service worker prevents termination. That run is invalid and is excluded.

## Results

| Variant | Chromium 151 | Firefox 153 | Firefox 160 (stock) |
|---|---|---|---|
| `none` (control) | stopped | stopped | stopped |
| `poll` (fetch every 2 s) | **stopped** | **stopped** | — |
| `icon1` | alive for all 90 s | alive | alive |
| `icon10` | alive for all 90 s | alive | — |

Every control was stopped, so each run exercised the browser's idle termination.

## Findings

1. **Updating the toolbar icon keeps the background alive in both browsers**, at 10 frames per second and at 1. In Firefox and in Chromium, an extension API call resets the idle timer.
2. **Polling the server alone does not.** A `fetch` resets neither browser's idle timer. A background that only polls would be stopped within about 30 s and lose its loop.
3. **Design for L17 / §3.5:**
   - while at least one download is active, one loop advances the ring frame (calling `action.setIcon`) and polls the server; the icon calls keep the background alive;
   - when nothing is active, the loop ends, and the browser stops the background after its idle timeout;
   - between sessions, an alarm or the next user action starts it again.
   - **No keep-alive tricks are needed.**
4. **The state must survive a stop.** The loop's knowledge of active jobs lives in memory only while running. Anything that must outlast a stop (the change cursor, the jobs last shown) belongs in `storage.local` or `storage.session`.

## Not tested; carried to the named workstream

| Item | Why it matters | Where |
|---|---|---|
| Downloads lasting **hours** | The runs lasted 90 s. Chromium also enforces a 5-minute limit on any single event's handling; a loop not tied to an event should be exempt, but this is unverified. | WS-E3: run once for 15 min in each browser |
| **The browser restarts mid-download** | The loop must resume from stored state on startup. | WS-E3 |
| Battery and CPU cost of the animation | At 10 fps the icon is redrawn constantly. A low rate (for example 4 fps) may look as smooth. | WS-E3 |
