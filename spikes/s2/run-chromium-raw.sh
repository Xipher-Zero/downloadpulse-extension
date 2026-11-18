#!/bin/sh
# Chromium with no automation connection: binary launched directly, killed after the window.
set -e
CH=$1; V=$2; PORT=$3; HERE=$(cd "$(dirname "$0")" && pwd); WORK=$(mktemp -d)
mkdir -p "$WORK/ext"
sed "s/__PORT__/$PORT/; s/__VARIANT__/$V/" "$HERE/bg.template.js" > "$WORK/ext/bg.js"
cp "$HERE/manifest.chrome.json" "$WORK/ext/manifest.json"
python3 "$HERE/server.py" "$PORT" > "$WORK/server.log" 2>&1 & SERVER=$!
"$CH" --headless=new --user-data-dir="$WORK/profile" --no-first-run --disable-gpu \
  --disable-extensions-except="$WORK/ext" --load-extension="$WORK/ext" about:blank >/dev/null 2>&1 & BR=$!
sleep 115; kill $BR 2>/dev/null; sleep 1; kill $SERVER 2>/dev/null
grep '^REPORT ' "$WORK/server.log" | sed 's/^REPORT //'; rm -rf "$WORK"
