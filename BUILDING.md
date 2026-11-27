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

## Releasing

Release zips are built by GitHub Actions, never by hand (`.github/workflows/release.yml`). The version moves in lockstep with DownloadPulse.

1. On `main`, set `version` in `package.json` (and `package-lock.json`) to the release's version, and merge it.
2. Tag that commit and push the tag:

   ```sh
   git tag -a v1.0.8 -m "DownloadPulse extension 1.0.8"
   git push origin v1.0.8
   ```

3. The Release workflow then:
   - refuses a tag that doesn't match `package.json`'s version;
   - runs `npm ci --ignore-scripts`, `npm run check` and `npm test` (unit, end-to-end and smoke);
   - runs `npm run package`, and writes `SHA256SUMS` over the three zips;
   - attests the zips' build provenance with GitHub's attestations;
   - attaches the zips and `SHA256SUMS` to a **draft pre-release** for the tag.

   Re-running it replaces the files on a release that is still a draft. It never touches a published release.
4. Check the draft, then publish it yourself. Uploading the same zips to AMO and the Chrome Web Store is also by hand.

## Verifying a release

Download the zips and `SHA256SUMS` from the GitHub release into one folder, then:

```sh
sha256sum -c SHA256SUMS
gh attestation verify downloadpulse-firefox-1.0.8.zip \
  --repo Xipher-Zero/downloadpulse-extension \
  --signer-workflow Xipher-Zero/downloadpulse-extension/.github/workflows/release.yml \
  --source-ref refs/tags/v1.0.8
```

Run `gh attestation verify` for each zip: `downloadpulse-chromium-<version>.zip`, `downloadpulse-firefox-<version>.zip` and `downloadpulse-source-<version>.zip`. It checks that the zip was built by this repository's Release workflow from that tag.

A build from source is checked the same way: `npm ci --ignore-scripts && npm run build` gives `dist/firefox` matching the Firefox zip's content, file for file.
