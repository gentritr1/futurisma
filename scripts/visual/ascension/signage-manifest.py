"""Document atlas regions and the two explicit gameplay-size exceptions."""
from pathlib import Path
import json,hashlib
atlas='public/assets/ascension/textures/signage.jpg'
rows=[
 {'text':'09','asset':'rocket-platform','uv':[.012,.585,.488,.985],'panelMetres':[.78,.78],'maximumLetterHeightMetres':.59},
 {'text':'CT-2','asset':'crawler-transporter','uv':[.512,.585,.988,.985],'panelMetres':[1.8,1.1],'maximumLetterHeightMetres':.4},
 {'text':'TRENCH 2','asset':'trench-wall-module','uv':[.012,.012,.488,.488],'panelMetres':[2.4,2.4],'maximumLetterHeightMetres':.59},
 {'text':'S-07','asset':'power-kit / surge','uv':[.012,.505,.488,.567],'maximumLetterHeightMetres':.2},
 {'text':'P-12','asset':'power-kit / shield','uv':[.512,.505,.988,.567],'maximumLetterHeightMetres':.2},
 {'text':'SURGE','asset':'two launch strips','source':'src/game/ascension-road-signals.ts','maximumLetterHeightMetres':.59},
 {'text':'T−MM:SS / PAD 09 / TRENCH OPEN or TRENCH CLOSED / DELUGE ROAD','asset':'countdown boards 1 and 2','source':'src/game/ascension-runtime.ts','gameplaySizeException':True,'displayMetres':[26.4,7],'clockLetterHeightMetres':140/256*7,'statusLetterHeightMetres':55/256*7}]
Path('art/evidence/ascension-v1/phase-b/signage-manifest.json').write_text(json.dumps({'script':'scripts/visual/ascension/signage-manifest.py','atlas':atlas,'atlasSha256':hashlib.sha256(Path(atlas).read_bytes()).hexdigest(),'nonBoardHeights':'Conservative authored bounds; not a pixel OCR measurement.','entries':rows},indent=2))
