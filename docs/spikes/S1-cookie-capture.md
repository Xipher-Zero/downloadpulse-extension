# Spike S1 — Capturing a `.torrent`/`.nzb` with the user's login

**Question (PLAN §10, S1):** can the extension fetch a `.torrent`/`.nzb` file from a site that requires the user's login, with the user's cookies, in Firefox and in Chromium, under their third-party cookie rules? This settles PLAN L15 / §3.4.

**Status:** answered, 2026-11-17 (Arizona time). Evidence only; no product code.

**Harness:** [`spikes/s1/`](../../spikes/s1/) (throwaway; `run.sh` reproduces each run).

## Method

**A local "tracker"** (`server.py`):
- `/login` sets four session cookies, one per SameSite variant: `Lax`, `Strict`, `None; Secure`, and unspecified;
- `/file.torrent` answers with exactly which cookies arrived.
- It is reached under two hostnames, `127.0.0.1` and `localhost`, which are **different sites**. That gives a same-site file (page and file on `127.0.0.1`) and a cross-site file (page on `127.0.0.1`, file on `localhost`).

**A throwaway Manifest V3 extension** (Chromium: service worker; Firefox: event page) with host permissions for both hosts. On install it:
1. logs in on `localhost`, then on `127.0.0.1`, each as a top-level tab, as a person signs in to a tracker;
2. fetches both files **from its background script**, with `credentials: "include"`;
3. fetches both files **from a content script** running in the `127.0.0.1` page;
4. posts all results back to the server.

**Browsers:**
- Chromium 151: Playwright's build, extension loaded;
- Firefox 153: Playwright's build, via `web-ext`;
- **Firefox 160**: the stock Flathub build, via `web-ext`, temporary add-on, separate throwaway profile.

## Results

Cookies received by the "tracker", per fetch:

| Browser and cookie setting | Background, same-site | Background, cross-site | Content script, same-site | Content script, cross-site |
|---|---|---|---|---|
| Chromium 151, defaults | all four, including Strict | all four of that site's | all four | **blocked (CORS)** |
| Chromium 151, third-party cookies blocked | all four | all four | all four | **blocked (CORS)** |
| Firefox 153, defaults (Total Cookie Protection) | all four | all four | all four | **blocked (CORS)** |
| Firefox 153, all third-party cookies blocked (`cookieBehavior=1`) | all four | all four | all four | **blocked (CORS)** |
| **Firefox 160 stock**, defaults | all four | all four | all four | **blocked (CORS)** |

Host permission was granted in every run (`permissions.contains` true).

## Findings

1. **A background fetch carries the target site's own login cookies**, every SameSite variant including `Strict`, in both browsers. It holds even with third-party cookies blocked (Chromium) and with all third-party cookies blocked (Firefox). Both browsers treat an extension's request to a host it holds permission for as first-party to that host. CORS does not apply.
2. **A content-script fetch works only for a file on the page's own origin.** Cross-origin it is blocked by CORS in both browsers, so it is not a general mechanism.
3. **The capture mechanism for L15 is therefore the background fetch.** The extension fetches the file's URL from its background script, reads the bytes and uploads them to DownloadPulse. The file URL, which may carry a passkey, is neither sent nor kept (Rule D3).

## Consequences for the plan

- **Host permission for any site:** the background fetch needs host permission for the file's host, which can be any tracker or indexer. The extension therefore needs host permission for all sites, not only the content script's matches. Content-script `matches` do not grant fetch permission in Manifest V3. This costs nothing extra: the all-sites warning is already accepted for L12 and L14 (PLAN §3.7).
- **The DownloadPulse server's origin** is still requested at connect time (L20). It is then covered by the all-sites permission anyway, so that request may become a no-op. Settle this in WS-E0.

## Not tested; carried to the named workstream

| Item | Why it matters | Where |
|---|---|---|
| A **store-installed** Firefox add-on's host permissions | Firefox may treat Manifest V3 host permissions as granted by the user, not at install. These runs used temporary add-ons, which had them granted. If they are user-granted, onboarding must request them. | WS-E0 |
| **Firefox containers** and **private windows**; Chromium **incognito** | The background fetch uses the default cookie store, not the tab's container or private store. A user logged in to the tracker only inside a container or a private window would not be recognised. Options: fetch from the content script when the file is on the page's own origin (it uses the tab's store); otherwise say why the capture failed. | WS-E2 |
| Real HTTPS sites, redirects to another host, anti-bot challenges (for example Cloudflare) | The harness used plain HTTP on loopback with no redirect and no challenge. A clearance cookie is a cookie and should travel the same way, but this is unverified. | WS-E2 |
