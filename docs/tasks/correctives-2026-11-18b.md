# Correctives from the operator's review of the dropdown (2026-11-18, round 2)

The operator reviewed the connected dropdown in Brave and listed corrections, held until the list was complete, then asked for them all in one round with the desktop application's window coming forward ("users would expect an integrated extension to open an already running app, not a webpage").

**Standing rule from this round:** the extension is a portal to DownloadPulse (submit, follow, withdraw requests), not DownloadPulse in the browser. It borrows DownloadPulse's look (glyphs, button family, colours, status semantics); its sizes and layout are its own.

## 1. A DownloadPulse found on this computer is offered, not paired

- **Before:** Connect found the local DownloadPulse and started pairing at once (an approval tab opened).
- **Now:** a `found` state says "DownloadPulse is running on this computer." and offers **Connect to DownloadPulse on this computer** or **Connect to a different DownloadPulse** (which reveals the server address field). Nothing is paired until the person chooses. Nothing found: the existing screen, unchanged.
- `pair-local` accepts only the two local origins the probe tries.

## 2. Settings inside the dropdown; a gear on the title row

- The gear (Lucide `settings`, DownloadPulse's glyph-button style) sits at the end of the title row. It opens the settings as a view of the dropdown, with a Back glyph; nothing opens outside it.
- The browser's own settings page for the extension (its Extensions screen) is the same view, built from the same `popup.html` at build time (`data-standalone="settings"`, `scripts/build.mjs`). `src/options/` is removed: one markup, one script.

## 3. Open DownloadPulse: a centred ghost button, and the desktop application comes forward

- The only action on its row once Settings moved: DownloadPulse's ghost button, centred.
- For DownloadPulse on this computer (any loopback origin), the extension first asks `POST /api/browser/v1/application/show`. The installed desktop application answers `{"desktop": true}` and its supervisor brings the window forward, exactly as the tray's Open does. A server (`{"desktop": false}`), an older DownloadPulse (`404`) or no answer opens the page in a tab, as before.
- Whether the window takes the focus is the operating system's decision: Windows and some Wayland desktops may flash the taskbar entry instead.

## 4. The connection header

- The status reads by colour: **green "Connected"** while DownloadPulse answers the list's polling; **yellow "Can't reach DownloadPulse"** while the extension is connected but DownloadPulse doesn't answer (the list keeps what was last seen); "Checking connection…" before the first answer, or when the last is older than 15 s.
- Server, Account and Browser sit behind a chevron to the right of the status, collapsed.
- DownloadPulse on this computer (any loopback origin, on any port) is shown as **"Locally installed instance"**, never its loopback address. A remote server keeps its URL.

## 5. "Sent Downloads:"

The list's title, in title case with its colon; each language follows its own title and colon conventions.

## 6. The per-site switch moved into the settings

"Download buttons on <site>" is in the settings' "On web pages" section, for the current tab's site.

## 7. The transfer rows

- The name is one line, cut with an ellipsis; its whole name is the tooltip.
- The status line holds the status, the compact estimate and, right-aligned, the controls: pause or resume (contextual) and Remove, as DownloadPulse glyph buttons (Lucide `pause`, `play`, `trash2`): pause and resume in DownloadPulse's blue tone, Remove in its danger tone. Remove asks for no confirmation in the extension.
- The estimate is compact: `ETA: H:MM:SS`, `M:SS` (for example `1:02:05`, `33:12`, `0:45`), `ETA: ∞` while DownloadPulse has no figure; no estimate, nothing shown. The time is a left-to-right isolate, so right-to-left languages keep its order. The long forms (`etaAbout`, `etaEstimating`) are retired.
- Status colours are DownloadPulse's transfer-list semantics: downloading green, queued and needs-attention blue, preparing the processing purple, paused yellow, failed red, done and removed uncoloured.

## 8. The progress row

The percent sits right of the bar, in a slot reserved at full width (tabular numerals), so the bar never changes length from no figure to 100%.

## 9. The person's DownloadPulse theme (operator's choice: palette IDs from DownloadPulse)

- DebridPulse's browser session answers `appearance: {mode, dark_palette, light_palette}` from its one owner (`services.account_appearance`).
- The extension stores it (not a secret), refreshes it when the dropdown opens (at most every 30 s) and draws the dropdown and the settings page in that mode and palette. The palettes' colours are carried by the extension (`src/shared/palettes.ts`, taken from DebridPulse `b91c6674`'s `design-tokens.css` and `ui-theme-palettes.css`). An unknown palette ID is drawn as its mode's native palette, so a new palette in DownloadPulse needs an extension update to be shown.
- Before any answer (not connected, or an older DownloadPulse), the pages follow the browser's light or dark preference.
- The in-page surfaces (hover icon, video button, toasts) are not themed yet.

## DebridPulse changes (branch 1.0.14)

- `api/browser_routes.py`: `POST /browser/v1/application/show` (classified browser-client in `auth/permissions.py`); `appearance` in the session answer.
- `application/desktop_control.py`: `request_show()` and the channel operation `show` (answered once).
- `desktop/supervisor.py`: the loop asks `show` every 0.5 s and, when asked, does the tray's Open (one shared `bring_forward`).
- No transfer core, provider, routing, candidacy or classification change.

## Localization

Ten keys changed or added (`listTitle` and nine new). Each was translated into the 18 locales, then independently reviewed by a different agent, which corrected one (Polish `popupUnreachable`: "no connection" read as not connected). The sources and review ledgers are updated; `etaAbout`/`etaEstimating` are removed everywhere.

## Proof

- **Extension:** unit tests (local vs server origins); e2e 33 cases (the found step and choosing a different DownloadPulse; the chevron and "Locally installed instance"; status colour green/yellow and back; Open opening a tab for a server and asking the desktop application otherwise; gear and Back staying inside the dropdown; the per-site switch in settings; row layout, compact ETA, glyph buttons and tones, one-line name with tooltip, reserved percent slot; the theme followed, changed and unknown); the Chromium and locale smoke tests; the Firefox smoke install; `web-ext lint` (its one warning, Firefox for Android's minimum version, predates this round).
- **DebridPulse:** a real desktop backend and the supervisor's real loop: a browser token's show brings a window closed to the tray back (show, focus) within 2 s, once; without a token, `401`. A mutation that ignores `show` in the supervisor fails it. The fence pins the new route as browser-client only; a server answers `{"desktop": false}`; the session's appearance follows a change.
- **Not proven here:** the real desktop window on each operating system, and the focus policies of Windows and Wayland. These need desktop installers.
