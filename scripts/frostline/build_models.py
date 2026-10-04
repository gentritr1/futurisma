"""Original Frostline holiday village. Blender Z-up -> glTF Y-up."""
import bpy, math, os, random
from mathutils import Vector
random.seed(2000)
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'public/assets/frostline')
os.makedirs(OUT,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
colors={'wood':(.25,.14,.07,1),'stone':(.5,.55,.63,1),'snow':(.83,.89,.96,1),'cream':(.75,.66,.49,1),'red':(.43,.055,.055,1),'green':(.025,.12,.075,1),'copper':(.45,.21,.11,1),'dark':(.025,.045,.075,1),'gold':(.9,.55,.15,1),'bulb':(1,.7,.3,1),'window':(1,.7,.35,1)}
mats={}
for name,c in colors.items():
    m=bpy.data.materials.new(name);m.diffuse_color=c;m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=c;mats[name]=m

def group(name,parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;return o

def done(o,name,mat,parent):
    o.name=name;o.data.materials.append(mats[mat]);o.parent=parent
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.select_set(False);return o

def box(name,p,size,mat,parent):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.scale=size;return done(o,name,mat,parent)

def cyl(name,p,r,depth,mat,parent,verts=12,r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r,radius2=r if r2 is None else r2,depth=depth,location=p);return done(bpy.context.object,name,mat,parent)

def ball(name,p,r,mat,parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10,ring_count=6,radius=r,location=p);return done(bpy.context.object,name,mat,parent)

def beam(name,a,b,r,mat,parent):
    a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(b-a).length,mat,parent,8);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def mesh(name,verts,faces,mat,parent):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.parent=parent;data.materials.append(mats[mat]);
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False);return o

def window(parent,x,y,z,w=2.7,h=2.8,side=False):
    # Each visible pane has unambiguous full-square UVs for the generated window.
    verts=[(-w/2,0,-h/2),(w/2,0,-h/2),(w/2,0,h/2),(-w/2,0,h/2)]
    o=mesh('warm_window',verts,[(0,1,2,3)],'window',parent);o.location=(x,y,z)
    if side:o.rotation_euler.z=math.pi/2
    uv=o.data.uv_layers.active
    for loop,coords in zip(o.data.polygons[0].loop_indices,[(0,0),(1,0),(1,1),(0,1)]):uv.data[loop].uv=coords
    if not side:
      box('window_sill',(x,y-.2,z-h/2),(w+.5,.6,.22),'wood',parent)
      box('sill_snow',(x,y-.2,z-h/2+.2),(w+.6,.6,.2),'snow',parent)
      for dx in [-w/2-.45,w/2+.45]:box('shutter',(x+dx,y-.06,z),(.65,.25,h),'green',parent)

def roof(parent,w,d,eave,peak,material='wood'):
    verts=[(-w,-d,eave),(w,-d,eave),(0,-d,peak),(-w,d,eave),(w,d,eave),(0,d,peak)]
    faces=[(2,5,3,0),(1,4,5,2),(1,2,0),(5,4,3)]
    mesh('gable_roof',verts,faces,material,parent)
    mesh('thick_snow_roof',[(x,y,z+.48) for x,y,z in verts],[(2,5,3,0),(1,4,5,2)],'snow',parent)
    for x in [-w,w]:
      beam('eave_beam',(x,-d,eave),(x,d,eave),.3,'wood',parent)
      for y in range(-int(d),int(d)+1,2):
        snow=ball('eave_snow',(x,y,eave+.5),.75,'snow',parent);snow.scale=(.8,1.65,.65)
        cyl('icicle',(x,y,eave-.5),.12,1.3,'snow',parent,5,0)
    for y in [-d,d]:
      beam('gable_trim',(-w,y,eave),(0,y,peak),.25,'wood',parent);beam('gable_trim',(0,y,peak),(w,y,eave),.25,'wood',parent)

assets=[]
for variant in range(2):
    c=group('chalet_'+('a' if variant==0 else 'b'));assets.append(c)
    box('stone_foot',(0,0,.9),(16,12,1.8),'stone',c)
    box('plaster',(0,0,6),(16,12,10.2),'cream' if variant==0 else 'red',c)
    for x in [-7.8,0,7.8]:box('timber_post',(x,-6.12,5.8),(.42,.35,10.5),'wood',c)
    for z in [1.9,5.5,10.4]:box('timber_lintel',(0,-6.15,z),(16.3,.4,.45),'wood',c)
    for z in [3.6,8]:
      for x in [-4.5,4.5]:window(c,x,-6.26,z)
      for y in [-3,3]:window(c,8.05,y,z,side=True)
    box('door',(0,-6.22,2.8),(1.7,.35,3.7),'wood',c)
    box('door_glass',(0,-6.44,3.1),(1,.1,1.3),'window',c)
    box('balcony',(0,-7.3,5.65),(17.5,3,.5),'wood',c)
    box('balcony_snow',(0,-7.3,5.95),(17.7,3,.15),'snow',c)
    for x in range(-8,9):box('baluster',(x,-8.65,6.8),(.18,.18,1.6),'wood',c)
    box('handrail',(0,-8.65,7.6),(17,.3,.25),'wood',c)
    box('rail_snow',(0,-8.65,7.85),(17.2,.4,.25),'snow',c)
    roof(c,9,7,11,17)
    window(c,0,-7.03,13,2.4,2.2)
    box('chimney',(4,3,16),(2.2,2.2,6),'stone',c);box('chimney_cap',(4,3,19.2),(2.6,2.6,.55),'snow',c)
    for j in range(17):ball('fairy_light',(-8+j,-8.9,7.2-.25*math.sin(j*.5)),.09,'bulb',c)
    for x in [-6,6]:
      beam('roof_brace',(x,-6.5,8.5),(x,-8.4,10.8),.23,'wood',c)

clock=group('clock_tower');assets.append(clock)
box('clock_base',(0,0,1),(12,12,2),'stone',clock)
box('clock_shaft',(0,0,17),(9,9,32),'stone',clock)
for z in [8,18,30]:box('clock_course',(0,0,z),(10,10,.7),'wood',clock)
box('clock_balcony',(0,-5.5,19),(13,4,.7),'wood',clock)
for x in range(-6,7):box('clock_rail',(x,-7.3,20.2),(.25,.25,2),'wood',clock)
box('clock_handrail',(0,-7.3,21.3),(13,.4,.3),'snow',clock)
box('clock_roof_base',(0,0,32),(12,12,1.2),'wood',clock)
cyl('copper_spire',(0,0,37),7,10,'copper',clock,4,2.1)
cyl('spire_snow',(0,0,42),2.3,.45,'snow',clock,4)
for x in [-1.6,1.6]:
  for y in [-1.6,1.6]:box('bell_post',(x,y,44),(.3,.3,3.8),'wood',clock)
cyl('bell',(0,0,44),.9,1.5,'gold',clock,12,.45)
cyl('finial_roof',(0,0,46.2),2.8,1.8,'copper',clock,4,0)
beam('spire_pin',(0,0,47),(0,0,50),.12,'gold',clock)
for z in [5,13]:window(clock,0,-4.58,z,2.5,3)
# The readable clock face and animated hands are authored as Three.js overlays.

pine=group('snow_pine');assets.append(pine)
cyl('trunk',(0,0,3),.5,6,'wood',pine,8)
for i,(z,r,h) in enumerate([(5,4.6,6),(8,3.7,5.8),(10.6,2.8,5.3),(13,1.8,4.5)]):
    cyl('needles',(0,0,z),r,h,'green',pine,12,0)
    cyl('snow_bough',(0,0,z+.7),r*.94,h*.8,'snow',pine,12,0)
    for j in range(12):
      a=j*math.tau/12;drop=ball('snow_fringe',(r*.8*math.cos(a),r*.8*math.sin(a),z-h*.25),r*.19,'snow',pine);drop.scale.z=.45

stall=group('market_stall');assets.append(stall)
box('stall_body',(0,0,1.2),(6,4,2.4),'red',stall)
for x in [-2.8,2.8]:
  for y in [-1.8,1.8]:box('stall_post',(x,y,2.8),(.28,.28,5.6),'wood',stall)
box('counter',(0,-2.2,2.5),(6.6,1,.35),'wood',stall)
roof(stall,3.6,2.6,5.4,7,'green')
for i in range(7):
  ball('stall_bulb',(-2.8+i*.93,-2.75,5.15),.13,'bulb',stall)
  cyl('mug',(-2.4+i*.75,-2.15,2.85),.2,.4,'gold',stall,8)
window(stall,0,1.72,3.7,4.3,2.3)
for x in [-3.8,3.8]:
  box('gift',(x,-1,.7),(1.3,1.1,1.4),'green' if x<0 else 'red',stall)
  box('ribbon',(x,-1.57,.7),(.2,.07,1.5),'gold',stall)
  box('ribbon_top',(x,-1,1.44),(.2,1.2,.08),'gold',stall)

gondola=group('gondola');assets.append(gondola)
box('cabin',(0,0,1.5),(3.6,3,3),'red',gondola)
box('cabin_glass',(0,0,2.4),(3.65,3.05,1.45),'dark',gondola)
for x in [-1.75,0,1.75]:box('glass_mullion',(x,-1.55,2.4),(.12,.1,1.6),'red',gondola)
box('cabin_roof',(0,0,3.4),(4,3.4,.4),'snow',gondola)
beam('hanger',(0,0,3.6),(0,0,7),.15,'dark',gondola)
beam('cable_grip',(-1,0,7),(1,0,7),.16,'dark',gondola)

for root in assets:
  for parent in [root]+[o for o in root.children_recursive if o.type=='EMPTY']:
    buckets={}
    for o in list(parent.children):
      if o.type=='MESH':buckets.setdefault(o.data.materials[0].name,[]).append(o)
    for material,objects in buckets.items():
      bpy.ops.object.select_all(action='DESELECT')
      for o in objects:o.select_set(True)
      bpy.context.view_layer.objects.active=objects[0]
      if len(objects)>1:bpy.ops.object.join()
      bpy.context.object.name=root.name+'_'+material
  bpy.ops.object.select_all(action='DESELECT')
  for o in [root]+list(root.children_recursive):o.select_set(True)
  bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,root.name+'.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'scripts/frostline/frostline-source.blend'))
print('FROSTLINE: exported six original village kits')
