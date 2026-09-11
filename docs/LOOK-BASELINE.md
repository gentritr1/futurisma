# The look, measured

The user's report was "it looks pale". This is that report turned into numbers, so
any polish target is a delta against a measurement rather than an adjective.

Instrument: `scripts/visual/grade/measure-frames.py` (Pillow + numpy). Per frame it
reports BT.709 luma mean/stdev, HSV saturation, **CIELAB chroma**, luma percentiles,
and the share of pixels below 16 / above 239.

**Use CIELAB chroma, not HSV saturation.** HSV reads a dark tinted pixel as fully
saturated, which made Polarity and Tideline look vivid at satMean 158 when their
actual chroma is 11-13. Every conclusion below uses chroma.

## Base: the shipped game

10 HUD-free Ascension station frames (`art/evidence/ascension-v1/phase-e/stations/base-*.png`),
whole frame:

| | mean | worst | best |
| --- | ---: | ---: | ---: |
| CIELAB chroma | 9.47 | 6.32 (TRENCH) | 11.92 (TANK_FARM) |
| p99 luma | 182.99 | 154.8 | 191.5 |
| luma stdev | 46.31 | 40.02 | 52.47 |
| **pixels over 239** | **0.00 %** | 0.00 % | 0.00 % |

6 in-race frames at 1280x720 across all five circuits, world band only, agree:
chroma 7.9-12.8, p99 94-201, **whitePct 0.00 on every one**.

## Reference: art this project already made and liked

Same instrument, same units.

| frame | chroma | p99 | over 239 |
| --- | ---: | ---: | ---: |
| `art/references/.../ascension-01-apron.png` | 5.89 | **254.3** | 3.33 % |
| `art/references/.../ascension-04-launch.png` | 7.33 | **243.5** | 1.08 % |
| `art/references/.../atlas-jungle-gptimage2.png` (source texture) | **18.73** | 249.0 | 9.98 % |
| `art/references/.../atlas-signage-gptimage2.png` (source texture) | 12.85 | 180.0 | 0.00 % |

## What the numbers say

1. **The world never reaches white.** Not one pixel over 239 in 16 frames across five
   circuits. The concept renders reach a p99 of 243-254; the game caps at 183. Roughly
   60-70 levels of highlight range are simply unused.
2. **The render halves the chroma of its own art.** The jungle atlas texture measures
   chroma 18.7 going in. The rendered world measures 9.5 coming out.
3. **It is not a saturation problem.** The painted hero everyone liked
   (`device-road-pair-v3/pair-1-A.png`) is itself only chroma 9.33. It reads rich
   because of range and specular, not because of saturation. Turning up a saturation
   slider would make the game garish and still flat.

So "pale" is a highlight-range and material-response problem. Any fix must move
whitePct off zero and p99 toward the 240s, and must stop discarding texture chroma.

## Rule for anyone writing a target here

Run this script on the frame you are pointing at and quote the delta. A chroma or
contrast target that was not produced by this instrument is not a target, it is a wish.
