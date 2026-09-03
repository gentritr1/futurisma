#!/bin/bash
# P20.4 round-2 review harness (not part of the shipped game).
#
# Sweeps ONE zone's tint and reports the signed near-band luma delta for each
# candidate, so the tint is chosen by measurement. The vertex tint is a LINEAR
# multiplier applied before AgX and before alpha blending in display space, so
# what a given hex does to the screen is not something to reason about from the
# hex — it has to be shot.
#
#   bash shots/p20.4r2/tint-sweep.sh <currentHex> <candidate> [candidate...]
#
# Each candidate replaces the PREVIOUS one in living-world-zones.js, so the file
# is left holding the last candidate in the list. Put the value you want to keep
# last, or restore it by hand.
set -e
ROOT=/Users/gentlegen/Desktop/Projects/futurisma-race/.claude/worktrees/agent-ac64b44c15df1d13a
ZONES=$ROOT/src/game/living-world-zones.js
STATIONS=${STATIONS:-310,574,1080,1784}
PREV=$1
shift

for TINT in "$@"; do
  # The hex values are unique across the five P20.4 zones, so matching on the
  # value alone cannot reach a zone this sweep is not aiming at. Asserted:
  test "$(grep -c "tint: ${PREV}," "$ZONES")" = "1"
  sed -i '' "s/tint: ${PREV},/tint: ${TINT},/" "$ZONES"
  PREV=$TINT
  sleep 1
  node "$ROOT/shots/p20.4r2/shoot-pinned.mjs" \
    "http://127.0.0.1:5206/?map=bitterpan&laps=1&demo=1&diagnostics=1" \
    "$ROOT/shots/p20.4r2/sweep-$TINT" "$STATIONS" >/dev/null
  echo "=== tint $TINT ==="
  python3 "$ROOT/shots/p20.4r2/near-field.py" \
    "$ROOT/shots/p20.4r2/sweep-$TINT" "$ROOT/shots/p20.4r2/off"
done
