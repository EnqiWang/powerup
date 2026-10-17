#!/usr/bin/env bash
# PoweruP local demo server. Serves this folder on http://localhost:8004 (static files only).
cd "$(dirname "$0")"
URL="http://localhost:8004/?demo=1"
PY=$(command -v python3 || command -v python)
[ -z "$PY" ] && { echo "Python 3 is required (macOS: xcode-select --install)"; exit 1; }
echo "Opening $URL   (Ctrl+C to stop)"
( sleep 1; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null ) &
exec "$PY" -m http.server 8004 --bind 127.0.0.1
