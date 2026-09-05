"""Phase A flat material-ID blockout. No reference maquette is exported."""
import bpy, json, math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
route=json.loads((root/'src/game/data/ascension/route.json').read_text())
out=root/'public/assets/ascension';out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
materials={}
for name,color in {'concrete':(.48,.48,.42,1),'metal':(.25,.32,.22,1),'jungle':(.19,.29,.13,1),'water':(.23,.34,.30,1),'emissive':(.9,.57,.18,1),'markings':(.63,.28,.13,1)}.items():
 m=bpy.data.materials.new('AP_ID_'+name);m.diffuse_color=color;m.use_nodes=True
 shader=m.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=color;shader.inputs['Metallic'].default_value=0;shader.inputs['Roughness'].default_value=1;materials[name]=m
static=[]
def box(name,p,size,role='concrete',join=True):
 bpy.ops.mesh.primitive_cube_add(size=1,location=(p[0],-p[2],p[1]));o=bpy.context.object;o.name=name;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(materials[role]);
 if join:static.append(o)
 return o
def cylinder(name,p,r,h,role='metal',vertices=12):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h,location=(p[0],-p[2],p[1]));o=bpy.context.object;o.name=name;o.data.materials.append(materials[role]);static.append(o);return o
def sample(u):return route['stations'][int(u*route['count'])%route['count']]
def beside(u,offset):
 s=sample(u);p=Vector(s['p']);t=Vector(s['t']);right=t.cross(Vector((0,1,0))).normalized();return p+right*offset
# Estuary below the deck; no solid geometry in the racing corridor.
box('estuary', [0,-18,0],[1900,.3,1900],'water')
lamps=[]
for i in range(0,route['count'],12):
 s=route['stations'][i];u=i/route['count']
 for side in [-1,1]:
  p=beside(u,(s['width']/2+4)*side);box('lamp_mast',p+Vector((0,4,0)),[.2,8,.2],'metal');box('lamp_housing',p+Vector((0,8,0)),[1,.5,.6],'metal');box('lamp_lens',p+Vector((0,7.9,0)),[.8,.15,.45],'emissive');lamps.append({'position':list(p+Vector((0,7.9,0))),'sector':s['sector']})
  if u>.67 and u<.89:
   q=beside(u,side*32);cylinder('mangrove_trunk',q+Vector((0,3,0)),1,13,'jungle',6);cylinder('mangrove_canopy',q+Vector((0,10,0)),8,6,'jungle',7)
# Repeated trench wall modules keep the route corridor clear.
for i in range(25,len(route['shortcut']['stations'])-25,10):
 s=route['shortcut']['stations'][i];p=Vector(s['p']);t=Vector(s['t']);right=t.cross(Vector((0,1,0))).normalized()
 for side in [-1,1]:
  center=p+right*(side*14)+Vector((0,7,0))
  if min(math.hypot(center.x-st['p'][0],center.z-st['p'][2]) for st in route['stations'])<28:continue
  wall=box('trench_wall_module',center,[3,14,24]);wall.rotation_euler.z=math.atan2(-t[0],-t[2])
# Pad deck spans the trench with its support piers outside the racing corridor.
s=route['shortcut']['stations'][int(len(route['shortcut']['stations'])*.4)];pad=Vector(s['p']);pad.y=20
pad_forward=Vector(s['t']).normalized();pad_right=pad_forward.cross(Vector((0,1,0))).normalized()
deck=box('launch_platform',pad,[45,5,42],'metal');deck.rotation_euler.z=math.atan2(-pad_forward.x,-pad_forward.z)
for dx in [-18,18]:
 for dz in [-17,17]:box('platform_pier',pad+pad_right*dx+pad_forward*dz+Vector((0,-15,0)),[5,30,5])
rocket=cylinder('rocket_core_09',pad+Vector((0,26,0)),5,47,'concrete');static.remove(rocket)
for side in [-1,1]:
 boost=cylinder('rocket_olive_booster',pad+Vector((side*7,19,0)),2.7,34,'metal');static.remove(boost);boost.parent=rocket;boost.matrix_parent_inverse=rocket.matrix_world.inverted()
box('service_tower',pad+Vector((21,26,0)),[5,55,7],'metal')
for h in [15,30,45]:box('swing_arm',pad+Vector((12,h,0)),[16,1.5,2],'metal')
for u in [.25,.35]:
 p=beside(u,-38);cylinder('deluge_tower',p+Vector((0,18,0)),12,18);box('deluge_support',p+Vector((0,5,0)),[10,10,10],'metal')
for u in [.91,.94,.97]:cylinder('propellant_tank',beside(u,33)+Vector((0,9,0)),10,18)
# Crawler's complete swept envelope rests on a viaduct above the road.
s=sample(.65);cross=Vector(s['p']);cross.y+=12
bridge=box('crawlerway_bridge',cross,[110,2,38])
crawler=box('crawler_CT2',cross+Vector((0,10,0)),[44,4,32],'metal',False)
for dx in [-18,18]:
 for dz in [-11,11]:
  o=box('crawler_tread',cross+Vector((dx,4,dz)),[12,6,7],'metal',False);o.parent=crawler;o.matrix_parent_inverse=crawler.matrix_world.inverted()
# Merge static material groups to keep the blockout draw budget explicit.
for role,m in materials.items():
 objects=[o for o in static if o.data.materials[0]==m]
 if not objects:continue
 static=[o for o in static if o not in objects]
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name='ascension_blockout_'+role
bpy.ops.wm.save_as_mainfile(filepath=str(root/'art/blender/ascension_blockout.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'blockout.glb'),export_format='GLB',export_yup=True)
(out/'lights.json').write_text(json.dumps(lamps,indent=2))
(out/'blockout.json').write_text(json.dumps({'phase':'A','pad':list(pad),'crawlerOrigin':list(cross),'crawlerRoadHeight':s['p'][1],'crawlerBridgeBottom':cross.y-1,'noMaquettes':True},indent=2))
