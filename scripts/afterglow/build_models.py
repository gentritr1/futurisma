"""Original Relay 08 scenery. Run with Blender --background --python this_file.
Dimensions are metres; Z-up exports as glTF Y-up. No external models.
"""
import bpy, math, os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'public/assets/afterglow')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
materials = {}
for name, color in {'concrete':(.72,.73,.72,1), 'blue':(.12,.22,.37,1),
    'orange':(.73,.23,.065,1), 'dark':(.045,.07,.1,1), 'window':(.38,.25,.12,1), 'silver':(.48,.55,.59,1),
    'amber':(1,.56,.18,1), 'mint':(.2,.95,.86,1), 'leaf':(.17,.28,.12,1),
    'leaflight':(.32,.4,.17,1), 'bark':(.25,.21,.15,1)}.items():
    m=bpy.data.materials.new(name); m.diffuse_color=color; m.use_nodes=True
    bsdf=m.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Base Color'].default_value=color
    bsdf.inputs['Roughness'].default_value=.7
    if name in ['amber','mint']:
        bsdf.inputs['Emission Color'].default_value=color; bsdf.inputs['Emission Strength'].default_value=1
    materials[name]=m

def group(name, parent=None):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.parent=parent; return o
def finish(o,name,mat,parent):
    o.name=name; o.data.materials.append(materials[mat]); o.parent=parent; return o
def box(name,loc,scale,mat,parent,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('cut corners','BEVEL');m.width=bevel;m.segments=1
        bpy.ops.object.modifier_apply(modifier=m.name)
    return finish(o,name,mat,parent)
def cylinder(name,loc,r,depth,mat,parent,vertices=12,r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r if r2 is None else r2,depth=depth,location=loc)
    return finish(bpy.context.object,name,mat,parent)
def beam(name,a,b,r,mat,parent,vertices=8):
    a,b=Vector(a),Vector(b);o=cylinder(name,(a+b)/2,r,(b-a).length,mat,parent,vertices)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def mesh(name,verts,faces,mat,parent):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);finish(o,name,mat,parent)
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)
    return o

assets=[]
dish=group('relay_dish');assets.append(dish)
cylinder('octagonal_foundation',(0,0,4),17,8,'concrete',dish,8,13)
cylinder('blue_collar',(0,0,8.4),12.6,1.2,'blue',dish,12)
cylinder('turntable',(0,0,10),10,2,'dark',dish,16)
cylinder('rotating_collar',(0,0,11.7),8.7,1.5,'orange',dish,12)
for x in [-7,7]:
    beam('yoke_arm',(x,6,12),(x,6,29),2.4,'orange',dish)
    hub=cylinder('hinge',(x,6,29),3.8,2.5,'orange',dish,12);hub.rotation_euler.y=math.pi/2
    hub=cylinder('hub_cap',(x+(-1.5 if x<0 else 1.5),6,29),2.3,.4,'dark',dish,12);hub.rotation_euler.y=math.pi/2
head=group('dish_head',dish);head.location=(0,-1,30);head.rotation_euler.x=math.radians(56)
R=25;N=32;rings=7
for sector in range(N):
    vertices=[]
    for j in range(rings+1):
        radius=R*j/rings
        for a in [sector/N*math.tau,(sector+1)/N*math.tau]:
            vertices.append((radius*math.cos(a),radius*math.sin(a),radius*radius/72))
    faces=[(2*j,2*j+2,2*j+3,2*j+1) for j in range(rings)]
    mesh('dish_panel',vertices,faces,'blue' if sector in [4,5,6,7] else 'concrete',head)
    a=sector/N*math.tau
    for j in range(rings):
        r1=R*j/rings;r2=R*(j+1)/rings
        beam('radial_rib',(r1*math.cos(a),r1*math.sin(a),r1*r1/72-.35),(r2*math.cos(a),r2*math.sin(a),r2*r2/72-.35),.27,'silver',head,6)
    a2=(sector+1)/N*math.tau
    beam('rim',(R*math.cos(a),R*math.sin(a),R*R/72),(R*math.cos(a2),R*math.sin(a2),R*R/72),.55,'concrete',head)
for a in [0,math.tau/3,math.tau*2/3]:
    beam('feed_tripod',(22*math.cos(a),22*math.sin(a),22*22/72),(0,0,25),.3,'silver',head)
cylinder('feed_receiver',(0,0,24.6),1.3,4,'orange',head)
box('feed_light',(0,0,27),(1,1,.8),'amber',head)
for a in range(8):
    t=a*math.tau/8;box('foundation_vent',(13*math.cos(t),13*math.sin(t),5),(2.6,.3,2),'dark',dish)

station=group('relay_terminal');assets.append(station)
box('terminal_body',(0,0,8),(52,28,16),'concrete',station,.8)
box('roof',(0,0,16.7),(55,31,1.4),'blue',station,.6)
for x in range(-22,23,8):
    box('front_glass',(x,-14.2,7),(6.8,.35,10),'window',station)
    box('window_light',(x,-14.45,10),(6.2,.2,.75),'amber',station)
    box('column',(x-4,-14.7,8),(1,2,16),'concrete',station,.1)
    box('window_mullion',(x,-14.55,6),(.25,.2,8),'silver',station)
for x in [-17,0,17]:
    box('roof_plant',(x,0,19),(8,9,4),'concrete',station,.4)
    for y in [-3,-1,1,3]:box('louvres',(x,y,21.1),(7,.6,.2),'dark',station)
    beam('duct',(x,5,17.5),(x,12,17.5),1,'silver',station)
box('blue_front_band',(0,-14.4,13.9),(50,.5,3.4),'blue',station)
for x in [-24,24]:
    beam('mast',(x,4,17),(x,4,33),.26,'silver',station)
    box('mast_beacon',(x,4,33),(.7,.7,.7),'orange',station)

arch=group('relay_gate');assets.append(arch)
for x in [-18,18]:
    box('pylon',(x,0,7.4),(3.5,5.5,14.8),'concrete',arch,.65)
    box('pylon_blue',(x,-2.9,8.5),(2,.2,8),'blue',arch)
    box('pylon_lamp',(x,-3.05,5),(.55,.12,3),'mint',arch)
box('header',(0,0,14.5),(39.5,5.5,4.6),'concrete',arch,.6)
box('header_inset',(0,-2.85,14.6),(32,.2,3.3),'dark',arch)
box('header_light',(0,-2.98,12.7),(31,.15,.23),'mint',arch)

train=group('relay_train');assets.append(train)
box('carriage',(0,0,1.8),(3.4,15,3.6),'concrete',train,.9)
box('roof_band',(0,0,3.65),(2.6,12.8,.25),'blue',train,.1)
for x in [-1.72,1.72]:
    box('window_band',(x,0,2.5),(.06,12.3,1.3),'dark',train)
    box('lit_band',(x,0,3.03),(.08,11.8,.15),'amber',train)
    for y in [-5,-2.5,0,2.5,5]:box('window_posts',(x,y,2.5),(.12,.17,1.4),'concrete',train)
box('windshield',(0,-7.42,2.2),(2.5,.12,1.5),'dark',train)
for x in [-1,1]:box('headlamp',(x,-7.52,1),(0.6,.1,.3),'amber',train)

palm=group('relay_palm');assets.append(palm)
for i in range(8):
    a=(.17*i,0,i*1.65);b=(.17*(i+1),0,(i+1)*1.65)
    beam('trunk',a,b,.5-i*.027,'bark',palm,7)
for i in range(10):
    angle=i*math.tau/10;vertices=[]
    for j in range(7):
        t=j/6;r=t*7.8;z=13.2+math.sin(t*math.pi)*1.6-t*2.4
        width=math.sin(t*math.pi)*.95
        for side in [-1,1]:vertices.append((1.4+r*math.cos(angle)+side*width*math.sin(angle),r*math.sin(angle)-side*width*math.cos(angle),z))
    mesh('frond',vertices,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(6)],'leaf' if i%2 else 'leaflight',palm)

def descendants(root):
    return [root]+[o for o in root.children_recursive]
# Join static mesh pieces by material within each animated parent: few draws,
# while the dish head remains free to gently seek and the train can move.
for root in assets:
    parents=[root]+[o for o in root.children_recursive if o.type=='EMPTY']
    for parent in parents:
        buckets={}
        for o in list(parent.children):
            if o.type=='MESH':buckets.setdefault(o.data.materials[0].name,[]).append(o)
        for mat,objects in buckets.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in objects:o.select_set(True)
            bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
            bpy.context.object.name=parent.name+'_'+mat
    bpy.ops.object.select_all(action='DESELECT')
    for o in descendants(root):o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,root.name+'.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'scripts/afterglow/afterglow-source.blend'))
print('AFTERGLOW: exported',len(assets),'original model kits')
