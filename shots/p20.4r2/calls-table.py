#!/usr/bin/env python3
"""P20.4 round-2 review harness (not part of the shipped game).

The living-world share of `renderer.info.render.calls`, per pinned station, as a
DIFFERENCE against the same pose with `?living=0` — which is the only way to
read it, because the diagnostics `livingWorldDrawCalls` field reports the
AUTHORED batch count (7) and not what the renderer issued (14 before
`forceSinglePass`, 7 after).
"""
import json


def calls(path):
    return {row["station"]: row["calls"] for row in json.load(open(path))}


def main():
    before = calls("shots/p20.4r2/r1-live/pinned.json")
    after = calls("shots/p20.4r2/final-live/pinned.json")
    off = calls("shots/p20.4r2/final-off/pinned.json")
    print(f"{'station':>8}{'r1 live':>9}{'after':>7}{'living=0':>10}"
          f"{'r1 share':>10}{'after share':>13}")
    for station in sorted(after):
        print(f"{station:>8}{before[station]:>9}{after[station]:>7}"
              f"{off[station]:>10}{before[station] - off[station]:>10}"
              f"{after[station] - off[station]:>13}")


if __name__ == "__main__":
    main()
