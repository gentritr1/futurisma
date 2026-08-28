# FUTURISMA — Core Runtime Completion Audit

Recorded: 2026-08-24  
Updated: 2026-08-28
Implementation state: validated working tree, pending commit
Scope status: **CORE RUNTIME + GREENWATER v1.2/v1.3/v1.4/v1.5/v1.6 FINAL FREEZES + FOUR-SHIP RACE FOUNDATION INTEGRATED**

This audit closes the first requested production phase: security, browser
performance, deterministic game physics, controls, race rules, audio lifecycle,
graphics-resource lifecycle, interruption handling, and responsive gameplay UI.
The accepted Greenwater v1.0 runtime is now the primary environment. The
procedural route, collision, gates, hazards, recovery and turn guidance remain
authoritative; the earlier Phase 1 prop dressing is retained only as a
load-failure fallback.

## Acceptance matrix

| Requirement | Status | Authoritative evidence |
| --- | --- | --- |
| Accepted source assets remain locked | PASS | `npm run validate:assets` and `npm run validate:race-presence`: 12 accepted TOTEM files match; Greenwater v1.0 remains byte-locked; the 59-file v1.2, 70-file Living World v1.3, 111-file Surface Character v1.4, 185-file Facility Story v1.5 and 65-file Race Presence v1.6 final freezes verify every manifest entry. The accepted v1.5 review hash remains recorded but its exact bytes are locally unavailable; the rejected later candidate is quarantined and the accepted final archive remains authoritative without re-baselining. |
| Greenwater route remains locked | PASS | `npm run validate:map`: 1,258 samples, 2,515.982 m, eight gates, nine music states. |
| Deterministic high-speed physics | PASS | `npm run validate:physics`: 330.0 km/h cruise, 403.2 km/h boost, smooth 379.9→346.2 km/h post-boost carry, 98.1 m finish run-out, and 0.002 m/s 60/120 Hz speed drift. |
| Long-session physics stability | PASS | The 240-second mixed-control soak repeats boost exhaustion/recovery and drift entry/exit with 0.017% 60/120 Hz distance drift. |
| Authored wet handling | PASS | Water Table reaches 0.805 grip and recovers to 0.990 without a one-step snap; 60/120 Hz difference stays below 0.001. |
| Checkpoints, finish, recovery, hazards, and wrong-way behavior | PASS | `npm run validate:race` covers forward crossings, wraparound, missed-gate extra circuit, finish filtering, open-edge recovery telemetry, cable contacts, and hysteretic wrong-way warnings. |
| Deterministic rival race | PASS | `npm run validate:rivals` proves 120 Hz fixed-step equivalence, bounded lines, monotonic unwrapped distance, five exact lap crossings, stable ranking/gaps, safe-state recovery, no rubber-banding, and an 8.9-second three-rival finish spread. |
| Manual control ownership | PASS | `npm run validate:control` proves sanitized analogue input, keyboard priority, single-owner action edges, deliberate showcase takeover, and interruption-safe release gating. Neutral input creates no steering assistance. |
| Camera and presentation stability | PASS | Camera lens/shake tests are deterministic at 60/120 Hz; high-refresh presentation tests pass at 144/165/240 Hz. Live camera range remains 56.02–70.49°. |
| Audio timing and lifecycle | PASS | Audio control is capped at 30 Hz; 174 BPM F-minor stem transitions are bar-quantized. Suspended clocks create zero transient nodes; click-started runs release every voice to zero. |
| GPU and scene-resource lifecycle | PASS | Shared resources dispose exactly once. The integrated world, rival field, static v1.4 surface layer and v1.6 TOTEM race-presence pass stabilize at 127 geometries and 28 textures, request TOTEM once, reuse the environment's jungle/emissive sheets, and do not load the fallback kit. |
| Frame scheduling and adaptive quality | PASS | Ready, paused, and settled-result worlds skip simulation/audio/draw work. Quality tiers remain resize-safe with a 540-line target and 360-line floor. |
| Browser performance envelope | PASS | Race Presence v1.6 five-lap run: 9.8 ms p95, 10.9 ms maximum sampled frame, 85 peak calls, 66,308 peak triangles, 127 geometries, and 28 textures at a native 1600 × 900 internal render. All five laps completed cleanly in 02:52.800. |
| Bundle budget | PASS | Production shell remains within its tested raw and gzip ceilings. The 5.9 MiB environment GLB loads asynchronously and is excluded from initial JavaScript. Validation measures every initial HTML-referenced script and stylesheet against raw and gzip ceilings. |
| Browser security policy | PASS | `npm run validate:security` verifies strict CSP, HSTS and the remaining production response headers, pinned dependency versions, and absence of unsafe DOM, code-evaluation, storage, or network sinks. |
| Dependency advisories | PASS | Fresh `npm audit --audit-level=high`: zero vulnerabilities. |
| Restart/interruption resilience | PASS | Same-page consecutive trials reproduce 34.483 s, identical camera range/resources, zero retained audio/particles, and one vehicle request. Focus loss and WebGL loss require a fresh resume action. |
| Responsive gameplay UI | PASS | Live 1600×900 and 390×844 captures show no document overflow or critical HUD overlap; start focus, drift instruction, finish distance, turn direction, checkpoint, speed, timing, and boost remain readable without audio. |

The complete measurement history and environment-integration regression gates
remain in `docs/PERFORMANCE_BASELINE.md`.

## Explicit non-claims

- The automated brightness metric is not treated as proof of route readability.
  Native chase-camera inspection separately accepted every named sector and the
  Hangar, Sweep, Fuel Row and finish hard gates.
- The six current atlases are deterministic code-painted production sheets, not
  hand-painted replacements. Their frozen layout supports a later byte-for-byte
  texture swap without changing geometry or UVs.
- The accepted v1.0 archive remains byte-locked as historical source evidence.
  Visual Identity v1.2 bakes the approved signage state into its GLB atlas: the
  repeated authored distance faces and lap numeral are absent, while the dark
  fixture and header bar remain. No runtime texture alteration is active.
- Living World v1.3 is a render-time sibling layer. Its final freeze does not
  alter or re-baseline the accepted v1.2 runtime, atlases, placements or
  gameplay data.
- Surface Character v1.4 is integrated from its accepted final freeze. Its GLB,
  atlas and review-to-freeze boundary are byte-locked, and the completed native
  integration measurement is recorded canonically with `final_v14_freeze: true`.
- Facility Story v1.5 is integrated from its accepted deterministic final
  freeze. Its 60-mesh / 61,798-triangle GLB, two reserved atlas-slot changes,
  review-to-freeze boundary and native integration record are byte-locked.
  `final_v15_freeze` is true.
- Race Presence v1.6 is integrated from its accepted deterministic final
  freeze. Its baked TOTEM GLB, eight-slot effects atlas, NEEDLE 16 livery,
  review-to-freeze boundary and native integration record are byte-locked.
  `final_v16_freeze` is true.
- Rival collisions, additional vehicle models and later maps remain outside
  this foundation acceptance. The three rivals deliberately share TOTEM
  geometry; NEEDLE 16 replaces the temporary baseline identity while
  Privateer and Nightform retain their accepted Phase 1 atlases.

## Final environment handoff

`GREENWATER_ENVIRONMENT_v1.0.zip` remains preserved with archive SHA-256
`a773bf7f6f7e6ab160dfba385d67455e2ff7a9ade57369fafd416310825564af`.
The final `GREENWATER_VISUAL_IDENTITY_v1.2.zip` is **ACCEPTED AND INTEGRATED**
with archive SHA-256
`13da5c6212ab98e95956db063fa671cb0f484a9e3861abf0e40cf973de07782a`.
Its canonical runtime GLB SHA-256 is
`95bef29dc29781a0f0c2f12f9cf4b8cf59c1d9a3254dd3b86f7cff7cbad73bd9`.
Independent validation passes all 59 archive entries, all 58 declared hashes,
the deterministic archive rebuild, 2,401 placements, seven upgrades, 63 merged
runtime meshes, 60,138 triangles, six materials, six textures, every hard gate,
and exact production-asset identity with the accepted Pass 1 review.

Greenwater Visual Identity v1.2, Living World v1.3, Surface Character v1.4,
Facility Story v1.5 and Race Presence v1.6 are complete, integrated,
independently accepted and preserved as deterministic final freezes.

## Greenwater Living World v1.3 integration acceptance

The accepted final archive is locked at SHA-256
`72984328ef3005619e4c69991da46c1c9e21282a113d1b3ffc873a57e9b3191c`.
Its production files are byte-identical to review archive
`73acf9125abd34389c74b3e4b6dfa972e5393163feaecce47571d6bcc58ce56f`.
The game now uses its reviewed 12-sector sun/hemisphere/FogExp2 palette and one
render-time sibling layer: 155 cards, 310 triangles, exactly four draw calls,
one 30 Hz updater, and one new 512 × 512 texture. Jungle foliage and industrial
lamps reuse texture objects already loaded by the accepted v1.2 environment.
The existing navigation rim light, gameplay route, collision, checkpoints,
hazards, recovery, handling, signage and music mapping remain unchanged.

The complete automated suite passes after integration. The final ambience-polish,
forced high-quality 1600 × 900 browser lap completed in 34.483 seconds, held
10.2 ms p95 / 10.4 ms maximum sampled frame time, and peaked at 81
complete-scene calls / 43,592 visible triangles. Resources stabilized at 128 geometries / 23 textures; the
authored environment peaked at 18 submitted groups / 26,028 triangles. The run
recorded zero impacts, missed gates, recoveries, wrong-way entries, environment
or living-layer load failures, browser warnings, WebGL losses or restores.

Native chase-camera inspection keeps the crane, deck and route opening clear at
the V4 station; Sweep rain remains outside the driving read; Canopy preserves a
clear exit; Fuel Row does not appear blocked; TOTEM remains distinct against
every sector palette; and the Cradle finish reads on the live 250 m approach.
TOTEM now uses restrained low-poly cyan exhaust, an instanced wet hover wake and
an early-console-style blob shadow. Runtime gem-style navigation markers were
removed after chase-camera inspection showed that they read as detached pieces;
the authored emissive surfaces retain the vehicle's light language. The forward
steering fins are seated on their boom mounts before player and rival geometry
is captured. Reduced-motion mode removes rapid plume pulsing while preserving
state feedback.
The review package's independently isolated exact-300 m finish gate remains
297 new-beacon pixels, split 162 left / 135 right of the gantry axis.


## Greenwater Surface Character v1.4 integration acceptance

The accepted final archive is locked at SHA-256
`3e5f21868be3274116e096dc6b4a3bcc5c0011a7c7a5d8ef9ee93b759740458b`
and preserves review provenance
`3d92dc8fc69425eb71e8a1072469e2ec5756911163c912432438d9b25e3d12c3`.
Its runtime GLB and atlas retain the reviewed hashes
`620417aaa6e512314e98b8758f93c7f9290e01ffc16d5cfc842979c79c65df7b` and
`f6438ee0614671aa0c3cac525081d16cfba984d3860703677a39285b9a103e68`.
The game loads the one-mesh, one-material, 776-triangle unlit overlay as a
static render-time sibling with the reviewed nearest filtering, transparent
non-depth-writing material state and no updater. Course geometry, collision,
checkpoints, hazards, recovery, handling, sector lighting, living motion,
signage and music mapping remain unchanged.

The complete automated suite passes after integration. A production browser
lap at forced high quality and native 1600 × 900 completed in 34.483 seconds,
held 9.2 ms p95 / 10.7 ms maximum sampled frame time, and peaked at 82 calls /
44,368 triangles. Resources stabilized at 129 geometries / 24 textures; the
authored environment remained at 18 peak groups / 26,028 triangles. The lap
recorded zero impacts, missed gates, recoveries, wrong-way entries, load
failures, console warnings or errors, runtime exceptions, network failures and
WebGL context faults.

Native V4, Canopy, Fuel Row and finish-approach captures preserve the route,
crane, outboard tank line, TOTEM silhouette and Cradle finish read. The surface
layer adds low-resolution wet seams, drainage stains, mineral bloom, runoff,
leaf stain and graphite repair character without forming an apparent obstacle
or false branch. The deterministic final archive records these measurements,
contains the approved duplicate-audit cleanup and sets `final_v14_freeze: true`.
