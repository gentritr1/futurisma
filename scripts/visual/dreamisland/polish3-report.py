"""Assemble the POLISH-3 handoff from instrument output, retaining failed targets."""
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'art/evidence/dreamisland-v1/polish-3'

def read(name):
    return json.loads((OUT / name).read_text())

def table(headers, rows):
    return '\n'.join(['| ' + ' | '.join(headers) + ' |',
                      '| ' + ' | '.join(['---'] * len(headers)) + ' |'] +
                     ['| ' + ' | '.join(map(str, row)) + ' |' for row in rows])

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

protected = ['src/game/game.ts', 'src/game/autopilot.ts', 'src/game/dreamisland-schedule.js',
             'src/game/dreamisland-powers-config.js', 'src/game/data/dreamisland/route.json',
             'src/game/data/dreamisland/schedule.json', 'src/game/data/dreamisland/rival-pace.json',
             'src/game/dreamisland-sky.ts', 'src/game/dreamisland-water.ts',
             'src/game/dreamisland-materials.ts', 'public/assets/dreamisland/painted.glb']
hashes = []
for name in protected:
    before = hashlib.sha256(git('show', '7bf6dc2:' + name)).hexdigest()
    after = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    hashes.append(dict(file=name, before=before, after=after, unchanged=before == after))
assert all(row['unchanged'] for row in hashes)
protected_report = dict(script='scripts/visual/dreamisland/polish3-report.py', baseline='7bf6dc2',
                        observedHead=git('rev-parse', '--short', 'HEAD').decode().strip(), files=hashes)
(OUT / 'protected-hashes.json').write_text(json.dumps(protected_report, indent=2) + '\n')

build = read('validators/build.json')
painted = read('validators/painted-validation.json')
runtime = read('validators/runtime-validation.json')
atlas = read('atlas-final/atlas-quadrant-proof.json')
assert atlas['decided'] == atlas['claims'] and not atlas['errors']
audio = read('audio/offline-capture.json')
checks = read('audio/checks.json')
transcode = read('audio/transcode.json')
kit = read('hardware/build.json')
petals = read('hardware/petal-motion.json')
frames = read('frames-final/capture.json')
pixels = read('frames-final/pixels.json')['rows']
moss = read('hardware/moss-final/pixels.json')['rows']
surf = read('audio/surf-band-match.json')
night = read('audio/night-band-match.json')
tiers = ['works', 'rookie', 'feral', 'works-reduced']
soaks = {tier: read('soak-' + tier + '/race.json') for tier in tiers}
metrics = {tier: read('soak-' + tier + '/metrics.json') for tier in tiers}
feels = {tier: read('soak-' + tier + '/feel.json') for tier in tiers}
feel = feels['works']
for tier in tiers:
    for name, expected in soaks[tier]['inputHashes'].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, (tier, name)
    assert soaks[tier]['errors'] == []
    assert soaks[tier]['diagnostics']['current']['missedGates'] == 0
    assert soaks[tier]['diagnostics']['current']['recoveries'] == 0
    assert not read('soak-' + tier + '/material-walk.json')['violations']
    assert soaks[tier]['dreamisland']['audio']['loaded']
    assert metrics[tier]['peakTotalCalls'] <= 110
    assert metrics[tier]['peakTriangles'] + metrics[tier]['peakShadowTriangles'] <= 180000
for name, expected in audio['hashes'].items():
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, name

worst_draws = max(m['peakTotalCalls'] for m in metrics.values())
worst_tris = max(m['peakTriangles'] + m['peakShadowTriangles'] for m in metrics.values())
soak_table = table(['Run', 'Laps, ms', 'Misses / recoveries', 'Draws', 'Main + shadow tris', 'p95 ms', 'Residual frames'], [
    [tier, ' / '.join(map(str, soaks[tier]['atFlag']['lapTimesMs'])), '0 / 0', m['peakTotalCalls'],
     f"{m['peakTriangles']:,} + {m['peakShadowTriangles']:,}", f"{m['p95Ms']:.3f}", f"{m['sampleResidual']:+.3f}"]
    for tier, m in metrics.items()])
sample_table = table(['Run', 'Window samples', 'Window ms', 'Calibrated Hz', 'Expected samples', 'Observed − expected'], [
    [tier, m['windowSamples'], f"{m['windowMs']:.3f}", f"{m['expectedRateHz']:.6f}",
     f"{m['expectedSamples']:.6f}", f"{m['sampleResidual']:+.6f}"] for tier, m in metrics.items()])
lighting_table = table(['Run / lighting', 'Peak main draws', 'Peak shadow draws', 'Peak combined draws', 'Conservative triangles'], [
    [tier + ' / ' + state, row['peakMainCalls'], row['peakShadowCalls'], row['peakTotalCalls'],
     row['peakTriangles'] + row['peakShadowTriangles']]
    for tier, m in metrics.items() for state, row in m['lightingStates'].items() if isinstance(row, dict)])
offset_table = table(['Pickup', 'Progress', 'Trigger lateral m', 'Hardware lateral m', 'Offset from trigger m', 'Foot Y m', 'Plate top m'], [
    [row['id'], row['progress'], row['triggerLateral'], row['hardwareLateral'], f"{row['lateralOffset']:+.1f}",
     f"{row['position'][1]:.6f}", f"{row['plateTopMetres']:.6f}"] for row in painted['powerKit']['placements']])
band_table = table(['Centre Hz', 'Surf reference dB', 'Surf render dB', 'Δ dB', 'Night reference dB', 'Night render dB', 'Δ dB'], [
    [f"{a['hz']:.3f}", f"{a['referenceDb']:.3f}", f"{a['renderedDb']:.3f}", f"{a['deltaDb']:+.3f}",
     f"{b['referenceDb']:.3f}", f"{b['renderedDb']:.3f}", f"{b['deltaDb']:+.3f}"]
    for a, b in zip(surf['bands'], night['bands'])])
bytes_table = table(['Clip', 'Source bytes', 'Transcoded bytes', 'Served'], [
    [row['file'], row['sourceBytes'], row['bytes'], 'yes' if row['served'] else 'reference only'] for row in transcode['files']])
levels_table = table(['Sound', 'Measured input dBFS', 'Metric', 'Calibrated gain'], [
    [row['id'], f"{row['measuredDb']:.4f}", row['metric'], f"{row['gain']:.8f}"]
    for row in read('audio/level-calibration.json')['rows']])
position_table = table(['Source', 'World position x / y / z, m'], [
    [row['id'], ' / '.join(f'{value:.3f}' for value in row['position'])]
    for row in json.loads((ROOT / 'public/assets/dreamisland/painted.json').read_text())['audioSources']['sources']])
color_table = table(['Pinned shot', 'Visible pixels', 'Mean linear luma'], [
    [row['id'], row['pixels'], f"{row['luma']:.6f}"] for row in {row['id']: row for row in pixels + moss}.values()])
atlas_table = table(['Consumer', 'Atlas cell', 'Claim / measured', 'Mask pixels', 'Nearest-colour margin'], [
    [row['id'], row['role'] + '/' + row['cell'], row['claimed'] + ' / ' + row['nearest'],
     row['maskedPixels'], f"{row['margin']:.3f}"] for row in atlas['results'][:4]])
split_table = table(['Sector', 'Lap 1 ms', 'Lap 2 ms', 'Lap 3 ms'], [
    [sector] + [next((f"{row['milliseconds']:.3f}" for row in feel['splits']
                     if row['sector'] == sector and row['lap'] == lap), 'incomplete') for lap in [1, 2, 3]]
    for sector in ['BEACH', 'GROVE', 'POINT', 'BASIN', 'COURT', 'REEF', 'CUT']])
feel_table = table(['Run', 'Day BASIN mean ms', 'Night BASIN ms', 'Night loss ms', 'Earlier night brake m'], [
    [tier, f"{f['basin']['dayMeanMs']:.3f}", f"{f['basin']['nightMs']:.3f}",
     f"{f['basin']['deltaMs']:+.6f}", f"{f['brakeShiftMetres']:+.6f}"] for tier, f in feels.items()])
trials = [('baseline-works', '1 / 0.85; original width'), ('grip-trial-030', '1 / 0.30; original width'),
          ('grip-floor-control', '1 / 0.20; original width'),
          ('width-grip-trial', '1 / 0.20; BASIN 14 m'), ('width-floor-trial', '1 / 0.20; BASIN 13.9 m')]
trial_table = table(['Instrument run', 'Day / night grip; trial width', 'Day BASIN ms', 'Night BASIN ms', 'Loss ms'], [
    [name, label, f"{read(name + '/feel.json')['basin']['dayMeanMs']:.3f}",
     f"{read(name + '/feel.json')['basin']['nightMs']:.3f}", f"{read(name + '/feel.json')['basin']['deltaMs']:.6f}"]
    for name, label in trials])
brake_table = table(['Lap', 'Progress at first turn-limited brake', 'Course distance m', 'Fog density'], [
    [row['lap'], f"{row['turnLimitedApproach']['progress']:.9f}",
     f"{row['turnLimitedApproach']['metres']:.6f}", row['turnLimitedApproach']['fogDensity']]
    for row in feel['braking']])

changed = set(git('diff', '--name-only').decode().splitlines())
changed.update(git('ls-files', '--others', '--exclude-standard').decode().splitlines())
source_files = sorted(name for name in changed if not name.startswith('art/evidence/'))
files_text = '\n'.join('- `' + name + '`' for name in source_files)

report = f'''# Dream Island — POLISH-3 handoff

**Status: E1–E3 implemented and instrument-verified; E4 FAIL / pending scope decision. This pass is not accepted as complete. No commit made.**

Started clean on `main` at `7bf6dc2`. Other work advanced HEAD to `{protected_report['observedHead']}` during the pass; that work was preserved. The report generator compares protected files to the starting commit in [protected-hashes.json](protected-hashes.json). `game.ts`, autopilot, route, schedule, powers configuration, pace, skies, water, original materials and painted GLB are byte-identical. The hardware placement follows the user's explicit verge/plate approval.

## Files added or changed

Audio joins EngineAudio's existing buses through a small shared port and strongest-duck precedence. Dream Island's graph, synthesis, measured profiles, hardware and clock remain in the lazy circuit path. The existing Surge/Shield effect renderer accepts circuit colours; rules and trigger positions are unchanged. Instrument changes collect actual physics inputs and renderer data; the optional width/grip experiments affect only the served test page.

{files_text}

Evidence is in this directory. The final visual set is `frames-final/`; `atlas-final/`, `hardware/moss-final/` and `hardware/effects/` are separate proofs. Baseline/trial directories retain the inputs and failures used for calibration. Aborted or occluded capture attempts were removed; they are not acceptance evidence.

## Numbers this pass measured for the first time

All rows below are **VERIFIED by the named instrument**, including measurements that fail their target. Inherited limits and the prior round's budget are distinguished in the next section.

| Measurement | Result | Instrument / evidence |
| --- | --- | --- |
| Audio source / all-transcode / served bytes | {transcode['sourceBytes']:,} / {transcode['transcodedBytes']:,} / {transcode['servedBytes']:,} | `prepare-dreamisland-audio.py`, `audio/transcode.json` |
| New served audio ceiling | {transcode['ceilingBytes']:,} B = ceil(measured × 1.10) | transcode report; enforced by `validate-build.mjs` |
| Surf / night maximum band error | {max(abs(x['deltaDb']) for x in surf['bands']):.6f} / {max(abs(x['deltaDb']) for x in night['bands']):.6f} dB | `bed-match.py`, tables below |
| BEACH offline mix | {audio['seconds']} s, {audio['sampleRate']} Hz, {audio['channels']} channels; RMS {audio['mix']['rmsDb']:.6f} dBFS, peak {audio['mix']['peakDb']:.6f} dBFS | `audio-capture.mjs`, `audio/offline-capture.json` |
| Waterfall night level change | {checks['waterfallNightDeltaDb']:+.6f} dB RMS | `audio-checks.mjs`, actual shared graph render |
| Clock at strike | minute 0 rad, hour 0 rad in race, sprint, time attack | `validate-dreamisland-runtime.mjs`; rendered 40 m frames |
| Kit geometry / bytes | Surge {kit['devices']['PK_surge']['triangles']} tris, Shield {kit['devices']['PK_shield']['triangles']} tris; {kit['bytes']:,} B | Blender builder's exported GLB accessor measurement; painted validator |
| Live hardware | {frames['captures'][0]['hardware']['meshes']} meshes / {frames['captures'][0]['hardware']['triangles']:,} triangles | `polish3-frames.mjs`, live scene |
| Petal opening | {petals['rows'][-1]['milliseconds']:.0f} ms, measured final angle ≈ 0.700000 rad | `petal-measure.py`, actual instance matrices |
| Deck plates | top {painted['powerKit']['placements'][0]['plateTopMetres']:.6f} m; original five trigger coordinates | `validate-dreamisland-painted.mjs`, projected geometry vertices |
| Corridor | {painted['corridor']['intrusions']} intrusions / {painted['corridor']['samples']:,} rays | same validator, including closed/open hardware, lamps, plates and support |
| Final worst-tier rendering | {worst_draws} combined draws / {worst_tris:,} conservative triangles | four `race.mjs` soaks |
| Works BASIN night loss | {feel['basin']['deltaMs'] / 1000:.9f} s — FAIL 0.25–0.40 s | `feel.mjs`, actual 120 Hz input samples |
| Works earlier night braking | {feel['brakeShiftMetres']:.6f} m — FAIL ≥ 8 m | same instrument, turn-limited approach |

## Registration and asset checklist

**VERIFIED.** All eight supplied MP3s and the power-kit orthographic sheet exist. No image or audio generator was used. Six signatures are served as 24 kHz / 48 kbps mono MP3s; surf and night remain reference inputs because both procedural matches pass. No radio recording was added. Existing voice/music switches and text-only schedule callouts are retained: warning → “THE CLOCK — ONE LAP”; strike → “NIGHT — CAUSEWAY WET”; night-settled adds no flash or voiced line.

The power kit loads through `PowerKit.load` and satisfies both node contracts: `PK_surge_{{cage,capacitors,core,mount}}` and `PK_shield_{{housing,petals,core,lattice}}`. It reuses shared metal, concrete and emissive atlases, contains no embedded texture, and adds no power rule. Four whole petal instances rotate on collection. Existing effect geometry/shaders are skinned amber/cyan.

## Budget before / after / gate

The before column is **inherited**, from the approved round-2 evidence and brief; it is not a new measurement. Final values are **VERIFIED** by `race.mjs` and `validate-build.mjs`.

| Axis | Before | After | Gate / remaining |
| --- | --- | --- | --- |
| Worst combined draws | 94 | {worst_draws} | 110 / {110 - worst_draws} |
| Main + shadow triangles | 157,650 | {worst_tris:,} | 180,000 / {180000 - worst_tris:,} |
| Initial JS gzip | 264.9 KiB (rounded) | {build['javascriptGzip']:,} B ({build['javascriptGzip'] / 1024:.6f} KiB) | 272,384 B / {272384 - build['javascriptGzip']} B |
| Initial shell gzip | 276.8 KiB (rounded) | {build['shellGzip']:,} B ({build['shellGzip'] / 1024:.6f} KiB) | 283,648 B / **{283648 - build['shellGzip']} B** |
| New served signature audio | 0 B | {build['islandAudioBytes']:,} B | {build['ceilings']['dreamIslandAudio']:,} B |
| Device triangles | marker boxes | {kit['devices']['PK_surge']['triangles']} / {kit['devices']['PK_shield']['triangles']} | 1,200 each |
| Frozen seam | game.ts 2,577 lines | byte-identical | no edit |

The shell margin is small and must be remeasured after any subsequent production change. No inherited ceiling or assertion was weakened. Triangles sum the independent main/shadow maxima conservatively. Combined draw peaks are measured per frame; adding independent draw maxima would give a different, invalid peak.

## Validators and code suite

**VERIFIED PASS:** `npm run test:code` with Python 3 + Pillow; full output in `logs/di-polish3-tests-final.log`. This includes the production build and its byte gate. Independent final build JSON: [validators/build.json](validators/build.json). Painted/runtime reports are copied here so the older phase-C reports can remain unchanged.

Clock assertions add 9:00 at start, exact 12:00 at strike and hold for every format, without removing existing assertions. Determinism, snapshot/restore and existing persistence checks remain in the suite. The corridor sweep remains unchanged in density and ceiling and now includes the hardware, both hinge endpoints, target plates, matching lamps and the REEF stone support. Existing bore containment remains {painted['bore']['lateralClearanceMetres']:.6f} m lateral clearance.

## Four soaks and p95 reconciliation

**VERIFIED.** Chrome, high quality, 1280×720, seed 3868938316, music disabled. All four reach the flag after strike and night-settled; all audio graphs load; all have zero browser errors and zero material-walk violations. The report generator checks every recorded soak/audio input hash against the delivered files.

{soak_table}

The renderer wrapper measures main and shadow passes separately. The percentile uses the measured window below. Expected samples = calibrated refresh rate × window duration; residual = observed − expected. These are desktop/headless observations, not device performance promises.

{sample_table}

Both lighting states retain the shadow pass:

{lighting_table}

## E1 — sound and the 1/3-octave match

{bytes_table}

Transcoding strips metadata and preserves the supplied clip content. The six-file set measures {transcode['servedBytes']:,} B; its independent pinned ceiling is {transcode['ceilingBytes']:,} B. The two bed reference transcodes are evidence only.

The procedural beds use seeded versions of the existing brine/noise/canopy synthesis, with measured parametric EQ. `calibrate-beds.py` renders the actual JS synthesis on every iteration; it does not resynthesize from source PCM. `bed-match.py` compares 8 seconds against the original supplied references, resampling both inputs identically to the delivery bandwidth. All 28 complete 1/3-octave bands are included, including quiet bands. **Every band passes ±6 dB.** dB columns are integrated FFT band energy relative to full scale; deltas are render minus reference.

{band_table}

Level calibration uses the existing Works hum measurement (−27.3 dB, inherited from `audio-probe.mjs` and documented in `audio-ambience.ts`) as the reference. Bells target 9 dB above it, beds/water/fish/tunnel at it, birds 6 dB below it. Actual pre-gain buffer measurements and resulting gains are below; final shared-graph measurements follow, so a gain value is not treated as proof of output level.

{levels_table}

Positional source coordinates are derived from the painted manifest/GLB anchors by `prepare-dreamisland-audio-positions.mjs`; `--check` confirms they match the manifest. Birds use painted verge palms, fish use each shoal's mean starting position. The listener moves; sources stay at these world positions.

{position_table}

`audio-checks.mjs` measures the clock's strongest 100 ms through the existing master/compressor at BEACH {checks['spatial'][0]['strongest100msDb']:.3f}, REEF {checks['spatial'][1]['strongest100msDb']:.3f}, CUT {checks['spatial'][2]['strongest100msDb']:.3f} dBFS. The waterfall measures {checks['waterfall'][0]['rmsDb']:.3f} → {checks['waterfall'][1]['rmsDb']:.3f} dBFS, with its actual filter at {checks['waterfall'][0]['cutoffHz']} → {checks['waterfall'][1]['cutoffHz']} Hz. Birds reach zero over the audio ramp. The tunnel clip takes the dry effects bus; the engine retains its existing underpass reverb, avoiding another send on the recorded echo.

Shared music/ambience ducking takes the stronger radio or clock duck (−3 / −2 dB), rather than multiplying them. Checks exercise overlap and release, music=0, voice=0, reset/rearm/dispose, and the actual wrapper under normal/reduced motion with identical audio-level samples. Audio uses its own schedule-derived 12-second ramp and never reads the visual reduced-motion jump. See [audio/checks.json](audio/checks.json).

**Listening artifact:** [30-second BEACH strike WAV](audio/strike-beach-30s.wav), float32 stereo, {(OUT / 'audio/strike-beach-30s.wav').stat().st_size:,} bytes. `audio-capture.mjs` schedules the shipped graph into native OfflineAudioContext using the real EngineAudio master, compressor, buses and idle engine. It pins the BEACH chase listener, disables music/voice, and applies no post-normalization. Strike starts at 10.000 s; the ramp ends at 22.000 s. Output peak {audio['mix']['peak']:.9f} is below clipping. This is an offline mix, not a live microphone or video recording.

**UNVERIFIED listening gap:** the supplied strike file's strongest 100 ms begins at 7.9 s within the clip; the quarter chime's at 2.0 s (`level-calibration.json`). Playback is scheduled at the exact event, with the supplied attacks preserved. Three perceptually distinct tolls and immediate cue recognition require the user's audition of the WAV; the file name alone is not that proof. No voiced Dream Island lines were generated.

## E2 — running clock

**VERIFIED:** the 40 m captures pin race tick {frames['captures'][0]['tick']} (`strikeTick − 600`) and strike tick {frames['captures'][0]['strikeTick']}. Before strike, minute = {runtime['clockHands']['race']['before']['minute']:.12f} rad and hour = {runtime['clockHands']['race']['before']['hour']:.12f} rad. At strike both are exactly zero. The minute completes one revolution, the hour moves 9→12, then both hold; Sprint reads its own schedule. Matrices are set from the pure tick function, never accumulated delta time. The two authored hand meshes retain independent pivots and shared materials.

See `frames-final/clock-before-strike.png`, `clock-at-strike.png`, `capture.json`, and `validators/runtime-validation.json`.

## E3 — hardware, trigger plates and colour measurements

**VERIFIED:** source heights are {frames['captures'][0]['hardware']['placements'][0]['height']:.6f} m Surge and {frames['captures'][0]['hardware']['placements'][1]['height']:.6f} m Shield. Exported kit SHA-256: `{kit['sha256']}`. Runtime batches five devices, lamps, plates and support into seven draws. All use lit, fogged, tone-mapped shared atlas materials. Bronze compensation uses float vertex attributes because the GLB exporter's normalized colour accessor clamps values above one.

The five trigger positions, collect radius and power simulation are unchanged. Tall hardware sits on the verge at the same progress; the plate is the target. Each device carries a matching core lamp, and plate/core emission follows the same charge/availability. Collected targets go dark. The GROVE foot is raycast onto the actual flat sand shoulder beyond its steep inner bank. REEF has no sand under the foot, so a stone outrigger meets the pier edge flush with the deck.

{offset_table}

The positive/negative offset sign follows the course's lateral axis. Plates are 2.8 × 3.6 m and 0.08 m thick, with tops 0.085 m above the deck, below the user's 0.3 m allowance. These dimensions and the two hinge envelopes are checked by the painted validator; all corridor rays pass.

The four petals are independent whole-mesh hinges. Actual float32 instance matrices measure about 0.612500 rad at 125 ms and 0.700000 rad at 250 ms. `petal-measure.py` checks the measured endpoint; no per-vertex animation is used. See the 0/15/30-tick collected frames.

Core, plate, bronze and moss colours were sampled/corrected against the supplied sheet and rendered again through the shared AgX/light/fog path. `reference-power-colors.py` records the source ROIs and RGBs; `calibrate-power-colors.py` records input/output corrections. `hardware-pixels.py` measures only visible pixels matching the isolated object within 2/255 and differing from its blank by more than 5/255. Source linear values are linearized mean sRGB; rendered luma is the mean of per-pixel linear luma. They are labelled separately and are not claimed to be pixel-exact matches.

Bronze's separate ratio calculation is retained in `hardware/color-fit/bronze-correction.json`: before × targetLinear / measuredLinear, followed by the normal-material verification below. Its earlier moss ROI is historical; the final moss correction uses the green joint mask in `reference-colors.json` and `moss-baseline/color-correction.json`.

{color_table}

The existing effect shader proof (`power-effects.mjs` + `effect-pixels.py`) compares fixed-pose active/off frames: Surge's added light is warm (R > G > B), Shield's is cyan (G/B > R). Bright jet centres remain white from the existing effect; the outer burst carries the warm tint. See `hardware/effects/`.

## Rendered-pixel atlas checks

**VERIFIED {atlas['decided']}/{atlas['claims']}, zero undecided.** The debug instrument substitutes quadrant ID textures while retaining each mesh's actual UVs. Each consumer must render and its mask must choose the claimed quadrant. Original consumers remain covered, with additional claims for the kit's metal/stone/moss/support and both independent clock hands. The four core/plate claims are:

{atlas_table}

This explicitly covers **both concrete road-cell plates**, as requested, as well as both emissive cores. Full proof and frames: [atlas-final/atlas-quadrant-proof.json](atlas-final/atlas-quadrant-proof.json). It is a cell-selection proof; final colour/luma uses the normal-material frames above.

## E4 — stopwatch and braking evidence (targets not met)

**VERIFIED measurements, FAIL acceptance.** `feel.mjs` interpolates district boundary crossings from the real driver's 120 Hz samples, unwrapping progress at the physical seam. It does not use the lap UI counter, which advances slightly before that seam. Incomplete first BEACH / final CUT splits are omitted. Full Works splits:

{split_table}

Night BASIN enters at the tail of the lighting ramp (the shipped grip change has already happened) and exits at full night. The 8.333 ms input interval limits temporal resolution; fractional interpolation digits are retained for reproducibility, not claimed as physical sub-tick accuracy.

{feel_table}

The CUT measurement identifies the first nonzero brake during the actual turn-limited approach to the first CUT turn. It also retains the literal first brake after the district boundary in `feel.json`; the driver is already braking there, so that later point is not substituted for the approach measurement.

{brake_table}

The day mean minus night position is {feel['brakeShiftMetres']:.6f} m: night is slightly later. `src/game/autopilot.ts:318` calculates braking distance from speed and turn target; the controller never reads fog. Increasing rendering fog therefore cannot produce the requested ≥8 m shift on its own.

Permitted grip/width experiments were run through the actual driver in an isolated browser response, leaving production route/physics unchanged:

{trial_table}

The minimum-grip control at original width loses {read('grip-floor-control/feel.json')['basin']['deltaMs'] / 1000:.9f} s. The strongest tested combination loses {max(read(name + '/feel.json')['basin']['deltaMs'] for name, _ in trials) / 1000:.9f} s; it also remains below the target.

The width trials are diagnostic course-sample overrides, not a rebuilt authored route or an accepted solution. All trial runs completed with zero misses/recoveries, but neither meets 250–400 ms. The 13.9 m trial reaches the existing station-width validator floor. This is evidence of these failed trials, not a proof over every possible width profile.

**Pending user decision:** the proposed next step is a Dream Island wet-surface drag term applied to human and demo craft plus a fog-based demo braking margin, then calibration against the requested measurements. That crosses the inherited collision-rule boundary and extends E4 beyond its stated grip/width/fog-density levers; approval was requested and has not arrived. No such extension was implemented. Production grip remains 0.85. No pace solve was run because the production route/physics and Works lap times are unchanged; if subsequently needed, the named solver is `scripts/solve-dreamisland-pace.mjs`. Fog is unchanged, so the existing crossfade baseline was not replaced or rerun.

## Discrepancies, open gaps and work left undone

- **E4 remains open** for the measured reasons above. E5's evidence package is present, but the overall acceptance cannot close while E4 fails.
- The original five coordinates were inside the protected driving corridor. The user's explicit amendment authorizes verge hardware plus low road plates; offsets and plate atlas proof are above. No collect trigger moved.
- Audio references are complete. Only six files ship because both procedural beds pass. The brief's “commit” wording for scripts/WAV is superseded by the user's **do not commit** instruction; all deliverables remain uncommitted.
- **UNVERIFIED:** user listening judgment on bell recognition, three tolls, water/bed character and mix; user visual judgment on the 40 m landmark silhouettes and reference likeness; non-desktop/device performance. Headless pixels and spectra establish the listed properties, not those judgments.
- The shared radio bank is unchanged. New voiced callouts remain a future request; none are needed for the specified text-only behaviour.
- Only the newly touched hardware/clock/effects were visually remeasured. Skies, water and fog are byte-identical; no new crossfade claim is made.

## Commands and reproduction

Run from the repository root with Node 20.19.4 on PATH, Python 3 + Pillow + numpy, ffmpeg/ffprobe and the existing local Chrome harness. The local preview used port 5200. Browser commands are serial for uncontended timing; the user's server was left running.

This is a command ledger, not an end-to-end rerun recipe: calibration commands were interleaved with captures and apply corrections to the palette/profile used for those captures. To verify the delivered state, start with `npm run test:code` and rerun the capture/measurement commands without the prepare/build/calibrate authoring steps.

```sh
export PATH="$HOME/.nvm/versions/node/v20.19.4/bin:$PATH"
python3 scripts/prepare-dreamisland-audio.py
node scripts/prepare-dreamisland-audio-positions.mjs
node scripts/prepare-dreamisland-audio-positions.mjs --check
python3 scripts/visual/dreamisland/calibrate-beds.py
node scripts/visual/dreamisland/render-bed.mjs
node scripts/visual/dreamisland/audio-capture.mjs --out=art/evidence/dreamisland-v1/polish-3/audio/level-baseline
python3 scripts/visual/dreamisland/calibrate-sound-levels.py
node scripts/visual/dreamisland/audio-capture.mjs --out=art/evidence/dreamisland-v1/polish-3/audio
node scripts/visual/dreamisland/audio-checks.mjs --out=art/evidence/dreamisland-v1/polish-3/audio
python3 scripts/visual/dreamisland/bed-match.py art/references/dreamisland/phase-e/audio/surf-bed-day.mp3 art/evidence/dreamisland-v1/polish-3/audio/surf-bed-offline.wav art/evidence/dreamisland-v1/polish-3/audio/surf-band-match.json
python3 scripts/visual/dreamisland/bed-match.py art/references/dreamisland/phase-e/audio/night-bed.mp3 art/evidence/dreamisland-v1/polish-3/audio/night-bed-offline.wav art/evidence/dreamisland-v1/polish-3/audio/night-band-match.json
python3 scripts/visual/dreamisland/reference-power-colors.py
python3 scripts/visual/dreamisland/calibrate-power-colors.py art/evidence/dreamisland-v1/polish-3/hardware/color-trial
python3 scripts/visual/dreamisland/calibrate-power-colors.py art/evidence/dreamisland-v1/polish-3/hardware/moss-baseline --moss
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_power_kit.py
npm run test:code
node scripts/validate-build.mjs --out=art/evidence/dreamisland-v1/polish-3/validators
node scripts/visual/dreamisland/polish3-frames.mjs --out=art/evidence/dreamisland-v1/polish-3/frames-final
python3 scripts/visual/dreamisland/hardware-pixels.py art/evidence/dreamisland-v1/polish-3/frames-final
node scripts/visual/dreamisland/polish3-frames.mjs --out=art/evidence/dreamisland-v1/polish-3/hardware/moss-final --shots=shield-moss-day,shield-moss-night
python3 scripts/visual/dreamisland/hardware-pixels.py art/evidence/dreamisland-v1/polish-3/hardware/moss-final
python3 scripts/visual/dreamisland/petal-measure.py art/evidence/dreamisland-v1/polish-3
node scripts/visual/dreamisland/power-effects.mjs --out=art/evidence/dreamisland-v1/polish-3/hardware/effects
python3 scripts/visual/dreamisland/effect-pixels.py art/evidence/dreamisland-v1/polish-3/hardware/effects
node scripts/visual/dreamisland/atlas-quadrant-proof.mjs --out=art/evidence/dreamisland-v1/polish-3/atlas-final
for tier in works rookie feral; do
  node scripts/visual/dreamisland/race.mjs --tier="$tier" --out="art/evidence/dreamisland-v1/polish-3/soak-$tier"
done
node scripts/visual/dreamisland/race.mjs --tier=works --reduced --out=art/evidence/dreamisland-v1/polish-3/soak-works-reduced
for tier in works rookie feral works-reduced; do
  node scripts/visual/dreamisland/feel.mjs "art/evidence/dreamisland-v1/polish-3/soak-$tier"
done
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.3 --out=art/evidence/dreamisland-v1/polish-3/grip-trial-030
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.2 --out=art/evidence/dreamisland-v1/polish-3/grip-floor-control
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.2 --basin-width=14 --out=art/evidence/dreamisland-v1/polish-3/width-grip-trial
node scripts/visual/dreamisland/race.mjs --tier=works --grip=0.2 --basin-width=13.9 --out=art/evidence/dreamisland-v1/polish-3/width-floor-trial
for trial in baseline-works grip-trial-030 grip-floor-control width-grip-trial width-floor-trial; do
  node scripts/visual/dreamisland/feel.mjs "art/evidence/dreamisland-v1/polish-3/$trial"
done
python3 scripts/visual/dreamisland/polish3-report.py
git diff --check
```

Calibration commands mutate their profile/palette files; run them only when recalibrating, followed by rebuilt assets, new frames and measurements. Acceptance commands read production assets and write evidence. The original baseline predates implementation and cannot be regenerated from this changed checkout without the recorded starting revision. The report/contact sheet generator only reads inputs and writes this evidence directory.
'''
(OUT / 'README.md').write_text(report)

tiles = [('clock-before-strike', 'Clock / strike minus 600 ticks'), ('clock-at-strike', 'Clock / strike'),
         ('surge-day-40m', 'Surge / 40 m day'), ('surge-night-40m', 'Surge / 40 m night'),
         ('shield-day-40m', 'Shield / 40 m day'), ('shield-night-40m', 'Shield / 40 m night'),
         ('surge-day-8m', 'Surge / detail'), ('shield-day-8m', 'Shield / detail'),
         ('shield-collected-0ticks', 'Shield / collected / 0 ms'), ('shield-collected-30ticks', 'Shield / collected / 250 ms'),
         ('surge-plate-night', 'Surge / target plate'), ('shield-plate-night', 'Shield / target plate')]
sheet = Image.new('RGB', (1280, 6 * 390), '#121820')
draw = ImageDraw.Draw(sheet)
for index, (name, label) in enumerate(tiles):
    x, y = index % 2 * 640, index // 2 * 390
    im = Image.open(OUT / 'frames-final' / (name + '.png')).convert('RGB').resize((640, 360))
    sheet.paste(im, (x, y + 30))
    draw.text((x + 10, y + 8), label, fill='white')
sheet.save(OUT / 'contact-sheet.jpg', quality=90)
print('Wrote README.md, contact-sheet.jpg and protected-hashes.json; E4 remains FAIL.')
