"""Close round-2 evidence against the tested inputs, without rerunning the race."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path('art/evidence/dreamisland-v1/polish/round-2')


def read(name):
    return json.loads((ROOT / name).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


suite = read('test-code-final/result.json')
assert suite['exitCode'] == 0
input_mismatches = [path for path, expected in suite['hashes'].items()
                    if digest(path) != expected]
assert not input_mismatches, input_mismatches

frozen = Path(read('frozen-preview.json')['snapshot'])
frozen_mismatches = [path for path in suite['hashes']
                     if digest(path) != digest(frozen / path)]
assert not frozen_mismatches, frozen_mismatches

protected = ['src/game/game.ts', 'src/game/dreamisland-course.ts',
             'src/game/dreamisland-runtime.ts', 'src/game/dreamisland-schedule.js',
             'src/game/dreamisland-powers.ts', 'src/game/dreamisland-powers-config.js',
             'src/game/data/dreamisland/route.json',
             'src/game/data/dreamisland/schedule.json',
             'src/game/data/dreamisland/rival-pace.json']
protected_checks = {}
for path in protected:
    original = subprocess.check_output(['git', 'show', '40e5856:' + path])
    protected_checks[path] = digest(path) == hashlib.sha256(original).hexdigest()
assert all(protected_checks.values())
assert len(Path('src/game/game.ts').read_text().splitlines()) == 2577

soaks = {}
for name in ['feral', 'works', 'rookie', 'works-reduced']:
    metrics = read(f'soak-{name}/metrics.json')
    race = read(f'soak-{name}/race.json')
    materials = read(f'soak-{name}/material-walk.json')
    diagnostics = race['diagnostics']['current']
    assert not race['errors'] and not materials['violations']
    assert diagnostics['missedGates'] == diagnostics['recoveries'] == 0
    assert diagnostics['minimumSurfaceGrip'] == .85
    assert race['atFlag']['state']['nightSettled']
    assert metrics['windowSamples'] == 720
    assert abs(metrics['sampleResidual'] -
               (metrics['windowSamples'] - metrics['expectedSamples'])) < 1e-9
    assert metrics['peakTotalCalls'] <= 110
    triangles = metrics['peakTriangles'] + metrics['peakShadowTriangles']
    assert triangles <= 180000
    if name == 'works-reduced':
        assert race['dreamisland']['painted']['fishVisible'] == 0
        assert metrics['emissiveStability']['framesWithAnEmissiveChange'] == 0
        assert metrics['lightingStates']['crossfade'] is None
    soaks[name] = {'lapsMs': diagnostics['lapTimesMs'], 'errors': len(race['errors']),
                   'missedGates': diagnostics['missedGates'],
                   'recoveries': diagnostics['recoveries'],
                   'p95Ms': metrics['p95Ms'], 'sampleResidual': metrics['sampleResidual'],
                   'draws': metrics['peakTotalCalls'], 'triangles': triangles,
                   'materialViolations': len(materials['violations'])}

painted = read('test-code-final/validators/painted-validation.json')
assert painted['corridor']['intrusions'] == 0
assert painted['signage']['maximumLetterHeightMetres'] <= .59
assert read('canopy-clearance.json')['additionalClearance'] >= 2
assert read('test-code-final/validators/runtime-validation.json')['determinism']['identicalSnapshots']
atlas = read('atlas-final/atlas-quadrant-proof.json')
assert atlas['decided'] == 11 and not atlas['undecided']

frames = read('final-frames/frames.json')
strike = read('final-strike/strike.json')
heroes = read('hero-features/focal-capture.json')
sheet = read('eyeball-before-after.json')
assert len(frames['frames']) == 14 and not frames['errors']
assert len(strike['frames']) == 10 and not strike['errors']
assert len(heroes['frames']) == 8
assert len(sheet['pairs']) == 17
for pair in sheet['pairs']:
    assert Path(pair['before']).is_file() and Path(pair['after']).is_file()

log = (ROOT / 'test-code-final/npm-test-code.log').read_text()
build = re.search(r'([\d.]+) KiB gzip shell; [\d.]+ KiB raw / ([\d.]+) KiB gzip initial JS', log)
assert build
shell_kib, initial_js_kib = map(float, build.groups())
assert shell_kib <= 277 and initial_js_kib <= 266

changed = subprocess.check_output(['git', 'diff', '--name-only'], text=True).splitlines()
untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True).splitlines()
owned = [path for path in changed + untracked if
         path.startswith(('src/game/dreamisland-', 'public/assets/dreamisland/',
                          'art/blender/build_dreamisland_',
                          'scripts/visual/dreamisland-heroes/'))]
excluded = [path for path in changed if path not in owned]
report = {
    'instrument': __file__, 'status': 'VERIFIED: validation complete; residual 3 remains FAIL',
    'startingHead': '40e5856',
    'endingHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'concurrentCommit': '23e6d8f: paddock starting-grid fix; no commit made by this pass',
    'testCodeExit': suite['exitCode'], 'testedInputHashes': suite['hashes'],
    'inputMismatches': input_mismatches, 'frozenInputMismatches': frozen_mismatches,
    'protectedUnchangedFromStart': protected_checks,
    'excludedFilesNotEditedByThisPass': ['index.html', 'src/game/ui.ts',
        'src/game/meta-ui.ts', 'src/game/race-modes.ts', 'src/game/race-modes-rules.js',
        'scripts/validate-race-modes.mjs'],
    'otherWorktreeChanges': excluded, 'ownedSourceAndInstrumentFiles': sorted(owned),
    'evidenceRoot': str(ROOT), 'soaks': soaks,
    'build': {'instrument': 'scripts/validate-build.mjs',
              'shellGzipKiB': shell_kib, 'initialJsGzipKiB': initial_js_kib},
    'artifacts': {'chaseFrames': 14, 'beforeAfterPairs': 17, 'hero40mFrames': 8,
                  'strikeFrames': 10, 'newAtlasConsumersDecided': atlas['decided']},
    'visualInspection': 'Inspected the full 17-pair sheet, eight hero views, strike contact sheet, '
                        'and pinned grove, water, beacon and gate renders.'}
(ROOT / 'final-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(report['status'])
print(json.dumps({'soaks': soaks, 'build': report['build'], 'artifacts': report['artifacts']}, indent=2))
