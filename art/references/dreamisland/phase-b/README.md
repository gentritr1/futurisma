# Dream Island — Phase B kit (atlases, card sheet, sky sources)

Generated 2026-09-09, 9 images, **4.5 credits** (balance 57.98 → 53.48). Every image was opened and given a verdict; the verdicts, verbatim prompts and job ids are in `generation.json` (the same record Ascension keeps in `art/references/ascension/generation.json`).

| File | Role | Verdict (short) |
|---|---|---|
| `atlas-concrete-gptimage2.png` | concrete | KEEP — sand road / causeway paving / cyan kerb / wall blocks |
| `atlas-metal-gptimage2.png` | metal | KEEP — chevron strip / rail / bronze clock ring + hands / lamp post |
| `atlas-jungle-gptimage2.png` | jungle | KEEP — bark / moss + blossoms / leaf fill / sand |
| `atlas-water-gptimage2.png` | water | KEEP — caustic shallows / cobalt facets / foam gradient / waterfall |
| `atlas-signage-gptimage2.png` | signage | KEEP — DREAM ISLAND / 07 / 1–6 / BEACH, all exact; plates only, not the green field |
| `atlas-emissive-gptimage2.png` | emissive | KEEP — foam glow / shallows glow / lamp / clock face (hands drew as one line: use metal hands) |
| `atlas-jungle-card-gptimage2.png` | jungle (magenta key) | KEEP — frond / fern / blossom shrub / goldfish; discard key as `ascension-materials.ts` does |
| `sky-day-gptimage2.png` | sky, day | KEEP source, 1344×576 → resample to 4096×1024, must pass `sky-profile.py` |
| `sky-night-gptimage2.png` | sky, night | KEEP source, same path; clear starfield by design (cloud band can only add light) |

**Quadrant convention:** 2×2 at 1024², rects TL/TR/BL/BR with a 0.004 inset from the gutters. **Chosen atlas resolution for this map: 1024² for all six roles** (Tideline precedent; not Ascension's 1254² mismatch).

The heroes, day/night pairs and the two orthographic model sheets are one level up in `../heroes` and `../sheets`.
