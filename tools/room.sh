#!/bin/bash
# Joins or leaves a lolPing room. The plugin watches the state file and starts or stops room/room.mjs.
set -euo pipefail

STATE="${XDG_STATE_HOME:-$HOME/.local/state}/ping-wheel/room"
HELPER="$(dirname "$(readlink -f "$0")")/../room/room.mjs"
{ read -r code; read -r name; read -r color; } 2>/dev/null < "$STATE" || true
name=${name:-$USER} color=${color:-0}

usage() {
  echo "Usage: room.sh [create|join CODE|leave] [--name NAME] [--color 0-7]" >&2
  exit 1
}

cmd=${1:-}
[[ $# -gt 0 ]] && shift
case $cmd in
  create) command -v node >/dev/null || { echo "Rooms need Node.js: omarchy pkg add nodejs" >&2; exit 1; }
          code=$(node "$HELPER" --new-code) ;;
  join) [[ $# -gt 0 ]] || usage; code=${1^^}; shift ;;
  leave) code= ;;
  "") [[ -n ${code:-} ]] && echo "$code ($name)" || echo "Not in a room."; exit 0 ;;
  *) usage ;;
esac
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) name=${2:?}; shift 2 ;;
    --color) [[ ${2:-} =~ ^[0-7]$ ]] || usage; color=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ -z $code ]] || command -v node >/dev/null || { echo "Rooms need Node.js: omarchy pkg add nodejs" >&2; exit 1; }

mkdir -p "$(dirname "$STATE")"
printf '%s\n%s\n%s\n' "$code" "${name//$'\n'/ }" "$color" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
[[ -z $code ]] && echo "Left the room." || echo "$code"
command -v wl-copy >/dev/null && [[ $cmd == create ]] && printf '%s' "$code" | wl-copy && echo "(copied, send it to your friends)" >&2
exit 0
