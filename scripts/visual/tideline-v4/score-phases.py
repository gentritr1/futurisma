"""Score the independent review only after its answer key has been unsealed."""
import json,re
from pathlib import Path
folder=Path('art/evidence/tideline-v4/phases-round4')
key=json.loads((folder/'key.json').read_text())
answers={m[0]:(m[1].lower(),int(m[2])) for m in re.findall(r'\| ([A-J]) \| ([^|]+?) \| (\d+)%', (folder/'blind-review.md').read_text())}
rows=[]
for record in key['records']:
 expected={1:'flooded',2:'partly drained',3:'drained'}[record['lap']]
 answer,confidence=answers[record['id']]
 rows.append({'frame':record['id'],'expected':expected,'answer':answer,'confidence':confidence,'correct':answer==expected,'port':.34<=record['p']<.72})
result={'script':'scripts/visual/tideline-v4/score-phases.py','frames':rows,'correct':sum(r['correct'] for r in rows),'portFrames':sum(r['port'] for r in rows),'accepted':len(rows)==10 and sum(r['port'] for r in rows)==5 and all(r['correct'] and r['confidence']>=90 for r in rows)}
(folder/'score.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));assert result['accepted']
