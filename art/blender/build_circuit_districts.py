"""Original district landmarks; Y-up helpers and an original generated industrial atlas.
Run Blender --background --python art/blender/build_circuit_districts.py.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/circuit-districts'
bpy.ops.wm.read_factory_settings(use_empty=True)
atlas=bpy.data.images.load(str(OUT/'materials.jpg'))
materials={}
for role in ['paint','steel','cream','glow','lit']:
    mat=bpy.data.materials.new(role);mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value=.68
    if role=='glow':
        node=mat.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name='Color'
        mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
        mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value=1
    else:
        node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=atlas
        # Export the atlas and vertex colors separately; glTF multiplies them.
        mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
        if role=='lit':
            mat.node_tree.links.new(node.outputs['Color'],shader.inputs['Emission Color']);shader.inputs['Emission Strength'].default_value=1
    materials[role]=mat
parts={};nodes=[]
RUST=(1,1,1,1);MINT=(.82,1,.9,1);CREAM=(.85,.76,.58,1);DARK=(.23,.27,.27,1);WARM=(1,.49,.12,1)
def pos(p):return (p[0],-p[2],p[1])
def finish(obj,role,cell,color):
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(materials[role]);uv=obj.data.uv_layers.active
    if role=='steel' and cell==0:cell=4
    if role=='paint' and color==MINT and cell==0:cell=2
    # Each box face addresses one complete atlas panel; primitive cube UVs
    # would only show little fragments of the material and turn walls flat.
    if uv and len(obj.data.vertices)==8 and len(obj.data.polygons)==6:
        bounds=[(min(v.co[a] for v in obj.data.vertices),max(v.co[a] for v in obj.data.vertices)) for a in range(3)]
        for poly in obj.data.polygons:
            axis=max(range(3),key=lambda a:abs(poly.normal[a]));u_axis=1 if axis==0 else 0;v_axis=1 if axis==2 else 2
            for loop in poly.loop_indices:
                v=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                uv.data[loop].uv=((v[u_axis]-bounds[u_axis][0])/max(.001,bounds[u_axis][1]-bounds[u_axis][0]),(v[v_axis]-bounds[v_axis][0])/max(.001,bounds[v_axis][1]-bounds[v_axis][0]))
    if uv:
        for loop in uv.data:
            u,v=loop.uv;loop.uv=((cell%4+.035+u*.93)/4,(1-cell//4+.035+v*.93)/2)
    attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for c in attr.data:c.color=color
    parts.setdefault(role,[]).append(obj);return obj
def box(p,s,role='steel',cell=0,color=DARK):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos(p));o=bpy.context.object;o.scale=(s[0],s[2],s[1]);return finish(o,role,cell,color)
def cyl(p,r,h,role='steel',color=DARK,vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h,location=pos(p));return finish(bpy.context.object,role,1 if role=='cream' else 4,color)
def beam(a,b,r=.15,role='steel',color=DARK):
    va,vb=Vector(pos(a)),Vector(pos(b));d=vb-va
    o=box((0,0,0),(r,d.length,r),role,4,color);o.location=(va+vb)/2;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def rail(x1,x2,y,z):
    for x in [x1+(x2-x1)*i/6 for i in range(7)]:box((x,y+.65,z),(.09,1.3,.09))
    box(((x1+x2)/2,y+1.3,z),(x2-x1,.09,.09))
def window(x,y,z,w=1.2,h=1):
    box((x,y,z),(w+.3,h+.3,.18),'steel',0,DARK)
    box((x,y,z-.11),(w,h,.04),'glow',0,WARM)
    box((x,y,z-.14),(.08,h,.04))
def join(name):
    for role,objects in parts.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();obj=bpy.context.object
        bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        obj.name=f'{name}_{role}';nodes.append(obj)
    parts.clear()

# Sawtooth workshop with real open frontage, recessed wall, mezzanine and annex.
for bay in range(3):
    x=-8+bay*8;h=10+bay*2
    box((x,h/2,7.8),(7.8,h,.35),'paint',0,RUST)
    for sx in [-3.9,3.9]:
        outer=(bay==0 and sx<0) or (bay==2 and sx>0)
        if outer:
            box((x+sx,h-2,.8),(.25,4,14),'paint',0,RUST)
            for z in [-5.5,6]:box((x+sx,(h-4)/2,z),(.25,h-4,3),'paint',0,RUST)
            # A side loading entrance stays visibly open from the race approach.
            for z in [-3.7,4.1]:box((x+sx,3,z),(.4,6,.35))
            box((x+sx,6,-.1),(1,.25,8.5))
            box((x+sx,5.83,-.1),(.75,.12,2.5),'glow',0,WARM)
            wall_x=x+sx-(2 if sx>0 else -2)
            box((wall_x,2.7,0),(.15,5.3,7),'paint',1,(.65,.38,.13,1))
            # Lit inset side wall, warm on the approach-facing side.
            box((wall_x+(.1 if sx>0 else -.1),3.5,0),(.03,4.4,6),'lit',6,(1,1,1,1))
        else:box((x+sx,h/2,.8),(.25,h,14),'paint',0,RUST)
    for dx in [-2.15,2.15]:
        roof=box((x+dx,h+.9,.8),(4.7,.3,15),'steel',0,(.38,.4,.35,1));roof.rotation_euler.y=(-1 if dx<0 else 1)*.29
    box((x,h+1.65,.8),(.35,.18,15.3),'steel',4,(.52,.54,.47,1))
    for rib in range(13):
        for z in [-6.3,7.95]:box((x-3.7+rib*.61,h-1,z),(.08,2,.12),'paint',0,RUST)
    box((x,h-1,-6.25),(8,2,.3),'paint',0,RUST)
    for rib in range(21):
        for side in [-3.95,3.95]:
            z=-5.8+rib*.66
            if -3.9<z<4.3:box((x+side,h-2,z),(.12,4,.10),'paint',0,(.68,.28,.085,1))
            else:box((x+side,h/2,z),(.12,h,.10),'paint',0,(.68,.28,.085,1))
    for z in [-4,0,4]:
        # Side clerestory windows make the building inhabited from oblique driving views.
        for side in [-4.01,4.01]:box((x+side,h-3,z),(.035,1.5,2.1),'glow',0,WARM)
    for pillar in [-3.85,3.85]:box((x+pillar,4.5,-6.1),(.3,9,.4))
    box((x,.3,.8),(8,.6,14),'cream',1,CREAM)
    # Warm inside back wall, broken up by structural bars and shelving.
    box((x,3.1,4.8),(7.4,5,.18),'paint',1,(.55,.38,.18,1))
    box((x,3.3,4.68),(7.4,5.3,.04),'lit',6,(1,1,1,1))
    for xx in [-2.5,0,2.5]:window(x+xx,6.6,4.5,1.6,1.1)
    for row in range(2):
        box((x,1+row*1.6,3),(6.4,.14,1))
        for xx in [-2.4,-.8,.8,2.4]:box((x+xx,1.55+row*1.6,3),(1.1,1,.8),'paint',5,CREAM)
    box((x,7.5,-5.4),(7.2,.15,2.1))
    awning=box((x,7.65,-6),(8.1,.2,3.8),'paint',0,(.29,.4,.34,1));awning.rotation_euler.x=.10
    for rib in range(20):box((x-3.8+rib*.4,h-1,-6.45),(.1,1.9,.13),'paint',0,(.57,.22,.065,1))
    if bay==1:
        for xx in [-2.6,0,2.6]:window(x+xx,h-1,-6.55,1.2,.55)
    box((x,7,-6.9),(1.6,.18,.7));box((x,6.89,-6.9),(1.3,.06,.5),'glow',0,WARM)
for x in [-9,9]:
    cyl((x,16,5),.58,8);cyl((x,20,5),.78,.35)
for x,h in [(-8,14.5),(0,16.5),(8,18.5)]:
    box((x,h,2),(4.6,1.6,5),'steel',4,(.7,.76,.69,1))
    for z in [-.1,.8,1.7,2.6,3.5,4.4]:box((x,h+.83,z),(4.2,.09,.12),'steel',4,DARK)
    duct=cyl((x,h-2,4),.8,4,'steel',(.65,.7,.62,1));duct.rotation_euler.x=math.pi/2
    for y in [h-2.5,h-.6]:cyl((x,y,5.8),.83,.12,'steel',(.8,.83,.75,1))
for step in range(4):box((0,.15+step*.15,-7-step*.4),(6,.3+step*.3,.5),'cream',1,CREAM)
# A broad rear processing hall overlaps the smaller loading frontage. This
# asymmetrical deep roof mass distinguishes a factory from a row of shops.
for x in [-12,12]:box((x,9,14),(.35,18,12),'paint',0,RUST)
box((0,9,20),(24,18,.35),'paint',0,RUST)
for x in [-6.1,6.1]:
    roof=box((x,19.5,14),(13,.4,13),'steel',4,(.52,.59,.54,1));roof.rotation_euler.y=(-1 if x<0 else 1)*.22
box((0,20.9,14),(.4,.2,13),'steel',4,(.7,.76,.7,1))
for x in [-12.25,12.25]:
    for z in [9,12,15,18]:
        box((x,12.5,z),(.12,9,.14),'steel',4,DARK)
        box((x,14.3,z),(.07,2,1.8),'glow',0,(.7,.38,.11,1))
for x in [-8,0,8]:
    cyl((x,20.4,15),1.4,2,'steel',(.6,.68,.62,1));cyl((x,21.5,15),1.65,.25,'steel',(.8,.83,.76,1))
join('works')

# Twin silos on braced legs, elevator, catwalk and conveyors within footprint.
for x in [-5.5,5.5]:
    cyl((x,14,0),4.4,14,'cream',(1,.96,.84,1),16)
    bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=1.2,radius2=4.4,depth=4,location=pos((x,5,0)));finish(bpy.context.object,'cream',1,CREAM)
    cyl((x,2.4,0),.6,1.3,'steel',DARK)
    for y in [7,10.5,14,17.5,21]:cyl((x,y,0),4.5,.18,'paint',(.52,.42,.28,1),16)
    for rib in range(16):
        a=rib*math.tau/16
        box((x+math.sin(a)*4.38,14,math.cos(a)*4.38),(.045,13.8,.045),'steel',4,(.52,.46,.35,1))
    bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=4.4,radius2=1.8,depth=2,location=pos((x,22,0)));finish(bpy.context.object,'cream',1,CREAM)
    for dx in [-2.8,2.8]:
        for z in [-2.8,2.8]:
            box((x+dx,3.5,z),(.75,7,.75));box((x+dx,.2,z),(1.6,.4,1.6),'cream',1,CREAM)
        beam((x+dx,0,-2.8),(x-dx,7,-2.8),.42)
    box((x,23.2,0),(8.5,.25,1.8));rail(x-4.2,x+4.2,23.3,-1)
    for y in [i*.6 for i in range(39)]:box((x+4.5,y,-.2),(.65,.07,.07))
    for dx in [4.16,4.84]:box((x+dx,11.5,-.2),(.09,23,.09))
tower_parts={role:len(objects) for role,objects in parts.items()}
box((0,15,6),(5.4,30,3),'paint',0,RUST)
for x in [-3.1,3.1]:
    box((x,15,4.3),(.3,30,.3));box((x,15,7.7),(.3,30,.3))
for y in [2,7,12,17,22,27]:
    beam((-3.1,y,4.2),(3.1,y+3.5,4.2),.18)
    beam((3.1,y,7.8),(-3.1,y+3.5,7.8),.18)
for y in [5,12,20,28]:
    box((0,y,6),(5.5,.25,5.5));rail(-2.7,2.7,y,3.2)
    window(0,y+1.6,4.3,1.3,.6)
for role,objects in parts.items():
    for obj in objects[tower_parts.get(role,0):]:obj.location.x+=10.5
for x in [-9.5,9.5]:
    beam((10.5,27,6),(x,23,0),.7);beam((10.5,28,6),(x,24,0),.1)
    cyl((x,24.7,0),.2,.45,'glow',WARM)
# The silos form one connected loading compound, with a low mint shed behind
# the bins and a warm sorting gallery in front; no isolated towers.
box((0,4.2,7.9),(22,8,4),'paint',0,MINT)
for x in [-8,-4,0,4,8]:
    window(x,5.4,5.8,2.7,1.6)
    for dx in [-1.5,1.5]:box((x+dx,4,5.65),(.12,8,.14),'paint',0,(.27,.46,.37,1))
for dx in [-5.7,5.7]:
    roof=box((dx,9,7.9),(12,.3,5),'steel',4,(.4,.49,.43,1));roof.rotation_euler.y=(-1 if dx<0 else 1)*.12
# Visible upper truss connects the elevator to the loading shed.
for y in [23,24.2]:beam((0,y+3,6),(10,y,7.5),.15)
for segment in range(5):
    beam((segment*2,26-segment*.6,6+segment*.3),((segment+1)*2,27.2-(segment+1)*.6,6+(segment+1)*.3),.12)
box((0,1.5,-6.7),(15,.3,5),'paint',5,CREAM)
for x in [-7,0,7]:
    box((x,3.8,-8.6),(.15,7.6,.15));box((x,7.3,-6.6),(5.8,.25,5.2),'paint',0,MINT)
    box((x,7.12,-8.2),(2,.12,.7),'glow',0,WARM)
    for j in range(3):box((x-1.7+j*1.6,2.15,-6.7),(1.2,1.3,1.3),'paint',5,CREAM)
# The elevator delivers down to a loading conveyor; steps link each platform.
beam((0,25,6),(0,5,-8),.8)
for step in range(19):
    box((2.7,step*.45,2-step*.45),(1.2,.12,.65))
for x in [-5.5,5.5]:
    box((x,6.8,-4.6),(1.2,.16,.6));box((x,6.7,-4.6),(1,.05,.45),'glow',0,WARM)
for x,z,r in [(-7.5,-7,4.8),(7,-6.7,5.5)]:
    bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=r,radius2=.15,depth=r*.9,location=pos((x,r*.45,z)))
    finish(bpy.context.object,'cream',1,(1,.96,.83,1))
# A substantial open-truss conveyor completes the elevator silhouette.
for y in [24,26]:beam((10.5,y+3,6),(-14.5,y,9),.22)
for segment in range(7):
    x=10.5-segment*3.57;z=6+segment*.43;y=27-segment*.43
    beam((x,y,z),(x-3.57,y+1.57,z+.43),.17)
beam((10.5,27.5,6),(-14.5,24.5,9),.65)
for x in [-7,-14]:
    height=27-(10.5-x)/25*3
    for z in [8,10]:box((x,height/2,z),(.6,height,.6))
    box((x,height,9),(.8,.3,2.8))
    beam((x,0,8),(x,height,10),.22)
beam((-7,3,9),(-14,24,9),.3);beam((-14,3,9),(-7,24,9),.3)
join('silos')

# Raised wetland research hall: warm clerestory, broad roof, decks, reed screens.
for x in [-7,-3.5,0,3.5,7]:
    for z in [-5,5]:cyl((x,0,z),.24,5)
box((0,2.1,0),(16,.45,12),'paint',5,(.6,.53,.36,1))
box((0,5.5,2),(14,6,6),'paint',0,MINT)
for x in [-5.5,-2.75,0,2.75,5.5]:
    window(x,5.7,-1.1,2,2.4)
    box((x,5.2,-4.5),(.14,6,.14))
for x in [-4,4]:
    roof=box((x,9,-.2),(8.7,.35,11.5),'paint',0,MINT);roof.rotation_euler.y=(-1 if x<0 else 1)*.18
box((0,9.7,1),(12,1.8,4),'paint',0,MINT)
for x in [-4.5,-1.5,1.5,4.5]:window(x,9.7,-1.08,1.8,.75)
rail(-7.8,7.8,2.35,-5.8)
for x in [-6,6]:
    for reed in range(5):box((x-.8+reed*.4,3.7,-5.2),(.1,2.5,.1),'paint',5,CREAM)
for i in range(6):box((0,.2+i*.33,-7+i*.35),(3,.3,.65),'paint',5,CREAM)
cyl((5,11.2,3),1.1,2.2,'cream',CREAM)
join('hall')

# Wetland pump/watch tower, strong distant vertical landmark.
for x in [-2.7,2.7]:
    for z in [-2.7,2.7]:box((x,8,z),(.4,16,.4),'paint',5,CREAM)
    beam((x,0,-2.7),(-x,13,-2.7),.22)
for y in [6,13]:box((0,y,0),(7,.25,7),'paint',5,CREAM);rail(-3.5,3.5,y,-3.5)
box((0,16,0),(6,5,6),'paint',0,MINT)
for x in [-1.8,0,1.8]:window(x,16.7,-3.1,1.1,1.6)
box((0,19,0),(7.5,.4,7.5),'paint',0,MINT)
cyl((0,21,0),.1,4);cyl((0,23,0),.24,.4,'glow',WARM)
join('tower')

# A yard tug / channel skiff silhouette; moves only within the district.
box((0,.6,0),(2.8,.6,6),'paint',0,MINT)
box((0,1.8,.8),(2.3,2.1,2.3),'paint',0,CREAM)
window(0,2,-.4,1.8,1)
box((0,3,.8),(2.6,.2,2.7))
for x in [-1.4,1.4]:
    for z in [-1.7,1.7]:
        o=cyl((x,.5,z),.5,.3);o.rotation_euler.y=math.pi/2
join('tug')
manifest=[]
for obj in nodes:
    obj.data.calc_loop_triangles();bounds=[obj.matrix_world@Vector(c) for c in obj.bound_box]
    manifest.append({'name':obj.name,'triangles':len(obj.data.loop_triangles),'boundsBlender':[[min(v[i] for v in bounds),max(v[i] for v in bounds)] for i in range(3)]})
bpy.ops.object.select_all(action='DESELECT')
for obj in nodes:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'districts.glb'),export_format='GLB',use_selection=True,export_yup=True,export_vertex_color='ACTIVE')
atlas.pack();bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/circuit_districts.blend'))
(ROOT/'art/evidence/circuit-districts/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('DISTRICT_EXPORT',json.dumps({'triangles':sum(n['triangles'] for n in manifest),'nodes':len(nodes),'bytes':(OUT/'districts.glb').stat().st_size}))
