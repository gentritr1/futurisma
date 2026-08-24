# FUTURISMA — Core Runtime Completion Audit

Recorded: 2026-08-24  
Accepted commit: `0c0bb77`  
Scope status: **CORE RUNTIME ACCEPTED · AUTHORED ENVIRONMENT PENDING**

This audit closes the first requested production phase: security, browser
performance, deterministic game physics, controls, race rules, audio lifecycle,
graphics-resource lifecycle, interruption handling, and responsive gameplay UI.
It does not claim that the final Greenwater art pass exists. The current scene is
still the validated procedural course plus Phase 1 fallback dressing.

## Acceptance matrix

| Requirement | Status | Authoritative evidence |
| --- | --- | --- |
| Accepted source assets remain byte-identical | PASS | `npm run validate:assets`: 10 accepted TOTEM files match; 20 fallback prop placements resolve. |
| Greenwater route remains locked | PASS | `npm run validate:map`: 1,258 samples, 2,515.982 m, eight gates, nine music states. |
| Deterministic high-speed physics | PASS | `npm run validate:physics`: 330.0 km/h cruise, 403.2 km/h boost, smooth 379.9→346.2 km/h post-boost carry, 98.1 m finish run-out, and 0.002 m/s 60/120 Hz speed drift. |
| Long-session physics stability | PASS | The 240-second mixed-control soak repeats boost exhaustion/recovery and drift entry/exit with 0.017% 60/120 Hz distance drift. |
| Authored wet handling | PASS | Water Table reaches 0.805 grip and recovers to 0.990 without a one-step snap; 60/120 Hz difference stays below 0.001. |
| Checkpoints, finish, recovery, hazards, and wrong-way behavior | PASS | `npm run validate:race` covers forward crossings, wraparound, missed-gate extra circuit, finish filtering, open-edge recovery telemetry, cable contacts, and hysteretic wrong-way warnings. |
| Manual control ownership | PASS | `npm run validate:control` proves sanitized analogue input, keyboard priority, single-owner action edges, deliberate showcase takeover, and interruption-safe release gating. Neutral input creates no steering assistance. |
| Camera and presentation stability | PASS | Camera lens/shake tests are deterministic at 60/120 Hz; high-refresh presentation tests pass at 144/165/240 Hz. Live camera range remains 56.02–70.49°. |
| Audio timing and lifecycle | PASS | Audio control is capped at 30 Hz; 174 BPM F-minor stem transitions are bar-quantized. Suspended clocks create zero transient nodes; click-started runs release every voice to zero. |
| GPU and scene-resource lifecycle | PASS | Shared resources dispose exactly once. Five-lap runs retain 86 geometries and 17 textures; repeat trials reuse the same vehicle request and asset-kit load. |
| Frame scheduling and adaptive quality | PASS | Ready, paused, and settled-result worlds skip simulation/audio/draw work. Quality tiers remain resize-safe with a 540-line target and 360-line floor. |
| Browser performance envelope | PASS | High-quality five-lap baseline: 9.7–10.0 ms p95, 10.4–10.5 ms maximum, 92 peak calls, 42,696 peak triangles, 86 geometries, and 17 textures. |
| Bundle budget | PASS | Production shell is 217.7 KiB gzip, including 211.7 KiB JavaScript. The raw vendor-heavy chunk warning is informational and remains inside the enforced gzip budget. |
| Browser security policy | PASS | `npm run validate:security` verifies strict CSP and response headers, pinned dependency versions, and absence of unsafe DOM, code-evaluation, storage, or network sinks. |
| Dependency advisories | PASS | Fresh `npm audit --audit-level=high`: zero vulnerabilities. |
| Restart/interruption resilience | PASS | Same-page consecutive trials reproduce 34.483 s, identical camera range/resources, zero retained audio/particles, and one vehicle request. Focus loss and WebGL loss require a fresh resume action. |
| Responsive gameplay UI | PASS | Live 1440×900 and 390×844 captures show no document overflow or critical HUD overlap; start focus, finish distance, turn direction, checkpoint, speed, timing, and boost remain readable without audio. |

The complete measurement history and environment-integration regression gates
remain in `docs/PERFORMANCE_BASELINE.md`.

## Explicit non-claims

- The final authored Greenwater environment has not been modelled or integrated.
- Landmark silhouettes, next-opening value framing, authored surface materials,
  final jungle masses, and final fog-card occlusion cannot be accepted from the
  procedural fallback scene.
- Opponents, additional vehicles, and later maps are outside this first core
  runtime acceptance.

## Required next handoff

Send `docs/GREENWATER_ENVIRONMENT_DESIGN_AGENT_PROMPT.md` to the design agent and
attach `artifacts/GREENWATER_ENVIRONMENT_PRODUCTION_INPUT_v1.0.zip`.

Current input ZIP SHA-256:
`6b6bb8b79c53609e45c552407cf09d7da129c7675b87e9e669c5eedb011cb68c`

When `GREENWATER_ENVIRONMENT_v1.0.zip` returns, integration is accepted only
after its byte-level validation passes and every environment gate in
`docs/PERFORMANCE_BASELINE.md` is rerun. Until then, the overall PS2/Y2K ambience
objective remains open even though the core runtime phase is accepted.
