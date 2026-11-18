# WS-E0 — Extension scaffold

**Task type:** implementation, gated (Gates 0–9; hard stop at Gate 9).

**Repository:** `Xipher-Zero/downloadpulse-extension`, branch `main`, base `5337982`.

**Authority:**
- PLAN.md §9 (WS-E0), L2, L3, L21, L25;
- spike S1's carried item: Firefox host-permission grant on a normal install.

## 1. Mission

Produce the empty, buildable, testable extension that every later workstream adds to:
- one TypeScript codebase;
- a build that writes the Chromium and Firefox packages;
- type checking and `web-ext lint`;
- a smoke test per browser;
- CI that runs all of it and keeps the two packages as artifacts.

**No features.**

## 2. Locked behaviour

| # | Behaviour |
|---|---|
| B1 | `npm run build` writes `dist/chromium/` and `dist/firefox/`, each a loadable unpacked Manifest V3 extension, from the same sources. |
| B2 | **Chromium:** background is a service worker (`background.service_worker`). **Firefox:** an event page (`background.scripts`) plus `browser_specific_settings.gecko`. Nothing else differs per browser. |
| B3 | The extension has a toolbar action with a popup, an options page and a background script. Each shows or does only a placeholder: the popup shows the product name and "Not connected". |
| B4 | **User-visible strings come from `_locales/<lang>/messages.json`** via `chrome.i18n`, including the manifest's `__MSG_…__`. English only in this task; the other 18 languages belong to WS-E5. No literal UI text in markup or code. |
| B5 | **Permissions:** `storage` only. Every later feature adds its own permission in its own task. |
| B6 | `npm run check` passes: TypeScript strict type check, `web-ext lint` on `dist/firefox` with zero errors, and the build itself. |
| B7 | `npm test` passes the smoke tests. **Chromium:** the service worker starts and the popup renders its placeholder strings. **Firefox:** the package installs as a temporary add-on, and no extension script raises an error (Firefox's console is routed to stdout and scanned). |
| B8 | `npm run package` writes both installable archives into `web-ext-artifacts/`. |
| B9 | CI (`.github/workflows/ci.yml`) runs check, test and package on push and pull request, and uploads both packages as artifacts. Actions pinned by full SHA. |
| B10 | GPL-2.0-or-later throughout: `package.json` licence field and an SPDX header in each source file. |

## 3. Preservation invariants

- `docs/` and `spikes/` are untouched, except for this task document and the PLAN revision log.
- Dependencies are pinned exactly, with the lock file committed. Development-only dependencies: no runtime dependency ships in the packages.
- Nothing reaches the network at runtime; no permissions beyond B5.

## 4. Evidence anchors (verified at Gate 0, 2026-11-17)

**Tool versions** (each published at least two weeks earlier):
- `typescript` 7.0.2 (2026-07-08);
- `esbuild` 0.28.2 (2026-08-08);
- `@types/chrome` 0.3.7 (2026-10-27);
- `web-ext` 10.8.0 (2026-10-15);
- `@playwright/test` 1.62.1, the version DebridPulse already pins and qualifies. 1.65.1 is four days old and excluded.

**Action SHAs**, the same commits DebridPulse's workflows pin:
- `actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` (v5);
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` (v7.0.1);
- `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0, released 2026-10-08).

**Spike findings relied on:** S1 (all-sites host permission, later), S2 (background lifetime, later), S3. None is exercised by the scaffold itself.

## 5. Ownership contract

| Path | Owns |
|---|---|
| `src/manifest.mjs` | the one manifest definition; per-browser differences only through B2. Plain JavaScript, because the build imports it directly. |
| `scripts/build.mjs` | the build: esbuild bundling, static copy, manifest write |
| `src/background/`, `src/popup/`, `src/options/` | each surface's entry point |
| `src/shared/` | shared helpers: the `chrome` namespace use, localization helper |
| `_locales/` | all user-visible text (B4) |
| `test/smoke/` | the two smoke tests |

**API namespace:** `chrome.*` with promises in both browsers; Firefox documents promise support for `chrome.*` under Manifest V3. No runtime polyfill. The scaffold calls only synchronous APIs (`chrome.i18n`), so **the first task to call an asynchronous API proves this in both browsers' smoke tests**.

## 6. Scope and prohibited work

**In scope:** B1–B10, plus the Firefox host-permission question carried from S1 (Gate 1).

**Prohibited:**
- features: onboarding, pairing, context menus, content scripts, notifications;
- any DebridPulse change;
- other languages;
- store submission.

## 7. Open item

- **D6 (Firefox add-on ID): INPUT REQUIRED before store submission**, not before this task. The scaffold uses a development ID, `downloadpulse-dev@downloadpulse.invalid`, defined in one place (`src/manifest.ts`) and marked as the one to replace.

## 8. Gates

| Gate | Content |
|---|---|
| 0 | Anchors above verified. |
| 1 | **The S1 carried question:** does Firefox grant Manifest V3 `host_permissions` to a normally installed (non-temporary) add-on, or must the user grant them? Evidence only; it decides how later tasks request host access, and adds nothing to this scaffold. |
| 2 | Design as §5; no alternatives needing operator decision. |
| 3–6 | Implement B1–B10. |
| 7 | Focused qualification: `npm run check`, `npm test`, `npm run package`; one run each, plus one negative check per smoke test (a broken entry point must fail it). |
| 8 | Self-review against this document. |
| 9 | **Hard stop:** packet to the operator; nothing committed or pushed before approval. |

## 9. Acceptance matrix

| Behaviour | Proof |
|---|---|
| B1, B2 | `npm run build`; both manifests inspected in the packet |
| B3, B4 | Chromium smoke test reads the popup's localized strings |
| B5 | manifests inspected; `permissions` is `["storage"]` |
| B6 | `npm run check` exit code 0 |
| B7 | `npm test` exit code 0; a negative run fails |
| B8 | `npm run package`; both archives listed |
| B9 | workflow file inspected. CI's first run happens after the push, so it is reported, not claimed. |
| B10 | `grep` for SPDX headers |

## 10. Gate record

**Gate 0 (2026-11-17):** anchors in §4 verified.

**Gate 1 (2026-11-17), the S1 carried question:**
- **Experiment:** a probe add-on placed as a normal (non-temporary) install in a fresh profile, with `xpinstall.signatures.required=false`. Firefox removed the unsigned package without registering it, because the build enforces signing as release Firefox does. A real normal install needs a signed package, which needs the AMO account (L24). The experiment is inconclusive by construction.
- **Documented behaviour instead:**
  - Firefox 127 and later list Manifest V3 `host_permissions` (and content-script matches) in the install prompt and **grant them at install**: [Mozilla bug 1889402](https://bugzilla.mozilla.org/show_bug.cgi?id=1889402), [MDN `host_permissions`](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions);
  - the user **can revoke them** at any time in about:addons ([Mozilla Add-ons blog, 2024-05-14](https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/));
  - **host permissions added by an update are not shown** to the user.
- **Consequences for later tasks**, not for this scaffold:
  1. the first store release declares every host permission the product needs, including `<all_urls>` (S1);
  2. every use of host access checks `chrome.permissions.contains` and, when it is missing, offers a re-grant from a user action (`chrome.permissions.request`). Revocation is normal, not an error.
- **Verify** with the first signed AMO build (WS-E6).

**Gates 3–6 (2026-11-17):** B1–B10 implemented, as in the packet.

**Gate 7 (2026-11-17)**, one run each:

| Check | Result |
|---|---|
| `npm run check` | exit 0: build; type check; `web-ext lint` 0 errors, 0 notices, 1 warning (below) |
| `npm test` | exit 0: Chromium 1 passed; Firefox installed, no extension errors |
| `npm run package` | exit 0: `downloadpulse-chromium-0.1.0.zip`, `downloadpulse-firefox-0.1.0.zip` |
| negative: popup script throws (Chromium) | **fails**, as required |
| negative: background throws (Firefox) | **fails**: the error is caught from stdout |
| negative: corrupt manifest (Firefox) | **fails**: "the add-on was not installed" |
| negative: a type error and a non-existent `chrome` API | `tsc` **fails** with TS2322 and TS2339 |

**Firefox minimum version:** `strict_min_version` is **140.0** (the current ESR), because `data_collection_permissions` is supported from Firefox 140.

**The one remaining lint warning:** Firefox for **Android** supports that key only from 142. Android is not a target (PLAN §4), and declaring `gecko_android` would advertise Android support, so the warning is recorded rather than suppressed.

**Gate 8 (2026-11-17):** self-review against this document.
- Three corrections were made to the document: the manifest file name, the scope of the API-namespace proof, and the exact wording of B7's Firefox proof.
- B9 (CI) has not run yet; its first run follows the push and is reported then.
