"""Eight-second 1/3-octave energy comparison at the shipped 24 kHz bandwidth.
Usage: python3 bed-match.py reference.mp3 rendered.wav output.json
All complete bands from 19.7 through 10079 Hz; no quiet bands are omitted.
"""
import json
import subprocess
import sys
from pathlib import Path
import numpy as np

RATE, SECONDS = 24000, 8
CENTERS = 1000 * 2 ** (np.arange(-17, 11) / 3)

def samples(path):
    data = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1',
                                    '-ar', str(RATE), '-t', str(SECONDS), '-f', 'f32le', '-'])
    x = np.frombuffer(data, dtype='<f4').astype(float)
    assert len(x) >= RATE * SECONDS, (path, len(x))
    return x[:RATE * SECONDS]

def bands(x):
    power = abs(np.fft.rfft(x))**2 * 2 / len(x)**2
    hz = np.fft.rfftfreq(len(x), 1/RATE)
    return np.array([10*np.log10(max(1e-30, power[(hz >= c/2**(1/6)) & (hz < c*2**(1/6))].sum())) for c in CENTERS])

if __name__ == '__main__':
    reference, rendered, output = map(Path, sys.argv[1:4])
    a, b = samples(reference), samples(rendered)
    reference_bands, rendered_bands = bands(a), bands(b)
    rows = [dict(hz=float(c), referenceDb=float(r), renderedDb=float(s), deltaDb=float(s-r), passBand=bool(abs(s-r)<=6))
            for c, r, s in zip(CENTERS, reference_bands, rendered_bands)]
    report = dict(script='scripts/visual/dreamisland/bed-match.py', sampleRate=RATE, seconds=SECONDS,
                  reference=str(reference), rendered=str(rendered), bands=rows, passed=all(r['passBand'] for r in rows),
                  referenceRmsDb=float(10*np.log10(np.mean(a*a))), renderedRmsDb=float(10*np.log10(np.mean(b*b))),
                  peak=float(max(abs(b))), bandwidthNote='All complete 1/3-octave bands in the 24 kHz delivery format; both inputs resampled identically.')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))
    assert report['passed'], 'Bed tone-match exceeds ±6 dB; retain the table and recalibrate or ship the reference loop.'
