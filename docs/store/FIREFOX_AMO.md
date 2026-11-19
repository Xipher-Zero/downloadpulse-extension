# Firefox Add-ons (AMO): submission notes (draft for the operator)

- **Add-on ID:** `FIREFOX_ADDON_ID` in `src/manifest.mjs` is still the development placeholder. Set the permanent ID at submission (operator, 2026-11-18). It can never change afterwards.
- **Platforms:** desktop only (Firefox 140+). Do not list for Android.
- **Data collection** (`browser_specific_settings.gecko.data_collection_permissions`):
  - **Required:**
    - `authenticationInfo`:
      - the DownloadPulse connection key the extension receives, stores and sends back to the user's DownloadPulse;
      - a video's sign-in cookies for its own address, sent with that video to the user's DownloadPulse, only over HTTPS or to DownloadPulse on the same computer (on by default, switchable in Settings; never stored by the extension).
    - `browsingActivity`: the link and page addresses the user sends.
    - `websiteContent`: a captured `.torrent`, `.nzb` or `.meta4` file.
  - **Optional:** `technicalAndInteraction` (the browser and operating-system names that name the connection, asked only when the user ticks that option on the disclosure page).
  - Firefox shows its built-in consent at install, and for the optional item when it's chosen.
- **Private windows:** `incognito: "not_allowed"`.
- **Source code:** the package is bundled with esbuild. Upload the source archive built alongside it (`downloadpulse-source-<version>.zip`, from `git archive`, lockfile included) and point reviewers to `BUILDING.md`.
- **Policies:** use the public-listing policy and the updated agreement if submitting on or after 2026-12-01.
- **Reviewer notes:** see `docs/store/REVIEWERS.md`.
