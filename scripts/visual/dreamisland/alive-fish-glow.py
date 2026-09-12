"""Phase F §4.3 — read the fish-glow pair.

    python3 scripts/visual/dreamisland/alive-fish-glow.py [DIR]

Prints, for the same pinned night pose with the shoals shown and hidden, the
luma p99 and p99.9 and how many pixels of the with-fish frame sit above the
no-fish frame's own p99. The last number is the one §4.3 asks for: a fish that
"contributes to the night p99" is a fish whose pixels are inside the brightest
one per cent of the frame, and that is only true if hiding them moves p99.

Luma is Rec.709 on 0..255, the same convention `measure-frames.py` uses, so the
numbers can sit beside that script's without conversion.
"""
import json
import sys
from pathlib import Path

from PIL import Image
import numpy as np

root = Path(sys.argv[1] if len(sys.argv) > 1 else "art/evidence/dreamisland-v1/alive/code/fish")
capture = json.loads((root / "capture.json").read_text())


def luma(path: str) -> np.ndarray:
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(float)
    return rgb @ np.array([0.2126, 0.7152, 0.0722])


with_fish = luma(capture["withFish"])
without_fish = luma(capture["withoutFish"])
base_p99 = float(np.percentile(without_fish, 99))
rows = {
    "pose": capture["pose"],
    "tick": capture["meta"]["tick"],
    "distanceMetres": capture["meta"]["distanceMetres"],
    "fishVisibleMeshes": capture["fishVisibleMeshes"],
    "withFish": {
        "p99": round(float(np.percentile(with_fish, 99)), 3),
        "p999": round(float(np.percentile(with_fish, 99.9)), 3),
        "max": round(float(with_fish.max()), 3),
        "mean": round(float(with_fish.mean()), 3),
    },
    "withoutFish": {
        "p99": round(base_p99, 3),
        "p999": round(float(np.percentile(without_fish, 99.9)), 3),
        "max": round(float(without_fish.max()), 3),
        "mean": round(float(without_fish.mean()), 3),
    },
    "changedPixels": int((np.abs(with_fish - without_fish) > 1).sum()),
    "fishPixelsAboveNoFishP99": int(
        ((with_fish > base_p99) & (np.abs(with_fish - without_fish) > 1)).sum()
    ),
    "totalPixels": int(with_fish.size),
}
rows["p99Delta"] = round(rows["withFish"]["p99"] - rows["withoutFish"]["p99"], 3)
rows["p999Delta"] = round(rows["withFish"]["p999"] - rows["withoutFish"]["p999"], 3)
(root / "glow.json").write_text(json.dumps(rows, indent=1) + "\n")
print(json.dumps(rows, indent=1))
