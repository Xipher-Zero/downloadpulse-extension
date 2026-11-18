# WS-E2 — Submission surfaces

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9).

**Repository:** `Xipher-Zero/downloadpulse-extension`, branch `main`, base `3154047`.

**Authority:**
- PLAN.md §3.2–§3.4, §3.7, and decisions L11–L15, L20;
- spikes S1 (capture by background fetch) and S3 (page action, video detection, top-layer button);
- WS-E0 Gate 1 (host permissions: check, then re-grant);
- DebridPulse `BROWSER_CLIENT.md` §2a, the browser jobs API at `ceb1b63b`.

## 1. Mission

A connected browser sends a download to DownloadPulse in one gesture, from wherever the person is:
- **right-click** on a link or a selection;
- the **hover icon** beside a download link;
- the **video-player button**;
- in Firefox, the **URL-bar icon**.

`.torrent`, `.nzb` and `.meta4` links are fetched with the person's own login for that site, and their contents are sent.

## 2. Locked behaviour

| # | Behaviour |
|---|---|
| B1 | **Right-click on a link** → "Download with DownloadPulse": the link is sent, captured first if it is a `.torrent`/`.nzb`/`.meta4` (B5). |
| B2 | **Right-click on a selection:** every `http(s)` URL and `magnet:` URI in the selected text is extracted (fuzzy: surrounding punctuation and brackets are trimmed). The http(s) URLs are sent as one `links` batch (at most 100); each magnet is sent on its own. |
| B3 | **Hover icon:** when the pointer is over a link that is a download candidate (PLAN §3.3 as amended: `magnet:`; a download file extension; a `download` attribute; a non-HTML `type`), or over plain text that is such a URL, a small button appears. It sits to the right of the link (left in RTL), in the top layer, in a closed shadow root, and never over the link. It is removed when the pointer leaves. Click → B1's path. **No network request** decides whether a link is a candidate. |
| B4 | **Video button:** over a `<video>` (through overlays and open or closed shadow roots; in any frame, S3), a top-layer button in the video's top-right corner. Click → the **frame's own URL** (the embed, or the page) is sent as a link; core decides (Media Downloads). **Firefox URL-bar icon:** shown on a tab once its content script has seen a video there; click → the page URL. |
| B5 | **Capture (S1):** the background fetches the file with the person's own cookies for that site (`credentials: "include"`), within DownloadPulse's limits (torrent and `.meta4` 16 MB, NZB 8 MB). An HTML answer is refused as "that site returned a web page, perhaps a sign-in page" instead of being sent. The bytes are sent base64 as `torrent`/`nzb`/`metalink`. **The file URL (which may hold a passkey) is never sent to DownloadPulse, stored or logged.** |
| B6 | **Feedback:** each submission confirms quietly with a short in-page toast in the frame it came from ("Sent to DownloadPulse"), or says why not, from the server's typed code: private-LAN confirmation required, collection item, limit reached, not connected, and so on. Where no content script can run, the toolbar badge flashes ✓ or !. |
| B7 | **Idempotency:** each gesture is one submission with one fresh key. A network retry inside that gesture reuses the key, so it never becomes a second download. |
| B8 | **Only when connected:** while not connected, the menu item and the buttons don't appear. Content scripts ask the background whether the extension is connected, and never read storage. |
| B9 | **Permissions:** `<all_urls>` host access (capture from any site, S1); the content script on all URLs, in all frames; `contextMenus`; in Firefox, `page_action`. Before capture, `permissions.contains` is checked, and when the person has revoked access the toast says how to restore it (WS-E0 Gate 1). |
| B10 | **Secrets out of reach of content scripts (correction to WS-E1 B8):** the token and the pairing device code live in the extension origin's **IndexedDB**, which content scripts (page origin) cannot open. `chrome.storage` keeps only non-secret display state. A token stored by WS-E1 in `storage.local` is moved once and deleted there. |
| B11 | **All text** comes from `_locales/en`. Every in-page element is in a closed shadow root and carries its own styles. |

## 3. Invariants

- No DebridPulse change.
- WS-E0 and WS-E1 behaviour is kept, except the B10 storage correction.
- The content script makes **no network request**, reads no storage and holds no secret.

## 4. Qualification (Gate 7)

- **Unit:** URL extraction from selections; candidate classification; the capture decision (extension → kind).
- **Chromium e2e** against the fake DownloadPulse plus a fake "site" (in the namespace, as WS-E1):
  - the hover icon appears only on candidates, beside the link, and sends;
  - a `.torrent` that needs a cookie is captured and sent as `torrent`, with the cookie used and the URL not sent;
  - an HTML answer is refused;
  - the video button sends the frame URL;
  - not connected → no buttons;
  - the token is not readable by a content script (an extension-world script in the page's frame tries `chrome.storage.local`).
- **Not automatable, so manual:** the right-click menu (a native menu) and Firefox's URL-bar icon.

## 5. Gate record

**Gate 0–2 (2026-11-18).**
- **The secrets question:** `storage.local.setAccessLevel` is documented inconsistently: the Chrome reference lists it, MDN and a Chromium-extensions thread say session only, and that thread reports `onChanged` leaking to content scripts regardless.
- **Hence B10:** secrets live in the extension origin's IndexedDB, which content scripts (page origin) cannot open, with a one-time migration of a WS-E1 token.

**Defects found and fixed during Gates 3–7:**
1. **The background's sender guard** used `sender.tab`, so the popup opened as a tab couldn't connect. It now checks whether the sender is one of the extension's own pages, by URL.
2. **The hover icon read `event.composedPath()` after an `await`,** when it is already empty, so anchor links were never detected. The path is now captured during dispatch.
3. **The hover button's constant SVG used `innerHTML`,** flagged by `web-ext lint` (`UNSAFE_VAR_ASSIGNMENT`). It's now built with DOM calls.

**Gate 7:**

| Check | Result |
|---|---|
| `npm run check` | 0 errors; the known Android-only warning |
| Unit (URL extraction, candidates, capture kinds, plus WS-E1's) | 7 passed |
| Chromium e2e, surfaces (8; fake DownloadPulse + fake site, private network namespace) | 8 passed |
| What those 8 prove | the hover icon only beside download links (not `/about`), beside not over, sends links and magnets with a fresh UUID key; a cookie-guarded `.torrent` captured with the site cookie, sent as `torrent` with exact bytes, the passkey URL never sent, no cookie to DownloadPulse; a sign-in page answering for a `.torrent` refused, nothing sent; a plain-text URL's icon sends it; the video button sends the page address from inside the player's corner; not connected → nothing offered; the token absent from `chrome.storage` and present in IndexedDB; a WS-E1 token migrated and still working |
| Chromium e2e, onboarding (WS-E1, 7) + smoke (1) | passed (16 in total with the above) |
| Mutation: capture with `credentials: "omit"` | the cookie case **failed**, as required; restored |
| **Real DebridPulse** `ceb1b63b`, end to end: connect → sign in → approve → hover a link → DebridPulse records the request, its `credential_id` equal to this browser's ID in Connected browsers | **passed** |
| Firefox smoke | installed, no extension errors |

**Not run (manual before release):**
- the right-click menu (a native menu, not automatable), for links and selections;
- Firefox's URL-bar icon;
- the in-page surfaces in Firefox;
- the toast's wording (inside a closed shadow root; the refusal mapping is code-reviewed).

**Known limit:** an indexer's NZB link without `.nzb` in its path (`/api?t=get&id=…`) is not recognised for capture and is sent as a plain link (unit-tested as such). Recognising it would need a network probe, which B3 forbids, or a content-type check after a fetch. That's a later decision.
