# Building the extension from source

The packages are built from this source with esbuild. The source archive and this repository contain everything needed; the build fetches nothing but the npm packages pinned in `package-lock.json`.

Requirements: Node.js 24 or later, npm.

```sh
npm ci --ignore-scripts      # the exact dependency versions in package-lock.json
npm run build                # writes dist/firefox and dist/chromium
```

**Reviewers:** stop here. `dist/firefox` is the Firefox package's content, file for file.

Maintainers, from a Git checkout, also run:

```sh
npm run package              # web-ext-artifacts/downloadpulse-{firefox,chromium}-<version>.zip, and the source archive
```

Outside a Git checkout (an unpacked source archive), `npm run package` writes the two packages and no source archive.

- `dist/firefox` is the Firefox package's content and `dist/chromium` the Chromium package's.
- The build is deterministic for a given source and lockfile.
- The one difference between two builds of the same commit is `version_name` (Chromium only), which records the commit.
