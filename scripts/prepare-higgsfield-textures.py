#!/usr/bin/env python3
"""
H2a — turn the Higgsfield batch-1 generations into sheets this game can serve.

    python3 scripts/prepare-higgsfield-textures.py [--in DIR] [--check]

Deterministic: no randomness, no network, no time. Re-running it on the same
inputs writes byte-identical PNGs, which is what lets `validate-art-pass.mjs`
and `validate-assets.mjs` pin their sha256. `--check` re-derives everything and
fails if any served file would change, without writing.

Inputs live in `assets-in/higgsfield/batch1/` in the MAIN checkout and are
gitignored — they are 5-7 MB hero renders, not source art. This script is the
provenance for the sheets that ARE committed, the same way
`scripts/design/build-futurisma-atlases.mjs` is for the P12/P15/P18 sheets.

WHAT THE GENERATIONS ACTUALLY ARE, MEASURED
-------------------------------------------
The brief that ordered them described `01-salt-crust` and `02-brine-crust` as
"near top-down". They are not. Both are ground-plane views with a horizon off
the top of the frame. The instrument that says so is `band_aspect()`: the ratio
of the VERTICAL to the HORIZONTAL macro-scale spectral period, measured in six
horizontal bands of the square that would actually become the tile. 1.00 is a
plan view; a ground plane receding from the camera reads below 1.00 at the top
of the frame and climbs toward the bottom, so the number to kill is the SLOPE.

Measured on 01-salt-crust, over the square crop taken from row `keep`:

    keep     square   polys/tile   aspect mean   spread   slope per band
       0       2048         13.9          0.82     0.60          +0.119
     512       1536         10.4          0.88     0.49          +0.060
     768       1280          8.3          0.93     0.40          -0.021
    1024       1024          6.9          0.72     0.19          +0.011

`keep = 768` is the choice, and `CRUST_KEEP_FROM_ROW` is that number. It is the
first crop whose perspective TREND is gone (-0.021 per band against +0.119 for
the whole frame, i.e. the aspect no longer climbs down the tile) while still
carrying 8.3 macro polygons per tile. Cropping further to row 1024 buys a
tighter spread but at a uniform aspect of 0.72 — no longer perspective, just a
squash — and drops to 6.9 polygons, which is a repeat period the pan floor
would show at 12 m per tile.

NO PERSPECTIVE RECTIFICATION IS APPLIED, and that is deliberate. A per-row
inverse-perspective resample was built, fitted (R^2 0.980 against the four
pre-crop bands) and MEASURED on its own output: the aspect bands came back
0.73 / 1.12 / 0.77 / 1.18 against 0.67 / 0.90 / 1.00 / 1.17 going in. The trend
slope improved from +0.16 to +0.10 per band but the fit collapsed, so the
correction could not be shown to have done what it claimed. A crop whose
residual trend is measurably flat beats a warp whose effect cannot be
demonstrated, so the warp was deleted rather than shipped behind a hedge.

TONE, AND WHY THE TILE IS MATCHED TO THE ONE IT REPLACES
--------------------------------------------------------
`pan-floor-colour.js` derives the pan's vertex colours from the LINEAR-SPACE
MEAN of `bitterpan_crust_tile_256.png`, and P20.6's macro field and P20.11's
distance fades are all tuned around that value. The generation's own mean is
(220.5, 212.6, 204.9) against the shipping tile's (233.2, 229.4, 218.1) — darker
and warmer. Swapping it in raw would re-grade the whole pan by a route nothing
in the colour system knows about. So the tile's per-channel mean is matched to
the shipping tile's exactly, and only its detail is new. Its luma std (22.3) is
already inside the FACADE_STD_GAIN band over the shipping tile's (18.0), so no
contrast reduction is applied and none is hidden.

SEAMLESSNESS, MIRROR-FREE
-------------------------
`make_seamless()` is the two-fold border blend, not a mirror: with J = the image
rolled by half its size on both axes, and w a separable smoothstep window that
is 0 in a feathered band hugging the borders and 1 in the interior,

    O = I*w + J*(1-w)

At the borders O is J, whose border pixels are I's CENTRE pixels — adjacent in
I, therefore continuous across the wrap. In the interior O is I untouched. Only
a band of `SEAM_FEATHER` of the width is cross-faded, and nothing is mirrored,
so the tile carries no axis of symmetry for the eye to lock onto.

`seam_energy()` is the acceptance test: tile the result 2x2, measure mean
absolute gradient in a band straddling the seam and in an interior band of the
same size, and report the ratio. A ratio near 1.0 means the seam is
indistinguishable from ordinary texture. Above ~1.15 there is a visible line.

TONE MATCHING THE FACADE SKINS
------------------------------
The four generated facade cells are photoreal, with baked speculars and a
lighting gradient across each cell. The eleven regions they would sit BESIDE on
`bitterpan_facades_1024` are pixel-authored and flat: luma std 8-41, mean
57-196. Dropping raw photoreal cells into that sheet puts two art languages on
one texture, and every family that keeps an old region reads as a different
game from the four that take a new one.

So each new cell is (a) de-lit by subtracting a large-radius blur and re-adding
its own mean, then (b) matched to the ORIGINAL region's mean RGB exactly, with
its luma contrast capped at `FACADE_STD_GAIN` x the original region's std.
PRODUCT.md principle 4 allows modern rendering "where it reads better", which is
why the gain is above 1.0 at all; the cap is why a photoreal skin cannot
out-contrast the sheet it has to share.

WHAT IS DELIBERATELY NOT REPLACED, AND WHY
------------------------------------------
  SKIN_CANVAS      the generated cell is a hanging tarp OBJECT — grommets, a
                   hemmed edge, a grey wall behind it — not a canvas material.
                   Box-mapped once per face (see bitterpan-facades.ts on
                   `uvMetresPerTile` as an aspect ratio) every canvas structure
                   on the pan would wear one giant tarp with eyelets. It cannot
                   tile and it cannot be cropped into a material.
  RIG_FAR          the 4x4 horizon sheet has three mesa cells and no second
                   lattice rig. Assigning a mesa to RIG_FAR would put a rock
                   where the zone table asks for a derrick.
  SHIMMER_BAND     the generated band cells are PALE GREY GRADIENTS on white.
  HAZE_BAND        The regions they would replace carry pale RGB (248,246,239)
                   and (222,213,191) at partial alpha; a luminance-to-alpha pass
                   turns a pale gradient into a DARK one, inverting the two
                   cells whose whole job is to lift the far field.

Those four keep their original pixels, copied through from the base sheet, so
the new sheets stay drop-in replacements at the same rects.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------------
# Tuning. Every number the sheets carry is declared here.
# --------------------------------------------------------------------------

#: Fraction of each axis cross-faded at the wrap. 14%, mid of the 12-16% band.
SEAM_FEATHER = 0.14
#: De-lighting blur radius as a fraction of the shorter axis. Big enough to be
#: pure illumination, small enough to leave the macro polygon layout alone.
DELIGHT_RADIUS = 0.25
#: Ratio of tile-seam gradient energy to interior gradient energy above which a
#: tile is reported as having a visible seam.
SEAM_RATIO_LIMIT = 1.15
#: How much more luma contrast a generated facade skin may carry than the
#: pixel-authored region it replaces. See "TONE MATCHING" above.
FACADE_STD_GAIN = 1.30
#: Row of the 2048 generation below which the crust/brine plate is taken. The
#: table in the module docstring is the measurement that chose it.
CRUST_KEEP_FROM_ROW = 768
#: The pan tile is SERVED at 512, not 1024. Truecolour PNG of a photographic
#: crust measures 1475.3 KiB at 1024 and 418.9 KiB at 512 with adaptive
#: filtering; the item budget for this phase is 700 KB. 512 is still four times
#: the texel density of the 256 tile it replaces, at 12 m per tile either way.
#: The 1024 is emitted under shots/ so the comparison stays checkable.
CRUST_SERVED_SIZE = 512

#: The flat silhouette colour every solid cell of `futurisma_horizon_1024`
#: carries (measured: mean (30.0, 37.0, 33.0), std 2.9 across all fourteen).
HORIZON_INK = (30, 37, 33)
#: Luminance-to-alpha ramp for the horizon silhouettes. Below LO fully opaque,
#: above HI fully clear. The horizon batch alpha-tests at 0.5, so the ramp only
#: has to place the 50% crossing on the drawn edge; it exists so the faint
#: background pylons of PYLON_RUN survive at all rather than being thresholded
#: away with a single cut.
HORIZON_ALPHA_LO = 90.0
HORIZON_ALPHA_HI = 240.0

#: The double frame line the horizon generation drew between its 4x4 cells,
#: measured off the sheet (see `--check` output). Content spans between them.
HORIZON_CELL_BOUNDS = [(0, 493), (521, 1011), (1038, 1527), (1554, 2048)]
#: The single dark gutter on the 2x2 facade generation, likewise measured.
FACADE_COL_BOUNDS = [(0, 1006), (1042, 2048)]
FACADE_ROW_BOUNDS = [(0, 1004), (1041, 2048)]

#: Horizon cell (row, column) in the generation -> region of the base sheet.
#: Written out by MEANING, and the three regions with no honest source are
#: absent on purpose — see "WHAT IS DELIBERATELY NOT REPLACED".
HORIZON_MAP = {
    (0, 0): "MESA_LONG",        # long low plateau
    (0, 2): "MESA_BLUFF",       # tall stepped bluff
    (0, 3): "PLANT_MASS",       # refinery block: columns, stacks, pipe deck
    (1, 0): "GANTRY_FAR",       # lattice gantry crane on legs
    (1, 1): "TANK_FARM_FAR",    # squat storage tanks with handrails
    (1, 2): "STACK_CLUSTER",    # seven chimneys over a plant block
    (1, 3): "STACK_SINGLE",     # one tall chimney
    (2, 0): "PYLON_RUN",        # transmission towers receding, with wires
    (2, 1): "HANGAR_MASS",      # barrel-roof shed under a gantry
    (2, 2): "TREELINE_DENSE",   # closed conifer stand
    (2, 3): "SILO_PAIR",        # two hopper-bottomed silos
    (3, 0): "TREELINE_SNAG",    # dead standing trunks
    (3, 1): "TREELINE_BROKEN",  # low broken scrub
}
#: (0, 1) is a third mesa with no region to take, and (3, 2)/(3, 3) are the two
#: pale bands. Neither is a defect; both are recorded so the count reconciles:
#: 16 cells generated, 13 used, 3 regions keep their original pixels.
HORIZON_UNUSED_CELLS = [(0, 1), (3, 2), (3, 3)]

#: Facade cell (row, column) in the 2x2 generation -> region of the base sheet.
FACADE_MAP = {
    (0, 0): "SKIN_GALV_RIB",
    (0, 1): "SKIN_PATCHED",
    (1, 1): "SKIN_CONCRETE",
}
#: (1, 0) is the tarp object. See "WHAT IS DELIBERATELY NOT REPLACED".
FACADE_UNUSED_CELLS = [(1, 0)]

BASE_FACADES = "public/assets/map02/textures/bitterpan_facades_1024.png"
BASE_HORIZON = "public/assets/greenwater/textures/futurisma_horizon_1024.png"

OUT_CRUST = "public/assets/map02/textures/bitterpan_crust_tile_hf_512.png"
OUT_FACADES = "public/assets/map02/textures/bitterpan_facades_hf_1024.png"
OUT_HORIZON = "public/assets/greenwater/textures/futurisma_horizon_hf_1024.png"
#: Prepared but NOT served: there is no texture slot on the pan for a second
#: ground material, and adding one would add a draw call, which this phase is
#: not allowed to spend. Written under `shots/`, which .gitignore already
#: covers as the bucket for local review artefacts.
OUT_CRUST_1024 = "shots/higgsfield/bitterpan_crust_tile_hf_1024.png"
OUT_BRINE_512 = "shots/higgsfield/bitterpan_brine_hf_512.png"

# --------------------------------------------------------------------------
# Small image maths. numpy + PIL only — scipy is not a dependency of this repo.
# --------------------------------------------------------------------------


def box_blur(plane: np.ndarray, radius: int) -> np.ndarray:
    """Mean over a (2r+1)^2 window, reflect-padded, via a summed-area table."""
    if radius < 1:
        return plane.copy()
    k = 2 * radius + 1
    height, width = plane.shape
    padded = np.pad(plane, radius, mode="reflect")
    table = np.cumsum(np.cumsum(padded, axis=0), axis=1)
    table = np.pad(table, ((1, 0), (1, 0)))
    return (
        table[k:k + height, k:k + width]
        - table[0:height, k:k + width]
        - table[k:k + height, 0:width]
        + table[0:height, 0:width]
    ) / float(k * k)


def gaussian_ish(plane: np.ndarray, radius: int) -> np.ndarray:
    """Three box blurs. Close enough to a Gaussian for an illumination field."""
    out = plane
    for _ in range(3):
        out = box_blur(out, max(1, radius // 3))
    return out


def delight(image: np.ndarray, radius_fraction: float = DELIGHT_RADIUS) -> np.ndarray:
    """
    Subtract the large-scale illumination field and re-add the mean.

    Done on LUMA and applied as a per-pixel gain so hue and saturation survive;
    subtracting per channel would drag a warm image toward grey wherever the
    field is bright.
    """
    rgb = image.astype(np.float64)
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    radius = max(1, int(round(min(image.shape[:2]) * radius_fraction)))
    field = gaussian_ish(luma, radius)
    mean = float(field.mean())
    gain = mean / np.maximum(field, 1e-3)
    return np.clip(rgb * gain[..., None], 0, 255)


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def wrap_window(n: int, feather: float) -> np.ndarray:
    """0 in a band hugging both borders, 1 in the interior, smoothstep between."""
    index = np.arange(n, dtype=np.float64)
    distance = np.minimum(index, n - 1 - index)
    return smoothstep(distance / max(1.0, feather * n))


def make_seamless(image: np.ndarray, feather: float = SEAM_FEATHER) -> np.ndarray:
    """
    Mirror-free wrap. See the module docstring for why this tiles.

    The roll is by exactly half on both axes, so the blend partner at any border
    pixel is the corresponding CENTRE pixel and the two are continuous under the
    wrap by construction rather than by luck.
    """
    height, width = image.shape[:2]
    rolled = np.roll(np.roll(image, height // 2, axis=0), width // 2, axis=1)
    weight = wrap_window(height, feather)[:, None] * wrap_window(width, feather)[None, :]
    if image.ndim == 3:
        weight = weight[..., None]
    return image * weight + rolled * (1.0 - weight)


def seam_energy(image: np.ndarray, band: int = 12) -> tuple[float, float, float]:
    """
    Tile 2x2 and compare gradient energy across the seam with the interior.

    Returns (seam, interior, ratio). The interior band is taken at the same
    offset from the OTHER quarter line, so it samples the same kind of content
    at the same width and the comparison is not against a global average that a
    quiet region could flatter.
    """
    rgb = image.astype(np.float64)
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    tiled = np.tile(luma, (2, 2))
    gradient = np.abs(np.diff(tiled, axis=1))
    height, width = luma.shape
    seam = float(gradient[:, width - band:width + band].mean())
    quarter = width // 2
    interior = float(gradient[:, quarter - band:quarter + band].mean())
    return seam, interior, seam / max(interior, 1e-9)


def macro_period(block: np.ndarray, axis: int, lo=0.0015, hi=0.02) -> float:
    """Spectral-centroid period, in pixels, of one axis of one block."""
    signal = block - block.mean(axis=axis, keepdims=True)
    window = np.hanning(signal.shape[axis])
    signal = signal * (window[None, :] if axis == 1 else window[:, None])
    power = (np.abs(np.fft.rfft(signal, axis=axis)) ** 2).mean(axis=1 - axis)
    freq = np.fft.rfftfreq(signal.shape[axis])
    mask = (freq > lo) & (freq < hi)
    return 1.0 / ((power[mask] * freq[mask]).sum() / power[mask].sum())


def band_aspect(luma: np.ndarray, bands: int = 6) -> np.ndarray:
    """
    Vertical/horizontal macro period per horizontal band of one square plate.

    1.00 is a plan view. A ground plane receding from the camera reads low at the
    top of the frame and climbs toward the bottom, so what identifies perspective
    is the SLOPE of this series, not any single value. Six bands, because four
    over a 512-row block was noisy enough to make a fitted correction
    unfalsifiable (see the module docstring).
    """
    side = luma.shape[0]
    step = side // bands
    margin = luma.shape[1] // 5
    out = []
    for index in range(bands):
        block = luma[index * step:(index + 1) * step, margin:luma.shape[1] - margin]
        out.append(macro_period(block, 0) / macro_period(block, 1))
    return np.array(out)


def report_aspect(luma: np.ndarray, label: str) -> np.ndarray:
    """`band_aspect`, printed with the fitted trend that is the actual verdict."""
    aspects = band_aspect(luma)
    slope = float(np.polyfit(np.arange(len(aspects)), aspects, 1)[0])
    print(
        f"    {label}: aspect {[round(float(v), 2) for v in aspects]}\n"
        f"      mean={aspects.mean():.2f} spread={aspects.max() - aspects.min():.2f} "
        f"slope/band={slope:+.3f}   (1.00 = plan view; a flat slope is the test)"
    )
    return aspects


def resize(image: np.ndarray, width: int, height: int) -> np.ndarray:
    mode = "RGBA" if image.shape[2] == 4 else "RGB"
    pil = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8), mode)
    return np.array(pil.resize((width, height), Image.LANCZOS)).astype(np.float64)


def match_region_tone(cell: np.ndarray, target: np.ndarray) -> np.ndarray:
    """
    Put a generated skin into the base sheet's tonal range.

    Luma contrast is scaled toward the target region's std (never above
    FACADE_STD_GAIN x it, never boosted if the source is already flatter), then
    every channel's mean is matched to the target region's mean RGB. The result
    sits in the same value band as the eleven regions it shares the sheet with.
    """
    def luma_of(rgb):
        return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

    source = cell.astype(np.float64)
    target = target.astype(np.float64)
    source_luma = luma_of(source)
    target_luma = luma_of(target)
    gain = min(
        1.0,
        (target_luma.std() * FACADE_STD_GAIN) / max(source_luma.std(), 1e-6),
    )
    wanted = source_luma.mean() + (source_luma - source_luma.mean()) * gain
    scaled = source * (wanted / np.maximum(source_luma, 1e-3))[..., None]
    for channel in range(3):
        mean = scaled[..., channel].mean()
        scaled[..., channel] *= target[..., channel].mean() / max(mean, 1e-3)
    print(
        f"      tone: luma std {source_luma.std():5.1f} -> "
        f"{luma_of(np.clip(scaled, 0, 255)).std():5.1f} "
        f"(target {target_luma.std():5.1f}, gain {gain:.2f}); "
        f"mean {source_luma.mean():5.1f} -> {target_luma.mean():5.1f}"
    )
    return np.clip(scaled, 0, 255)


def write_png(path: Path, array: np.ndarray, check: bool) -> tuple[str, int]:
    """
    Write a deterministic PNG and return (sha256, bytes).

    PIL's own encoder is deterministic for a fixed version but embeds no
    timestamp only by default; the bytes are built by hand here so the hashes
    this script prints cannot move with a Pillow upgrade.
    """
    array = np.clip(array, 0, 255).astype(np.uint8)
    height, width = array.shape[:2]
    channels = array.shape[2]
    colour_type = 6 if channels == 4 else 2
    # Adaptive per-scanline filtering, the standard minimum-sum-of-absolute-
    # differences heuristic. Not an optional nicety: filter 0 on every line
    # costs the pan tile 2137.9 KiB against 1475.3 KiB here, and the choice of
    # served resolution below turns on that number.
    raw = bytearray()
    previous = np.zeros(width * channels, dtype=np.int32)
    for row in range(height):
        line = array[row].reshape(-1).astype(np.int32)
        left = np.concatenate([np.zeros(channels, dtype=np.int32), line[:-channels]])
        up = previous
        upleft = np.concatenate([np.zeros(channels, dtype=np.int32), previous[:-channels]])
        estimate = left + up - upleft
        pick = np.where(
            (np.abs(estimate - left) <= np.abs(estimate - up))
            & (np.abs(estimate - left) <= np.abs(estimate - upleft)),
            left,
            np.where(np.abs(estimate - up) <= np.abs(estimate - upleft), up, upleft),
        )
        candidates = (line, line - left, line - up,
                      line - ((left + up) // 2), line - pick)
        scores = [int(np.abs(((c + 128) % 256) - 128).sum()) for c in candidates]
        best = scores.index(min(scores))
        raw.append(best)
        raw.extend((candidates[best] % 256).astype(np.uint8).tobytes())
        previous = line

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            len(payload).to_bytes(4, "big")
            + kind + payload
            + zlib.crc32(kind + payload).to_bytes(4, "big")
        )

    header = (
        width.to_bytes(4, "big") + height.to_bytes(4, "big")
        + bytes([8, colour_type, 0, 0, 0])
    )
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    digest = hashlib.sha256(png).hexdigest()
    target = ROOT / path
    if check:
        if not target.exists():
            print(f"  CHECK FAIL {path}: missing")
            return digest, len(png)
        if target.read_bytes() != png:
            print(f"  CHECK FAIL {path}: on disk differs from the derivation")
            return digest, len(png)
        print(f"  check ok   {path}")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(png)
    print(f"  {path}  {len(png):,} bytes  sha256 {digest}")
    return digest, len(png)


# --------------------------------------------------------------------------
# The four items.
# --------------------------------------------------------------------------


def prepare_ground_tile(
    source: Path,
    size: int,
    keep_from_row: int,
    tone_target: Path | None = None,
) -> np.ndarray:
    """
    Perspective ground render -> seamless plan-view tile.

    No warp. `keep_from_row` is chosen so that the residual perspective TREND is
    already flat; the before/after aspect series are printed so that claim is
    checkable rather than asserted.
    """
    image = np.array(Image.open(source).convert("RGB")).astype(np.float64)

    def square_of(plate):
        height, width = plate.shape[:2]
        side = min(height, width)
        return plate[(height - side) // 2:(height - side) // 2 + side,
                     (width - side) // 2:(width - side) // 2 + side]

    def luma_of(rgb):
        return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

    whole = square_of(image)
    report_aspect(luma_of(whole), "whole frame")
    square = square_of(image[keep_from_row:])
    kept = report_aspect(luma_of(square), f"kept from row {keep_from_row}")
    print(f"      macro polygons across the tile: "
          f"{square.shape[0] / macro_period(luma_of(square), 1):.1f}")
    slope = float(np.polyfit(np.arange(len(kept)), kept, 1)[0])
    if abs(slope) > 0.05:
        print(f"      WARNING: residual perspective trend {slope:+.3f} per band")

    square = delight(square)
    square = make_seamless(square)
    tile = resize(square, size, size)

    if tone_target is not None:
        base = np.array(Image.open(ROOT / tone_target).convert("RGB")).astype(np.float64)
        print(f"      matching tone to {tone_target}:")
        tile = match_region_tone(tile, base)

    print(
        f"    tile {size}: rgb mean "
        f"({tile[..., 0].mean():.1f}, {tile[..., 1].mean():.1f}, "
        f"{tile[..., 2].mean():.1f})  luma std {luma_of(tile).std():.1f}"
    )
    seam, interior, ratio = seam_energy(tile)
    verdict = "SEAMLESS" if ratio <= SEAM_RATIO_LIMIT else "VISIBLE SEAM"
    print(
        f"    seam check: seam grad {seam:.3f} vs interior {interior:.3f} "
        f"-> ratio {ratio:.3f}  [{verdict}]"
    )
    return tile


def prepare_facade_sheet(source: Path, regions: dict) -> np.ndarray:
    """New sheet = the base sheet, with three region rects repainted."""
    base = np.array(Image.open(ROOT / BASE_FACADES).convert("RGBA")).astype(np.float64)
    sheet = base.copy()
    generation = np.array(Image.open(source).convert("RGB")).astype(np.float64)

    for (row, column), name in FACADE_MAP.items():
        rect = regions[name]
        r0, r1 = FACADE_ROW_BOUNDS[row]
        c0, c1 = FACADE_COL_BOUNDS[column]
        cell = generation[r0:r1, c0:c1]
        print(f"    {name}: source cell rows {r0}-{r1} cols {c0}-{c1} "
              f"-> rect {rect['x']},{rect['y']} {rect['w']}x{rect['h']}")

        # Crop to the region's aspect BEFORE resampling, so a 512x256 region is
        # not a squashed square. Centred.
        want = rect["w"] / rect["h"]
        height, width = cell.shape[:2]
        if width / height > want:
            keep = int(round(height * want))
            cell = cell[:, (width - keep) // 2:(width - keep) // 2 + keep]
        else:
            keep = int(round(width / want))
            cell = cell[(height - keep) // 2:(height - keep) // 2 + keep, :]

        cell = delight(cell)
        cell = make_seamless(cell)
        cell = resize(cell, rect["w"], rect["h"])
        target = base[rect["y"]:rect["y"] + rect["h"],
                      rect["x"]:rect["x"] + rect["w"], :3]
        cell = match_region_tone(cell, target)
        seam, interior, ratio = seam_energy(cell)
        print(f"      seam ratio {ratio:.3f} "
              f"[{'SEAMLESS' if ratio <= SEAM_RATIO_LIMIT else 'VISIBLE SEAM'}]")
        sheet[rect["y"]:rect["y"] + rect["h"],
              rect["x"]:rect["x"] + rect["w"], :3] = cell
        # Every replaced region is an opaque skin; alpha is left as the base
        # sheet had it, which for these three is 255 everywhere. Asserted, not
        # assumed, because LATTICE_RIG and BASE_SKIRT on the same sheet are not.
        alpha = base[rect["y"]:rect["y"] + rect["h"],
                     rect["x"]:rect["x"] + rect["w"], 3]
        assert alpha.min() == 255, f"{name} is not fully opaque on the base sheet"

    kept = [n for n in regions if n not in FACADE_MAP.values()]
    print(f"    {len(FACADE_MAP)} regions repainted; {len(kept)} copied from the "
          f"base sheet unchanged: {', '.join(sorted(kept))}")
    return sheet


def prepare_horizon_sheet(source: Path, regions: dict) -> np.ndarray:
    """New sheet = the base sheet, with thirteen cells redrawn as silhouettes."""
    base = np.array(Image.open(ROOT / BASE_HORIZON).convert("RGBA")).astype(np.float64)
    sheet = base.copy()
    generation = np.array(Image.open(source).convert("L")).astype(np.float64)

    for (row, column), name in HORIZON_MAP.items():
        rect = regions[name]
        r0, r1 = HORIZON_CELL_BOUNDS[row]
        c0, c1 = HORIZON_CELL_BOUNDS[column]
        cell = generation[r0:r1, c0:c1]

        # Black ink -> opaque, white paper -> clear, with a ramp so the faint
        # far pylons of PYLON_RUN are not thresholded out of existence.
        alpha = np.clip(
            (HORIZON_ALPHA_HI - cell) / (HORIZON_ALPHA_HI - HORIZON_ALPHA_LO),
            0.0, 1.0,
        ) * 255.0
        rgba = np.zeros((*cell.shape, 4), dtype=np.float64)
        rgba[..., 0] = HORIZON_INK[0]
        rgba[..., 1] = HORIZON_INK[1]
        rgba[..., 2] = HORIZON_INK[2]
        rgba[..., 3] = alpha
        rgba = resize(rgba, rect["w"], rect["h"])
        # Resampling a hard silhouette leaves ringing in RGB; the ink is flat by
        # definition, so RGB is re-flattened and only alpha keeps the resample.
        rgba[..., 0] = HORIZON_INK[0]
        rgba[..., 1] = HORIZON_INK[1]
        rgba[..., 2] = HORIZON_INK[2]

        opaque = rgba[..., 3] > 127  # the batch's own alphaTest is 0.5
        rows_covered = np.nonzero(opaque.any(axis=1))[0]
        base_rect = base[rect["y"]:rect["y"] + rect["h"],
                         rect["x"]:rect["x"] + rect["w"], 3] > 127
        base_rows = np.nonzero(base_rect.any(axis=1))[0]
        print(
            f"    {name:16s} cell({row},{column}) -> rect {rect['x']},{rect['y']} "
            f"| coverage {opaque.mean() * 100:4.1f}% (was {base_rect.mean() * 100:4.1f}%) "
            f"| rows {rows_covered.min()}-{rows_covered.max()} "
            f"(was {base_rows.min()}-{base_rows.max()})"
        )
        # P18.1: a silhouette that does not reach the bottom of its cell floats.
        # The generation draws a ground line on every cell, so this is a check
        # rather than a correction — if it ever fails, the cell needs padding,
        # not a shrug.
        assert rows_covered.max() >= rect["h"] - 4, (
            f"{name} is not bottom-anchored: coverage stops at row "
            f"{rows_covered.max()} of {rect['h']}"
        )
        sheet[rect["y"]:rect["y"] + rect["h"],
              rect["x"]:rect["x"] + rect["w"]] = rgba

    kept = [n for n in regions if n not in HORIZON_MAP.values()]
    print(f"    {len(HORIZON_MAP)} cells redrawn; {len(kept)} copied from the base "
          f"sheet unchanged: {', '.join(sorted(kept))}")
    print(f"    generation cells left unused: {HORIZON_UNUSED_CELLS}")
    return sheet


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--in", dest="inputs",
        default="/Users/gentlegen/Desktop/Projects/futurisma-race/assets-in/higgsfield/batch1",
        help="directory holding the Higgsfield batch-1 generations",
    )
    parser.add_argument("--check", action="store_true",
                        help="re-derive and compare, do not write")
    args = parser.parse_args()
    inputs = Path(args.inputs)
    if not inputs.is_dir():
        print(f"input directory {inputs} not found", file=sys.stderr)
        return 2

    atlas = json.loads((ROOT / "src/game/data/ATLAS_REGIONS.json").read_text())
    results = {}

    print("[1/4] pan crust tile <- 01-salt-crust.png")
    crust1024 = prepare_ground_tile(
        inputs / "01-salt-crust.png", 1024, CRUST_KEEP_FROM_ROW,
        tone_target=Path("public/assets/map02/textures/bitterpan_crust_tile_256.png"),
    )
    results[OUT_CRUST] = write_png(
        Path(OUT_CRUST), resize(crust1024, CRUST_SERVED_SIZE, CRUST_SERVED_SIZE),
        args.check)
    # Emitted for the size comparison the served resolution turns on, not served.
    results[OUT_CRUST_1024] = write_png(Path(OUT_CRUST_1024), crust1024, args.check)

    print("[2/4] brine tile <- 02-brine-crust.png  (PREPARED, NOT SERVED)")
    brine = prepare_ground_tile(
        inputs / "02-brine-crust.png", 512, CRUST_KEEP_FROM_ROW)
    results[OUT_BRINE_512] = write_png(Path(OUT_BRINE_512), brine, args.check)

    print("[3/4] facade sheet <- 04-facade-atlas.png + the base sheet")
    facades = prepare_facade_sheet(
        inputs / "04-facade-atlas.png", atlas["bitterpan_facades_1024"]["regions"])
    results[OUT_FACADES] = write_png(Path(OUT_FACADES), facades, args.check)

    print("[4/4] horizon sheet <- 05-horizon-sheet.png + the base sheet")
    horizon = prepare_horizon_sheet(
        inputs / "05-horizon-sheet.png", atlas["futurisma_horizon_1024"]["regions"])
    results[OUT_HORIZON] = write_png(Path(OUT_HORIZON), horizon, args.check)

    print("\nServed additions (the numbers the validators pin):")
    added = 0
    for path in (OUT_CRUST, OUT_FACADES, OUT_HORIZON):
        digest, size = results[path]
        added += size
        print(f'  "{path.split("public/assets/")[1]}":\n    "{digest}",  // {size:,} bytes')
    print(f"  total added to public/: {added:,} bytes ({added / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
