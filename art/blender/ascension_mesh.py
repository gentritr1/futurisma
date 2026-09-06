"""Small explicit Y-up mesh builder for the six painted Ascension atlas roles."""
import bpy, math
from mathutils import Vector

def coord(p): return (p[0],-p[2],p[1])
def empty(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o

class Asset:
 def __init__(self,name,materials):
  self.root=empty(name);self.materials=materials;self.parts={};self.tile=0;self.tint=(1,1,1,1)
 def geometry(self,points,faces,role='metal',tile=None):
  vertices,polygons,uvs,colours=self.parts.setdefault(role,([],[],[],[]));base=len(vertices);vertices.extend(coord(p) for p in points)
  tile=self.tile if tile is None else tile
  for face in faces:
   polygons.append(tuple(base+i for i in face));vs=[Vector(points[i]) for i in face];normal=(vs[1]-vs[0]).cross(vs[2]-vs[0]);axis=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=axis]
   if 1 in axes:axes=[next(a for a in axes if a!=1),1]
   lo=[min(p[a] for p in vs) for a in axes];span=[max(p[a] for p in vs)-lo[j] for j,a in enumerate(axes)]
   for p in vs:
    u=(p[axes[0]]-lo[0])/max(.0001,span[0]);v=(p[axes[1]]-lo[1])/max(.0001,span[1]);uvs.append((((tile-4 if tile in [4,5] else tile)%2)*.5+.012+u*.476,.585+v*.4 if tile in [4,5] else (1-tile//2)*.5+.012+v*.476));colours.append(self.tint)
 def box(self,c,s,role='metal',tile=None):
  points=[(c[0]+x*s[0]/2,c[1]+y*s[1]/2,c[2]+z*s[2]/2) for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
  self.geometry(points,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],role,tile)
 def beam(self,a,b,width,role='metal',tile=None):
  a,b=Vector(a),Vector(b);axis=(b-a).normalized();ref=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0));u=axis.cross(ref).normalized()*width/2;v=axis.cross(u).normalized()*width/2
  self.geometry([p+u*x+v*y for p in [a,b] for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],role,tile)
 def cylinder(self,c,r,h,role='metal',sides=12,axis=(0,1,0),top_radius=None,tile=None):
  axis=Vector(axis).normalized();ref=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0));u=axis.cross(ref).normalized();v=axis.cross(u).normalized();c=Vector(c);r2=r if top_radius is None else top_radius
  pts=[c+axis*end*h/2+(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides))*(r if end<0 else r2) for end in [-1,1] for i in range(sides)]
  faces=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]+[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
  self.geometry(pts,faces,role,tile)
 def ring(self,c,r,tube=.1,role='metal',axis=(0,0,1),segments=6):
  axis=Vector(axis).normalized();ref=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0));u=axis.cross(ref).normalized();v=axis.cross(u).normalized();c=Vector(c)
  pts=[c+(u*math.cos(i*math.tau/segments)+v*math.sin(i*math.tau/segments))*(r+tube*math.cos(j*math.tau/3))+axis*tube*math.sin(j*math.tau/3) for i in range(segments) for j in range(3)]
  self.geometry(pts,[(i*3+j,((i+1)%segments)*3+j,((i+1)%segments)*3+(j+1)%3,i*3+(j+1)%3) for i in range(segments) for j in range(3)],role)
 def ladder(self,x,y,z,height,width=.8):
  for dx in [-width/2,width/2]:self.beam((x+dx,y,z),(x+dx,y+height,z),.1)
  for i in range(int(height/.4)+1):self.beam((x-width/2,y+i*.4,z),(x+width/2,y+i*.4,z),.07)
 def plate(self,c,w,h):
  self.box(c,(w,h,.08),'metal',1)
  for x in [-1,1]:
   for y in [-1,1]:self.cylinder((c[0]+x*(w/2-.08),c[1]+y*(h/2-.08),c[2]+.06),.035,.035,sides=6,axis=(0,0,1))
 def lamp(self,c,scale=1):
  x,y,z=c;s=scale
  self.box((x,y-.5*s,z),(.45*s,.15*s,.45*s),'metal',0)
  self.cylinder((x,y,z),.22*s,.7*s,'emissive',8,tile=0)
  for angle in range(0,360,90):
   a=math.radians(angle);dx,dz=.25*s*math.cos(a),.25*s*math.sin(a);self.beam((x+dx,y-.38*s,z+dz),(x+dx,y+.38*s,z+dz),.035*s)
  for dy in [-.38,.38]:self.ring((x,y+dy*s,z),.25*s,.035*s,axis=(0,1,0))
  self.cylinder((x,y+.43*s,z),.32*s,.13*s,sides=6)
  for dx in [-.16,.16]:self.cylinder((x+dx*s,y-.4*s,z+.17*s),.022*s,.025*s,sides=6)
 def finish(self):
  for role,(vertices,faces,uvs,colours) in self.parts.items():
   mesh=bpy.data.meshes.new(self.root.name+'_'+role);mesh.from_pydata(vertices,[],faces);mesh.materials.append(self.materials[role]);mesh.update();uv=mesh.uv_layers.new(name='Atlas UV0');color=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
   for i,value in enumerate(uvs):uv.data[i].uv=value;color.data[i].color=colours[i]
   obj=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(obj);obj.parent=self.root
  return self.root
