"""Decode real post-master recordings and trim using the recorded AudioContext clock."""
import json, subprocess, wave, tempfile, math, array
from pathlib import Path
root=Path('art/evidence/ascension-v1/phase-d')
rows=[]
for kind,seconds in [('trench',10),('launch',20)]:
    capture=json.loads((root/f'{kind}-capture.json').read_text()); timing=capture['timing']
    cues=capture['finish']['audio']['records']
    offset=0 if kind=='trench' else next(c['contextTime'] for c in cues if c['id']=='launch-deluge')-timing['audioStart']
    assert offset>=0
    with tempfile.TemporaryDirectory() as folder:
        decoded=Path(folder)/'decoded.wav'
        decode=subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/f'{kind}.webm'),'-ar','48000','-ac','2','-c:a','pcm_s16le',str(decoded)],check=True,capture_output=True,text=True)
        with wave.open(str(decoded)) as w:
            count=w.getnframes(); data=w.readframes(count)
        start=round(offset*48000); frames=seconds*48000
        assert start+frames<=count,(kind,start,frames,count)
        clip=data[start*4:(start+frames)*4]
        with wave.open(str(root/f'{kind}.wav'),'wb') as w:
            w.setnchannels(2);w.setsampwidth(2);w.setframerate(48000);w.writeframes(clip)
        values=array.array('h',clip); peak=max(abs(v) for v in values)/32768
        rms=math.sqrt(sum(v*v for v in values)/len(values))/32768
        assert rms>.0001
    rows.append(dict(decoderWarnings=decode.stderr.strip(),durationDiscrepancySeconds=count/48000-timing['audioContextSeconds'],kind=kind,rawDecodedFrames=count,rawContextWindowSeconds=timing['audioContextSeconds'],expectedFramesAt48000=timing['audioContextSeconds']*48000,residualFrames=count-timing['audioContextSeconds']*48000,wallWindowSeconds=timing['wallSeconds'],wallExpectedFramesAt48000=timing['wallSeconds']*48000,wallResidualFrames=count-timing['wallSeconds']*48000,trimOffsetSeconds=offset,trimStartFrame=start,roundingSeconds=start/48000-offset,clipSeconds=seconds,clipFrames=frames,clipExpectedFrames=seconds*48000,clipResidual=0,peak=peak,rms=rms,startOccupied=capture['start']['trenchOccupied'],stopOccupied=timing['stopState']['trenchOccupied']))
launch=json.loads((root/'launch-capture.json').read_text())['finish']['audio']
arrival=next(c for c in launch['records'] if c['id']=='pressure-arrival')
duck=launch['duckEvents']; assert duck[1]['tick']-duck[0]['tick']==480
assert 0<=arrival['residualSeconds']<1/120+.000001
report=dict(script='scripts/visual/ascension/reconcile-audio.py',captureScript='scripts/visual/ascension/audio-capture.mjs',scope='Real post-master game mix. Opus decoded at 48000 Hz; context runs at its recorded native rate. Exact PCM clip lengths do not imply sample-exact MediaRecorder start alignment: MediaRecorder framing and decoder warnings remain uncertainty. Raw decoded duration shortfalls are reported separately; the audio-clock trim is approximate, not a sample-exact T-0 proof.',clips=rows,launchArrival=arrival,musicDuck=dict(ticks=480,rate=120,seconds=4,residualTicks=0))
(root/'audio-reconciliation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
