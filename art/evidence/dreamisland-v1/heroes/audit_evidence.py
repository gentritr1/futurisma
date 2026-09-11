"""Reconcile renders to the final GLBs, check ruler pixels, and make contact sheets.

python3 art/evidence/dreamisland-v1/heroes/audit_evidence.py
"""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageStat

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[3]
manifest=json.loads((ROOT/'public/assets/dreamisland/heroes/heroes.json').read_text())
master=json.loads((OUT/'blender-render-check.json').read_text())
frames={frame['file']:frame for frame in master['frames']}
for path in sorted(OUT.glob('blender-render-check-*.json'),key=lambda p:p.stat().st_mtime):
    for frame in json.loads(path.read_text())['frames']:
        frames[frame['file']]=frame
assert len(frames)==19
assert sum(frame['cameraType']=='orthographic' for frame in frames.values())==16
assert sum(frame['cameraType']=='perspective' for frame in frames.values())==3
proof={'status':'VERIFIED','frames':[],'turntables':16,'distanceFrames':3,'rulerPixelChecks':16}
for file,frame in frames.items():
    source=ROOT/'public/assets/dreamisland/heroes'/manifest['assets'][frame['asset']]['file']
    sha=hashlib.sha256(source.read_bytes()).hexdigest()
    assert sha==frame['assetSha256'],f'Stale render metadata: {file}'
    im=Image.open(OUT/file).convert('RGB')
    assert im.size==(1280,960)
    # Distant stacks occupy a small part of the frame by design. Test for a
    # constant image here; visual readability is reviewed separately.
    assert max(ImageStat.Stat(im).stddev)>1,f'Constant frame: {file}'
    result={'file':file,'assetSha256':sha,'pngSha256':hashlib.sha256((OUT/file).read_bytes()).hexdigest(),'size':list(im.size)}
    if frame['cameraType']=='orthographic':
        span=frame['verticalSpanMetres']
        bar=frame['scaleBarPixels']
        assert abs(bar-2/span*960)<1e-6
        x=round(1184+.06/(span*1280/960)*1280-.5)
        samples=[im.getpixel((x,round(888-(i+.5)*bar/4-.5))) for i in range(4)]
        luma=[sum(pixel)/3 for pixel in samples]
        assert min(luma[0],luma[2])>max(luma[1],luma[3])+40,(file,samples)
        result['ruler']={'metres':2,'pixels':bar,'segmentCentresRgb':samples,'allFourHalfMetreSegmentsVisible':True}
    else:
        target=300 if frame['asset']=='sea-stack-set' else 40
        assert abs(frame['distanceMetres']-target)<.001
        assert frame['verticalFovDegrees']==(65 if frame['asset']=='watchtower' else 50)
        result['distanceMetres']=frame['distanceMetres']
    proof['frames'].append(result)
for name in manifest['assets']:
    views=['front','side','back','three-quarter']
    group=[frames[name+'-'+view+'.png'] for view in views]
    assert len({frame['verticalSpanMetres'] for frame in group})==1,'Turntable scale must be consistent'
    sheet=Image.new('RGB',(1280,960))
    for i,view in enumerate(views):
        im=Image.open(OUT/(name+'-'+view+'.png')).convert('RGB')
        im=im.resize((640,480),Image.Resampling.LANCZOS)
        sheet.paste(im,((i%2)*640,(i//2)*480))
    sheet.save(OUT/(name+'-turntable.png'))
overview=Image.new('RGB',(1280,960))
for i,name in enumerate(manifest['assets']):
    im=Image.open(OUT/(name+'-three-quarter.png')).convert('RGB').resize((640,480),Image.Resampling.LANCZOS)
    overview.paste(im,((i%2)*640,(i//2)*480))
overview.save(OUT/'heroes-overview.png')
web=json.loads((OUT/'render-check.json').read_text())
grid=[sample for check in web['atlasPixelProof'] for sample in check.get('grid',[])]
assert len(grid)==175
assert max(sample['error'] for sample in grid)<=3
proof['atlasGridSamples']=len(grid)
proof['atlasMaximumChannelError']=max(sample['error'] for sample in grid)
proof['atlasProbeFiles']=[check['file'] for check in web['atlasPixelProof']]
assert all((OUT/file).exists() for file in proof['atlasProbeFiles'])
for old in OUT.glob('atlas-pixel-*.png'):
    if old.name not in proof['atlasProbeFiles']:
        old.unlink()  # Obsolete probes from this evidence task only.
master['frames']=list(frames.values())
(OUT/'blender-render-check.json').write_text(json.dumps(master,indent=2)+'\n')
(OUT/'evidence-audit.json').write_text(json.dumps(proof,indent=2)+'\n')
print('VERIFIED 19 current-GLB Blender frames; 16 complete 2 m rulers; 175 atlas grid samples; maximum channel error',proof['atlasMaximumChannelError'])
