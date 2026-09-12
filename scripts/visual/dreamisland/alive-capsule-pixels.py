"""Phase F §4.4 — measure the capsule and column pixel heights.

    python3 scripts/visual/dreamisland/alive-capsule-pixels.py [DIR]

Reads the frames `alive-capsule-pixels.mjs` wrote and prints, per state and
distance, the bounding box of every pixel that differs from the blank frame.
The blank frame is the same pose with every mesh hidden, so "differs from blank"
is the object and not the sky behind it.

A tolerance of 6 per channel is applied: an additive column two levels above a
dark sky is not a pixel of column any driver will ever see, and counting it
would make the column's height a property of the compression rather than of the
geometry. The tolerance is printed with every number it produced.
"""
import json
import sys
from pathlib import Path

from PIL import Image
import numpy as np

TOLERANCE = 6
root = Path(sys.argv[1] if len(sys.argv) > 1 else "art/evidence/dreamisland-v1/alive/code/capsule")
capture = json.loads((root / "capture.json").read_text())


def extent(frame: str, blank: str):
    a = np.asarray(Image.open(frame).convert("RGB")).astype(int)
    b = np.asarray(Image.open(blank).convert("RGB")).astype(int)
    mask = np.abs(a - b).max(axis=2) > TOLERANCE
    if not mask.any():
        return {"pixels": 0, "heightPx": 0, "widthPx": 0, "top": None, "bottom": None}
    ys, xs = mask.nonzero()
    return {
        "pixels": int(mask.sum()),
        "heightPx": int(ys.max() - ys.min() + 1),
        "widthPx": int(xs.max() - xs.min() + 1),
        "top": int(ys.min()),
        "bottom": int(ys.max()),
    }


rows = []
for row in capture["rows"]:
    measured = {
        "state": row["state"],
        "distanceMetres": row["distanceMetres"],
        "capsule": extent(row["capsule"], row["blank"]),
        "column": extent(row["column"], row["blank"]),
        "ring": extent(row["ring"], row["blank"]),
    }
    rows.append(measured)
    print(
        f"{measured['state']:>5} {measured['distanceMetres']:>4} m  "
        f"capsule {measured['capsule']['heightPx']:>4} px tall x {measured['capsule']['widthPx']:>4} px  "
        f"column {measured['column']['heightPx']:>4} px tall x {measured['column']['widthPx']:>3} px  "
        f"ring {measured['ring']['heightPx']:>3} px"
    )

out = {
    "script": "scripts/visual/dreamisland/alive-capsule-pixels.py",
    "source": str(root / "capture.json"),
    "viewport": capture["viewport"],
    "camera": capture["camera"],
    "tolerancePerChannel": TOLERANCE,
    "method": "bounding box of pixels differing from the same pose with every mesh hidden",
    "rows": rows,
}
(root / "pixels.json").write_text(json.dumps(out, indent=1) + "\n")
print("wrote", root / "pixels.json")
