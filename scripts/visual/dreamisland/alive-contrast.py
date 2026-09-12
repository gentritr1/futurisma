"""Phase F round 2, item 3 — WCAG contrast of every HUD text against its ground.

    python3 scripts/visual/dreamisland/alive-contrast.py [DIR]

Reads what `alive-contrast.mjs` captured and prints, per pose and per text
element, the WCAG 2.1 contrast ratio between the element's computed ink and the
mean colour of the BACKGROUND frame inside that element's own rect. The gate is
4.5:1, the WCAG AA ratio for body text.
"""
import json
import sys
from pathlib import Path

from PIL import Image
import numpy as np

GATE = 4.5
root = Path(sys.argv[1] if len(sys.argv) > 1 else
            "art/evidence/dreamisland-v1/alive/code/round-2/contrast")
capture = json.loads((root / "capture.json").read_text())


def channel(value: float) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def luminance(rgb) -> float:
    r, g, b = (channel(float(v)) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b) -> float:
    la, lb = luminance(a), luminance(b)
    high, low = max(la, lb), min(la, lb)
    return (high + 0.05) / (low + 0.05)


def ink(text) -> list:
    """The sRGB triple the browser resolved, never a parse of the CSS string:
    every colour in this skin is a `color-mix(in oklab, ...)` and comes back as
    `oklab(...)`, whose three numbers are not R, G and B."""
    return [float(v) for v in text["inkRgb"]]


rows, failures = [], []
for pose in capture["poses"]:
    background = np.asarray(Image.open(root / pose["background"]).convert("RGB")).astype(float)
    height, width, _ = background.shape
    for text in pose["texts"]:
        r = text["rect"]
        x0, y0 = max(0, r["x"]), max(0, r["y"])
        x1, y1 = min(width, r["x"] + r["width"]), min(height, r["y"] + r["height"])
        if x1 <= x0 or y1 <= y0:
            continue
        mean = background[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
        row = {
            "pose": pose["id"], "id": text["id"], "class": text["className"],
            "text": text["text"], "ink": ink(text),
            "fontSize": text["fontSize"], "font": text["fontFamily"],
            "backgroundMean": [round(float(v), 1) for v in mean],
            "ratio": round(ratio(ink(text), mean), 2),
        }
        row["pass"] = row["ratio"] >= GATE
        rows.append(row)
        if not row["pass"]:
            failures.append(row)

for row in sorted(rows, key=lambda r: r["ratio"]):
    mark = "PASS" if row["pass"] else "FAIL"
    label = row["id"] or row["class"].split()[0] if (row["id"] or row["class"]) else "?"
    print(f'{mark} {row["ratio"]:6.2f}  {row["pose"]:<12} {label:<26} {row["text"][:40]}')

out = {"script": "scripts/visual/dreamisland/alive-contrast.py", "gate": GATE,
       "method": capture["method"], "elements": len(rows),
       "failures": len(failures), "rows": rows}
(root / "contrast.json").write_text(json.dumps(out, indent=1) + "\n")
print(f"\n{len(rows)} text elements, {len(failures)} below {GATE}:1")
