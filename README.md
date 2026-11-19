# DownloadPulse Extension

The DownloadPulse browser extension, for Firefox and for Chromium-based
browsers (Chrome, Edge, Brave and others), built from one codebase.

It sends the downloads you choose (links, files, video pages, selected links)
to your own DownloadPulse server or desktop application, and shows and
manages them from the toolbar. It connects with DownloadPulse's browser
pairing (`debridpulse.browser/1`); DownloadPulse decides everything after that.

- Privacy: [`PRIVACY.md`](PRIVACY.md).
- Building from source: [`BUILDING.md`](BUILDING.md).
- Store notes: [`docs/store/`](docs/store/).

## Licence

DownloadPulse Extension is free software: you can redistribute it and/or
modify it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 2 of the License, or (at your
option) any later version. See [`LICENSE`](LICENSE).

## Development

Requirements:
- Node.js 24 or later;
- Firefox for the Firefox smoke test: Playwright's (`npx playwright install firefox`) is used by default; `FIREFOX=/path/to/firefox` picks another.

```sh
npm ci --ignore-scripts
npx playwright install chromium firefox
npm run check     # build, TypeScript type check, web-ext lint (Firefox)
npm test          # smoke tests: Chromium (Playwright), Firefox (web-ext)
npm run package   # web-ext-artifacts/downloadpulse-{chromium,firefox}-<version>.zip
```

The onboarding tests (`test/e2e`) need `127.0.0.1:8095` to themselves and refuse to run while a real DownloadPulse holds it. On a computer running DownloadPulse, run them in a private network namespace (Linux):

```sh
unshare -rn sh -c 'ip link set lo up && npm test'
```

`test/real` (outside `npm test`) connects to a real, disposable DownloadPulse on port 8095: `DP_REAL_USER=… DP_REAL_PASSWORD=… npx playwright test --config playwright.real.config.mjs`.

`npm run build` writes unpacked extensions to `dist/chromium/` and `dist/firefox/`. To load one by hand:
- **Chromium:** `chrome://extensions`, then *Load unpacked*;
- **Firefox:** `about:debugging#/runtime/this-firefox`, then *Load Temporary Add-on*.

The plan is in [`docs/PLAN.md`](docs/PLAN.md); each workstream's task document is in [`docs/tasks/`](docs/tasks/).
