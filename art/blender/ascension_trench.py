"""Four contiguous art zones, measured along the unchanged shortcut centreline."""
import math,json
from mathutils import Vector
from ascension_mesh import Asset

def build_trench(route,place,library,materials,out):
 stations=route['shortcut']['stations'];distances=[0.]
 for a,b in zip(stations,stations[1:]):distances.append(distances[-1]+(Vector(a['p'])-Vector(b['p'])).length)
 cuts=[0,180,440,700,distances[-1]];names=['ENTRY RAMP','PAD UNDERSIDE','SCORCHED ZONE','DELUGE EXIT']
 assert all(120<=b-a<=400 for a,b in zip(cuts,cuts[1:]))
 def at(distance):return min(range(len(distances)),key=lambda i:abs(distances[i]-distance))
 def zone(distance):return min(3,next((i for i in range(4) if distance<cuts[i+1]),3))
 def sample(i,x=0,y=0,z=0):
  st=stations[i];t=Vector(st['t']);right=t.cross(Vector((0,1,0))).normalized()
  return Vector(st['p'])+right*x+Vector((0,y,0))+t*z
 zones=[{'name':names[i],'fromMetres':cuts[i],'toMetres':cuts[i+1],'lengthMetres':cuts[i+1]-cuts[i],'fromProgress':stations[at(cuts[i])]['progress'],'toProgress':stations[at(cuts[i+1])]['progress']} for i in range(4)]
 for i in range(20,len(stations)-20,10):
  st=stations[i];t=Vector(st['t']);k=zone(distances[i])
  for side in [-1,1]:
   q=sample(i,14*side)
   if min(math.hypot(q.x-s['p'][0],q.z-s['p'][2]) for s in route['stations'])<28:continue
   wall=place('trench-wall-module',q,math.atan2(-t.z,t.x)+(math.pi if side>0 else 0),sector='TRENCH')
   wall['trenchZone']=names[k]
   if k==0:wall.scale.z*=.62
   for mesh in wall.children:
    if mesh.type!='MESH':continue
    role=mesh.data.materials[0].name.split('_')[-1]
    if k in [2,3] and role in ['concrete','emissive']:
     mesh.data=mesh.data.copy()
     if k==2 and role=='emissive':mesh.data.materials[0]=materials['metal']
     for loop,color in zip(mesh.data.loops,mesh.data.color_attributes['Color'].data):
      height=mesh.data.vertices[loop.vertex_index].co.z
      if k==2:
       shade=.035 if role=='emissive' else .64-(.60*max(0,min(1,(height-4)/5)))
       color.color=(shade,shade*.87,shade*.70,1)
      elif role=='concrete':color.color=(.37,.52,.49,1)
 # The underside is a connected service apron with an exhaust opening under the rocket.
 a=Asset('trench-pad-underside',materials)
 for i in range(at(180),at(440),6):
  end=min(i+6,at(440));middle=(distances[i]+distances[end])/2
  bands=[(-24,-7),(7,24)] if 318<middle<385 else [(-24,24)]
  for left,right in bands:
   points=[sample(j,x,y) for y in [13,14] for j in [i,end] for x in [left,right]]
   a.geometry(points,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3)],'concrete',0)
  if i%18==0:
   a.beam(sample(i,-14,12.8),sample(i,14,12.8),.45)
   for side in [-1,1]:a.beam(sample(i,side*16,0),sample(i,side*16,13),.7)
 a.finish();library[a.root.name]=a.root;place(a.root.name,(0,0,0),sector='TRENCH')
 # A curved flame deflector beside the running lane leaves the full road clear.
 a=Asset('trench-flame-deflector',materials);i=at(354)
 points=[sample(i,x,y,z) for x in [11.8,19] for y,z in [(0,-9),(0,9),(12,9),(9,4),(3,-2)]]
 a.tint=(.24,.22,.18,1);a.geometry(points,[(0,4,3,2,1),(5,6,7,8,9)]+[(j,(j+1)%5,(j+1)%5+5,j+5) for j in range(5)],'concrete',1)
 a.finish();library[a.root.name]=a.root;place(a.root.name,(0,0,0),sector='TRENCH')
 # Wet exit: repeated overhead deluge headers and open roadside drainage channels.
 a=Asset('trench-deluge-hardware',materials)
 for d in range(712,int(distances[-1]),24):
  i=at(d);a.beam(sample(i,-14,12),sample(i,14,12),.55)
  for x in [-12,-8,-4,0,4,8,12]:a.beam(sample(i,x,12),sample(i,x,11.6),.20)
  for side in [-1,1]:
   a.beam(sample(i,side*14,0),sample(i,side*14,12),.45)
 for i in range(at(700),len(stations)-12,4):
  for side in [-1,1]:
   end=min(i+4,len(stations)-1);points=[sample(j,side*x,-.025) for j in [i,end] for x in [10.4,12.3]]
   a.geometry(points,[(0,1,3,2)],'metal',3)
 a.finish();library[a.root.name]=a.root;place(a.root.name,(0,0,0),sector='TRENCH')
 report={'script':'art/blender/ascension_trench.py','routeUnchanged':True,'measuredLengthMetres':distances[-1],'zones':zones,'transitions':[{'progress':stations[at(cuts[i])]['progress'],'metres':cuts[i],'from':names[i-1],'to':names[i]} for i in range(1,4)]}
 (out/'trench-zones.json').write_text(json.dumps(report,indent=2))
