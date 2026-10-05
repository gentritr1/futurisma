# Frostline grounding (2026-10-05)

Owner report: Map 09 props "on the air". Cause: every prop stood at the road
centre's height for its lap progress, while the ground beside the road was a
flat slab at y = -3 (road runs from -1 to +44 m) plus per-segment bank slabs
out to about 44 m, with gaps between them on curves.

Fix: `src/game/frostline-terrain.ts` is one heightfield mesh (12 m grid, 29,040
triangles) that follows the road and settles to the old -3 m valley floor 284 m
out. It replaces the -3 m slab and the 480 bank slabs. Buildings and holiday
sites get level terraces cut into it. Every grounded prop now stands at the snow
height under its own (x, z). Roadside boards, flags, fence rails and ribbon bows
that had no supports now have posts. The red road rails now reach 1.6 m into the
snow, so no gap opens under them where a terrace is cut lower than the road.

## Audit: before and after (same instrument, same classification)

`gap` is the closest bottom probe's height above the snow directly below it. An
object resting on another grounded object (probe test, or touching one that
reaches as low) counts as 0. Counts reconcile: objects = audited + ground meshes.
The +332 grounded props after the fix are the new posts (312) and sleigh struts (20).

| family | before: count / >0.5 m / >2 m / >10 m / max | after |
| --- | --- | --- |
| forest cones (70-200 m) | 910 / 865 / 865 / 509 / 53.6 m | 910 / 0 / 0 / 0 / 0 |
| roadside pines (31-75 m) | 285 / 121 / 121 / 69 / 49.7 m | 285 / 0 / 0 / 0 / 0 |
| village chalets | 378 / 31 / 29 / 19 / 33.2 m | 378 / 0 |
| outpost chalets | 144 / 5 / 3 / 0 / 2.3 m | 144 / 0 |
| holiday life (residents, carts, rink, train, sleighs) | 1729 / 241 / 162 / 37 / 30.5 m | 1749 / 0 |
| road rails, snow lips, lane strips | 5440 / 98 / 95 / 36 / 46.8 m | 5440 / 0 |
| lantern posts | 270 / 9 / 8 / 0 / 7.7 m | 270 / 0 |
| festive ribbon bows | 36 / 9 / 9 / 9 / 13.8 m | 48 / 0 (poles added) |
| snow/ice signs | 10 / 8 / 8 / 0 / 4.3 m | 30 / 0 (posts added) |
| festive flags | 16 / 5 / 5 / 0 / 4.6 m | 48 / 0 (poles and crossbars added) |
| fence rails, benches/gifts, market crates | 400 / 5 / 0 / 0 / 1.8 m | 628 / 0 |
| large pines on mounds, pine mounds, distant hills, arch pillars, garland poles, christmas tree, clock tower, market stalls, winter devices, chevron panels | 0 over 0.5 m before (the mounds sit at p 0.02-0.16, where the road is low) | 0 |
| **all grounded props** | **10,538 / 1,397 / 1,305 / 679 / 53.6 m** | **10,870 / 0 / 0 / 0 / 0** |

Before the fix, the floating props were spread over all ten lap deciles. The full
tables are in `audit-before.json` and `audit-after.json`. The first, stricter run
without the contact rule found 2,707 props over 0.5 m.

Also measured, after the fix:
- **Road deck.** The snow never rises through it. 0 of 13,440 deck samples have
  snow above the road; the closest snow is 0.197 m under it (`validate:frostline`
  checks 0.209 m over 1,920 × 27 points).
- **Terrain slope.** 0 triangles steeper than 45°, 41 steeper than 30°, maximum 35°.
- **Gondola cars.** At least 30.9 m above the snow along the whole cable (37 m before).
- **Signature yard** (shared `circuit-signatures`, outside `env.root`). The snow
  is 0.25-0.36 m under its origin. Before, it was 0.11-3.39 m under.
- **Buried.** 33 holiday objects, all ground-level detail: 31 ice puddle tiles
  1.5 cm thick, up to 0.36 m under the snow, and 2 resident shoes,
  0.14 m under.
- **Deepest embed of grounded models on slopes.** Village chalet 0.88 m, outpost
  chalet 0.44 m, pine trunk 0.87 m. Forest cones go up to 3.7 m into the uphill
  side of the steepest slopes, because a cone's base must not overhang the slope.

**Excluded from the grounded headline** (still measured; "loose" means not
touching anything grounded):
- Particles and lines: falling snow, chimney smoke, lamp glows, cocoa steam,
  fireworks, firework trails, snowball burst. 7 drawables.
- Sky dome; road puddle reflector (a decal on the road); hidden snowball projectile.
- Gondola cars (15 meshes) and their 2 cables, which hang from fixed points.
- Garland swag. 450 objects, 0 loose, hung between the garland poles.
- Arch beams, signs and swag. 294 objects, 0 loose, spanning the arch pillars.
- Cocoa cart signs. 12 objects, 0 loose, hung under the canopy (raised 8 cm so
  they touch it).
- Bulbs and lamp heads. 3,911 objects. 483 hang off swags and arches or ring
  the decorated trees.
- Christmas tree ornaments. 56 objects, 2 hang off branch tips.
- Holiday glow discs. 14 additive ground decals.

## Rendering cost

Measurements come from `?diagnostics` (the `#futurisma-diagnostics` JSON) in a
demo race at the same race-clock times. The calls and triangles shown are for
the frame shown.

| clock | sector | calls before → after | triangles before → after |
| --- | --- | --- | --- |
| 5 s | Christmas Square | 134 → 141 | 1,714,260 → 1,742,332 |
| 14 s | Lantern Climb (gate 02/06) | 235 → 228 | 1,726,876 → 1,753,454 |
| 22 s | Gondola Ridge | 177 → 180 | 1,722,574 → 1,751,442 |
| 31 s | Frosted Forest | 152 → 154 | 1,715,148 → 1,741,032 |
| peak over 0-31 s | | 248 → 245 | 1,745,744 → 1,773,068 |

Static environment: 330 → 331 meshes (+1, the terrain), 1,729,542 → 1,756,794
triangles (+27,252, +1.6%). The extra posts join existing instanced batches, so
they add no draw calls. The terrain is built at map load in about 35 ms warm
(75 ms cold) in desktop Chrome, and 128 ms in Node.

Build (`validate:build`): the shell is unchanged at 288.5 KiB gzip, and the
initial JS is unchanged at 996.4 KiB raw / 276.1 KiB gzip across 28 files.
Frostline still loads lazily. The `frostline-environment` chunk grows from
42,622 B raw / 13,767 B gzip to 50,323 B raw / 16,583 B gzip, because it now
includes the terrain. `npm run test:code` exits 0.

## Screenshots

Demo race, 1280x720, JPEG 80. Each pair is taken at the same race-clock time
(±0.07 s): `before-<t>s.jpg` and `after-<t>s.jpg` for t = 5 (village chalets),
14 (Lantern Climb, the owner's "NEXT GATE 02 / 06" view), 22 (top of the climb,
Gondola Ridge; the forest cones hanging in the sky on the right are gone after)
and 31 (Frosted Forest).

## Re-run

```sh
ln -s <main checkout>/node_modules node_modules       # worktree only
npx vite --port 5191 --strictPort --host 127.0.0.1 &  # dev server for THIS checkout
node --experimental-websocket scripts/frostline/grounding-audit.mjs /tmp/audit.json
node --experimental-websocket scripts/frostline/grounding-shots.mjs after --out=/tmp/shots --times=5,14,22,31
npm run validate:frostline                             # terrain/road invariants, no browser
```

Both browser scripts launch their own headless Chrome over CDP (ports 9333 and
9334, `scripts/frostline/cdp.mjs`). They kill only the PID they started, and a
guard timer kills it on timeout. For "before", check out
`origin/main -- src/game/frostline-{environment,holiday-life,winter-effects}.ts`
and rerun.
