"""3 m capsule, geometric centre at the shared origin; four contracted nodes."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from build_dreamisland_props import *
setup();nodes=[]
frame=[torus(.59,.075,z,12,4) for z in [-.85,.85]]
for x,y in [(-.62,0),(.62,0),(0,-.62),(0,.62)]:frame.append(box((.075,.075,1.7),(x,y,0)))
nodes.append(finish_node('CAP_frame',frame,'metal','rail',chrome=True))
# Capsule latitude rings retain round ends without subdivision modifiers.
glass=sphere(.58,segments=12,rings=10)
for v in glass.data.vertices:v.co.z+=.7 if v.co.z>0 else -.7
nodes.append(finish_node('CAP_glass',[glass],'emissive','shallows-glow',glass=True))
nodes.append(finish_node('CAP_core',[cylinder(.24,1.95,vertices=12)],'emissive','shallows-glow'))
nodes.append(finish_node('CAP_cap',[cylinder(.23,.22,z,vertices=12) for z in [-1.39,1.39]],'metal','rail',chrome=True))
export('capsule.glb',nodes,dict(CAP_frame=240,CAP_glass=216,CAP_core=44,CAP_cap=88))
assert sum(len(o.data.loop_triangles) for o in nodes)<=800
