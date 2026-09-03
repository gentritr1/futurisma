# FUTURISMA — provenance, verification detail and accepted archives

This is the long-form record that used to live in the README: the full
verification notes, the browser-storage exemption, and every accepted art
freeze with its SHA-256. It is reference material, kept verbatim so the hashes
and contracts stay discoverable. The short version lives in
[README.md](../README.md).

## Verification

```sh
npm run test:code       # every code-only validator + the production build
npm run test:archives   # accepted art-package provenance (needs the archives)
npm test                # both, in that order
npm audit --audit-level=high
npm run validate:environment -- GREENWATER_ENVIRONMENT_STAGE1.zip
npm run validate:environment -- GREENWATER_ENVIRONMENT_STAGE2.zip GREENWATER_ENVIRONMENT_STAGE1.zip
npm run validate:environment -- GREENWATER_ENVIRONMENT_v1.0.zip GREENWATER_ENVIRONMENT_STAGE2.zip
```

`test:code` is the gate every feature branch runs; it needs nothing but the
tracked source, so it passes inside a bare `git worktree`.

`test:archives` audits the accepted art packages, which are heavy untracked
payloads. Every archive lookup resolves through `scripts/lib/archive-root.mjs`:
the root defaults to `artifacts/` in this checkout and can be pointed anywhere
with `FUTURISMA_ARCHIVE_ROOT`. When the root or a required package is **absent**
the validator prints `ARCHIVES SKIPPED (<reason>)` and exits 0; when a package
is **present but wrong** it still fails hard. Bare package names passed to
`validate:environment` resolve under that root; absolute or path-bearing
arguments are used as given.

```sh
# audit the main checkout's archives from a feature worktree
FUTURISMA_ARCHIVE_ROOT=/path/to/main-checkout/artifacts npm run test:archives
```

`public/_headers` carries the production CSP, clickjacking, MIME-sniffing,
cross-origin, HSTS, referrer, and browser-permission policy for static hosts that
support a `_headers` file. Configure equivalent response headers if the chosen
host uses another format.

### The browser-storage exemption

`validate:security` used to ban `localStorage` and `sessionStorage` across all of
`src/`, which was the right rule while the game had nothing to remember. The meta
layer has to keep settings, a chosen livery, a chosen circuit and best laps across
a reload, so the ban was **narrowed rather than lifted**: exactly one file,
`src/game/persistence.ts`, may touch `localStorage`, and it is held to four extra
assertions the validator enforces on every run.

- **One file.** Storage in any other `src/` file still fails the build.
  `sessionStorage` stays banned everywhere, including in the exempt file, as do
  `localStorage.clear()` and `localStorage.key()` — both reach keys this game
  never wrote.
- **Namespaced keys.** Every key must be a string literal (or a file-local string
  constant, which the validator resolves) beginning `futurisma.`, so the origin
  stays partitioned from anything served beside it.
- **A versioned payload.** The file must declare an integer `SCHEMA_VERSION` and
  store a `schemaVersion` field. A payload written by any other version is
  discarded whole rather than half-read.
- **Nothing identity-shaped.** The exempt file may not contain the words
  `email`, `name`, `user`, `id` or `token`. The save file is four settings, two
  selections and per-course lap times; there is no account, no server and no
  upload, which is also why the game needs no consent banner.

Five negative fixtures run on every invocation and prove the rule still bites:
storage outside the owner, `sessionStorage` inside it, an un-prefixed key, a
missing schema version, and an identity-shaped field are each asserted to be
*rejected*. A validator that only ever passes is not evidence.

The Content Security Policy is deliberately unchanged by this. **CSP has no Web
Storage directive** — neither the `index.html` meta policy nor `public/_headers`
has ever governed `localStorage`, and no directive could be added that would —
so `validate:security` is the only thing standing between this game and an
unbounded storage surface, which is why the assertions above live there.

`validate:persistence` covers the other half: `src/game/save-schema.js` holds
every decision the save layer makes (defaults, per-field guards, the discard
rule, the degrade-to-memory rule) in plain JS so Node can attack it with 25
hostile payloads — truncated JSON, a 5 MB string, a schema from the future,
poisoned records, a prototype-pollution attempt — plus stubbed storage ports that
throw on read and on write. The invariant is that every one of them yields a
usable save and no exception; a refused write drops the session to
`persistenceMode: "memory"`, which the diagnostics line reports.

The local suite verifies accepted asset hashes, measured map invariants,
longitudinal and steering response at 60/120 Hz, a 240-second mixed-control
physics soak, checkpoint, hazard, and finish-distance rules,
showcase-to-manual control intent, music timing, high-refresh presentation
cadence, render-resolution tiers,
strict browser security policy, the single-file browser-storage exemption and
its hostile save-file fixtures, pinned package versions, the production build,
raw and gzip startup budgets across every HTML-referenced asset, and hostile
asset-package fixtures. The Greenwater package
validator reads the ZIP without extracting it, rejects traversal, duplicate,
encrypted, overlapping, over-expanded, corrupt, or undeclared entries, then
checks every manifest hash, PNG structure, embedded GLB image, accessor range,
node transform, material role, required Stage 1 kit-root contract, Stage 2
placement vector, runtime hierarchy, sector/material merge, measured budget,
Stage 3 render set, acceptance report, and the upward-facing deck audit. When
successive packages are supplied, it proves both that Stage 2 preserves the
accepted Stage 1 art contract and that final v1.0 preserves the accepted Stage 2
placements, budgets, atlases, and unchanged geometry payloads. The only allowed
final runtime geometry delta is the corrected normals and triangle winding on
exactly the twelve sector deck meshes. Browser
diagnostics remain the source of truth for full-lap
draw calls and frame pacing. The current five-lap adaptive and high-quality
soak results, plus the gates to rerun after environment integration, are locked
in [`docs/PERFORMANCE_BASELINE.md`](docs/PERFORMANCE_BASELINE.md).
The requirement-by-requirement closeout for this core-runtime phase is in
[`docs/CORE_RUNTIME_COMPLETION_AUDIT.md`](docs/CORE_RUNTIME_COMPLETION_AUDIT.md).

## Production asset

The accepted source handoff is preserved in `artifacts/TOTEM_Phase1_v1.0-patch1.zip`. Runtime copies are served from `public/assets/totem/`. The editable master
(`totem_master.glb`) and the unused `totem_decals_1024_base.png` are authoring
inputs only; they live in that archive and are no longer served.
The accepted prop kit is merged by material into the start-area pit display and
20 sparse course-dressing placements. It supplies the two cable-hazard meshes,
wetland reeds, canopy plants, and two off-track repair units without changing
collision or route logic. Procedural cable visuals remain the load-failure
fallback, while their gameplay warning posts stay active in both paths.

The accepted Greenwater map handoff is preserved in
`artifacts/GREENWATER_MAP01_v1.0.zip`. Its measured runtime centreline and
validation report live in `src/game/data/`.

The accepted environment history is preserved in
`artifacts/GREENWATER_ENVIRONMENT_STAGE1.zip`,
`artifacts/GREENWATER_ENVIRONMENT_STAGE2.zip`, and the accepted final
`artifacts/GREENWATER_ENVIRONMENT_v1.0.zip`. The accepted visual-production
freeze is preserved in `artifacts/GREENWATER_VISUAL_IDENTITY_v1.2.zip`, and the
accepted living-world freeze is preserved in
`artifacts/GREENWATER_LIVING_WORLD_v1.3.zip`. These successive contracts are
checked by the normal test suite. The final v1.2 runtime is served from
`public/assets/greenwater/`; the procedural course continues to own
collision, projection, checkpoints, hazards and recovery. The Phase 1 prop kit
remains a visual load-failure fallback. Visual Identity v1.2 bakes the approved
signage state into the GLB atlas: the duplicate authored distance faces and lap
numeral are absent, while the dark lap plate and header remain. The game's
correctly placed 200M/150M/100M/50M boards are therefore the sole braking-
distance language, with no runtime texture alteration.

The accepted Living World v1.3 freeze is integrated as a non-colliding sibling
of that frozen environment. It adds the reviewed 12-sector lighting/FogExp2
palette plus mist, rain, steam, water glints, selective foliage sway and small
industrial lamps. The layer is fixed at four draw calls / 310 triangles, runs
from one 30 Hz updater, reuses the loaded jungle and emissive atlases, and adds
only `greenwater_motion_512.png`. The deterministic 70-file archive is locked at
SHA-256
`72984328ef3005619e4c69991da46c1c9e21282a113d1b3ffc873a57e9b3191c`;
the accepted v1.2 archive remains unchanged and is not re-baselined.

The accepted Surface Character v1.4 final freeze is integrated as one more
static, non-colliding sibling. Its one unlit mesh adds 388 coarse patina decals,
776 triangles, one draw call and one 512 × 512 nearest-filtered texture without
an updater, lighting, collision or gameplay data. The deterministic 111-file
final archive is preserved in `artifacts/GREENWATER_SURFACE_CHARACTER_v1.4.zip`
and locked at SHA-256
`3e5f21868be3274116e096dc6b4a3bcc5c0011a7c7a5d8ef9ee93b759740458b`.
Its accepted review provenance remains
`3d92dc8fc69425eb71e8a1072469e2ec5756911163c912432438d9b25e3d12c3`;
all v1.2, v1.3 and v1.4 freeze flags are true.

The accepted Facility Story v1.5 final freeze is integrated into the served
environment GLB. The deterministic 185-file final archive is preserved in
`artifacts/GREENWATER_FACILITY_STORY_v1.5.zip` and locked at SHA-256
`118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9`.
Its final manifest records production-byte identity with accepted review archive
`4c1b2ddd9cd5fc1fd50899c5caa5f1cc3440d6d4a824acd17c235f2e61723123`;
its runtime GLB is locked at
`5b711fb7bc46533fa6eb6a4ce9b455efe7866061e4f6ea10f82eb0996da20177`.
It contains 60 merged environment meshes and 61,798 authored triangles, and
paints only `reserved_c15` and `reserved_m15`.
The accepted v1.2 signage atlas and the v1.3/v1.4 sibling layers remain
unchanged. Native one- and five-lap browser gates are complete and
`final_v15_freeze` is true.

The exact accepted v1.5 review archive is not retained locally. A later ZIP
with the same filename is explicitly quarantined because it packages the final
source HTML rather than the original review source. The historical review hash
is not re-baselined; the accepted final freeze remains the local runtime
authority. See `docs/GREENWATER_FACILITY_STORY_V1_5_PROVENANCE_GAP.md`.

The accepted Race Presence v1.6 final freeze is integrated into TOTEM and the
four-craft field. Its deterministic 65-entry archive is preserved in
`artifacts/GREENWATER_RACE_PRESENCE_v1.6.zip` and locked at SHA-256
`2bd5adfd1350b2fd2a9302a8f4139918d1e1d0fe3a1b88b4b80f4cffeb4a6b8a`.
The baked runtime GLB, 256 × 256 effects atlas and NEEDLE 16 livery remain
byte-identical to the accepted review at SHA-256
`4bec092f1c85c78b00a4974532b0dda5f1f89f756d9741535820368e3cfd35ec`,
`d5562ae064c9532fd447c89ae013642dc03f72f7354293caa952972ad5af8aa3`
and `2f8b3528845eaa7167062e93ae43fedf74e0d6c2ddc14cea14d565e8ec95dc1c`.
The included builder reproduces the final archive byte-for-byte, all integration
gates pass, `final_v16_freeze` is true and Map 02 has not started.

The production contract for Greenwater's authored environment art is in
`docs/GREENWATER_ENVIRONMENT_ART_BRIEF.md`. It preserves the accepted route and
defines the modular kit, landmark anchors, navigation grammar, runtime budgets,
and validated export package required for integration.
The Stage 3 presentation freeze and Stage 4 deck-winding correction are complete.
Greenwater's Production Pass 1 and deterministic Visual Identity v1.2 freeze are
also accepted and integrated. Living World v1.3 has passed package, full-suite
and high-quality browser integration checks, and its deterministic final freeze
is now accepted and byte-locked. Surface Character v1.4 has passed package,
full-suite and native 1600 × 900 browser integration checks; its deterministic
final freeze is also accepted and byte-locked. The
completed prompt is retained in `docs/GREENWATER_ENVIRONMENT_DESIGN_AGENT_PROMPT.md`
as the production decision record. The signage brief and its diagnostic history
remain in `docs/GREENWATER_SIGNAGE_V1_1_DESIGN_AGENT_PROMPT.md`; the implementation
now resolves that issue directly. The completed visual-identity prompt remains in
`docs/GREENWATER_VISUAL_IDENTITY_LOCK_DESIGN_AGENT_PROMPT.md` as a decision record.

