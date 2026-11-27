# DownloadPulse Extension

The DownloadPulse browser extension, for Firefox and for Chromium-based
browsers (Chrome, Edge, Brave and others), built from one codebase.

It sends the downloads you choose (links, files, video pages, selected links)
to your own DownloadPulse server or desktop application, and shows and
manages them from the toolbar. Turned on (1.0.2), the downloads the browser
itself starts go to DownloadPulse instead, with your sign-in on their site;
anything DownloadPulse can't take stays in the browser. It connects with DownloadPulse's browser
pairing (`downloadpulse.browser/1`; `debridpulse.browser/1` before the rename); DownloadPulse decides everything after that.

- Website: [downloadpulse.net/extension](https://downloadpulse.net/extension).
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

Releases are built from a pushed `v<version>` tag by `.github/workflows/release.yml`, with `SHA256SUMS` and build provenance: see [BUILDING.md](BUILDING.md#releasing) for the steps and how to verify a release.

`test/real` (outside `npm test`) connects to a real, disposable DownloadPulse on port 8095: `DP_REAL_USER=… DP_REAL_PASSWORD=… npx playwright test --config playwright.real.config.mjs`.

`npm run build` writes unpacked extensions to `dist/chromium/` and `dist/firefox/`. To load one by hand:
- **Chromium:** `chrome://extensions`, then *Load unpacked*;
- **Firefox:** `about:debugging#/runtime/this-firefox`, then *Load Temporary Add-on*.

The plan is in [`docs/PLAN.md`](docs/PLAN.md); each workstream's task document is in [`docs/tasks/`](docs/tasks/).
