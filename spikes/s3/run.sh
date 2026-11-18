#!/bin/sh
# Spike S3 harness (throwaway). Needs python3, node with `playwright` and
# `web-ext` resolvable (NODE_PATH / PATH), and a Firefox binary for firefox.
#   sh run.sh chromium <port>
#   sh run.sh firefox <port> <firefox-binary>
set -e
B=$1; PORT=$2; HERE=$(cd "$(dirname "$0")" && pwd); WORK=$(mktemp -d)
M=$B; [ "$B" = chromium ] && M=chrome
mkdir -p "$WORK/ext"
sed "s/__PORT__/$PORT/; s/__BROWSER__/$B/" "$HERE/bg.template.js" > "$WORK/ext/bg.js"
cp "$HERE/cs.js" "$WORK/ext/"; cp "$HERE/manifest.$M.json" "$WORK/ext/manifest.json"
python3 "$HERE/server.py" "$PORT" > "$WORK/server.log" 2>&1 & SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$WORK"' EXIT
sleep 1
case "$B" in
  chromium) node "$HERE/run-chromium.cjs" "$WORK/ext" "$WORK/profile" "$PORT" ;;
  firefox) timeout 30 web-ext run --source-dir "$WORK/ext" --firefox "$3" --no-input --no-reload --arg=-headless >/dev/null 2>&1 || true ;;
esac
grep '^REPORT ' "$WORK/server.log" | sed 's/^REPORT //'
