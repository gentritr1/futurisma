"""Explicit Y-up mesh builder for the Dream Island painted atlas roles.

Modelled on `art/blender/ascension_mesh.py`, with one deliberate difference:
Ascension's UV packer hard-codes its own six-tile sheet layout, and Dream Island
uses the plain 2x2 quadrant convention from
`art/references/dreamisland/phase-b/generation.json`. The rects are NOT
recomputed here - they are handed in from `public/assets/dreamisland/
atlas-manifest.json`, so the geometry samples exactly the rect the manifest
claims it samples and the two cannot drift.

Geometry is authored in GAME coordinates (Y up, -Z forward, metres) and `coord`
turns it into Blender's Z-up on the way into the mesh; `export_yup=True` turns
it back on the way out, which is the same round trip Ascension uses.
"""
import bpy, math
from mathutils import Vector

def coord(p): return (p[0],-p[2],p[1])
def empty(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o

class Asset:
 """One authored asset: geometry accumulated per role, emitted as one mesh each.

 `cell` names an atlas cell inside the current role, e.g. 'kerb-cyan'. Faces are
 planar-projected onto their two dominant axes and squeezed into that cell's
 rect. Each face samples its cell EXACTLY ONCE: an atlas cell cannot repeat,
 because texture wrapping would run into the neighbouring quadrant, so anything
 that needs a repeat is authored as repeated geometry (`grid`, `blocks`) rather
 than as a UV multiplier. `metric=True` keeps the face's aspect ratio while
 doing that - the same correction `ascension_mesh.py` makes - so a 3 m wall
 block and a 1 m kerb do not read at different stone scales.
 """
 def __init__(self,name,materials,rects):
  self.root=empty(name);self.materials=materials;self.rects=rects
  self.parts={};self.tint=(1,1,1,1);self.metric=True;self.scale=1.0
 def rect(self,role,cell):
  try:return self.rects[role][cell]
  except KeyError:raise KeyError('No atlas cell %r in role %r'%(cell,role))
 def geometry(self,points,faces,role,cell,tile=None):
  vertices,polygons,uvs,colours=self.parts.setdefault((role,cell),([],[],[],[]))
  # `scale` is a uniform authoring scale: it moves the metres an asset measures
  # without moving its proportions, and uniform scaling leaves the UVs alone.
  if self.scale!=1.0:points=[(p[0]*self.scale,p[1]*self.scale,p[2]*self.scale) for p in points]
  base=len(vertices);vertices.extend(coord(p) for p in points)
  u0,v0,u1,v1=self.rect(role,cell)
  metric=self.metric if tile is None else False
  for face in faces:
   polygons.append(tuple(base+i for i in face))
   vs=[Vector(points[i]) for i in face]
   normal=(vs[1]-vs[0]).cross(vs[2]-vs[0])
   axis=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=axis]
   # Keep the world's up axis on V wherever the face has one, so bark bands,
   # kerb stripes and wall courses never come out rotated ninety degrees.
   if 1 in axes:axes=[next(a for a in axes if a!=1),1]
   low=[min(p[a] for p in vs) for a in axes]
   span=[max(p[a] for p in vs)-low[j] for j,a in enumerate(axes)]
   for p in vs:
    s=(p[axes[0]]-low[0])/max(.0001,span[0])
    t=(p[axes[1]]-low[1])/max(.0001,span[1])
    if metric:
     aspect=span[0]/max(.0001,span[1])
     if aspect<1:s=.5+(s-.5)*aspect
     else:t=.5+(t-.5)/aspect
    uvs.append((u0+s*(u1-u0),v0+t*(v1-v0)));colours.append(self.tint)
 def box(self,centre,size,role,cell,tile=None):
  points=[(centre[0]+x*size[0]/2,centre[1]+y*size[1]/2,centre[2]+z*size[2]/2)
   for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
  self.geometry(points,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],role,cell,tile)
 def beam(self,a,b,width,role,cell,tile=None):
  a,b=Vector(a),Vector(b);axis=(b-a).normalized()
  reference=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))
  u=axis.cross(reference).normalized()*width/2;v=axis.cross(u).normalized()*width/2
  self.geometry([p+u*x+v*y for p in [a,b] for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]],
   [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],role,cell,tile)
 def cylinder(self,centre,radius,height,role,cell,sides=10,axis=(0,1,0),top_radius=None,tile=None,caps=True):
  axis=Vector(axis).normalized()
  reference=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))
  u=axis.cross(reference).normalized();v=axis.cross(u).normalized();centre=Vector(centre)
  top=radius if top_radius is None else top_radius
  points=[centre+axis*end*height/2+(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides))*(radius if end<0 else top)
   for end in [-1,1] for i in range(sides)]
  faces=[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
  if caps:faces=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]+faces
  self.geometry(points,faces,role,cell,tile)
 def card(self,centre,width,height,role,cell,yaw=0.,anchor='bottom'):
  """One flat quad. `anchor='bottom'` puts the centre on the card's foot, which
  is what lets a fern or a frond sit on the ground it is placed at."""
  rise=height/2 if anchor=='bottom' else 0
  dx,dz=math.cos(yaw)*width/2,math.sin(yaw)*width/2
  x,y,z=centre[0],centre[1]+rise,centre[2]
  self.geometry([(x-dx,y-height/2,z-dz),(x+dx,y-height/2,z+dz),
   (x+dx,y+height/2,z+dz),(x-dx,y+height/2,z-dz)],[(0,1,2,3)],role,cell,tile=1)
 def grid(self,centre,width,depth,role,cell,metres=3.2,tilt=0.):
  """A horizontal slab surface as a grid of quads, one atlas cell each.

  This is how a 24 m causeway deck gets 3 m paving stones instead of one stone
  stretched over the whole deck: the repeat lives in the geometry, because an
  atlas cell has nowhere to wrap to."""
  columns=max(1,round(width/metres));rows=max(1,round(depth/metres))
  for i in range(columns):
   for j in range(rows):
    x0=centre[0]-width/2+width*i/columns;x1=centre[0]-width/2+width*(i+1)/columns
    z0=centre[2]-depth/2+depth*j/rows;z1=centre[2]-depth/2+depth*(j+1)/rows
    y=centre[1]+tilt*(j/max(1,rows-1)-.5)
    self.geometry([(x0,y,z0),(x1,y,z0),(x1,y,z1),(x0,y,z1)],[(0,3,2,1)],role,cell,tile=1)
 def blocks(self,centre,size,length,role,cell,block=2.6,axis='z',stagger=.5,jitter=.0):
  """A run of individual stone blocks, so a wall reads as courses of 2-3 m
  blocks rather than one long box carrying one stretched block."""
  count=max(1,round(length/block));step=length/count
  for i in range(count):
   offset=-length/2+step*(i+.5)+(stagger*step if i%2 else 0)*0
   position=list(centre)
   position[2 if axis=='z' else 0]+=offset
   position[1]+=jitter*((i%3)-1)
   extent=list(size)
   extent[2 if axis=='z' else 0]=step*.94
   self.box(position,extent,role,cell)
 def leaf_clump(self,centre,width,height,role,cell,yaw=0.,lobes=7):
  """A lobed polygon instead of a rectangle, for a card cut from an OPAQUE cell.

  The broadleaf comes from the jungle leaf-fill quadrant, which is a full-bleed
  fill with no key to discard, so a quad reads as a green rectangle standing in
  the verge - which is exactly what the first build looked like. The silhouette
  therefore has to come from the geometry."""
  points=[];indices=[]
  cos,sin=math.cos(yaw),math.sin(yaw)
  for i in range(lobes*2):
   angle=i*math.tau/(lobes*2)
   radius=1. if i%2==0 else .62
   s=math.cos(angle)*radius*width/2;t=(math.sin(angle)*radius*.5+.5)*height
   points.append((centre[0]+cos*s,centre[1]+t,centre[2]+sin*s))
  points.append((centre[0],centre[1]+height*.5,centre[2]))
  hub=len(points)-1
  for i in range(lobes*2):indices.append((hub,i,(i+1)%(lobes*2)))
  self.geometry(points,indices,role,cell,tile=1)
 def crossed_cards(self,centre,width,height,role,cell,count=2,yaw=0.):
  for i in range(count):self.card(centre,width,height,role,cell,yaw+i*math.pi/count)
 def stair(self,centre,radius,rise,turns,steps,role,cell,tread=1.1,parapet=.5):
  """A winding side stair with its parapet, as `steps` boxes on a helix."""
  for i in range(steps):
   angle=turns*math.tau*i/steps;height=rise*i/steps
   x=centre[0]+math.cos(angle)*radius;z=centre[2]+math.sin(angle)*radius
   self.box((x,centre[1]+height,z),(tread,rise/steps*1.4,tread),role,cell,tile=1)
   self.box((x+math.cos(angle)*tread*.7,centre[1]+height+parapet,z+math.sin(angle)*tread*.7),
    (tread*.5,parapet*2,tread*.5),role,cell,tile=1)
 def merlons(self,centre,radius,height,count,missing,role,cell,sides=12):
  """Crenellations around a drum, with `missing` of them left out as a ruin."""
  for i in range(count):
   if i in missing:continue
   angle=i*math.tau/count
   self.box((centre[0]+math.cos(angle)*radius,centre[1]+height/2,centre[2]+math.sin(angle)*radius),
    (1.3,height,1.3),role,cell,tile=1)
 def finish(self):
  for (role,cell),(vertices,faces,uvs,colours) in self.parts.items():
   mesh=bpy.data.meshes.new(self.root.name+'_'+role+'_'+cell)
   mesh.from_pydata(vertices,[],faces);mesh.materials.append(self.materials[role]);mesh.update()
   uv=mesh.uv_layers.new(name='Atlas UV0')
   colour=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
   for i,value in enumerate(uvs):uv.data[i].uv=value;colour.data[i].color=colours[i]
   obj=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(obj);obj.parent=self.root
  return self.root

def triangles(root):
 return sum(sum(len(p.vertices)-2 for p in o.data.polygons)
  for o in [root]+list(root.children_recursive) if o.type=='MESH')
