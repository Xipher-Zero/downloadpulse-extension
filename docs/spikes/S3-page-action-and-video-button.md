# Spike S3 — Firefox URL-bar icon and the video-player button

**Question (PLAN §10, S3):**
- (a) can a Firefox page action be shown only on pages DownloadPulse can take, including hosts known only at runtime?
- (b) can a content script reliably find the video under the pointer, in in-page players, iframes and shadow DOM, and draw a button the site cannot cover?

This settles PLAN L14.

**Status:** answered, 2026-11-17 (Arizona time). Evidence only; no product code.

**Harness:** [`spikes/s3/`](../../spikes/s3/) (throwaway; `run.sh` reproduces each run).

## Method

**The fixture page** is served from `127.0.0.1`, `127.0.0.2` and `localhost` (three different sites). Each fixture is a 320×180 box:

| Fixture | What it models |
|---|---|
| `plain` | a bare `<video>` |
| `overlay` | a `<video>` under a full-size site overlay at `z-index: 2147483647` (custom player controls) |
| `shadow-open` | a `<video>` inside an open shadow root |
| `shadow-closed` | a `<video>` inside a **closed** shadow root |
| `iframe-same` | a `<video>` in a same-origin iframe |
| `iframe-cross` | a `<video>` in a **cross-origin** iframe (an embed) |
| `late` | a `<video>` inserted 2 s after load |
| `no-video` | a same-size `<div>` with no video (negative) |

**The content script** runs in all frames. Its detector, given a point:
- walks `elementsFromPoint`, so it sees beneath overlays;
- descends into shadow roots, open ones directly and closed ones through the content-script accessors: `element.openOrClosedShadowRoot` in Firefox, `chrome.dom.openOrClosedShadowRoot` in Chromium.

When it finds a video, it shows the button:
- in the **top layer** (the `popover` API);
- positioned in the video's top-right corner;
- in its own closed shadow root.

It then checks with `elementFromPoint` that the button is what is actually on top at that spot.

**Two probes:**
- **A point probe** at each fixture's centre, in every frame. Both browsers.
- **Real pointer movement** over each fixture: Playwright drives the mouse in Chromium, through the content script's `pointermove` handler.

**Page action (Firefox):**
- `page_action.show_matches` lists `127.0.0.1` (the static list);
- the background calls `pageAction.show()` for tabs on `127.0.0.2`, standing in for the server's supported-host list at runtime;
- `localhost` matches neither.

`pageAction.isShown()` is read for one tab of each.

**Negative check:** the same content script with both closed-root accessors removed. Only `shadow-closed` should fail.

**Browsers:**
- Chromium 151 (Playwright's build; automation is harmless here);
- Firefox 153 (Playwright's build, via `web-ext`);
- **Firefox 160**, the stock Flathub build.

## Results

| Fixture | Chromium 151: found / button on top | Firefox 153 | Firefox 160 (stock) | Chromium, real pointer |
|---|---|---|---|---|
| `plain` | yes / yes | yes / yes | yes / yes | yes / yes |
| `overlay` (max z-index) | yes / **yes** | yes / **yes** | yes / yes | yes / yes |
| `shadow-open` | yes / yes | yes / yes | yes / yes | yes / yes |
| `shadow-closed` | yes / yes | yes / yes | yes / yes | yes / yes |
| `iframe-same` (in the frame) | yes / yes | yes / yes | yes / yes | yes / yes |
| `iframe-cross` (in the frame) | yes / yes | yes / yes | yes / yes | yes / yes |
| `late` | yes / yes | yes / yes | yes / yes | yes / yes |
| `no-video` (negative) | **no** (correct) | **no** | **no** | no button |

**Negative check:** without the closed-root accessors, `shadow-closed` was **not found** in Chromium or in Firefox; every other fixture was unchanged. The accessors are what make closed shadow DOM work.

**Page action** (`isShown`), identical in Firefox 153 and 160:

| Tab | Shown |
|---|---|
| static match (`127.0.0.1`) | yes |
| runtime list (`127.0.0.2`, shown by `pageAction.show`) | yes |
| neither (`localhost`) | **no** |

Chromium has no `pageAction` API at all, as expected.

## Findings

1. **The Firefox URL-bar icon works for runtime host lists.** `pageAction.show(tabId)` shows the icon on any tab the background chooses, so it can follow the server's supported-host list (PLAN §5.6). A static `show_matches` isn't needed; at most it can cover a few always-known patterns.
2. **Finding the video works everywhere the plan needs:**
   - beneath overlays: `elementsFromPoint` sees through them;
   - in open and closed shadow DOM: closed roots through each browser's content-script accessor;
   - in same- and cross-origin iframes: the content script runs in the frame;
   - for videos added late: detection runs at pointer time, so there is no scan to miss them.
   - It produced no false positive on a video-sized box.
3. **The button can't be covered by the page.** Drawn in the top layer, it was on top of a site overlay at the maximum `z-index`, in both browsers.
4. **For an embed, the media URL is the frame's own URL** (`location.href` in the cross-origin frame, typically an embed URL); for a top-level player it is the page URL. The content script in that frame knows its URL, so no cross-frame access is needed.

## Not tested; carried to the named workstream

| Item | Why it matters | Where |
|---|---|---|
| **Clicking** the page action | Automation cannot click the URL bar. `pageAction.onClicked` is a documented event, but untested here. | WS-E2: a manual check |
| **Real pointer movement in Firefox** | Firefox was tested with the point probe only; Playwright cannot load extensions in Firefox. The same `pointermove` code path ran in Chromium. | WS-E2: a manual check |
| **Fullscreen** players | A fullscreen element sits in the top layer too; whether the button stays above it depends on top-layer order. | WS-E2 |
| **Real sites** (YouTube, Vimeo, Twitch, embeds, players drawing to `<canvas>`) | The fixtures model the structures, not specific sites. A canvas-only player has no `<video>`, and the button would not appear. | WS-E2 fixture set |
| **Frames inside frames** and `about:blank`/`srcdoc` frames | They need `match_about_blank`/`match_origin_as_fallback` and are untested. | WS-E2 |
