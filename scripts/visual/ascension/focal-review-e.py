from pathlib import Path
import json,shutil,hashlib,html
root=Path('art/evidence/ascension-v1/phase-e/focal');root.mkdir(parents=True,exist_ok=True)
features=json.loads(Path('art/evidence/ascension-v1/phase-b/model-build.json').read_text())['features'];keys=[];sections=[]
assets=['rocket-platform','crawler-transporter','countdown-board','trench-wall-module','deluge-water-tower','propellant-tank','vent-stack','crawlerway-gravel-bed','mangrove-pier','egret-card-set','service-tower-swing-arm','surge','shield']
for asset in assets:
 hero=Path('art/references/power-kit-v2/hero.png') if asset in ['surge','shield'] else Path('art/references/ascension')/f"hero-{asset}-{'flux2' if asset in assets[:4] else 'gptimage2'}.png"
 assert hero.exists(),hero
 target=root/f'reference-{asset}.png';shutil.copyfile(hero,target)
 keys.append({'asset':asset,'authoredDetails':features['power-kit' if asset in ['surge','shield'] else asset],'reference':str(hero),'referenceSha256':hashlib.sha256(hero.read_bytes()).hexdigest(),'modelSha256':hashlib.sha256((root/f'{asset}.png').read_bytes()).hexdigest()})
 note='Inherited approved Tideline power-kit hero; Ascension atlas repaint.' if asset in ['surge','shield'] else 'Approved reference hero.'
 sections.append(f'<section><h2>{html.escape(asset)}</h2><div><figure><img src="reference-{asset}.png"><figcaption>{note}</figcaption></figure><figure><img src="{asset}.png"><figcaption>Current model at chase height</figcaption></figure></div><textarea aria-label="Five shared details and verdict for {asset}"></textarea></section>')
secret=json.dumps(keys,indent=2);private=Path('/Users/gentlegen/Desktop/futurisma-race/ascension-private-review-keys');private.mkdir(exist_ok=True);(private/'focal.json').write_text(secret)
(root/'manifest.json').write_text(json.dumps({'script':'scripts/visual/ascension/focal-review-e.py','pairs':len(assets),'expectedDetailsPerPair':5,'status':'Independent review pending; authored checklist withheld','keySha256':hashlib.sha256(secret.encode()).hexdigest()},indent=2))
(root/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Focal asset comparison</title><style>body{background:#20241f;color:#eee;font:18px system-ui;margin:30px}section{border-top:1px solid #777;padding:30px 0}section>div{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}img{width:100%}textarea{width:95%;height:120px}</style><h1>Focal asset comparison</h1><p>Name five shared details in each pair and state remaining differences. For devices, judge the construction detail and lamp hardware. For the rocket, state whether it reads as a real vehicle. Authored checklists are withheld.</p>'+''.join(sections))
