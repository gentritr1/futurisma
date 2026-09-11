"""Four contiguous art zones, measured along the unchanged shortcut centreline."""
import math,json,bpy
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
 lod_cache={}
 zones=[{'name':names[i],'fromMetres':cuts[i],'toMetres':cuts[i+1],'lengthMetres':cuts[i+1]-cuts[i],'fromProgress':stations[at(cuts[i])]['progress'],'toProgress':stations[at(cuts[i+1])]['progress']} for i in range(4)]
 for i in range(20,len(stations)-20,10):
  st=stations[i];t=Vector(st['t']);k=zone(distances[i])
  for side in [-1,1]:
   q=sample(i,14*side)
   if min(math.hypot(q.x-s['p'][0],q.z-s['p'][2]) for s in route['stations'])<28:continue
   wall=place('trench-wall-module',q,math.atan2(-t.z,t.x)+(math.pi if side>0 else 0),sector='TRENCH')
   wall['trenchZone']=names[k]
   if k==0:wall.scale.z*=.62
   if k==2:
    # Dry refractory lining uses the dry cracked upper area of the existing atlas,
    # never the algae waterline. Four vertical bands resolve the heat gradient.
    lining=Asset('scorched-lining',materials)
    for lo,hi,bottom,top in [(0,4,.52,.42),(4,6,.42,.18),(6,10,.18,.025),(10,14,.025,.015)]:
     lining.box((0,(lo+hi)/2,0),(24,hi-lo,3),'concrete',0)
    lining.box((0,.7,1.73),(4.3,1.4,.16),'metal',1)
    lining.finish()
    for part in lining.root.children:
     if part.data.materials[0]==materials['concrete']:
      for loop,uv,color in zip(part.data.loops,part.data.uv_layers.active.data,part.data.color_attributes['Color'].data):
       height=part.data.vertices[loop.vertex_index].co.z
       shade=.52 if height<=0 else .42 if height<=4 else .18 if height<=6 else .025 if height<=10 else .015
       heat=max(0,1-abs(height-6)/3)
       color.color=(shade*(1+.20*heat),shade*(1-.06*heat),shade*(1-.25*heat),1)
       uv.uv.y=.72+(uv.uv.y-.512)/.476*.26
      old=next(o for o in wall.children if o.type=='MESH' and o.data.materials[0]==materials['concrete']);old.data=part.data
     else:
      cover=part.copy();bpy.context.collection.objects.link(cover);cover.parent=wall;cover['paintVariant']='sealed-drain'
    for child in list(lining.root.children):bpy.data.objects.remove(child,do_unlink=True)
    bpy.data.objects.remove(lining.root,do_unlink=True)
    # Two lamps on each wall: one survives on the left wall, none on the right.
    glass=next(o for o in wall.children if o.type=='MESH' and o.data.materials[0]==materials['emissive'])
    source=glass.data
    for alive in [False,True]:
     faces=[p for p in source.polygons if (side<0 and sum(source.vertices[v].co.x for v in p.vertices)/len(p.vertices)<0)==alive]
     if not faces:continue
     data=bpy.data.meshes.new('scorched-glass');data.from_pydata([v.co for v in source.vertices],[],[list(p.vertices) for p in faces]);data.materials.append(materials['emissive' if alive else 'metal']);data.update()
     uv=data.uv_layers.new();color=data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');loops=[j for p in faces for j in p.loop_indices]
     for n,j in enumerate(loops):uv.data[n].uv=source.uv_layers.active.data[j].uv;color.data[n].color=(1,1,1,1) if alive else (.025,.025,.025,1)
     obj=bpy.data.objects.new('scorched-lamp-glass',data);bpy.context.collection.objects.link(obj);obj.parent=wall;obj['paintVariant']='survivor' if alive else 'dead-'+str(side)
    bpy.data.objects.remove(glass,do_unlink=True)
   elif k==3:
    for mesh in wall.children:
     if mesh.type=='MESH' and mesh.data.materials[0]==materials['concrete']:
      mesh.data=mesh.data.copy()
      for color in mesh.data.color_attributes['Color'].data:color.color=(.37,.52,.49,1)
   for mesh in list(wall.children):
    if mesh.type!='MESH' or len(mesh.data.polygons)<100:continue
    role=mesh.data.materials[0].name.split('_')[-1]
    if role not in ['metal','signage']:continue
    mesh['lodLevel']=0
    cache_key=(k,mesh.data.materials[0].name,len(mesh.data.polygons),mesh.get('paintVariant'))
    lod=mesh.copy();bpy.context.collection.objects.link(lod);lod.parent=wall;lod['lodLevel']=1
    if cache_key in lod_cache:lod.data=lod_cache[cache_key]
    else:
     lod.data=mesh.data.copy();bpy.context.view_layer.objects.active=lod
     modifier=lod.modifiers.new('Distant module simplification','DECIMATE');modifier.ratio=.16
     bpy.ops.object.modifier_apply(modifier=modifier.name);lod_cache[cache_key]=lod.data
 # Fixed portal jambs mark all three boundaries; clear opening is 24 m x 11.5 m.
 a=Asset('trench-zone-portals',materials)
 for d in cuts[1:-1]:
  i=at(d)
  for side in [-1,1]:
   a.beam(sample(i,side*13,0),sample(i,side*13,12.5),2,'metal',1)
   a.beam(sample(i,side*11.95,0),sample(i,side*11.95,11.5),.18,'signage',3)
  a.beam(sample(i,-14,12.5),sample(i,14,12.5),2,'metal',1)
  a.beam(sample(i,-12,11.45),sample(i,12,11.45),.18,'signage',3)
 a.finish();library[a.root.name]=a.root;place(a.root.name,(0,0,0),sector='TRENCH')
 # Soot is dry, cracked and opaque. A scoured centre strip carries the racing line.
 a=Asset('trench-scorched-floor',materials)
 for i in range(at(440),at(700),2):
  end=min(i+2,at(700))
  for left,right,tint in [(-10,-1.2,(.065,.062,.058,1)),(-1.2,1.2,(1.05,1.01,.94,1)),(1.2,10,(.065,.062,.058,1))]:
   a.tint=tint;a.geometry([sample(j,x,.025) for j in [i,end] for x in [left,right]],[(0,1,3,2)],'concrete',3)
 a.finish();library[a.root.name]=a.root;place(a.root.name,(0,0,0),sector='TRENCH')
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
