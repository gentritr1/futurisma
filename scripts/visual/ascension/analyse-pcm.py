"""50 ms waveform evidence. Cue logs anchor time; waveform differences determine onset."""
import json,wave
from pathlib import Path
import numpy as np
root=Path('art/evidence/ascension-v1/audio-instrument');rate=48000;window=2400
runs={}
for name in 'ABC':
 meta=json.loads((root/f'{name}.json').read_text())
 with wave.open(str(root/f'{name}.wav')) as w:
  assert (w.getframerate(),w.getsampwidth(),w.getnchannels())==(rate,2,6)
  frames=w.getnframes();pcm=np.frombuffer(w.readframes(frames),dtype='<i2').reshape(-1,6).astype(float)/32768
 assert frames==meta['endFrame']-meta['startFrame']==meta['capturedFrames']==100*rate
 runs[name]=(meta,pcm)
def cue(name,id):
 return next(c for c in runs[name][0]['rows'][-1]['audio']['records'] if c['id']==id)
def rms(name,time,bus,band=None):
 meta,pcm=runs[name];start=round(time*rate-meta['startFrame']);x=pcm[start:start+window,bus*2:bus*2+2]
 if len(x)!=window:return 0
 if band:
  x=x.mean(axis=1);spectrum=np.fft.rfft(x);frequency=np.fft.rfftfreq(window,1/rate)
  return float(np.sqrt(2*np.sum(np.abs(spectrum[(frequency>=band[0])&(frequency<=band[1])])**2))/window)
 return float(np.sqrt(np.mean(x*x)))
def difference(id,control,band,before,after):
 bt=cue('B',id)['contextTime'];at=cue(control,id)['contextTime'];rows=[]
 for t in np.arange(before,after,.05):
  a=rms(control,at+t,2,band);b=rms('B',bt+t,2,band)
  rows.append(dict(secondsFromAnchor=round(float(t),6),controlBandRms=a,enabledBandRms=b,addedBandRms=float(np.sqrt(max(0,b*b-a*a))),masterControl=rms(control,at+t,0),masterEnabled=rms('B',bt+t,0),musicControl=rms(control,at+t,1),musicEnabled=rms('B',bt+t,1)))
 return rows
# Launch comparison is anchored to T-0, not to the recorded scheduled launch-cue tick.
launch=difference('launch-deluge','A',(20,200),-.5,3)
# Use pre-arrival waveform noise to establish a threshold; keep it in the result.
expected=cue('B','pressure-arrival')['distance']/343
baseline=[r['addedBandRms'] for r in launch if 0<=r['secondsFromAnchor']<max(0,expected-.15)]
threshold=max(.003,float(np.quantile(baseline,.95))*2)
def onset(rows,threshold):
 for i in range(len(rows)-2):
  if all(r['addedBandRms']>threshold for r in rows[i:i+3]):return rows[i]['secondsFromAnchor']
 return None
observed=onset(launch,threshold)
# Music component is tapped after the production duck gain. Full-mix RMS is also retained;
# engine and launch energy must not be mislabelled as music gain.
music=[]
for t in np.arange(0,4,.05):
 a=rms('A',cue('A','launch-deluge')['contextTime']+t,1);b=rms('B',cue('B','launch-deluge')['contextTime']+t,1)
 music.append(dict(masterA=rms('A',cue('A','launch-deluge')['contextTime']+t,0),masterB=rms('B',cue('B','launch-deluge')['contextTime']+t,0),seconds=float(t),a=a,b=b,db=float(20*np.log10(max(b,1e-9)/max(a,1e-9)))))
depth=float(10*np.log10(sum(r['b']**2 for r in music)/sum(r['a']**2 for r in music)))
klaxon=difference('crawler-klaxon-1','C',(180,450),-.5,4);k_onset=onset(klaxon,.003)
meta=runs['B'][0];cross=next(e['tick'] for e in meta['rows'][-1]['schedule']['events'] if e['id']=='crawler-cross-1')
crossTime=next(r['contextTime'] for r in meta['rows'] if r['tick']>=cross)
lead=crossTime-(cue('B','crawler-klaxon-1')['contextTime']+(k_onset or 0))
deluge=difference('rehearsal','C',(1000,6000),-.5,5);d_onset=onset(deluge,.003)
result=dict(script='scripts/visual/ascension/analyse-pcm.py',captureScript='scripts/visual/ascension/audio-capture.mjs',windowSeconds=.05,samplesPerEnvelope=window,pcm={n:dict(seconds=100,rate=rate,expected=100*rate,observed=runs[n][0]['capturedFrames'],residual=0) for n in runs},launch=dict(expectedDistanceSeconds=expected,distanceMetres=cue('B','pressure-arrival')['distance'],envelopeWindowSeconds=3.5,expectedEnvelopeSamples=70,observedEnvelopeSamples=len(launch),envelopeResidual=len(launch)-70,waveformOnsetSeconds=observed,threshold=threshold,bandHz=[20,200],residualSeconds=None if observed is None else observed-expected,passGate=observed is not None and abs(observed-expected)<=.1,envelopes=launch),duck=dict(windowSeconds=4,expectedEnvelopeSamples=4/.05,observedEnvelopeSamples=len(music),residual=len(music)-4/.05,fullMixChangeDb=float(10*np.log10(sum(r['masterB']**2 for r in music)/sum(r['masterA']**2 for r in music))),measuredMusicDb=depth,designDb=float(20*np.log10(.25)),passGate=bool(abs(depth-20*np.log10(.25))<=3),envelopes=music,scope='Music bus after production duck gain, synchronous with post-master reference. Total mix contains engine/launch and is not a music-gain measurement.'),klaxon=dict(envelopeWindowSeconds=4.5,expectedEnvelopeSamples=90,observedEnvelopeSamples=len(klaxon),envelopeResidual=len(klaxon)-90,waveformOnsetFromCueSeconds=k_onset,leadBeforeCrossingSeconds=lead,passGate=k_onset is not None and lead>=2,envelopes=klaxon),deluge=dict(envelopeWindowSeconds=5.5,expectedEnvelopeSamples=110,observedEnvelopeSamples=len(deluge),envelopeResidual=len(deluge)-110,waveformOnsetFromTestSeconds=d_onset,passGate=d_onset is not None and abs(d_onset)<=.1,envelopes=deluge))
# Confirm that the differential launch waveform reaches the POST-MASTER output.
# Find mixer latency from the waveform, rather than assuming a compressor delay.
def segment(name,time,bus,length=window):
 meta,pcm=runs[name];i=round(time*rate-meta['startFrame']);return pcm[i:i+length,bus*2:bus*2+2].mean(axis=1)
def low_band(x):
 z=np.fft.rfft(x);f=np.fft.rfftfreq(len(x),1/rate);z[(f<20)|(f>200)]=0;return np.fft.irfft(z,n=len(x))
def template(t,length=window):
 return low_band(segment('B',cue('B','launch-deluge')['contextTime']+t,2,length)-segment('A',cue('A','launch-deluge')['contextTime']+t,2,length))
ref=template(observed+.05,round(.4*rate));scores=[]
for lag in range(0,961,48):
 signal=low_band(segment('B',cue('B','launch-deluge')['contextTime']+observed+.05+lag/rate,0,len(ref)))
 scores.append((float(np.corrcoef(signal,ref)[0,1]),lag))
correlation,lag=max(scores);matched=[]
for row in launch:
 t=row['secondsFromAnchor'];ref=template(t);signal=low_band(segment('B',cue('B','launch-deluge')['contextTime']+t+lag/rate,0));gain=float(np.dot(signal,ref)/max(1e-12,np.dot(ref,ref)));coherence=float(np.corrcoef(signal,ref)[0,1]) if np.std(signal)>1e-12 and np.std(ref)>1e-12 else 0.;matched.append(dict(seconds=t,correlation=coherence,projectedRms=gain*float(np.sqrt(np.mean(ref*ref)))))
master_onset=next((r['seconds'] for i,r in enumerate(matched[:-2]) if all(q['correlation']>.5 and q['projectedRms']>.003 for q in matched[i:i+3])),None)
result['postMasterLaunch']={'method':'50 ms 20–200 Hz differential event waveform matched to post-master PCM; three consecutive windows require correlation >0.5 and projected RMS >0.003. Mixer latency calibrated by 0–20 ms lag scan at 1 ms spacing. This confirms routing, not perceived loudness.','measuredMixerLagSeconds':lag/rate,'calibrationCorrelation':correlation,'waveformOnsetSeconds':master_onset,'expectedSeconds':expected,'residualSeconds':None if master_onset is None else master_onset-expected,'passGate':master_onset is not None and abs(master_onset-expected)<=.1,'envelopes':matched}
for name in 'AB':
 meta,pcm=runs[name];start=round(cue(name,'launch-deluge')['contextTime']*rate-meta['startFrame']);clip=(np.clip(pcm[start:start+20*rate,:2],-1,1)*32768).clip(-32768,32767).astype('<i2')
 with wave.open(str(root/f'launch-{name}-master.wav'),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate);w.writeframes(clip.tobytes())
(root/'differential.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:{n:v for n,v in val.items() if n!='envelopes'} if isinstance(val,dict) else val for k,val in result.items()},indent=2))
assert all(result[k]['passGate'] for k in ['launch','duck','klaxon','deluge','postMasterLaunch']), 'Audio waveform gate failed'
