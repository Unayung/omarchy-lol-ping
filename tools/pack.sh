#!/bin/bash
# Picks the asset pack Ping Wheel uses: custom (bundled) or official (see fetch-official.sh).
# The plugin watches the state file and switches at once.
set -euo pipefail

STATE="${XDG_STATE_HOME:-$HOME/.local/state}/ping-wheel/pack"
current=$(cat "$STATE" 2>/dev/null || echo custom)

case "${1:-}" in
  custom | official) next=$1 ;;
  toggle) [[ $current == official ]] && next=custom || next=official ;;
  "") echo "$current"; exit 0 ;;
  *) echo "Usage: pack.sh [custom|official|toggle]" >&2; exit 1 ;;
esac

if [[ $next == official && ! -d ${XDG_DATA_HOME:-$HOME/.local/share}/ping-wheel/official ]]; then
  echo "Official pack not downloaded yet; run tools/fetch-official.sh first." >&2
  exit 1
fi

mkdir -p "$(dirname "$STATE")"
echo "$next" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
echo "$next"
