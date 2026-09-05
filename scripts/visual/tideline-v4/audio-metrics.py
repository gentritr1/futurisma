"""Measure delivered PCM, not requested MediaRecorder duration."""
import wave,json,math,array
from pathlib import Path
folder=Path('art/evidence/tideline-v4/audio')
report={'script':'scripts/visual/tideline-v4/audio-metrics.py','files':[]}
for file in sorted(folder.glob('*.wav')):
 with wave.open(str(file)) as wav:
  samples=array.array('h',wav.readframes(wav.getnframes()))
  peak=max(abs(x) for x in samples)/32768
  rms=math.sqrt(sum(x*x for x in samples)/len(samples))/32768
  report['files'].append({'file':str(file),'sampleRate':wav.getframerate(),'channels':wav.getnchannels(),'sampleFrames':wav.getnframes(),'durationSeconds':wav.getnframes()/wav.getframerate(),'peak':peak,'rmsDbFS':20*math.log10(rms),'clippedSamples':sum(abs(x)>=32767 for x in samples)})
folder.joinpath('metrics.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
