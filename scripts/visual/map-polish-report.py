"""Summarise observed map captures and the city optical-material correction."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/evidence/map-polish-review'


def read(path):
    return json.loads(path.read_text())


spec = importlib.util.spec_from_file_location('frame_measure', ROOT / 'scripts/visual/grade/measure-frames.py')
frame_measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frame_measure)
survey = read(OUT / 'captures.json')
captures = survey['captures']
assert len(captures) == 32
assert all(not c['errors'] and c['diagnostics']['environmentReady']
           and c['diagnostics']['mapKind'] == c['map'] for c in captures)
groups = {}
for capture in captures:
    key = capture['map'] + ('' if capture['blend'] is None else '-night' if capture['blend'] else '-day')
    groups.setdefault(key, []).append(capture)

measurements = [frame_measure.measure(str(OUT / c['file']), crop_hud=False) for c in captures]
(OUT / 'frame-measurements.json').write_text(json.dumps(measurements, indent=2) + '\n')
sheet = Image.new('RGB', (1920, len(groups) * 300), '#12171d')
draw = ImageDraw.Draw(sheet)
for row, (name, group) in enumerate(groups.items()):
    for column, capture in enumerate(group):
        x, y = column * 480, row * 300
        frame = Image.open(OUT / capture['file']).convert('RGB')
        frame.thumbnail((480, 270))
        sheet.paste(frame, (x, y + 26))
        draw.text((x + 8, y + 7), f"{name} / {capture['progress']:.0%} course", fill='white')
sheet.save(OUT / 'contact-sheet.jpg', quality=92)

trial = read(OUT / 'optics-trial/captures.json')['captures']
final = read(OUT / 'optics-final/captures.json')['captures']
optics = []
comparison = Image.new('RGB', (1280, 768), '#12171d')
draw = ImageDraw.Draw(comparison)
for row, (before, after) in enumerate(zip(trial, final)):
    name = before['map']
    assert name == after['map']
    base_path = OUT / f'optics-trial/{name}-before.png'
    final_path = OUT / f'optics-final/{name}-after.png'
    base = np.asarray(Image.open(base_path).convert('RGB'), dtype=np.int16)
    repeat = np.asarray(Image.open(OUT / f'optics-trial/{name}-repeat.png').convert('RGB'), dtype=np.int16)
    expected = np.asarray(Image.open(OUT / f'optics-trial/{name}-after.png').convert('RGB'), dtype=np.int16)
    actual = np.asarray(Image.open(final_path).convert('RGB'), dtype=np.int16)
    assert np.array_equal(base, repeat), 'Held-pose repeat has noise'
    assert np.array_equal(expected, actual), 'Shipped output differs from the accepted browser trial'
    assert all(m['fog'] and m['toneMapped'] and m['fogChunk'] and m['toneChunk'] for m in after['after']['materials'])
    for field in ['mainCalls', 'shadowCalls', 'mainTriangles', 'shadowTriangles']:
        assert before['before']['rendered'][field] == after['after']['rendered'][field], (name, field)
    delta = np.abs(actual - base)
    optics.append({'map':name, 'controlChangedPixels':int(np.any(base != repeat, axis=2).sum()),
                   'trialVsShippedChangedPixels':int(np.any(expected != actual, axis=2).sum()),
                   'changedPixels':int(np.any(delta != 0, axis=2).sum()),
                   'changedPixelsAbove8':int(np.any(delta > 8, axis=2).sum()),
                   'maximumChannelDelta':int(delta.max()),
                   'before':frame_measure.measure(str(base_path), crop_hud=False),
                   'after':frame_measure.measure(str(final_path), crop_hud=False)})
    for col, (label, path) in enumerate([('Before', base_path), ('Final', final_path)]):
        im = Image.open(path).convert('RGB'); im.thumbnail((640, 360))
        comparison.paste(im, (col * 640, row * 384 + 24))
        draw.text((col * 640 + 8, row * 384 + 6), f'{name} / {label}', fill='white')
comparison.save(OUT / 'optics-before-after.jpg', quality=94)
(OUT / 'optical-pixels.json').write_text(json.dumps({'instrument':'scripts/visual/map-polish-report.py', 'rows':optics}, indent=2)+'\n')

build = read(OUT / 'validators/build.json')
baseline = read(ROOT / 'art/evidence/dreamisland-v1/polish-3/validators/build.json')
races = [read(OUT / f'races/{m}.json')['metrics'] for m in ['nightshift', 'polarity']]
assert all(not r['errors'] and not r['missedGates'] and not r['recoveries'] and len(r['lapTimesMs']) == 3 for r in races)
production_changes = subprocess.check_output(['git', 'diff', survey['revision'], '--name-only', '--', 'src', 'public', 'art/blender'], cwd=ROOT, text=True).splitlines()
assert production_changes == ['src/game/neon-environment.ts'], production_changes
protected = ['src/game/game.ts', 'src/game/autopilot.ts', 'src/game/physics.js',
             'src/game/dreamisland-powers-config.js', 'src/game/dreamisland-schedule.js']
hashes = {}
for name in protected:
    data = (ROOT / name).read_bytes()
    assert data == subprocess.check_output(['git', 'show', f"{survey['revision']}:{name}"], cwd=ROOT)
    hashes[name] = hashlib.sha256(data).hexdigest()
(OUT / 'protected-hashes.json').write_text(json.dumps(hashes, indent=2)+'\n')

notes = {
    'greenwater':'Readable road furniture and signage; sparse verges and isolated foliage silhouettes still feel less finished.',
    'bitterpan':'Salt-pan identity and road edges read clearly; open scenery is intentionally sparse, with limited close landmark detail.',
    'nightshift':'Coherent street walls and colour cues; repeated façades remain apparent. Glow now obeys the shared render rule.',
    'polarity':'Overhead road and inverter-ring silhouettes communicate the map; broad ground/building faces remain plain. Glow corrected.',
    'tideline':'Strong material variation and enclosed industrial views; dark passages still need player legibility feedback. Tide cycle not re-audited here.',
    'ascension':'Surface markings and infrastructure load correctly; long approaches have broad plain terrain. Launch sequence not re-audited here.',
    'dreamisland':'Distinct tropical day/night palette and road-edge language; approved POLISH-3 remains intact. Controller feel remains a human-playtest item.',
}
lines = [
    '# Map polish follow-up — complete within this pass', '',
    'A fresh visual review of all seven registered circuits, plus a focused correction to Night Shift and Polarity. '
    'This is not blanket final-art approval for every map. The qualitative observations below are based on the saved frames; '
    'human playtesting and full event coverage remain separate.', '',
    '## Files added / changed', '',
    '- `src/game/neon-environment.ts`: both city optical layers now use the existing shared fog/tone-mapping adapter, loaded lazily before the environment is returned. '
    'The custom shader previously had `toneMapped: true` but omitted the tone-mapping chunk; its fog flag and fog chunk were absent.',
    '- `scripts/visual/map-polish-review.mjs`, `neon-optics-review.mjs`, `neon-race-review.mjs`, `map-polish-report.py`: read-only capture, optical comparison, race verification and report tools.',
    '- `art/evidence/map-polish-review/`: frames, comparison, measurements, validation logs and this report.', '',
    '## Rendered review', '',
    'VERIFIED loading: all 32 captures resolve the requested map, report the environment ready and record no browser errors. '
    'Four requested course positions (8%, 30%, 55%, 80%) per map; Dream Island is sampled with day and night pinned independently. '
    'The diagnostics round distance to whole metres; exact requested distances remain in each URL. '
    'HUD hidden, shipped image-treatment retained, reduced motion, 1280×720. These are stationary views, not gameplay screenshots at speed.', '',
    '![All-map survey](contact-sheet.jpg)', '',
    '| Map | Visual judgement from these frames |', '|---|---|',
]
for name, note in notes.items():
    lines.append(f'| {name} | {note} |')
lines += ['', 'The survey city frames precede the optical correction; the final comparison below and complete city races verify the changed output. '
          'The other maps do not instantiate the corrected optical layers (Tideline explicitly disables them).', '',
          '![City optical correction](optics-before-after.jpg)', '',
          '## Numbers this pass measured for the first time', '',
          'VERIFIED by `map-polish-review.mjs`: sampled draw/triangle maxima below include the separately instrumented shadow pass. '
          'They are pose samples, never substituted for a worst-tier race ceiling.', '',
          '| Map/state | Frames | Maximum sampled combined draws | Maximum sampled combined triangles |', '|---|---:|---:|---:|']
for name, group in groups.items():
    draws = max(c['rendered']['mainCalls'] + c['rendered']['shadowCalls'] for c in group)
    triangles = max(c['rendered']['mainTriangles'] + c['rendered']['shadowTriangles'] for c in group)
    lines.append(f'| {name} | {len(group)} | {draws} | {triangles:,} |')
lines += ['', 'VERIFIED by `map-polish-report.py` and the existing `grade/measure-frames.py`; luma is BT.709 on the full HUD-free frame, in 0–255 units. '
          'No lamp tint, light intensity, opacity, source texture or geometry was tuned. The correction is subtle at these poses.', '',
          '| Map | Changed pixels | Pixels with channel delta > 8 | Maximum channel delta | Mean luma before → after | Repeat noise / trial-to-shipped difference |', '|---|---:|---:|---:|---:|---:|']
for row in optics:
    lines.append(f"| {row['map']} | {row['changedPixels']:,} | {row['changedPixelsAbove8']:,} | {row['maximumChannelDelta']} | {row['before']['lumaMean']} → {row['after']['lumaMean']} | {row['controlChangedPixels']} / {row['trialVsShippedChangedPixels']} pixels |")
lines += ['', '## Budget before / after', '',
          'The before column is the approved POLISH-3 build artifact, not a newly invented baseline. '
          'Final values come from `validate-build.mjs --out=art/evidence/map-polish-review/validators`.', '',
          '| Budget | Approved before | Final | Existing ceiling |', '|---|---:|---:|---:|']
for label, key in [('Initial JavaScript gzip, B','javascriptGzip'), ('Initial shell gzip, B','shellGzip')]:
    lines.append(f"| {label} | {baseline[key]:,} | {build[key]:,} | {build['ceilings'][key]:,} |")
lines += [f"| Dream Island audio, B | {baseline['islandAudioBytes']:,} | {build['islandAudioBytes']:,} | {build['ceilings']['dreamIslandAudio']:,} |", '',
          f"Shell headroom is {build['ceilings']['shellGzip']-build['shellGzip']} B. The first static-import attempt failed at 283,654 B; "
          'the lazy city-only load passed the unchanged ceiling. Dream Island’s approved worst-tier race remains 105 draws / 162,334 triangles versus 110 / 180,000; '
          'this historical race is not claimed as a new soak. No Dream Island runtime or geometry changed.', '',
          '## Fresh city race checks', '',
          'VERIFIED by `neon-race-review.mjs`, full default three-lap Works races. '
          'The last 720 observed running-render intervals define p95; the separate pre-race 120-interval RAF calibration determines expected samples. '
          'Residual = actual samples − expected samples. These local Chrome/Metal timings are not device certification.', '',
          '| Map | Laps, ms | Missed gates / recoveries | Combined draw / triangle peak | p95, ms | Samples / expected | Residual |', '|---|---|---:|---:|---:|---:|---:|']
for r in races:
    lines.append(f"| {r['map']} | {' / '.join(map(str,r['lapTimesMs']))} | {r['missedGates']} / {r['recoveries']} | {r['peakTotalCalls']} / {r['peakTotalTriangles']:,} | {r['p95Ms']:.3f} | {r['windowSamples']} / {r['expectedSamples']:.3f} | {r['sampleResidual']:+.3f} |")
lines += ['', '**OPEN: Polarity reached 149 combined draws, above the documented 145-call shadow-enabled scene ceiling '
          '(`docs/PERFORMANCE_BASELINE.md`, P20.1).** Its gameplay checks passed; this is not a render-budget pass. '
          'The matched optical before/after views have identical main/shadow draw and triangle counts. '
          'No pre-change full-city race was captured, so the exact full-race before/after peak is unverified. '
          'Resolving the existing scene cost needs a dedicated draw audit, not brighter or newly generated art. '
          'The combined triangle totals above include shadow geometry; the historical 220,000 visible-triangle budget was stated for the main pass and is not directly comparable.', '',
          '## Registration, assets, atlas and collision checklist', '',
          '- VERIFIED: all seven existing map registrations load; no map or asset registration added.',
          '- VERIFIED: no new atlas consumers, meshes, placements or collision geometry. Existing Dream Island plate/core atlas proofs remain applicable; no new atlas-cell claim is made.',
          '- VERIFIED: only `neon-environment.ts` differs under production source/assets/Blender paths; `protected-hashes.json` checks the frozen game, controller, physics and Dream Island schedule/pickup files against the survey starting revision.',
          '- VERIFIED: the two corrected optical materials per city include shared fog and tone-mapping chunks; instance counts stay 90 per layer in Night Shift and 125 in Polarity.',
          '- No generated images/audio or Blender rebuild. Existing GPT Image 2 reference sheets and Blender build scripts are present for Dream Island, Tideline and Ascension. '
          'Image generation can supply modelling references; it is not an automatic image-to-production-mesh conversion. No missing loaded asset required generation in this pass.', '',
          '## Validators and commands', '',
          'VERIFIED: baseline and final `npm run test:code` PASS, including Python/Pillow-dependent checks and production build. '
          'Ascension course/runtime checks were also run separately because the main suite does not invoke those two checks. '
          'Logs are under `validators/`. The transient over-budget attempt is described in the budget section.', '',
          '```sh',
          'export PATH="$HOME/.nvm/versions/node/v20.19.4/bin:$PATH"',
          'node scripts/visual/map-polish-review.mjs',
          '# Before the production correction:',
          'node scripts/visual/neon-optics-review.mjs',
          '# On the final source:',
          'node scripts/visual/neon-optics-review.mjs --shipped --out=art/evidence/map-polish-review/optics-final',
          'npm run test:code',
          'npm run validate:ascension',
          'npm run validate:ascension-runtime',
          'node scripts/validate-build.mjs --out=art/evidence/map-polish-review/validators',
          'node scripts/visual/neon-race-review.mjs',
          'python3 scripts/visual/map-polish-report.py',
          'git diff --check', '```', '',
          '## Discrepancies, open verification gaps and closure', '',
          'The request to check other maps does not establish that all maps meet Dream Island’s art contracts. '
          'Greenwater/Bitterpan/older city vehicle effects still have pre-existing material exceptions, recorded in `captures.json`; '
          'this pass fixes the city scenery optics only. No controller, physics, pace, route, trigger or authored fog-density change was made. '
          'E4 remains closed by the user’s ruling: 0.213 s accepted as measured; fog/braking target withdrawn; both belong to human playtesting.', '',
          'UNVERIFIED: human driving feel, every camera/livery/device, complete launch/tide/night event coverage on all maps, and unaided landmark recognition. '
          'The sparse terrain and repeated façades above remain art observations, not silently expanded rebuild tasks. '
          'This focused follow-up is done; nothing was committed and no continuing task or automation was created.', '']
(OUT / 'README.md').write_text('\n'.join(lines))
print('Report PASS: 32 map views, controlled optical comparison, two full races and protected production scope.')
