"""Phase F props. Shared atlas UVs, explicit node contracts, measured export counts."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/dreamisland'
EVIDENCE=ROOT/'art/evidence/dreamisland-v1/alive/3d/build'
ATLAS=json.loads((OUT/'atlas-manifest.json').read_text())

def setup():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 EVIDENCE.mkdir(parents=True,exist_ok=True)

def material(role,chrome=False,glass=False):
 name='DI_MAT_'+role+('_chrome' if chrome else '_glass' if glass else '')
 if name in bpy.data.materials:return bpy.data.materials[name]
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Metallic'].default_value=1 if chrome else 0
 p.inputs['Roughness'].default_value=.08 if chrome else .15 if glass else .35
 if glass:p.inputs['Alpha'].default_value=.55;m.surface_render_method='DITHERED'
 t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(OUT/'textures'/f'{role}.jpg'),check_existing=True)
 m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
 if role=='emissive':
  m.node_tree.links.new(t.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=3
 return m

def finish_node(name,parts,role,cell,chrome=False,glass=False,stripes=False):
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:o.select_set(True)
 bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
 # Bake transforms and put every node at the same origin for instanced consumers.
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 o.data.materials.clear();o.data.materials.append(material(role,chrome,glass))
 rect=ATLAS['roles'][role][cell]['uv'];u0,v0,u1,v1=rect
 uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
 colors=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
 palette=[(.03,.5,1,1),(1,1,1,1),(1,.14,.05,1),(1,1,1,1),(1,.7,.02,1),(1,1,1,1)]
 for face in o.data.polygons:
  face.material_index=0;face.use_smooth=chrome or glass or stripes
  center=face.center
  stripe=int((math.atan2(center.y,center.x)+math.pi)/math.tau*6)%6
  for li in face.loop_indices:
   co=o.data.vertices[o.data.loops[li].vertex_index].co
   u=(math.atan2(co.y,co.x)+math.pi)/math.tau
   v=.5+.45*math.sin(co.z*2)
   uv.data[li].uv=(u0+(u1-u0)*(.02+.96*u),v0+(v1-v0)*v)
   colors.data[li].color=palette[stripe] if stripes else (1,1,1,1)
 o['atlasRole']=role;o['atlasCell']=cell;o['recipe']='glass' if glass else 'chrome' if chrome else role
 o['atlasRect']=rect
 return o

def sphere(radius,location=(0,0,0),segments=12,rings=8,scale=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=radius,location=location)
 o=bpy.context.object
 if scale:o.scale=scale
 return o

def cylinder(radius,depth,z=0,x=0,y=0,vertices=12):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=(x,y,z));return bpy.context.object

def box(size,location):
 bpy.ops.mesh.primitive_cube_add(size=1,location=location);o=bpy.context.object;o.scale=size;return o

def torus(major,minor,z=0,segments=16,sides=8):
 bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=segments,minor_segments=sides,location=(0,0,z));return bpy.context.object

def tube(points,radius=.15,sides=8):
 vertices=[];faces=[]
 for i,p in enumerate(points):
  tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
  tangent.normalize();a=tangent.cross(Vector((0,1,0))).normalized();b=tangent.cross(a).normalized()
  for j in range(sides):vertices.append(Vector(p)+radius*(a*math.cos(j*math.tau/sides)+b*math.sin(j*math.tau/sides)))
 for i in range(len(points)-1):
  for j in range(sides):faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
 faces.extend([tuple(reversed(range(sides))),tuple((len(points)-1)*sides+j for j in range(sides))])
 mesh=bpy.data.meshes.new('tube');mesh.from_pydata(vertices,[],faces);mesh.update();o=bpy.data.objects.new('tube',mesh);bpy.context.collection.objects.link(o);return o

def export(filename,nodes,ceilings):
 rows=[]
 for o in nodes:
  o.data.calc_loop_triangles();n=len(o.data.loop_triangles)
  assert n<=ceilings[o.name],(o.name,n,ceilings[o.name])
  points=[o.matrix_world@Vector(c) for c in o.bound_box]
  rows.append(dict(name=o.name,triangles=n,atlasRole=o['atlasRole'],atlasCell=o['atlasCell'],atlasRect=list(o['atlasRect']),bounds=[[min(p[a] for p in points),max(p[a] for p in points)] for a in range(3)]))
 bpy.ops.object.select_all(action='DESELECT')
 for o in nodes:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',use_selection=True,export_yup=True,export_vertex_color='ACTIVE',export_extras=True)
 (EVIDENCE/(filename+'.json')).write_text(json.dumps(rows,indent=2))
 print(json.dumps(rows))

if __name__=='__main__':
 setup();nodes=[]
 nodes.append(finish_node('PR_ball',[sphere(.75)],'jungle','sand',stripes=True))
 nodes.append(finish_node('PR_ring',[torus(.85,.25)],'jungle','sand'))
 nodes.append(finish_node('PR_sphere',[sphere(.7,rings=10)],'metal','rail',chrome=True))
 pipes=[]
 for x,height in [(-.8,2.6),(0,3.85),(.8,1.9)]:pipes.append(cylinder(.15,height,height/2,x=x,vertices=8))
 pipes.append(tube([(-.8,0,.2),(-.8,0,1.4),(-.7,0,1.65),(-.45,0,1.75),(.45,0,1.75),(.7,0,1.65),(.8,0,1.4),(.8,0,.2)]))
 for x in [-.8,0,.8]:pipes.append(cylinder(.28,.12,.06,x=x,vertices=8))
 pipes.append(sphere(.15,(0,0,3.85),segments=8,rings=4))
 nodes.append(finish_node('PR_pipes',pipes,'metal','rail',chrome=True))
 base=[box((.4,.4,.1),(0,0,.05)),cylinder(.14,.5,.35,vertices=8),box((.3,.3,.1),(0,0,.63)),box((.3,.3,.1),(0,0,1.05))]
 nodes.append(finish_node('PR_bollard',base,'concrete','wall-block'))
 nodes.append(finish_node('PR_bollard_core',[box((.18,.18,.32),(0,0,.84))],'emissive','shallows-glow'))
 nodes.append(finish_node('PR_plinth',[box((2,2,.18),(0,0,.09)),box((1.7,1.7,.9),(0,0,.63)),box((2,2,.18),(0,0,1.17))],'concrete','wall-block'))
 export('props.glb',nodes,dict(PR_ball=200,PR_ring=300,PR_sphere=240,PR_pipes=900,PR_bollard=148,PR_bollard_core=12,PR_plinth=60))
