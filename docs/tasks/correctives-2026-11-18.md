# Correctives from the operator's first real-browser test (2026-11-18)

## 1. An older DownloadPulse on this computer trapped onboarding

**Seen:** Brave showed "Something went wrong while connecting", and Start again led back to the same local check, so a remote server could never be named.

**Cause:**
- The local probe found the operator's desktop DownloadPulse (a build from before the browser API).
- An older server refuses the extension's pairing start before routing, with `403 Forbidden origin`. The extension read only 404/405 as "too old".

**Fix:**
- 401, 403, 404 and 405 on the pairing start mean **too old**: a current DownloadPulse admits that request with no credential.
- **The failure screen offers "Or connect to a DownloadPulse server:"**, so a failing local instance never traps the person. The new key is translated into 18 locales and independently reviewed (ledgers updated).
- **Tests:** a `forbidden-origin` fake server; local too-old → choose a server from the failure screen → paired.

## 2. Media downloads named "watch" in the extension

**Seen:** a YouTube download was listed as "watch" while DownloadPulse showed its resolved title.

**Cause (the operator's trace, transfer 1307):**
- The extension named every link from its last path segment ("watch").
- The browser job view carries the client's own name.
- DownloadPulse's title is its **derived display name** (from the artifact: "The Game Awards Situation Exposed Everything [7IcsIdbPk1s].webm"), while `torrents.name` stays "watch".

**Fix:**
- **DebridPulse, adapter layer only (`external/service.py`):** a browser job's projection gains `name` = `TransferRepository.display_names`, the Downloads list's own title. Because it's in the projection, a change of title moves the revision and change cursor, so the browser's cursor-based polling sees it.
- **Extension:**
  - the list and notifications prefer `name`;
  - a send names the job only when the link ends in a real file name (no "watch").

**Operator's ruling:** DownloadPulse's own system notifications keep their behaviour. Only the extension follows the title.
