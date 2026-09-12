"""§8: unchanged grade instrument plus exact isolation masks, blobs and FFT."""
import json,sys,importlib.util
from pathlib import Path
import numpy as np
from PIL import Image
from autocorrelation import autocorrelation_peak
root=Path.cwd();base=root/'art/evidence/dreamisland-v1/alive/3d'
spec=importlib.util.spec_from_file_location('grade',root/'scripts/visual/grade/measure-frames.py');grade=importlib.util.module_from_spec(spec);spec.loader.exec_module(grade)
def blobs(mask):
    remaining=set(zip(*np.nonzero(mask)));largest=0
    while remaining:
        stack=[remaining.pop()];size=0
        while stack:
            y,x=stack.pop();size+=1
            for dy in (-1,0,1):
                for dx in (-1,0,1):
                    p=(y+dy,x+dx)
                    if p in remaining:remaining.remove(p);stack.append(p)
        largest=max(largest,size)
    return largest
def stats(a,mask):
    rgb=a[mask,:3].astype(np.float32)/255.; luma=rgb@np.array([.2126,.7152,.0722])*255
    white=np.zeros(mask.shape,bool);white[mask]=luma>239
    lab=grade.lab(rgb)
    return dict(pixels=len(rgb),chroma=float(np.hypot(lab[:,1],lab[:,2]).mean()),p50=float(np.median(luma)),p99=float(np.percentile(luma,99)),whitePct=float(100*white.sum()/len(rgb)),maxWhiteBlob=blobs(white),autocorrelationPeak=autocorrelation_peak(white))
rows=[]
for pose in ['court','reef']:
 for blend in ['000','100']:
    folder=base/sys.argv[1]/pose; p=folder/f'blend-{blend}.png'
    if not p.exists() and '--available' in sys.argv:continue
    a=np.array(Image.open(p).convert('RGB'));h,w=a.shape[:2]
    blank=np.array(Image.open(folder/f'blend-{blend}-blank.png').convert('RGB'))
    row=grade.measure(str(p));row.update(pose=pose,blend=blend)
    for kind in ['sea','road']:
        isolated=np.array(Image.open(folder/f'blend-{blend}-{kind}.png').convert('RGB'))
        mask=np.any(isolated!=blank,axis=2)&np.all(a==isolated,axis=2)
        region=np.zeros_like(mask)
        if kind=='road':region[int(.48*h):int(.85*h),int(.4*w):int(.75*w)]=True
        else:region[int(.18*h):int(.62*h),int(.30*w):int(.97*w)]=True
        mask &=region
        Image.fromarray(mask).save(folder/f'blend-{blend}-{kind}-mask.png')
        row[kind]=stats(a,mask)
        if kind=='road' and pose=='court' and blend=='100':
            painting=np.array(Image.open(root/'art/references/dreamisland/phase-f/target-court-night-gptimage2.png').convert('RGB').resize((w,h),Image.Resampling.LANCZOS))
            row['paintingRoad']=stats(painting,mask)
    rows.append(row)
(base/sys.argv[1]/'review-measurements.json').write_text(json.dumps(rows,indent=2))
for row in rows:print(row['pose'],row['blend'],'chroma',row['chromaMean'],'p99/range',row['p99'],row['range'],'sea',row['sea'],'road',row['road'], 'painting',row.get('paintingRoad'))
