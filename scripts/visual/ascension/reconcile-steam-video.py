"""Compare decoded VFR video frames with both recorder and container time windows."""
import json,subprocess
from pathlib import Path
root=Path('art/evidence/ascension-v1/phase-c/steam-speed');capture=json.loads((root/'capture.json').read_text());probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','stream=nb_read_frames,r_frame_rate,avg_frame_rate','-show_entries','format=duration','-of','json',str(root/'apron-live.webm')]))
(root/'ffprobe.json').write_text(json.dumps(probe,indent=2));count=int(probe['streams'][0]['nb_read_frames']);rate=capture['recording']['requestedRateHz'];rows=[]
for name,seconds in [('recorder wall time',capture['recording']['durationMs']/1000),('container video duration',float(probe['format']['duration']))]:
 rows.append({'window':name,'seconds':seconds,'expectedRateHz':rate,'expectedFrames':seconds*rate,'decodedFrames':count,'residual':count-seconds*rate,'observedRateHz':count/seconds})
result={'script':'scripts/visual/ascension/reconcile-steam-video.py','decoder':'ffprobe -count_frames','captureScript':capture['script'],'rows':rows,'interpretation':'captureStream(30) requests a maximum capture cadence, not a guaranteed fixed frame rate. The recording is variable-frame-rate. Recorder wall time includes start/stop and encoding latency and differs from the container time span. Both deficits remain explicit; no missing frames are silently counted as present. ffprobe r_frame_rate 1000/1 is not interpreted as an observed frame rate.'}
(root/'reconciliation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
