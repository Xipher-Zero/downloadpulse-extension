# DownloadPulse Extension

The DownloadPulse browser extension, for Firefox and for Chromium-based
browsers (Chrome, Edge, Brave and others), built from one codebase.

It sends downloads from the browser to a DownloadPulse server as an external
client of DownloadPulse's External Client Protocol (`debridpulse.external/1`):
it authenticates with an Integration token and submits demand, and
DownloadPulse decides everything after that.

**Status:** in development. The scaffold builds and tests both packages; there are no features yet.

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

`npm run build` writes unpacked extensions to `dist/chromium/` and `dist/firefox/`. To load one by hand:
- **Chromium:** `chrome://extensions`, then *Load unpacked*;
- **Firefox:** `about:debugging#/runtime/this-firefox`, then *Load Temporary Add-on*.

The plan is in [`docs/PLAN.md`](docs/PLAN.md); each workstream's task document is in [`docs/tasks/`](docs/tasks/).
