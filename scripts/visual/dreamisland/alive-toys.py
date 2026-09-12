"""Phase F round 2, item 4 — count the toys that are actually big on screen.

    python3 scripts/visual/dreamisland/alive-toys.py [DIR]

A toy is a connected run of pixels in the ball-and-ring isolation frame that
differs from the blank frame by more than the tolerance; its height is that
run's bounding-box height. The gate is at least four toys 20 px tall or more in
each of the three day poses.

Runs that touch are counted as one, which can only UNDER-count, so a pass here
is a pass with the accounting stacked against it.
"""
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image
import numpy as np

TOLERANCE = 8
MIN_HEIGHT = 20
MIN_PIXELS = 12
root = Path(sys.argv[1] if len(sys.argv) > 1 else
            "art/evidence/dreamisland-v1/alive/code/round-2/toys")
capture = json.loads((root / "capture.json").read_text())


def components(mask: np.ndarray):
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    for y0 in range(height):
        for x0 in range(width):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            queue, pixels = deque([(y0, x0)]), []
            seen[y0, x0] = True
            while queue:
                y, x = queue.popleft()
                pixels.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
            ys = [p[0] for p in pixels]
            xs = [p[1] for p in pixels]
            yield {"pixels": len(pixels),
                   "heightPx": max(ys) - min(ys) + 1,
                   "widthPx": max(xs) - min(xs) + 1,
                   "top": int(min(ys)), "left": int(min(xs))}


rows = []
for pose in capture["poses"]:
    blank = np.asarray(Image.open(pose["blank"]).convert("RGB")).astype(int)
    counts = {}
    for key in ("toys", "all"):
        frame = np.asarray(Image.open(pose[key]).convert("RGB")).astype(int)
        mask = np.abs(frame - blank).max(axis=2) > TOLERANCE
        found = [c for c in components(mask) if c["pixels"] >= MIN_PIXELS]
        tall = sorted([c for c in found if c["heightPx"] >= MIN_HEIGHT],
                      key=lambda c: -c["heightPx"])
        counts[key] = {"drawn": len(found), "atLeast20px": len(tall),
                       "tallest": [c["heightPx"] for c in tall[:8]]}
    rows.append({"pose": pose["id"], "sector": pose["frozen"]["sector"],
                 "progress": round(pose["frozen"]["progress"], 4),
                 "ballsAndRings": counts["toys"], "withSpheres": counts["all"],
                 "pass": counts["all"]["atLeast20px"] >= 4,
                 "passBallsAndRingsAlone": counts["toys"]["atLeast20px"] >= 4})
    print(f'{"PASS" if rows[-1]["pass"] else "FAIL"} {pose["id"]:<11} '
          f'balls+rings {counts["toys"]["atLeast20px"]:>2} of {counts["toys"]["drawn"]:>2} '
          f'| with spheres {counts["all"]["atLeast20px"]:>2} of {counts["all"]["drawn"]:>2} '
          f'| tallest {counts["all"]["tallest"][:5]}')

out = {"script": "scripts/visual/dreamisland/alive-toys.py",
       "tolerancePerChannel": TOLERANCE, "minHeightPx": MIN_HEIGHT,
       "minPixels": MIN_PIXELS, "gate": "at least 4 toys >= 20 px tall per pose",
       "viewport": capture["viewport"], "rows": rows}
(root / "toys.json").write_text(json.dumps(out, indent=1) + "\n")
print("wrote", root / "toys.json")
