# Surface and lighting finish — 2 October 2026

This pass adds material detail to all nine circuits, real shadow reception on the two custom city road shaders, and low-profile service grates in selected sectors. The existing map palettes, lane paint, caustics, snow coverage and race mechanics remain authoritative.

Open the [comparison gallery](../art/evidence/surface-finish/index.html) through Vite at `http://127.0.0.1:5218/art/evidence/surface-finish/index.html`. These are actual game captures, with matching cameras. Weather and moving props can vary. The `surfaceFinish=0` comparison disables the road/detail installation; city structural shadow flags remain enabled in both sets.

## Art decisions

The image-generation skill produced a neutral 1024-square aggregate tile. The [exact prompt](../art/references/surface-finish/prompt.txt) and [original PNG](../art/references/surface-finish/asphalt-original.png) are retained. The served JPEG is 523,316 bytes. It supplies restrained scalar variation at approximately 4 m and 19 m scales rather than replacing the authored albedo. Contrast fades over 45–180 m to keep distant road cues clean. Existing PS2 filtering remains deliberate; AgX uses mipmaps and anisotropic filtering.

Night Shift and Polarity previously used road shaders without shadow reception. Their shaders now receive the existing directional shadow map and use a view-dependent wet response. Opaque structural families cast shadows; nearby off-screen structures remain eligible within 200 m so shadows do not disappear when the driving camera turns. Three independently culls meshes for color and shadow cameras. This adds caster work but no new shadow map, light or fullscreen pass.

Service grates use balanced pairs on the existing road frame. Dark backing, closed end frames and intermediate crossbars give them a seated appearance. Map-specific insets avoid lane-edge paint, raised kerbs and snowbanks. Bitterpan uses dust-muted metal; the other circuits use dark steel. Polarity grates currently serve the lower deck. These are visual details, not collision obstacles or new power-up cues.

## Runtime bounds and tradeoffs

- One shared selected-map texture, plus two texture samples on selected surface materials.
- One instanced grate draw per map: 120 or 140 boxes, 1,440 or 1,680 rendered triangles. There is no per-frame grate update.
- A lazy optional environment hook loads this pass after the authored environment. Failed module/image loads preserve race startup; cancellation releases late textures.
- The texture has one explicit reference-counted disposal owner. The instance buffers release when their geometry is disposed. Repeated application is ignored.
- Initial JavaScript measures 995.230 KiB raw / 274.926 KiB gzip; the initial compressed shell is 287.203 KiB. The raw-JS and shell limits each increased by 0.5 KiB for the hook/preload plumbing and shared render-mode export. The 275 KiB compressed-JS limit remains. The image and shader implementation remain outside the initial shell.
- This is a visual integration pass, not an FPS benchmark or a full commercial-quality certification. GPU performance still needs measurement across target devices. Large terrain transitions, some stretched legacy textures and low-detail vegetation remain candidates for future authored-art work.

## Verification

- TypeScript and production build; lazy-chunk and download budgets.
- Existing graphics-resource, lighting, shadow, render-mode and module-boundary validators.
- Nine-map Chrome GPU run: surface material application, road/site/detail captures, running/paused/reset clocks, existing map-specific state changes, resource disposal and no shader/runtime errors.
- Separate startup runs with blocked surface module, blocked image, reduced motion, PS2 rendering and disabled shadows.
- Surface ownership test covers repeated application, shared custom/standard shader texture ownership, instance-buffer disposal and cancellation after texture load.
- Fresh read-only review identified optional-import failure and camera-based shadow popping; both were fixed before final verification.

Reproduce with `node scripts/race-polish/signatures.mjs --surfaces`, `node scripts/race-polish/signatures.mjs --surfaces --before`, `node scripts/race-polish/surface-fallback.mjs` and `node scripts/race-polish/surface-ownership.mjs` while Vite runs on port 5218. Browser checks use the local Google Chrome application through Playwright. Camera placement is a controlled presentation fixture, not an automated racing performance score.
