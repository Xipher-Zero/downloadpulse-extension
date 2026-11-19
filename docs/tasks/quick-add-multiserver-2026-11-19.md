# Quick Add, and connections kept by server (2026-11-19)

## Quick Add (operator)

**Layout:** above "Sent Downloads:" there are two rows:
- the title "Quick Add", left-aligned;
- a field with DownloadPulse's primary Add button inside it, at the end, vertically centred.

**Sending:** what's typed goes as a selection does, through the same gate, transport rules, captures and same-send key reuse (`quickAdd`, `sendText`).

**The result:** shown on the title row's end for 4 s, green or red (operator's choice of the two mockups):
- on success the field empties;
- on failure it keeps the text;
- the row has a fixed height, so nothing moves (a test measures it).

## Multi-server preparation (operator; deferred UI)

Nothing visible changes and one server is used at a time, but nothing assumes there is only one:

- **Connections:** `connections`, a map by server origin, plus `activeServer`. An earlier build's single `connection` is moved in on first read.
- **Tokens:** one IndexedDB slot per server (`token@<origin>`). The old single `token` slot, and WS-E1's token in `chrome.storage`, are moved to it.
- **Session state per server** (`server-state.ts`, `<name>@<origin>`): jobs, cursor, notified, reach, cleared.
- **Monitor:** polls every usable connection. A 401 forgets only that server.
- **`forgetConnection(revoked, server)`:** forgets one server's token, connection and state. If that was the one in use, another becomes it.
- **Callers:** they name their server when they read the token, so a change of the active server mid-call can't mix two servers.

**Races found and fixed:**
- an internet-HTTP connection is settled first on every redraw, each step safe to repeat, so a popup closed or reloaded half-way leaves nothing half done;
- the popup now forgets that connection by name.

## Proof

- **e2e:**
  - Quick Add's layout, and its result row not moving;
  - nothing found, and a link sent;
  - the previous build's connection and token moved, and still used;
  - forgetting one server keeping another's connection, token and downloads;
  - the internet-HTTP connection forgotten alone.
- **Full suite:** 66 cases, by exit code.

**Strings:** five, in 18 locales, reviewed; none corrected. "Magnet" had no earlier translation; the review judged each language's term.
