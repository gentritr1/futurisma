# Dream Island heroes — revised watchtower handoff

VERIFIED (`loader-check.json`, `visual-review.json`, `evidence-audit.json`): the watchtower rebuild is complete at the revised dimensions, with five refreshed Blender frames. VERIFIED (`watchtower-preservation-check.json`): the user-approved clock tower, waterfall cliff and sea-stack GLBs and their complete manifest entries are unchanged.

VERIFIED (user clarification): the required opening is a clear 14 × 8 m rectangle plus an arched cap reaching 10 m. The 14 × 10 m rectangle is the envelope; its upper corners contain masonry. This supersedes the earlier rectangular-box wording. No claim of 14 × 10 m rectangular clearance is made.

VERIFIED (`watchtower-turntable.png`, `watchtower-40m.png`): [four-view turntable](watchtower-turntable.png), [front](watchtower-front.png), [side](watchtower-side.png), [back](watchtower-back.png), [three-quarter](watchtower-three-quarter.png), [40 m readability](watchtower-40m.png). All full frames are 1280 × 960. The four turntables share one orthographic scale and contain literal 2 m rulers. The perspective frame is 40 m from the asset centre, with a 65° vertical field of view to fit the wider, taller drum.

## Exact commands

VERIFIED (`watchtower-build.log`, `blender-watchtower-render.log`, `loader-check.log`, `render-watchtower.log`, `evidence-audit.log`, `watchtower-preservation-check.log`): run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python art/blender/build_dreamisland_heroes.py -- --asset=watchtower > art/evidence/dreamisland-v1/heroes/watchtower-build.log 2>&1
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python art/evidence/dreamisland-v1/heroes/render_blender.py -- --asset=watchtower > art/evidence/dreamisland-v1/heroes/blender-watchtower-render.log 2>&1
export PATH=$HOME/.nvm/versions/node/v20.19.4/bin:$PATH
node scripts/visual/dreamisland-heroes/check.mjs > art/evidence/dreamisland-v1/heroes/loader-check.log 2>&1
node scripts/visual/dreamisland-heroes/render.mjs --asset=watchtower > art/evidence/dreamisland-v1/heroes/render-watchtower.log 2>&1
python3 art/evidence/dreamisland-v1/heroes/audit_evidence.py > art/evidence/dreamisland-v1/heroes/evidence-audit.log 2>&1
python3 art/evidence/dreamisland-v1/heroes/verify_preservation.py > art/evidence/dreamisland-v1/heroes/watchtower-preservation-check.log 2>&1
```

VERIFIED (`blender-render-check-watchtower.json`): Blender 5.2 / Cycles CPU / 24 samples / denoised. The renderer reimports the exported GLB, binds the existing atlas files and uses its exported vertex colours. Earlier build/render logs describe the superseded watchtower; the scoped commands and current hashes above are authoritative.

## Files and collision scope

VERIFIED (session write commands): this revision changes only the permitted namespaces:

- `art/blender/build_dreamisland_heroes.py`: rebuilt watchtower and added `--asset` filtering to preserve approved exports.
- `public/assets/dreamisland/heroes/watchtower.glb` and `heroes.json`: revised export and only its manifest entry.
- `scripts/visual/dreamisland-heroes/`: the 20-line `check.mjs`, `inspect.mjs`, new `watchtower-check.mjs`, and scoped WebGL renderer/viewer.
- `art/evidence/dreamisland-v1/heroes/`: render/audit/preservation scripts, watchtower PNGs, updated contact sheets, atlas checks, measurements, logs and this report.

VERIFIED (session tools and `watchtower-preservation-check.json`): no AI image, texture or 3D generator was used; this task wrote no Phase B file and issued no commit command. The shared branch advanced from `9109b6f` to `e45875030d00a6f04e50d765f8fecab6c2846c7b` (`feat(dream-island): Map 07 phase B — painted world, atlases, two-sampler sky, water, esses`) during the final audit. Asset preservation and loader checks were rerun successfully after that commit. No `.blend` was saved outside the user's write scope.

## Measured assets and budgets

VERIFIED (`node scripts/visual/dreamisland-heroes/check.mjs`): measurements below come from the exported GLBs through three r184. Bounds use X / Y / Z metres. All requested target dimensions pass the 2% tolerance.

| Asset | Metres achieved | Bounds min → max | Triangles / budget | Meshes | Bytes |
|---|---|---|---:|---:|---:|
| VERIFIED clock tower | plinth 8 × 8; height 14; face Ø3.2 | -4 / 0 / -4 → 4 / 14 / 4 | 4,804 / 6,000 | 11 | 426,040 |
| VERIFIED watchtower | height 30; base width 28; crown width 20; bore spring 8 / crown 10 | -14 / 0 / -14.251359 → 14 / 30 / 14.251359 | 9,278 / 10,000 | 13 | 802,640 |
| VERIFIED waterfall cliff | width 21.945; drop 16 | -10.9725 / 0.045 / -8.016 → 10.9725 / 16.045 / 3.31 | 1,200 solid / 5,000 + 12 cards | 6 | 111,384 |
| VERIFIED sea stacks | heights 18 / 26 / 32 / 40 | -32.800385 / 0 / -5.829976 → 35.727273 / 40 / 5.812896 | 208 / 288 / 384 / 424; each ≤1,500 | 8 | 112,724 |

VERIFIED (`loader-check.json`, `heroes.json`): the watchtower's sculpted portal trim brings overall depth to 28.502718 m; base width is exactly 28 m. The lower drum keeps its width to Y=10, then tapers to the crown, preserving the required flanks. The upper chamber starts at Y=17.

VERIFIED (`loader-check.json`, prior export record): watchtower triangles changed from 6,384 to 9,278 against the revised 10,000 cap, leaving 722 triangles. The four heroes total 16,598 triangles and 38 mesh primitives. Every GLB is below 1 MB and contains zero textures/images. Watchtower materials are exactly `DI_MAT_concrete` and `DI_MAT_jungle`; all heroes retain the shared atlas material contract.

## Loader output and arch clearance

VERIFIED (`loader-check.log`): condensed output follows; the JSON/log contain the full per-mesh census.

```text
VERIFIED clock-tower: meshes=11 triangles=4804 boundsSize=[8, 14, 8] materials=DI_MAT_concrete,DI_MAT_emissive,DI_MAT_jungle,DI_MAT_metal embeddedTextures=0 bytes=426040
VERIFIED watchtower: meshes=13 triangles=9278 boundsSize=[28, 30, 28.502718] materials=DI_MAT_concrete,DI_MAT_jungle embeddedTextures=0 bytes=802640
VERIFIED waterfall-cliff: meshes=6 triangles=1212 boundsSize=[21.945, 16.0, 11.326] materials=DI_MAT_concrete,DI_MAT_jungle,DI_MAT_jungle-card,DI_MAT_water embeddedTextures=0 bytes=111384
VERIFIED sea-stack-set: meshes=8 triangles=1304 boundsSize=[68.527658, 40, 11.642872] materials=DI_MAT_concrete,DI_MAT_jungle embeddedTextures=0 bytes=112724
VERIFIED three r184: all four GLBs loaded; dimensions, budgets, materials, atlas UVs and texture absence passed.
VERIFIED watchtower 14 x 8 m rectangle plus arched cap to 10 m through full depth: 0 intersecting triangles.
```

VERIFIED (`watchtower-check.mjs`, `loader-check.json`): all 9,278 exported triangles are transformed to world space. The test uses box/triangle SAT for the rectangle and clips triangles against the 32-segment arch profile through the entire depth. Nominal rectangle: X=[-7,7], Y=[0,8], Z=[-15.251359,15.251359]. A 1 mm interior tolerance permits contact with the authored jamb/floor/ceiling boundaries. Both the rectangle and complete arched volume have zero interior intersections.

VERIFIED (`loader-check.json`): the 14 × 10 envelope intersects 1,168 triangles in its upper corners, as expected for the true arch confirmed by the user. Ceiling ray samples at Z=-10/0/10 measure Y=9.999986 near the shared apex edge; the chamber floor is Y=17, leaving 7.000014 m above those samples. Six flank samples at Y=1/4/7.5 and Z=0 measure exactly 7 m from each jamb to the exterior. Moss vertices cover all twelve angular sectors of the drum and carry exported vertex tint.

VERIFIED (`loader-check.json`): merlon vertices occupy slots 0,2,3,4,6,7,9,10,11; exactly slots 1,5,8 are missing. Both arched windows, both voussoir groups, both keystones and the tunnel anchor are present. Existing clock, waterfall and natural sea-stack arch assertions also pass.

## Five features per asset

VERIFIED (`visual-review.json`, named frames; exact dimensions/counts from `loader-check.json`): watchtower frames were inspected after the rebuild. The other three approved assets retain their existing verified views, and their hashes are unchanged.

| Asset | Feature | Frames | Observation |
|---|---|---|---|
| clock-tower | stepped three-tier plinth | [front](clock-tower-front.png), [three-quarter](clock-tower-three-quarter.png) | VERIFIED — Three distinct plinth tiers are visible. |
| clock-tower | square mossy shaft with visible block courses | [front](clock-tower-front.png), [back](clock-tower-back.png) | VERIFIED — Square block courses and moss patches read; recessed backing closes sky leaks in the shaft. |
| clock-tower | round white 3.2 m face with two plain metal hands | [front](clock-tower-front.png), [three-quarter](clock-tower-three-quarter.png) | VERIFIED — The white round face has exactly two visible plain geometry hands. |
| clock-tower | pitched hip roof with finial | [front](clock-tower-front.png), [side](clock-tower-side.png) | VERIFIED — Four pitched roof faces meet the finial. |
| clock-tower | winding side stair with stepped stone parapet | [side](clock-tower-side.png), [back](clock-tower-back.png), [three-quarter](clock-tower-three-quarter.png), [40m](clock-tower-40m.png) | VERIFIED — Separate stair risers and the stepped parapet are readable at 40 m in the 50-degree-VFOV frame. |
| watchtower | tapered drum with individual block courses | [side](watchtower-side.png), [three-quarter](watchtower-three-quarter.png), [40m](watchtower-40m.png) | VERIFIED — The full drum has broad solid flanks, a vertical lower section through the arch and a tapered upper section. Recessed mortar keeps the block courses continuous. |
| watchtower | twelve crenellation slots with exactly three missing merlons | [three-quarter](watchtower-three-quarter.png), [back](watchtower-back.png) | VERIFIED — Nine merlons are present; the exported vertices leave exactly slots 1, 5 and 8 empty. |
| watchtower | two recessed arched windows on opposite faces | [front](watchtower-front.png), [back](watchtower-back.png) | VERIFIED — An arched window is recessed above each mouth; both openings have dark backs and stone frames. |
| watchtower | full-depth arched tunnel with a keystone at both mouths | [front](watchtower-front.png), [back](watchtower-back.png), [three-quarter](watchtower-three-quarter.png), [40m](watchtower-40m.png) | VERIFIED — The shallow elliptical through-arch has individually separated voussoirs, straight jamb stones and a central trapezoidal keystone at each mouth. |
| watchtower | lower-third ivy and moss with jungle atlas and vertex tint | [front](watchtower-front.png), [side](watchtower-side.png), [three-quarter](watchtower-three-quarter.png) | VERIFIED — The green band wraps the curved structural drum and tunnel surfaces. Exported vertex colours vary across its height and around its circumference. |
| waterfall-cliff | stacked mossy stone block cliff with ledges | [front](waterfall-cliff-front.png), [three-quarter](waterfall-cliff-three-quarter.png) | VERIFIED — Stacked masonry blocks and moss caps read; a recessed backing closes joint sky leaks. |
| waterfall-cliff | elliptical plunge-pool foam ring mesh | [three-quarter](waterfall-cliff-three-quarter.png) | VERIFIED — A complete cyan foam ring is visible in the three-quarter frame. |
| waterfall-cliff | two blossom clumps on the existing jungle-card sheet | [front](waterfall-cliff-front.png), [three-quarter](waterfall-cliff-three-quarter.png) | VERIFIED — Two separate blossom clumps use the existing keyed sprite. |
| waterfall-cliff | projecting block ledges that cast distinct shadows | [side](waterfall-cliff-side.png), [three-quarter](waterfall-cliff-three-quarter.png) | VERIFIED — Ledges project in side view and cast clear shadows in the three-quarter view. |
| waterfall-cliff | overhanging top lip with waterfall_sheet_anchor | [side](waterfall-cliff-side.png), [three-quarter](waterfall-cliff-three-quarter.png) | VERIFIED — The overhanging lip is visible; the named anchor measures Y=16 over the pool datum Y=0. |
| sea-stack-set | four tapered block silhouettes | [front](sea-stack-set-front.png), [three-quarter](sea-stack-set-three-quarter.png) | VERIFIED — All four tapered silhouettes are visible together from front/back/three-quarter. |
| sea-stack-set | individual moss caps | [three-quarter](sea-stack-set-three-quarter.png) | VERIFIED — All four moss caps are visible in the three-quarter view. |
| sea-stack-set | one natural through-arch in the 32 m stack | [front](sea-stack-set-front.png), [back](sea-stack-set-back.png) | VERIFIED — The 32 m stack has a visible through-arch in front and back. |
| sea-stack-set | four different lean/profile combinations | [front](sea-stack-set-front.png), [three-quarter](sea-stack-set-three-quarter.png) | VERIFIED — The short buttress, needle, arch and overhanging tall profiles differ in lean and outline. |
| sea-stack-set | distinct buttress, needle, arch and overhanging tall silhouettes | [front](sea-stack-set-front.png), [three-quarter](sea-stack-set-three-quarter.png), [300m](sea-stack-set-300m.png) | VERIFIED — All four profiles remain separated and distinguishable against the sky at 300 m / 50-degree VFOV. |

## Rendered atlas and evidence checks

VERIFIED (`render-check.json`, `evidence-audit.json`): seven atlas-cell point probes and 175 rendered grid samples match the decoded source texels, with maximum channel error 0/255. The separate magenta-key discard check also passes; there are zero browser errors. The watchtower's current consumer UVs are checked against the jungle `moss-blossom` cell: [rendered cell](atlas-pixel-4-jungle.png). The other probes cover concrete wall/paving, metal clock ring/hands, emissive clock face, water foam and the jungle-card blossom sprite. Signage has no consumer in these heroes.

VERIFIED (`loader-check.json`): the shared atlas manifest and every source atlas hash still match the build inputs. No atlas file was changed.

VERIFIED (`evidence-audit.json`): all 19 Blender frames match the current GLB hashes: 16 orthographic turntable views with complete 2 m rulers, plus clock 40 m, watchtower 40 m and sea stacks 300 m. The clock and stack perspective views use 50° VFOV; the watchtower uses 65°. The four watchtower elevations share one orthographic scale. Supplementary WebGL evidence also contains 19 frames; only the watchtower captures were refreshed in this revision. The approved clock/cliff/stack Blender source frames were retained.

## Remaining scope

UNVERIFIED (separate integration task): runtime placement, shared-material binding in the game, clock animation, waterfall cards, full-game lighting/fog, map draw/triangle budgets, shadow passes, race soak/laps/missed gates/p95 and `test:code` with these heroes. Runtime and Phase B changes are outside this task. No game-integration or performance acceptance is claimed.

VERIFIED (`watchtower-preservation-check.json`, loader/render/audit results): the requested standalone watchtower rebuild and evidence are complete; the other three approved GLBs remain unchanged.
