"""Ascension Phase B. Authored meshes use six shared painted atlas roles.
Reference maquettes are measured beside authored silhouettes, then removed before export.
"""
import bpy,sys,json,math,hashlib,random
from pathlib import Path
from mathutils import Vector,Matrix
sys.path.insert(0,str(Path(__file__).parent))
from ascension_mesh import Asset,coord,empty
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'public/assets/ascension';EVIDENCE=ROOT/'art/evidence/ascension-v1/phase-b-revision/build'
EVIDENCE.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
materials={}
for role in ['concrete','metal','jungle','water','signage','emissive']:
 m=bpy.data.materials.new('AP_MAT_'+role);m.use_nodes=True;shader=m.node_tree.nodes.get('Principled BSDF');shader.inputs['Roughness'].default_value=1;shader.inputs['Metallic'].default_value=0
 tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/'textures'/(role+'.jpg')));tex.image.pack();m.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
 color=m.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name='Color';multiply=m.node_tree.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1;m.node_tree.links.new(tex.outputs['Color'],multiply.inputs[1]);m.node_tree.links.new(color.outputs['Color'],multiply.inputs[2]);m.node_tree.links.new(multiply.outputs[0],shader.inputs['Base Color'])
 if role=='emissive':m.node_tree.links.new(tex.outputs['Color'],shader.inputs['Emission Color']);shader.inputs['Emission Strength'].default_value=.7
 materials[role]=m
library={};details={}
def save(a,features):library[a.root.name]=a.finish();details[a.root.name]=features

def arm(name='service-tower-swing-arm'):
 a=Asset(name,materials)
 for z in [-1.5,1.5]:
  for y in [0,3]:a.beam((0,y,z),(18,y,z),.25)
  for i in range(3):
   x=i*6;a.beam((x,0,z),(x+3,3,z),.2);a.beam((x+3,3,z),(x+6,0,z),.2)
 for x in [0,6,12,18]:a.beam((x,0,-1.5),(x,0,1.5),.2)
 a.cylinder((0,1.5,0),.8,4);a.plate((9,1.5,1.62),2,2.8);a.lamp((17.5,3.6,0))
 for i in range(8):
  t=i*math.pi/8;t2=(i+1)*math.pi/8;a.beam((18+math.sin(t),-.2-1.8*math.sin(t),math.cos(t)),(18+math.sin(t2),-.2-1.8*math.sin(t2),math.cos(t2)),.22,'metal')
 save(a,['three truss bays per side','hinge cylinder','umbilical loop','central repair plate','caged glass lamp']);return a.root

arm()
a=Asset('rocket-platform',materials)
# Piers outside the twenty-metre trench and a genuine deck exhaust opening.
for x in [-18,18]:
 for z in [-17,17]:a.box((x,15,z),(5,30,5),'concrete',0)
for x in [-14.5,14.5]:a.box((x,32,0),(16,4,42),'concrete',0)
for z in [-14.5,14.5]:a.box((0,32,z),(13,4,13),'concrete',0)
for z in [-21,21]:a.box((0,34.05,z),(45,.4,.4),'signage',3)
for x in [-22.5,22.5]:a.box((x,34.05,0),(.4,.4,42),'signage',3)
a.plate((14,31,21.05),4,3);a.box((14,33,21.08),(.78,.78,.03),'signage',4)
# Tower uses open lattice, not a solid block.
for x in [-20,-15]:
 for z in [-3,3]:a.beam((x,34,z),(x,84,z),.65)
for y in range(34,84,8):
 for z in [-3,3]:a.beam((-20,y,z),(-15,min(y+8,84),z),.3);a.beam((-15,y,z),(-20,min(y+8,84),z),.3)
 for x in [-20,-15]:a.beam((x,y,-3),(x,min(y+8,84),3),.3)
a.box((-17.5,84,0),(7,.6,8));a.lamp((-17.5,85.1,0),1.5)
for x in [-20,20]:a.lamp((x,35.2,18),1.5)
save(a,['four piers and open exhaust hole','hazard deck rim','open service tower','repair plate','caged lamps and beacon'])
r=Asset('rocket-ascent',materials);r.tint=(1.35,.65,.42,1);r.cylinder((0,54,0),4.3,36,'concrete',16);r.tint=(1.6,1.6,1.45,1);r.cylinder((0,75,0),4.3,6,'concrete',16,tile=1);r.cylinder((0,80,0),4.3,4,'concrete',12,top_radius=1.6,tile=1)
for x in [-6.6,6.6]:
 r.tint=(1,1,1,1);r.cylinder((x,47,0),2.1,22,'metal',12);r.tint=(1.5,1.5,1.4,1);r.cylinder((x,59,0),2.1,2,'concrete',10,top_radius=.6);r.cylinder((x,35,0),2,2,'metal',10,top_radius=1.2)
for angle in range(0,360,90):
 t=math.radians(angle);u=Vector((math.cos(t),0,math.sin(t)));v=Vector((-math.sin(t),0,math.cos(t)))*.12
 pts=[u*4+Vector((0,36,0))-v,u*8+Vector((0,36,0))-v,u*4+Vector((0,43,0))-v,u*4+Vector((0,36,0))+v,u*8+Vector((0,36,0))+v,u*4+Vector((0,43,0))+v];r.geometry(pts,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],'concrete')
r.tint=(1,1,1,1);save(r,['blunt faceted nose','two olive boosters','four fins','rust core and ceramic upper band','three separate nozzles'])
r.root.parent=library['rocket-platform']
for i,y in enumerate([46,62,77]):
 source=library['service-tower-swing-arm'];copy=source.copy();copy.name='swing-arm-pivot-'+str(i);bpy.context.collection.objects.link(copy);copy.parent=library['rocket-platform'];copy.location=coord((-17.5,y,0))
 for child in source.children:o=child.copy();o.data=child.data;bpy.context.collection.objects.link(o);o.parent=copy
# Crawler silhouette: four tread assemblies, four legs, two glazed corner cabs.
a=Asset('crawler-transporter',materials);a.box((0,9,0),(44,3,32),'metal',0)
for z in [-16,16]:
 for x in [-16,-8,0,8,16]:
  a.beam((x-3.6,6.4,z),(x+3.6,7.8,z),.24);a.beam((x+3.6,6.4,z),(x-3.6,7.8,z),.24)
for x in [-18,18]:
 for z in [-11,11]:
  a.cylinder((x,5,z),1.25,6,'metal',8);a.box((x,7.8,z),(5,1.2,5));profile=[(0,-4.6),(.5,-5.5),(2.7,-5.5),(3.2,-4.6),(3.2,4.6),(2.7,5.5),(.5,5.5),(0,4.6)]
  points=[(x+side*3.5,y,z+dz) for side in [-1,1] for y,dz in profile]
  a.geometry(points,[tuple(reversed(range(8))),tuple(range(8,16))]+[(j,(j+1)%8,(j+1)%8+8,j+8) for j in range(8)],'metal',2)
  for end in [-1,1]:
   for y in [.65,1.15,1.65,2.15,2.65]:a.box((x,y,z+end*5.57),(7.15,.18,.22),'metal',2)
for x,z in [(-19,13),(19,13)]:
 a.box((x,11,z),(4,3,4),'metal',0);a.box((x,11.5,z+2.02),(3,.9,.05),'emissive',2)
 for dx in [-1.5,-.5,.5,1.5]:a.beam((x+dx,11.05,z+2.08),(x+dx,11.95,z+2.08),.06)
 for y in [11.05,11.5,11.95]:a.beam((x-1.5,y,z+2.08),(x+1.5,y,z+2.08),.06)
 a.box((x,9.9,z+2.6),(4.5,.18,1.2),'metal',3)
 for dx in [-2.2,2.2]:a.beam((x+dx,10,z+3.1),(x+dx,11.2,z+3.1),.08)
 a.beam((x-2.2,11.2,z+3.1),(x+2.2,11.2,z+3.1),.08)
 a.lamp((x,13,z),.8)
for z in [-16,16]:
 for x in range(-22,22):a.box((x+.5,10.6,z),(1,.35,.4),'signage',3)
for x in [-19,19]:a.lamp((x,11,-13),.8)
a.plate((0,9,16.05),3,1.4);a.box((0,9,16.12),(1.8,1.1,.03),'signage',5);a.lamp((19,14,13),.8);a.cylinder((20,13.3,13),.3,.8,'metal',8,axis=(1,0,0),top_radius=.6)
save(a,['four tread assemblies','four support legs','two corner cabs','hazard deck band and repair plate','beacon and horn'])
for i,(x,z) in enumerate([(-18,-11),(-18,11),(18,-11),(18,11)]):
 a=Asset('crawler-tread-'+str(i),materials)
 for side in [-1,1]:
  for dz in [-3,0,3]:a.cylinder((x+side*3.53,1.6,z+dz),1.2,.18,'metal',10,axis=(1,0,0),tile=3)
 for dz in range(-5,6):a.box((x,.13,z+dz),(7.15,.25,.6),'metal',2);a.box((x,3.1,z+dz),(7.15,.25,.6),'metal',2)
 root=a.finish();root.parent=library['crawler-transporter']
# Sheet-sized countdown board; game placement adds a taller clear-span frame.
a=Asset('countdown-board',materials);a.box((0,.4,0),(8,.8,4),'concrete');a.beam((-2,.8,0),(0,6,0),.6);a.beam((2,.8,0),(0,6,0),.6);a.beam((-1,3,0),(1,5,0),.4);a.box((0,8,0),(10,5,1.6),'metal',0)
for x in [-4.7,4.7]:a.box((x,8,.86),(.3,4.4,.1),'signage',3)
for y in [5.9,10.1]:a.box((0,y,.86),(9.5,.3,.1),'signage',3)
a.box((0,8,.84),(8.8,3.5,.12),'metal',3);a.lamp((0,10.9,0));a.cylinder((-5.5,9,0),.35,1,'metal',8,axis=(-1,0,0),top_radius=.75);a.plate((4.2,6.8,.87),.8,1);save(a,['A-frame mast','deep countdown housing','hazard border','beacon and horn','repair plate and cage lamp'])
# Repeating trench wall: two pipes, exactly four valves, a full ladder and drain.
a=Asset('trench-wall-module',materials);a.box((0,7,0),(24,14,3),'concrete',0)
for x in [-11.5,11.5]:a.box((x,7,1.6),(.6,14,.3),'concrete',2)
for y in [8.2,11]:
 a.cylinder((0,y,2.2),.48,23,'metal',10,axis=(1,0,0))
 for x in [-10,-5,0,5,10]:a.cylinder((x,y,2.2),.57,.22,'metal',10,axis=(1,0,0))
for x in [-10,-4,4,10]:
 a.tint=(1.4,.45,.3,1);a.ring((x,8.2,2.9),.55,.09);a.beam((x-.5,8.2,2.9),(x+.5,8.2,2.9),.07);a.beam((x,7.7,2.9),(x,8.7,2.9),.07)
a.tint=(1,1,1,1);a.ladder(8,1,2,12)
for x in range(-12,12):a.box((x+.5,2,1.55),(1,.55,.1),'signage',3)
a.plate((4.5,4.3,1.58),2.5,2.5)
a.box((0,.7,1.6),(4,1.2,.15),'metal',3);a.box((-3,4.5,1.58),(2.4,2.4,.03),'signage',2)
for x in [-8,10]:a.lamp((x,5.2,2.2),1.25)
save(a,['two continuous pipes','four red valve wheels','full-height ladder','caged glass lamps','hazard band repair plate and drain grate'])

# Secondary assets from their sheet / hero / material-ID triplets.
a=Asset('deluge-water-tower',materials)
for x in [-8,8]:
 for z in [-8,8]:a.box((x,8,z),(2,16,2));a.box((x,.3,z),(3,.6,3),'concrete')
a.cylinder((0,23,0),12,14,'concrete',20);a.ring((0,30.7,0),11.7,.12,axis=(0,1,0),segments=24)
for i in range(16):t=i*math.tau/16;a.beam((11.7*math.cos(t),30,11.7*math.sin(t)),(11.7*math.cos(t),30.7,11.7*math.sin(t)),.1)
a.tint=(1.4,.55,.35,1);a.cylinder((8,8,9.2),.7,16,'metal',10);a.ring((8,2,10),1,.12);a.tint=(1,1,1,1);a.ladder(-8,0,9.1,16);a.lamp((8,4,10));a.plate((-3,23,11.8),3,3);save(a,['single squat reservoir','four olive legs','outlet with red valve','ladder','repair plate and caged lamp'])
a=Asset('propellant-tank',materials);a.tint=(1.45,1.45,1.32,1);a.cylinder((0,10,0),10,20,'concrete',20);a.cylinder((0,21,0),10,2,'concrete',20,top_radius=1)
a.tint=(1.4,.55,.35,1)
for y in [6,15]:a.cylinder((0,y,0),10.15,.65,'metal',20)
a.tint=(1,1,1,1);a.ladder(0,0,10.2,21);a.cylinder((0,22.6,0),.4,1.2);a.cylinder((.5,23.2,0),.4,1,axis=(1,0,0));a.plate((-4,4,9.4),2,2);a.lamp((2,1.2,10.2));save(a,['two rust bands','shallow roof','bent roof vent','ladder','repair plate and caged lamp'])
a=Asset('vent-stack',materials);a.box((0,1,0),(6,2,6),'concrete');a.tint=(1.5,.6,.35,1);a.cylinder((0,13,0),2.1,22,'metal',12);a.cylinder((1.2,24.5,0),2.1,3,'metal',12,axis=(.7,.7,0));a.cylinder((3.1,25.5,0),2.1,3,'metal',12,axis=(1,0,0));a.tint=(1,1,1,1)
for y in [7,16]:a.cylinder((0,y,0),2.3,.5,'metal',12)
a.box((0,16,0),(7,.3,7),'metal',3)
for z in [-3.4,3.4]:a.beam((-3.4,17,z),(3.4,17,z),.1)
for x in [-3.4,3.4]:a.beam((x,17,-3.4),(x,17,3.4),.1)
a.ladder(0,1,2.3,15);a.lamp((3,16.8,3));save(a,['bent exhaust elbow','two collars','concrete plinth','maintenance platform','ladder and cage lamp'])
a=Asset('crawlerway-gravel-bed',materials);a.box((0,-1,0),(38,2,32),'concrete',2)
for x in [-10,10]:a.box((x,.08,0),(5,.16,32),'metal',2)
for x in [-18.5,18.5]:
 a.box((x,.25,0),(1,.5,32),'concrete',0)
 for z in [-15,15]:a.lamp((x,1.1,z))
a.plate((16,-.5,16.05),2,1);save(a,['two steel tread strips','rough concrete gravel median','two raised curbs','four cage lamps','corner repair plate'])
a=Asset('mangrove-pier',materials);a.box((0,-1,0),(26,2,24),'concrete',0)
for x in [-10,10]:
 for z in [-9,9]:a.box((x,-5,z),(2.5,6,2.5),'concrete',0)
for x in [-12.7,12.7]:
 for z in range(-12,13,4):a.beam((x,0,z),(x,1.1,z),.15)
 for y in [.5,1.1]:a.beam((x,y,-12),(x,y,12),.12)
 a.lamp((x,1.8,-10))
a.ladder(-13.2,-7,-7,7);a.plate((6,-1,12.05),2,1.4);save(a,['four algae-stained piles','low deck','two safety rails','maintenance ladder','two cage lamps and repair plate'])
# A silhouette card preserves feather detail at racing scale on the organic atlas.
a=Asset('egret-card-set',materials);a.geometry([(-.85,-.85,0),(.85,-.85,0),(.85,.85,0),(-.85,.85,0)],[(0,1,2,3)],'jungle',2)
save(a,['folded S-curved neck','yellow tapered beak','two black trailing legs','white feathered wings','slender white body'])
# Match the maquette's shallow platform foundation and tall upper stack.
# Mapping world coordinates also moves the authored arm pivots with their meshes.
def fit_platform_height(z):
 return z*18/34 if z<=34 else 18+(z-34)*(85.8-18)/(85.8-34)
bpy.context.view_layer.update()
objects=[library['rocket-platform']]+list(library['rocket-platform'].children_recursive)
old_matrices={o:o.matrix_world.copy() for o in objects}
for o in objects:
 matrix=old_matrices[o].copy();matrix.translation.z=fit_platform_height(matrix.translation.z);o.matrix_world=matrix
 bpy.context.view_layer.update()
 if o.type=='MESH':
  o.data=o.data.copy();inverse=o.matrix_world.inverted()
  for vertex in o.data.vertices:
   point=old_matrices[o]@vertex.co;point.z=fit_platform_height(point.z);vertex.co=inverse@point
library['crawler-transporter'].scale=(.8,.8,.8)
bpy.context.view_layer.update()
# Temporary maquettes are used only to record silhouette proportions beside the authored asset.
maquettes=[]
for asset,file,height in [('crawler-transporter','crawler-maquette-tripo.glb',12),('rocket-platform','rocket-platform-maquette-tripo.glb',85.8)]:
 before=set(bpy.data.objects);path=ROOT/'art/references/ascension'/file;bpy.ops.import_scene.gltf(filepath=str(path));objects=[o for o in bpy.data.objects if o not in before];mesh=[o for o in objects if o.type=='MESH'];
 for o in objects:
  if not o.parent or o.parent not in objects:o.matrix_world=Matrix.Rotation(-math.pi/2,4,'Z')@o.matrix_world
 bpy.context.view_layer.update();points=[o.matrix_world@Vector(v) for o in mesh for v in o.bound_box];lo=Vector(tuple(min(p[a] for p in points) for a in range(3)));hi=Vector(tuple(max(p[a] for p in points) for a in range(3)));dimensions=hi-lo
 factor=height/dimensions.z
 for o in objects:
  if not o.parent or o.parent not in objects:o.scale*=factor;o.location.x+=100-(lo.x+hi.x)*factor/2;o.location.z-=lo.z*factor
 bpy.context.view_layer.update();maquettes.append({'asset':asset,'source':file,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceDimensions':list(dimensions),'targetHeight':height,'uniformScale':factor,'removedObjectNames':[o.name for o in objects]})
 # A neutral front silhouette view makes proportion differences reviewable.
 for o in bpy.data.objects:o.hide_render=True
 for o in objects+[library[asset]]+list(library[asset].children_recursive):o.hide_render=False
 bpy.ops.object.camera_add(location=(50,-180,height*.5));camera=bpy.context.object;camera.rotation_euler=(Vector((50,0,height*.5))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=max(145,height*2);bpy.context.scene.camera=camera
 scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.color_type='SINGLE';scene.display.shading.single_color=(.6,.6,.6);scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100;scene.render.filepath=str(EVIDENCE/('silhouette-'+asset+'.png'));bpy.ops.render.render(write_still=True)
 bpy.data.objects.remove(camera,do_unlink=True)
 for o in objects:bpy.data.objects.remove(o,do_unlink=True)
 for o in bpy.data.objects:o.hide_render=False
assert not any('tripo' in o.name.lower() or 'maquette' in o.name.lower() for o in bpy.data.objects)
# Ascension keeps the authored pump-device pivots and repairs the carried art defects.
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/power-kit-v2/power_kit.glb'));kit_objects=[o for o in bpy.data.objects if o not in before]
kit_root=next(o for o in kit_objects if o.name=='PowerKitPumpWorks')
for o in kit_objects:
 if o.type!='MESH':continue
 role=o.data.materials[0].name.split('_')[-1].split('.')[0]
 if 'plinth' in o.name or 'flange_bolts' in o.name:role='metal'
 if o.name.endswith('_core'):role='emissive'
 o.data.materials.clear();o.data.materials.append(materials[role])
 if o.name.endswith('_stencil'):
  layer=o.data.uv_layers.active;low=[min(v.uv[a] for v in layer.data) for a in [0,1]];high=[max(v.uv[a] for v in layer.data) for a in [0,1]]
  for vertex in layer.data:
   u=(vertex.uv.x-low[0])/max(.00001,high[0]-low[0]);v=(vertex.uv.y-low[1])/max(.00001,high[1]-low[1]);vertex.uv=(.012+(.5 if 'shield' in o.name else 0)+u*.476,.505+v*.062)
 if o.name.endswith('_core'):
  for layer in o.data.color_attributes:
   for color in layer.data:color.color=(1,1,1,1)
 if 'flange_bolts' in o.name:
  # Each disconnected nut becomes a shallow round rivet at the same centre.
  adjacency={v.index:set() for v in o.data.vertices}
  for edge in o.data.edges:
   x,y=edge.vertices;adjacency[x].add(y);adjacency[y].add(x)
  welded={}
  for vertex in o.data.vertices:
   key=tuple(round(value,5) for value in vertex.co)
   if key in welded:adjacency[vertex.index].add(welded[key]);adjacency[welded[key]].add(vertex.index)
   else:welded[key]=vertex.index
  pending=set(adjacency);centres=[]
  while pending:
   stack=[pending.pop()];component=[]
   while stack:
    i=stack.pop();component.append(i)
    for j in adjacency[i]&pending:pending.remove(j);stack.append(j)
   centres.append(sum((o.data.vertices[i].co for i in component),Vector())/len(component))
  replacement=Asset('rivet_replacement',materials)
  for c in centres:replacement.cylinder((c.x,c.z,-c.y),.0075,.008,'metal',8,axis=(0,0,1),top_radius=.005)
  replacement.finish();part=replacement.root.children[0];o.data=part.data
  bpy.data.objects.remove(part,do_unlink=True);bpy.data.objects.remove(replacement.root,do_unlink=True)
for kind in ['surge','shield']:bpy.data.objects['PK_'+kind]['pumpHardware']=True
library['power-kit']=kit_root;details['power-kit']=['preserved turbine and iris pivots','emissive lamp glass','shallow round rivets','metal plinths','six Ascension painted atlas roles']
# Store all source assets separately so hero acceptance cannot hide missing pieces.
for name,root in library.items():
 if root.parent:continue
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for child in root.children_recursive:child.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_vertex_color='ACTIVE',export_extras=True)
# World layout authored from the accepted route; never edit route geometry here.
route=json.loads((ROOT/'src/game/data/ascension/route.json').read_text());world=empty('ascension_painted_world');placements=[]
def place(asset,p,yaw=0,scale=1,sector='PAD_ROAD',dynamic=False):
 source=library[asset];root=source.copy();root.name=asset+'_'+str(len(placements));bpy.context.collection.objects.link(root);root.parent=world;root.location=coord(p);root.rotation_euler.z=yaw;root.scale=source.scale*scale;root['sector']=sector;root['dynamic']=dynamic
 def copy_children(src,dst):
  for child in src.children:
   o=child.copy();bpy.context.collection.objects.link(o);o.parent=dst;copy_children(child,o)
 copy_children(source,root);placements.append({'asset':asset,'position':list(p),'yaw':yaw,'scale':scale,'sector':sector,'dynamic':dynamic});return root
up=Vector((0,1,0))
def station(u):return route['stations'][int(u*route['count'])%route['count']]
def beside(u,offset):
 s=station(u);t=Vector(s['t']);return Vector(s['p'])+t.cross(up).normalized()*offset
s=route['shortcut']['stations'][int(len(route['shortcut']['stations'])*.4)];p=Vector(s['p']);p.y=-12;t=Vector(s['t']);place('rocket-platform',p,math.atan2(-t.x,-t.z),sector='APRON_SWEEP',dynamic=True)
s=station(.65);p=Vector(s['p']);p.y+=13;place('crawler-transporter',p,sector='CRAWLERWAY',dynamic=True)
for x in [-38,0,38]:place('crawlerway-gravel-bed',p+Vector((x,-.1,0)),math.pi/2,sector='CRAWLERWAY')
for u in [.25,.35]:place('deluge-water-tower',beside(u,-42),sector='DELUGE_ROAD')
for u in [.91,.94,.97]:place('propellant-tank',beside(u,36),sector='TANK_FARM')
place('vent-stack',beside(.93,-34),sector='TANK_FARM')
# Trench keeps its accepted length. Rhythmic modules, brighter repair bays and overhead pad breaks.
for i in range(20,len(route['shortcut']['stations'])-20,10):
 s=route['shortcut']['stations'][i];p=Vector(s['p']);t=Vector(s['t']);right=t.cross(up).normalized()
 for side in [-1,1]:
  q=p+right*14*side
  if min(math.hypot(q.x-st['p'][0],q.z-st['p'][2]) for st in route['stations'])<28:continue
  wall=place('trench-wall-module',q,math.atan2(-t.z,t.x)+(math.pi if side>0 else 0),sector='TRENCH')
  # Scorched pad bays and cleaner service bays make the long descent legible.
  progress=s['progress']
  if .27<progress<.39:
   for mesh in wall.children:
    if mesh.type!='MESH' or not mesh.data.materials[0].name.endswith('concrete'):continue
    mesh.data=mesh.data.copy()
    for loop,color in zip(mesh.data.loops,mesh.data.color_attributes['Color'].data):
     height=mesh.data.vertices[loop.vertex_index].co.z;shade=.34+.35*min(1,height/14)
     color.color=(shade,shade*.94,shade*.87,1)

for i in range(int(route['count']*.67),int(route['count']*.89),9):
 s=route['stations'][i];t=Vector(s['t']);place('mangrove-pier',Vector(s['p'])-Vector((0,.18,0)),math.atan2(-t.x,-t.z),scale=max(1,(s['width']+3)/26),sector=s['sector'])
# Street lamps and mangrove silhouettes are authored geometry, outside the road.
a=Asset('street-lamp',materials);a.beam((0,0,0),(0,7,0),.18);a.beam((0,7,0),(1.5,7,0),.18);a.lamp((1.5,6.5,0),.9);save(a,['metal mast','cantilever','cage','glass','base'])
for i in range(0,route['count'],21):
 s=route['stations'][i];u=i/route['count'];t=Vector(s['t'])
 for side in [-1,1]:
  if min(abs(u-route['shortcut']['from']),abs(u-route['shortcut']['to']))>.035:
   place('street-lamp',beside(u,side*(s['width']/2+3)),math.atan2(-t.x,-t.z),sector=s['sector'])
  # Mangroves use instanced camera-facing Greenwater canopy cards at runtime.
for i in range(12):place('egret-card-set',beside(.72+i*.004,22)+Vector((0,8+i%3,0)),i*.5,sector='MANGROVE_CUT')
# Estuary water and apron shoulders have real world surfaces below the race deck.
a=Asset('estuary-water',materials)
for x in range(-1088,1088,64):
 for z in range(-1088,1088,64):
  # The raised estuary surrounds the low piers; the excavated inland trench stays dry.
  estuary=min(math.hypot(x+32-st['p'][0],z+32-st['p'][2]) for st in route['stations'][int(route['count']*.67):int(route['count']*.9)])<300
  beside_trench=min(math.hypot(x+32-st['p'][0],z+32-st['p'][2]) for st in route['shortcut']['stations'])<65
  y=-4.3 if estuary and not beside_trench else -18.3
  a.geometry([(x,y,z),(x,y,z+64),(x+64,y,z+64),(x+64,y,z)],[(0,1,2,3)],'water',0)
save(a,['painted estuary water']);place('estuary-water',(0,0,0),sector='ESTUARY')
# Continuous apron shoulders follow the accepted bank without overlapping slabs.
a=Asset('apron-slab',materials)
for i in range(int(route['count']*.08),int(route['count']*.16)):
 points=[]
 for j in [i,i+1]:
  st=route['stations'][j];right=Vector(st['t']).cross(up).normalized()
  for side in [-1,1]:points.append(Vector(st['p'])+right*35*side-Vector((0,1.2,0)))
 a.geometry(points,[(0,2,3,1)],'concrete',0)
save(a,['continuous service apron shoulder']);place('apron-slab',(0,0,0),sector='APRON_SWEEP')
# Batch static surfaces by sector and material; moving hierarchies stay separate.
bpy.context.view_layer.update();groups={}
for root in list(world.children):
 if root.get('dynamic'):continue
 for o in root.children_recursive:
  if o.type=='MESH':groups.setdefault((root['sector']+'_'+str(math.floor(root.location.x/180))+'_'+str(math.floor(root.location.y/180)),o.data.materials[0].name),[]).append(o)
for (sector,material),objects in groups.items():
 vertices=[];faces=[];uvs=[];colors=[]
 for obj in objects:
  base=len(vertices);vertices.extend(obj.matrix_world@v.co for v in obj.data.vertices)
  faces.extend(tuple(base+i for i in p.vertices) for p in obj.data.polygons)
  uvs.extend(tuple(v.uv) for v in obj.data.uv_layers.active.data)
  colors.extend(tuple(v.color) for v in obj.data.color_attributes['Color'].data)
 mesh=bpy.data.meshes.new('AP_'+sector+'_'+material);mesh.from_pydata(vertices,[],faces);mesh.materials.append(bpy.data.materials[material]);mesh.update();uv=mesh.uv_layers.new(name='Atlas UV0');color=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
 for i,value in enumerate(uvs):uv.data[i].uv=value;color.data[i].color=colors[i]
 combined=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(combined);combined.parent=world
 for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
for name in [o.name for o in library.values()]:
 source=bpy.data.objects.get(name)
 if source is None:continue
 for child in list(source.children_recursive):bpy.data.objects.remove(child,do_unlink=True)
 bpy.data.objects.remove(source,do_unlink=True)
bpy.ops.object.select_all(action='DESELECT');world.select_set(True)
for o in world.children_recursive:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/ascension_painted.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'painted.glb'),export_format='GLB',use_selection=True,export_yup=True,export_vertex_color='ACTIVE',export_extras=True)
meshes=[o for o in world.children_recursive if o.type=='MESH'];triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
manifest={'script':'art/blender/build_ascension_painted.py','phase':'B working art','roles':list(materials),'meshes':len(meshes),'triangles':triangles,'placements':placements,'features':details,'maquettes':maquettes,'maquettesRemovedBeforeWorldExport':True}
(OUT/'painted.json').write_text(json.dumps(manifest,indent=2));(EVIDENCE/'model-build.json').write_text(json.dumps(manifest,indent=2))
