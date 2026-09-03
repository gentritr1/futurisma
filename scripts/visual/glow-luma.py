"""Visual review harness (not part of the shipped game).

G2 round 2 - measures the contact edge glow against its own surround, because
"is the glow visible" is not a question a code review can answer and round 1
shipped one that was invisible in the acceptance screenshot.

Method: take the mean luma of the outer band on the glowing side (the strip the
gradient actually covers) and subtract the mean luma of the same-height strip
immediately inboard of it. Both strips come from the SAME frame, so scene
brightness, fog and tone mapping cancel out - what is left is the glow's own
contribution.

Usage: python3 scripts/visual/glow-luma.py <image> <side:left|right> [bandPct]
"""
import sys
from PIL import Image

path = sys.argv[1]
side = sys.argv[2] if len(sys.argv) > 2 else "left"
band = float(sys.argv[3]) if len(sys.argv) > 3 else 12.0

image = Image.open(path).convert("RGB")
width, height = image.size
strip = max(1, int(width * band / 100))
# Vertical middle 60%: the top carries the HUD header and the bottom the
# telemetry block, and neither is scene.
top, bottom = int(height * 0.2), int(height * 0.8)

def mean_luma(x0, x1):
    region = image.crop((x0, top, x1, bottom))
    pixels = list(region.getdata())
    return sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in pixels) / len(pixels)

if side == "left":
    glow = mean_luma(0, strip)
    surround = mean_luma(strip, strip * 2)
else:
    glow = mean_luma(width - strip, width)
    surround = mean_luma(width - strip * 2, width - strip)

print(f"{path} side={side} band={band}% strip={strip}px")
print(f"  glow    mean luma {glow:.1f}")
print(f"  surround mean luma {surround:.1f}")
print(f"  delta   {glow - surround:+.1f}")
