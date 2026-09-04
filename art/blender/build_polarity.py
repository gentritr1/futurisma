"""Polarity power interchange. Authored meshes around two independent racing decks."""
import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/polarity"
route = json.loads((ROOT / "src/game/data/polarity/route.json").read_text())
random.seed(404)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
materials, buckets, lights = {}, {}, []
origin, yaw, district = (0, 0, 0), 0, "LAUNCH"
census = {"powerHalls":0,"capacitorBanks":0,"inverterRings":0,"pylons":0,"towers":0}


def material(name, color, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = .78
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = emission
    materials[name] = m
    return name

CONCRETE = material("PL_ceramic_concrete",(.18,.23,.27))
METAL = material("PL_blue_steel",(.045,.085,.125))
TRIM = material("PL_aluminium",(.27,.34,.38))
GLASS = material("PL_smoked_glass",(.014,.025,.047))
AMBER = material("PL_lower_amber",(1,.31,.055),2.1)
CYAN = material("PL_upper_cyan",(.075,.65,.94),2.3)
VIOLET = material("PL_reactor_violet",(.52,.22,.85),1.9)
WHITE = material("PL_service_white",(.60,.74,.78),.95)


def world(p):
    x,y,z = p
    return (origin[0]+math.cos(yaw)*x-math.sin(yaw)*y,
            origin[1]+math.sin(yaw)*x+math.cos(yaw)*y,origin[2]+z)


def geometry(vertices, faces, mat):
    verts, polys = buckets.setdefault((district,mat),([],[]))
    offset=len(verts)
    verts.extend(world(p) for p in vertices)
    polys.extend(tuple(offset+i for i in f) for f in faces)


def box(center,size,mat):
    x,y,z=center; w,d,h=[v/2 for v in size]
    if min(size)<.15 and mat in [GLASS,AMBER,CYAN,VIOLET,WHITE]:
        axis=min(range(3),key=lambda a:size[a]); axes=[a for a in range(3) if a!=axis]
        verts=[]
        for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]:
            p=list(center);p[axes[0]]+=a*size[axes[0]]/2;p[axes[1]]+=b*size[axes[1]]/2;verts.append(p)
        geometry(verts,[(0,1,2,3)],mat);return
    vertices=[(x+a*w,y+b*d,z+c*h) for a,b,c in
        [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    geometry(vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)


def tube(points,radius,mat,sides=6,closed=False):
    pts=[Vector(p) for p in points];vertices=[]
    for i,p in enumerate(pts):
        previous=pts[(i-1)%len(pts)] if closed or i else p-(pts[1]-p)
        following=pts[(i+1)%len(pts)] if closed or i<len(pts)-1 else p+(p-pts[i-1])
        direction=(following-previous).normalized()
        first=direction.cross(Vector((0,1,0)))
        if first.length<.001:first=direction.cross(Vector((1,0,0)))
        first.normalize();second=direction.cross(first).normalized()
        for j in range(sides):
            a=j*2*math.pi/sides
            vertices.append(p+radius*(math.cos(a)*first+math.sin(a)*second))
    faces=[]
    for i in range(len(pts) if closed else len(pts)-1):
        for j in range(sides):
            k=(j+1)%sides;n=(i+1)%len(pts)
            faces.append((i*sides+j,i*sides+k,n*sides+k,n*sides+j))
    if not closed:
        faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(pts)-1)*sides+j for j in range(sides))])
    geometry(vertices,faces,mat)


def cylinder(center,radius,height,mat,segments=16):
    x,y,z=center
    tube([(x,y,z-height/2),(x,y,z+height/2)],radius,mat,segments)


def sign(text,p,size,mat):
    bpy.ops.object.text_add(location=world(p)); obj=bpy.context.object
    obj.data.body=text;obj.data.size=size;obj.data.align_x="CENTER";obj.data.resolution_u=2
    obj.rotation_euler=(math.pi/2,0,yaw);obj.data.materials.append(materials[mat])
    obj.name=district+"_SIGN_"+text.replace(" ","_")
    bpy.ops.object.convert(target="MESH")


def station(distance):
    return route["stations"][int(distance/route["length"]*route["count"])%route["count"]]


def anchor(s,side,offset):
    p,t=s["p"],s["t"];rx,rz=-t[2],t[0]
    return (p[0]+rx*offset*side,-p[2]-rz*offset*side,-.8),math.atan2(-rx*side,-rz*side)


def clear(center,radius):
    # Full city footprints stay outside BOTH routes, including their short cuts.
    for key in ["stations","upper"]:
        for s in route.get(key,[]):
            p=s["p"] if isinstance(s,dict) else s
            if (center[0]-p[0])**2+(-center[1]-p[2])**2<(24+radius)**2:return False
    return True


def lamp(local,mat,size=4,ground=.035):
    p=world(local)
    lights.append({"p":[p[0],p[2],-p[1]],"color":mat,"size":size,"ground":ground})


def power_hall(width,depth,height):
    # A sloped industrial shed, repeating buttresses, clerestory and external pipes.
    half=width/2;front=-depth/2;back=depth/2
    geometry([(-half,front,0),(half,front,0),(half,back,0),(-half,back,0),
              (-half,front,height-4),(0,front,height),(half,front,height-4),
              (-half,back,height-4),(0,back,height),(half,back,height-4)],
        [(0,1,6,5,4),(3,7,8,9,2),(0,4,7,3),(1,2,9,6),(4,5,8,7),(5,6,9,8)],CONCRETE)
    for x in range(int(-half)+2,int(half),5):
        box((x,front-.75,(height-5)/2),(1.15,1.8,height-5),METAL)
        box((x+2,front-.08,height-7),(2.2,.08,3),GLASS)
        box((x+2,front-.13,height-7),(1.8,.07,.2),CYAN)
    box((0,front-.09,4),(width*.65,.08,6),METAL)
    for z in range(2,7):box((0,front-.16,z),(width*.6,.07,.08),AMBER)
    box((0,front-.16,height-3),(width*.8,.06,.18),CYAN)
    sign("POLARITY // POWER AUTHORITY",(0,front-.25,9),.62,WHITE)
    for side in [-1,1]:
        tube([(side*(half+1.5),back-3,0),(side*(half+1.5),back-3,height+4),
            (side*(half-2),back-3,height+4)],.7,TRIM)
    lamp((0,front-1,8),AMBER,7)
    census["powerHalls"]+=1


def capacitor_bank():
    box((0,0,1),(21,18,2),CONCRETE)
    for x in [-6,0,6]:
        for y in [-4,4]:
            cylinder((x,y,8),2.25,14,METAL)
            for z in [2,5,8,11,14]:cylinder((x,y,z),2.55,.35,TRIM)
            cylinder((x,y,15.4),1.6,.8,CYAN)
            tube([(x,y,16),(x,y,20),(x,0,20)],.18,CYAN)
    tube([(-8,0,20),(8,0,20)],.25,TRIM)
    census["capacitorBanks"]+=1


def tower(width,depth,height):
    box((0,0,height/2),(width,depth,height),METAL)
    # Tapered top, fins and spaced luminous floor slots make a stepped silhouette.
    box((0,0,height+3),(width*.62,depth*.65,6),CONCRETE)
    box((0,0,height+9),(width*.32,depth*.35,6),METAL)
    for side in [-1,1]:
        box((side*(width/2+.35),0,height/2),(.7,depth+2,height),CONCRETE)
    for z in range(4,int(height),6):
        box((0,-depth/2-.07,z),(width*.78,.10,.38),CYAN if z>22 else AMBER)
        for x in [-width*.3,0,width*.3]:
            box((x,-depth/2-.07,z+2),(width*.2,.09,2),GLASS)
    cylinder((0,0,height+14),.18,4,VIOLET,8)
    census["towers"]+=1

# Large authored architecture lives at least 24m outside both road centrelines.
for index,distance in enumerate(range(30,int(route["length"]),64)):
    s=station(distance);district=s["sector"]
    for side in [-1,1]:
        origin,yaw=anchor(s,side,58+random.random()*12)
        if not clear(origin,24):continue
        if (index+side)%3==0:capacitor_bank()
        elif (index+side)%3==1:power_hall(32,27,random.uniform(20,30))
        else:tower(19,23,random.uniform(38,63))
    if index%2==0:
        origin,yaw=anchor(s,-1 if index%4 else 1,140+random.random()*35)
        if clear(origin,26):tower(30,30,random.uniform(70,115))

# Paired switch pylons and cable trays remain outside all playable road space.
for index,distance in enumerate(range(10,int(route["length"]),84)):
    s=station(distance);district=s["sector"]
    for side in [-1,1]:
        origin,yaw=anchor(s,side,30)
        if not clear(origin,3.3):continue
        box((0,0,1.5),(5,5,3),CONCRETE)
        box((0,0,21),(1.8,2.2,40),METAL)
        for z in [7,15,23,31,39]:
            box((0,0,z),(4,3,.8),TRIM)
            box((0,-1.56,z),(3.4,.10,.3),CYAN if z>=23 else AMBER)
        tube([(-2,0,4),(2,0,13),(-2,0,22),(2,0,31),(-2,0,40)],.18,TRIM)
        box((0,-1.2,21),(.24,.08,35),CYAN)
        lamp((0,-1.8,9),AMBER,4,0.035)
        lamp((0,-1.8,19),CYAN,4,21.94)
        census["pylons"]+=1

# Giant ellipses enclose both decks. Their legs stay beyond the driving corridors;
# the upper crossing is fifty metres high, leaving the swap volume open.
for progress in [.035,.17,.33,.47,.66,.84,.96]:
    s=station(progress*route["length"]);district=s["sector"]
    origin,yaw=anchor(s,1,0);yaw+=math.pi/2
    points=[(36*math.cos(a*math.tau/64),0,14+37*math.sin(a*math.tau/64)) for a in range(64)]
    # Check every low part against both routes. A short cut can move a ring leg.
    if any(not clear(world(p),1.8) for p in points if -1<p[2]<29):continue
    tube(points,1.65,METAL,8,True)
    for depth in [-1.72,1.72]:
        glow=[(35.8*math.cos(a*math.tau/64),depth,14+36.8*math.sin(a*math.tau/64)) for a in range(64)]
        tube(glow,.13,CYAN if depth<0 else VIOLET,4,True)
    for degrees in [15,45,75,105,135,165]:
        a=math.radians(degrees)
        tube([(33.8*math.cos(a),0,14+34.8*math.sin(a)),(39*math.cos(a),0,14+40*math.sin(a))],.45,TRIM)
    census["inverterRings"]+=1

# Highway-scale signs are attached to outboard pylons; no sign blocks a flip.
for progress,label in [(.03,"P O L A R I T Y"),(.26,"MAGNETIC INTERCHANGE"),(.65,"NORTH POWER DISTRICT")]:
    s=station(progress*route["length"]);district=s["sector"]
    origin,yaw=anchor(s,1,45)
    if clear(origin,13):
        box((0,0,15),(2,2,30),METAL)
        box((0,0,31),(25,2,5),METAL)
        box((0,-1.03,33.3),(24,.09,.14),CYAN)
        sign(label,(0,-1.05,30.2),1.05,WHITE)
        lamp((0,-1.2,31),CYAN,8,0.035)

# Ground stays well below the lower road; no extra road or collision meshes.
origin=(0,0,-1.4);yaw=0;district="HOME"
box((0,0,-1),(1900,1900,2),METAL)
for (sector,name),(vertices,faces) in buckets.items():
    mesh=bpy.data.meshes.new(sector+"_"+name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(sector+"_"+name,mesh);bpy.context.collection.objects.link(obj)
    mesh.materials.append(materials[name])
for sector in [d["id"] for d in route["districts"]]:
    members=[o for o in bpy.context.scene.objects if o.type=="MESH" and o.name.startswith(sector+"_")]
    if not members:continue
    bpy.ops.object.select_all(action="DESELECT")
    for obj in members:obj.select_set(True)
    bpy.context.view_layer.objects.active=members[0];bpy.ops.object.join();members[0].name="PL_DISTRICT_"+sector
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/"polarity_station.glb"),export_format="GLB",export_yup=True,
    export_animations=False,export_cameras=False,export_lights=False)
(OUT/"lights.json").write_text(json.dumps(lights))
triangles=0
for obj in bpy.context.scene.objects:
    if obj.type=="MESH":obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
(OUT/"manifest.json").write_text(json.dumps({"name":"Polarity", "generator":"Blender "+bpy.app.version_string,
    **census,"triangles":triangles,"lightAnchors":len(lights),"seed":404,
    "designClearanceMetres":24,"upperDeckHeightMetres":22},indent=2)+"\n")
scene=bpy.context.scene;scene.world.color=(.012,.016,.033)
bpy.ops.object.camera_add(location=(-130,350,190));camera=bpy.context.object
camera.rotation_euler=(Vector((80,0,20))-camera.location).to_track_quat("-Z","Y").to_euler();scene.camera=camera
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"art/blender/polarity_station.blend"))
print("POLARITY",json.dumps(census),triangles,"triangles",len(lights),"light anchors")
