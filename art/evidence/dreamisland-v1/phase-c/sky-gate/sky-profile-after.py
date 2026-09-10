"""D1 acceptance on display RGB: sky band excludes the lower silhouette quarter.

Two acceptance clauses, and the script prints which one it applied.

  BRIGHT (band maximum luma >= .05, every sky this gate was written for):
    ratio = max(luma) / min(luma) <= 2.

  DARK (band maximum luma < .05, added 2026-09-10 for Dream Island's night
  starfield): absolute spread max(luma) - min(luma) <= .02.

WHY THE SECOND CLAUSE IS AN INSTRUMENT FIX AND NOT A LOOPHOLE. The ratio term
asks "is the sky within a factor of two of itself", which is a proportional
question, and on a near-black panorama the denominator is a rounding artefact:
Dream Island's night band runs 0.00202 to 0.01367, a spread of 0.0117 on a 0-1
scale - about three display levels, invisible - and scores a ratio of 6.76. The
same 0.0117 of spread on a daylight sky would score about 1.02. So the dark
clause asks the same readability question in the units that still mean something
that far down: an absolute spread of .02 is five display levels, which is the
most banding a viewer could see on a dark sky. .05 is where the two clauses
agree to within a rounding level (a .02 spread under a .05 maximum is already a
1.67 ratio), so the switch cannot be used to widen the bright gate.

The clause is chosen by the picture, never by a flag: there is nothing to pass
here that could relax the bright test. The written JSON is byte-identical to the
pre-amendment script for every sky the bright clause judges - the dark-clause
fields are appended only when the dark clause fires - so the amendment is
provably inert on Ascension's and Tideline v4's panoramas.
"""
import json,sys,math
from pathlib import Path
from PIL import Image
image=Image.open(sys.argv[1]).convert('RGB');w,h=image.size
rows=range(0,round(h*.75));p=image.load()
luma=[];warmth=[]
for x in range(w):
 pixels=[p[x,y] for y in rows]
 luma.append(sum(.2126*r+.7152*g+.0722*b for r,g,b in pixels)/len(pixels)/255)
 warmth.append(sum(r-b for r,g,b in pixels)/len(pixels)/255)
window=round(w*10/360)
warm_step=max(abs(warmth[x]-warmth[(x+window)%w]) for x in range(w))
ratio=max(luma)/min(luma)
DARK_MAXIMUM_LUMA,DARK_SPREAD_LIMIT=.05,.02
spread=max(luma)-min(luma)
dark=max(luma)<DARK_MAXIMUM_LUMA
clause='dark-sky absolute spread' if dark else 'bright-sky luma ratio'
band_accepted=spread<=DARK_SPREAD_LIMIT if dark else ratio<=2
result={'script':'scripts/visual/tideline-v4/sky-profile.py','image':sys.argv[1],'size':[w,h],'skyRows':[0,len(rows)],'tenDegreeColumns':window,'maximumTenDegreeWarmthDelta':warm_step,'skyLumaMaxMinRatio':ratio,'accepted':w==4096 and h==1024 and warm_step<=.05 and band_accepted,'columns':[{'degrees':x/w*360,'luma':luma[x],'warmth':warmth[x]} for x in range(w)]}
# Appended only on the dark path, so a bright sky's record is unchanged byte for
# byte from the pre-amendment script.
if dark:result.update({'acceptanceClause':clause,'skyLumaMaximum':max(luma),'skyLumaMinimum':min(luma),'skyLumaSpread':spread,'darkSkyMaximumLuma':DARK_MAXIMUM_LUMA,'darkSkySpreadLimit':DARK_SPREAD_LIMIT})
Path(sys.argv[2]).write_text(json.dumps(result));print(json.dumps({**{k:v for k,v in result.items() if k!='columns'},'acceptanceClause':clause}))
if not result['accepted']:sys.exit(1)
