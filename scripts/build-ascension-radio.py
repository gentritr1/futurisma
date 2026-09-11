"""Synthesize original pit-radio dialogue locally; no imported recordings or voice clones."""
import json,subprocess,tempfile,hashlib,wave
from pathlib import Path
out=Path('public/assets/ascension/audio');out.mkdir(parents=True,exist_ok=True)
lines={'minus-sixty':'T minus sixty. Launch day.','deluge-armed':'Deluge armed.','clear-trench':'Clear the trench. Take Deluge Road.'}
records=[]
with tempfile.TemporaryDirectory(prefix='ascension-radio-') as temporary:
 for name,text in lines.items():
  source=Path(temporary)/(name+'.aiff');target=out/(name+'.wav')
  subprocess.run(['/usr/bin/say','-v','Samantha','-r','165','-o',str(source),text],check=True)
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-af','silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,afade=t=in:d=0.015','-ar','48000','-ac','1','-c:a','pcm_s16le',str(target)],check=True)
  with wave.open(str(target)) as audio:frames=audio.getnframes();rate=audio.getframerate()
  records.append({'id':name,'prompt':text,'engine':'macOS say / Samantha / 165 words per minute','job_id':None,'job_id_note':'Offline local synthesis has no service job ID.','file':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sampleRate':rate,'sampleFrames':frames,'seconds':frames/rate})
manifest={'script':'scripts/build-ascension-radio.py','records':records};Path('art/evidence/ascension-v1/phase-d/radio-generation.json').write_text(json.dumps(manifest,indent=2))
path=Path('art/references/ascension/generation.json');kit=json.loads(path.read_text());kit['audio_generation']=manifest;path.write_text(json.dumps(kit,indent=2)+'\n');print(json.dumps(manifest,indent=2))
