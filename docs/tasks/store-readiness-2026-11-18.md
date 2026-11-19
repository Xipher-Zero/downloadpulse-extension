# Store readiness (review of affeb5d, 2026-11-18)

The store review's findings, for Firefox Add-ons and the Chrome Web Store, and what was done.

## 1. Transport: no silent HTTPS-to-HTTP fallback
- **`serverAddress`** (`src/shared/server.ts`) replaces `candidateOrigins`.
  - **No scheme:** this computer over HTTP; any other host over **HTTPS only**.
  - **A typed `http://`:**
    - private network (RFC 1918, link-local, IPv6 ULA and link-local, `.local`, `.lan`, `.home.arpa`, `.internal`, single-label names): `lan-http`;
    - anything else: `public-http`.
- **Plain HTTP on a private network is a deliberate choice.** A screen ("Connect without encryption?", caution-gold status) explains that the connection key and downloads would cross the network unencrypted before **Connect without encryption**. The background refuses `lan-http` without that choice.
- **Plain HTTP across the internet is refused** (`failureInsecureRefused`).
- **An unreachable private address typed without a scheme** gets `failureHttpsOnly`, which says how to choose `http://`.
- **Captures:** an HTTPS link redirected to HTTP is refused, so the file and the site sign-in never cross the network in the clear.
- **DownloadPulse requests** already refuse redirects (`redirect: "error"`).

## 2. Disclosure and consent
- **A new page** between the first screen and connecting (operator: its own page, not a change to the reviewed pages):
  - what DownloadPulse receives (links, captured files with the site sign-in and never its cookies, video page addresses, background progress checks), what DownloadPulse records and what stays in the browser;
  - the privacy-policy link;
  - an optional **device-name** checkbox, off by default;
  - **Agree and continue**.
- **The agreement is recorded** (`src/shared/consent.ts`, `CONSENT_VERSION`), and the background pairs only with it. A changed disclosure is asked again.
- **The device name** ("Brave on Linux") is sent only with that box ticked and, in Firefox, its optional technical-data consent (requested when ticked). Otherwise the connection is named "Browser" (operator).
- **`PRIVACY.md`** is the one policy, linked from the disclosure page and the settings. Each claim was checked against every request and stored item in the code.

## 3. Permissions
- `<all_urls>` is narrowed to `http://*/*` and `https://*/*`, for the host permissions and the content script.
- Frames are kept, for embedded players and links.
- Each permission is justified in `docs/store/PERMISSIONS.md`.
- All code is local.

## 4. Firefox and Chrome specifics
- `incognito: "not_allowed"` in both.
- **Firefox `data_collection_permissions`:** required `browsingActivity` and `websiteContent`; optional `technicalAndInteraction`.
- **The permanent Gecko ID** is set at submission (operator, deferred).
- **Chrome:** single purpose, permission justifications and data-use answers in `docs/store/CHROME_WEB_STORE.md`.
- **AMO notes:** `docs/store/FIREFOX_AMO.md`.

## 5. Distribution
- The GPL `LICENSE` is in both packages.
- `npm run package` also writes `downloadpulse-source-<version>.zip` (`git archive`, lockfile included). `BUILDING.md` has the reproducible build.
- `docs/store/REVIEWERS.md`: steps to pair, send and revoke. The test instance and its disposable credentials are the operator's to fill in.
- The README is brought up to date.

## Proof
- **Unit:**
  - addresses without a scheme use HTTPS except this computer's;
  - the private versus public plain-HTTP classes, with edge addresses;
  - only http(s), no credentials;
  - private hosts.
- **e2e:**
  - the disclosure comes before anything is sent;
  - Back works;
  - the connection is named "Browser" by default, and after the device-name choice, after the browser and system;
  - agreeing is remembered;
  - plain HTTP on a private network shows the warning (the address in the literal colour), and Back works;
  - plain HTTP across the internet is refused;
  - an unreachable private address without a scheme gets the HTTPS hint.
- **Lint:** the Firefox manifest declares the data categories, `incognito`, and http(s)-only access; lint is clean apart from the old Android warning.
- **Packaging:** both packages carry `LICENSE`, and the source archive carries the lockfile.

**Not proven here:**
- an HTTPS-to-HTTP redirect on a real capture (the test fixtures serve plain HTTP only);
- Firefox's optional-consent prompt (Playwright doesn't drive Firefox extensions here).

## Localization
14 new strings in 18 locales, independently reviewed; 4 corrected (it, pl, tr, hi).

The reviewer also noted where the disclosure page summarizes `PRIVACY.md` rather than repeating it. These are left for the operator's iteration on the screen:
- `.meta4` links aren't named;
- it says "the file" where the policy says "the file and its name";
- the progress checks while the menu is open, and the theme request, aren't mentioned;
- "what stays" names the key and settings, not every stored detail;
- the user-triggered requests aren't listed.

## Second review (of e56ed58), fixed

1. **A capture followed an insecure redirect before refusing it.**
   - **The capture transport rule** (operator's choice) is decided before any request:
     - HTTPS;
     - or plain HTTP only on this computer or the private network;
     - never plain HTTP across the internet (`sendCaptureInsecure`).
   - **No redirect is followed** (`redirect: "manual"`): a browser hides where one leads until it's followed, so a redirecting link is refused (`sendCaptureRedirect`, which points to Quick Add).
   - **Proof:** a fixture link redirects to another address with a key in its query. The extension refuses it and the target is never requested. With redirects followed again, the test fails.
2. **Saved connections bypassed the consent and transport rules.**
   - `connectionState` (`ok`, `consent`, `plain-http`, `insecure`) gates the connection key at its one reader, `token()`. A held connection sends nothing:
     - no polling, no theme refresh, no send, no controls, no Open DownloadPulse;
     - no in-page buttons and no menu items.
   - **The popup settles it:**
     - `consent`: the disclosure page; agreeing unlocks the same connection, with no new pairing;
     - `plain-http`: the warning for that server; continuing records the choice;
     - `insecure`: forgotten locally, and the refusal shown.
   - A changed `CONSENT_VERSION` now holds already-paired browsers too.
   - **The request helper refuses plain HTTP across the internet,** whatever asks.
   - **Proof:**
     - a connection whose agreement is removed stops polling and the theme refresh until "Agree and continue", which unlocks it with no new pairing;
     - a saved internet-HTTP connection is forgotten and refused;
     - unit: the helper refuses before any request.
3. **Firefox:** `authenticationInfo` (the connection key) is added to the required data categories, and the AMO notes are updated.
4. **Chrome and the policy:**
   - the draft declares personally identifiable information (the account display name);
   - `PRIVACY.md` no longer claims "nothing to any third party". It names the two kinds of place contacted (the person's DownloadPulse, and a website a file link is sent from), the capture rule, and how held connections behave.
5. **BUILDING.md:** reviewers stop at `npm run build`. `npm run package` works outside a Git checkout, writing the two packages and no source archive.

**Strings:** two new, in 18 locales, reviewed; 3 corrected (ru, uk, ja).

## Third review (of cd9556b), fixed

**Finding:** the send handler captured a file before checking the connection. A page's buttons may still be offered for up to 5 s (the frame's cached answer) after a connection is held, so a click then contacted the source site with the person's credentials, then reported "Not connected".

**Fix:** `sendUrl` and `sendSelection` check that the connection may be used (`token()`, the gate) before anything else. `send()` still checks again before submitting.

**Proof:** a button offered while usable is clicked after the connection is held. The source site is never asked, and no job is sent. Without the early check, the test fails.

## Error log: `dom.openOrClosedShadowRoot` on KeepLinks (2026-11-19)

**The error:** `Uncaught (in promise) TypeError: Error in invocation of dom.openOrClosedShadowRoot(HTMLElement element)`.

**Cause:** while looking for a video under the pointer, `shadowOf` passed every element there to Chromium's `chrome.dom.openOrClosedShadowRoot`, which accepts only HTML elements. An SVG icon, as on KeepLinks, made it throw. That ended the pointer handling for that movement and logged the error.

**Fix:** only an HTML element is looked into (only one can hold a shadow root), and the lookup cannot throw out of the handler.

**Proof:** a play icon (SVG) over the fixture's video still finds the video and shows its button. With the old lookup, the test fails.

**CI on c0eb8da** failed the test "a saved connection … over internet HTTP is forgotten": the popup showed the first screen instead of the refusal. The cause was a real race. The popup forgot the connection, then recorded the refusal, and a redraw prompted by the forgetting could read "no connection, no refusal" and finish last. The refusal is now recorded first, so every later redraw finds it.
