#!/bin/bash
# Downloads the official League ping art and sounds from darrenprx/lolPing, pinned to one commit,
# into ~/.local/share/ping-wheel/official/. They are Riot Games' assets and are never part of
# this repository; run this only if you are fine using them under Riot's terms.
# Then switch packs with: tools/pack.sh official
set -euo pipefail

REV=2b8cdcb725738cdc4c112b35d06996c438fcc295
BASE="https://raw.githubusercontent.com/darrenprx/lolPing/$REV/assets"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/ping-wheel/official"

TEXTURES=(pingwheel_retreatrender push pingwheel_pushrender omw all_in pingwheel_allin_render_01
  pingwheel_allin_render_02 assist_me need_vision enemy_missing pingwheel_enemyvisionrender generic_ping)
SOUNDS=(SRP_12 SRP_9 OnMyWay SRP_4 ComeHere SRP_7 MIA AreaIsWarded button)

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/textures" "$stage/sounds"

get() {
  curl --fail --silent --show-error --location --proto '=https' --max-time 30 --max-filesize 5000000 \
    --output "$stage/$1" "$BASE/$1"
}
for t in "${TEXTURES[@]}"; do get "textures/$t.png"; done
for s in "${SOUNDS[@]}"; do get "sounds/$s.wav"; done

# Swap in the complete set at once, so the plugin never sees half a pack.
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST.old"
[[ -d $DEST ]] && mv "$DEST" "$DEST.old"
mv "$stage" "$DEST"
rm -rf "$DEST.old"
trap - EXIT
echo "Official pack saved to $DEST"
