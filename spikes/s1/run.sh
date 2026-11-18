#!/bin/sh
# Spike S1 harness (throwaway; not product code). Needs python3, a Firefox
# binary, and node with `playwright` and `web-ext` resolvable (for example
# NODE_PATH=<dir>/node_modules and PATH including its .bin).
#   sh run.sh chromium            # Playwright's Chromium, extension loaded
#   sh run.sh firefox <binary>    # Firefox via web-ext (temporary add-on)
# Each run prints the extension's report: which cookies reached the "tracker"
# for a same-site and a cross-site .torrent, fetched from the background
# script and from a content script.
set -e
PORT=18733; HERE=$(cd "$(dirname "$0")" && pwd); WORK=$(mktemp -d)
for b in chrome firefox; do
  mkdir -p "$WORK/ext-$b"
  sed "s/__PORT__/$PORT/; s/__BROWSER__/$b/" "$HERE/bg.template.js" > "$WORK/ext-$b/bg.js"
  cp "$HERE/cs.js" "$WORK/ext-$b/cs.js"; cp "$HERE/manifest.$b.json" "$WORK/ext-$b/manifest.json"
done
python3 "$HERE/server.py" $PORT > "$WORK/server.log" 2>&1 & SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$WORK"' EXIT
sleep 1
case "$1" in
  chromium) node "$HERE/run-chromium.cjs" "$WORK/ext-chrome" "$WORK/profile" ;;
  firefox) timeout 45 web-ext run --source-dir "$WORK/ext-firefox" --firefox "$2" --no-input --no-reload --arg=-headless || true ;;
  *) echo "usage: run.sh chromium | firefox <binary>"; exit 2 ;;
esac
grep '^REPORT ' "$WORK/server.log" | sed 's/^REPORT //'
