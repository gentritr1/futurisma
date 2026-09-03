#!/usr/bin/env python3
"""Visual review harness (not part of the shipped game).

P20.10 item 2 — WCAG contrast of a track-event chip against the frame it is
drawn over, from the frames `shoot-event-chips.mjs` captured.

THE FOREGROUND IS MEASURED, NOT TAKEN FROM THE STYLESHEET. `getComputedStyle`
would give the authored colour, which says nothing about what survives the glow,
the drop shadow and the antialiasing of a 10 px mono glyph. So the reading is
taken off the pixels: inside the label's own bounding box, the brightest decile
is the glyph body (the box is mostly background — a line of tracked-out mono is
well under half ink), and its mean is the foreground.

THE BACKGROUND IS THE 12 px SURROUND, which is the frame the chip is actually
competing with — the deck, the pan, a rig, whatever is under it that second —
rather than an assumed HUD panel colour. This chip has no backing plate, so
there is nothing else it could be measured against.

Ratio is WCAG 2.x: (Lmax + 0.05) / (Lmin + 0.05) over sRGB relative luminance.

Usage: python3 scripts/visual/chip-contrast.py <chipsDir>
"""
import json
import sys

from PIL import Image

SURROUND_PX = 12
FOREGROUND_PERCENTILE = 90


def relative_luminance(rgb):
    out = 0.0
    for value, weight in zip(rgb, (0.2126, 0.7152, 0.0722)):
        c = value / 255.0
        c = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        out += c * weight
    return out


def contrast(a, b):
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def mean(pixels):
    n = len(pixels)
    return tuple(sum(p[i] for p in pixels) / n for i in range(3))


def measure(png, box):
    image = Image.open(png).convert("RGB")
    x0, y0 = int(box["x"]), int(box["y"])
    x1, y1 = int(box["x"] + box["w"] + 0.999), int(box["y"] + box["h"] + 0.999)

    inside = [image.getpixel((x, y)) for y in range(y0, y1) for x in range(x0, x1)]
    ranked = sorted(inside, key=relative_luminance)
    cut = max(1, len(ranked) * (100 - FOREGROUND_PERCENTILE) // 100)
    foreground = mean(ranked[-cut:])

    ring = []
    for y in range(y0 - SURROUND_PX, y1 + SURROUND_PX):
        for x in range(x0 - SURROUND_PX, x1 + SURROUND_PX):
            if x0 <= x < x1 and y0 <= y < y1:
                continue
            if 0 <= x < image.width and 0 <= y < image.height:
                ring.append(image.getpixel((x, y)))
    background = mean(ring)
    return foreground, background, contrast(foreground, background)


def main():
    directory = sys.argv[1] if len(sys.argv) > 1 else "shots/p20.10/chips"
    chips = json.load(open(f"{directory}/chips.json"))
    worst = None
    for chip in chips:
        if not chip.get("box"):
            print(f"{chip['event']}: no box")
            continue
        fg, bg, ratio = measure(chip["path"], chip["box"])
        worst = ratio if worst is None else min(worst, ratio)
        print(
            f"{chip['event']:7s} \"{chip['text']}\"  "
            f"chip {chip['chipHeight']:.1f} px tall, label box "
            f"{chip['box']['w']:.0f}x{chip['box']['h']:.1f} px  "
            f"fg rgb({fg[0]:.0f},{fg[1]:.0f},{fg[2]:.0f}) "
            f"bg rgb({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f})  "
            f"contrast {ratio:.2f}:1  "
            f"{'PASS' if ratio >= 4.5 and chip['chipHeight'] >= 14 else 'FAIL'}"
        )
    if worst is not None:
        print(f"worst contrast {worst:.2f}:1 against a 4.5:1 floor")


if __name__ == "__main__":
    main()
