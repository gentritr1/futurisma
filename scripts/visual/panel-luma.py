#!/usr/bin/env python3
"""P20.7 item 2 acceptance measurement (review harness, not shipped).

Masks the screen-bay panel quads scripts/visual/panel-probe.mjs projected out
of the live scene and reports, per station and per side:

  SHADOW   the road-facing panel faces turned AWAY from the key light. These
           are the near-black rectangles P20.3's own crops flagged. Target:
           mean Rec.709 luma in [42, 90].
  SUN      the road-facing faces turned TOWARD it. Target: unchanged from the
           pre-fix build within +-6, per matched instance.

Per-instance rows are keyed by the InstancedMesh index, so a before/after pair
can be matched panel-for-panel rather than compared as two bulk averages of
whatever happened to be in frame.

  python3 scripts/visual/panel-luma.py <dir> [<dir> ...] [--per-panel]
  python3 scripts/visual/panel-luma.py --pair <beforeDir> <afterDir>

--pair matches instances that appear in BOTH runs at the same station and
prints the per-instance delta, which is the only form of the SUN criterion that
means anything: a bulk mean moves when the set of visible panels moves.
"""
import json
import os
import sys

from PIL import Image, ImageDraw


def luma_image(image):
    return image.convert("L", (0.2126, 0.7152, 0.0722, 0))


def quad_values(grey, quad):
    mask = Image.new("L", grey.size, 0)
    ImageDraw.Draw(mask).polygon([(p["x"], p["y"]) for p in quad], fill=255)
    box = mask.getbbox()
    if box is None:
        return []
    return [
        v for v, m in zip(grey.crop(box).getdata(), mask.crop(box).getdata()) if m
    ]


def measure(directory):
    shots = json.load(open(os.path.join(directory, "panels.json")))
    rows = []
    for shot in shots:
        grey = luma_image(Image.open(shot["file"]).convert("RGB"))
        for panel in shot["panels"]:
            values = quad_values(grey, panel["quad"])
            if len(values) < 60:
                continue
            rows.append({
                "dir": directory,
                "station": shot["station"],
                "d": shot["d"],
                "index": panel["index"],
                "side": panel["side"],
                "distM": round(panel["dist"], 1),
                "px": len(values),
                "luma": round(sum(values) / len(values), 1),
                "min": min(values),
                "max": max(values),
            })
    return rows


def summarise(rows, label):
    print(f"\n{label}")
    print(f"  {'station':>7} {'side':>7} {'n':>4} {'px':>7} {'mean':>6} "
          f"{'min':>6} {'max':>6}")
    for station in sorted({r["station"] for r in rows}):
        for side in ("SHADOW", "SUN", "EDGE"):
            group = [r for r in rows if r["station"] == station and r["side"] == side]
            if not group:
                continue
            px = sum(r["px"] for r in group)
            mean = sum(r["luma"] * r["px"] for r in group) / px
            print(f"  {station:>7} {side:>7} {len(group):>4} {px:>7} {mean:>6.1f} "
                  f"{min(r['luma'] for r in group):>6.1f} "
                  f"{max(r['luma'] for r in group):>6.1f}")


def pair(before_dir, after_dir):
    before = {(r["station"], r["index"]): r for r in measure(before_dir)}
    after = {(r["station"], r["index"]): r for r in measure(after_dir)}
    shared = sorted(set(before) & set(after))
    print(f"{len(shared)} panels visible in BOTH runs at the same station "
          f"({len(before)} before, {len(after)} after)")
    print(f"  {'station':>7} {'idx':>4} {'side':>7} {'before':>7} {'after':>7} "
          f"{'delta':>7}")
    worst = {}
    for keyed in shared:
        b = before[keyed]
        a = after[keyed]
        delta = a["luma"] - b["luma"]
        print(f"  {b['station']:>7} {b['index']:>4} {b['side']:>7} "
              f"{b['luma']:>7.1f} {a['luma']:>7.1f} {delta:>+7.1f}")
        bucket = worst.setdefault(b["side"], [])
        bucket.append(delta)
    print()
    for side, deltas in sorted(worst.items()):
        print(f"  {side}: n={len(deltas)} mean {sum(deltas) / len(deltas):+.1f} "
              f"min {min(deltas):+.1f} max {max(deltas):+.1f} "
              f"largest |delta| {max(abs(d) for d in deltas):.1f}")


def main(argv):
    if argv and argv[0] == "--pair":
        pair(argv[1], argv[2])
        return
    per_panel = "--per-panel" in argv
    for directory in [a for a in argv if not a.startswith("--")]:
        rows = measure(directory)
        summarise(rows, directory)
        if per_panel:
            for r in sorted(rows, key=lambda r: (r["station"], r["luma"])):
                print(f"    st{r['station']} idx{r['index']:>4} {r['side']:>7} "
                      f"{r['distM']:>5} m {r['px']:>5} px luma {r['luma']:>6.1f} "
                      f"[{r['min']}..{r['max']}]")


if __name__ == "__main__":
    main(sys.argv[1:])
