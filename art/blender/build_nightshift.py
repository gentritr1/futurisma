"""Authored Night Shift city. Rebuild after scripts/build-nightshift-route.mjs."""
import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/nightshift"
route = json.loads((ROOT / "src/game/data/nightshift/route.json").read_text())
random.seed(217)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
materials = {}
buckets = {}
lights = []
buildings = 0
origin = (0, 0, 0)
yaw = 0
district = "MOTEL"


def mat(name, color, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = .86
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    materials[name] = m
    return name


WALL = mat("NS_concrete", (.23, .27, .30))
BRICK = mat("NS_old_brick", (.24, .17, .17))
METAL = mat("NS_painted_metal", (.065, .105, .13))
TRIM = mat("NS_coping", (.32, .34, .33))
DARK = mat("NS_unlit_glass", (.012, .022, .032))
AMBER = mat("NS_sodium", (.9, .39, .11), 2.2)
PINK = mat("NS_rose_neon", (.93, .12, .28), 2.4)
CYAN = mat("NS_blue_neon", (.11, .65, .75), 2.3)
WINDOW = mat("NS_window_light", (.63, .49, .27), .75)
WHITE = mat("NS_fluorescent", (.55, .72, .67), 1.1)

# Weathered concrete: a real embedded texture, with fine grain and runoff.
size = 128
texture = bpy.data.images.new("Nightshift concrete grain", width=size, height=size)
pixels = []
streaks = [random.random() for _ in range(size)]
for y in range(size):
    for x in range(size):
        noise = .74 + random.random() * .18 + streaks[x] * .08
        if y % 32 < 1:
            noise *= .76
        pixels.extend((noise, noise, noise, 1))
texture.pixels = pixels
texture.pack()
for name in [WALL, BRICK]:
    m = materials[name]
    nodes = m.node_tree.nodes
    image = nodes.new("ShaderNodeTexImage")
    image.image = texture
    # Blender's current glTF exporter recognizes the color Mix node's factor.
    multiply = nodes.new("ShaderNodeMix")
    multiply.data_type = "RGBA"
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    color_a = next(socket for socket in multiply.inputs if socket.identifier == "A_Color")
    color_b = next(socket for socket in multiply.inputs if socket.identifier == "B_Color")
    color_b.default_value = m.diffuse_color
    color_output = next(socket for socket in multiply.outputs if socket.type == "RGBA")
    m.node_tree.links.new(image.outputs["Color"], color_a)
    m.node_tree.links.new(color_output, nodes.get("Principled BSDF").inputs["Base Color"])


def world(p):
    x, y, z = p
    return (origin[0] + math.cos(yaw)*x - math.sin(yaw)*y,
            origin[1] + math.sin(yaw)*x + math.cos(yaw)*y, origin[2] + z)


def box(center, size, material):
    key = (district, material)
    verts, faces = buckets.setdefault(key, ([], []))
    offset = len(verts)
    x, y, z = center
    w, d, h = [v/2 for v in size]
    # Window glass and luminous strips need a surface, not six box faces.
    if min(size) < .15 and material in [DARK, WINDOW, WHITE, CYAN, AMBER, PINK]:
        axis = min(range(3), key=lambda a: size[a])
        axes = [a for a in range(3) if a != axis]
        for a, b in [(-1,-1),(1,-1),(1,1),(-1,1)]:
            p = list(center)
            p[axes[0]] += a * size[axes[0]] / 2
            p[axes[1]] += b * size[axes[1]] / 2
            verts.append(world(p))
        faces.append(tuple(offset+i for i in range(4)))
        return
    verts.extend(world((x+dx*w, y+dy*d, z+dz*h)) for dx,dy,dz in
                 [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)])
    faces.extend(tuple(offset+i for i in f) for f in
                 [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])


def sign(text, p, size, material):
    bpy.ops.object.text_add(location=world(p))
    obj = bpy.context.object
    obj.data.body = text
    obj.data.size = size
    obj.data.align_x = "CENTER"
    obj.data.extrude = .013
    obj.data.resolution_u = 2
    obj.rotation_euler = (math.pi/2, 0, yaw)
    obj.data.materials.append(materials[material])
    obj.name = district + "_SIGN_" + text.replace(" ", "_")
    bpy.ops.object.convert(target="MESH")


def station(distance):
    return route["stations"][int(distance / route["length"] * route["count"]) % route["count"]]


def anchor(s, side, offset):
    p, t = s["p"], s["t"]
    rx, rz = -t[2], t[0]
    x, z = p[0]+rx*offset*side, p[2]+rz*offset*side
    # Local front is -Y in Blender; orient it toward the road.
    return (x, -z, p[1]-.2), math.atan2(-rx*side, -rz*side)


def clear_of_route(center, radius):
    x, z = center[0], -center[1]
    return all((x-s["p"][0])**2+(z-s["p"][2])**2 > (s["width"]/2+radius+2)**2
               for s in route["stations"])


def building(width, depth, height, wall, neon, with_sign=False, background=False):
    box((0,0,height/2), (width,depth,height), wall)
    box((0,0,height+.3), (width+.8,depth+.8,.6), TRIM)
    box((0,-depth/2-.25,2.8), (width+.3,1.5,.55), METAL)
    box((0,-depth/2-.99,2.77), (width,.08,.10), neon)
    # Recessed shop windows and steel shutters.
    for x in [-width*.29,width*.29]:
        box((x,-depth/2-.06,1.3), (width*.38,.08,2.15), DARK)
        box((x,-depth/2-.12,2.22), (width*.35,.06,.13), WHITE)
        for z in [.45,.75,1.05,1.35,1.65]:
            box((x,-depth/2-.13,z),(width*.36,.025,.035), METAL)
    for floor in range(1, int(height/3.8)):
        z = floor*3.8+1
        if floor % 3 == 0:
            box((0,0,z-1.6),(width+.25,depth+.25,.22),TRIM)
        for col in range(max(2,int(width/3))):
            x = -width/2+1.6+col*3
            lit = random.random() < .34
            box((x,-depth/2-.055,z),(1.45,.10,1.8),WINDOW if lit else DARK)
            if not background:
                box((x,-depth/2-.14,z-.94),(1.7,.35,.11),TRIM)
            # A scattering of air conditioning cages breaks the facade rhythm.
            if not background and col == 0 and floor % 2:
                box((x+1.25,-depth/2-.32,z-.3),(.65,.65,.5),METAL)
        for side in [-1,1]:
            for yy in [-depth*.28,depth*.05,depth*.33]:
                box((side*(width/2+.04),yy,z),(.08,1.3,1.8), WINDOW if random.random()<.3 else DARK)
    box((width*.18,depth*.13,height+1.2),(3.5,3.5,2.1),METAL)
    box((-width*.22,depth*.15,height+2),(.13,.13,4),TRIM)
    box((-width*.22,depth*.15,height+3.4),(2,.08,.08),TRIM)
    if with_sign:
        word = {"MOTEL":"MOTEL", "ARCADE":"ARCADE", "TENEMENTS":"LAUNDRY",
                "UNDERPASS":"NIGHT BUS", "QUAY":"COLD STORE", "RETURN":"DINER"}[district]
        box((width*.24,-depth/2-1,8.2),(3.5,.7,7.5),METAL)
        box((width*.24-1.65,-depth/2-1.4,8.2),(.12,.1,7.2),neon)
        if word in ["MOTEL","ARCADE","DINER"]:
            for i,ch in enumerate(word):
                sign(ch,(width*.24,-depth/2-1.43,10.5-i*1.1),1.05,neon)
        else:
            sign(word,(0,-depth/2-.7,3.3),.78,neon)
        p = world((width*.24,-depth/2-1.8,8.2))
        lights.append({"p":[p[0],p[2],-p[1]],"color":neon,"size":7,"ground":origin[2]+.23})


neons = {"MOTEL":PINK,"ARCADE":CYAN,"TENEMENTS":AMBER,"UNDERPASS":CYAN,"QUAY":AMBER,"RETURN":PINK}
for index, distance in enumerate(range(18, int(route["length"]), 23)):
    s = station(distance)
    district = s["sector"]
    for side in [-1,1]:
        # Leave one side of the quay open to the black water.
        if district == "QUAY" and side == 1:
            continue
        width,depth = random.uniform(13,19),random.uniform(14,19)
        origin,yaw = anchor(s,side,s["width"]/2+7+depth/2)
        if not clear_of_route(origin, math.hypot(width,depth)/2):
            continue
        height = random.uniform(17,38) if district in ["TENEMENTS","ARCADE"] else random.uniform(8,22)
        if district == "UNDERPASS": height += 14
        building(width,depth,height,BRICK if index%3==0 else WALL,neons[district],index%3==0)
        buildings += 1
    # Second row: uneven roofline, water tanks, scattered apartment lights.
    if index % 2 == 0:
        for side in [-1,1]:
            origin,yaw = anchor(s,side,82+random.random()*24)
            if clear_of_route(origin,22):
                building(24,24,random.uniform(32,76),WALL,neons[district],background=True)
                buildings += 1

# Street furniture, station shelters and overhead sodium lamps.
for index,distance in enumerate(range(0,int(route["length"]),55)):
    s=station(distance)
    district=s["sector"]
    side=-1 if index%2 else 1
    origin,yaw=anchor(s,side,s["width"]/2+2.5)
    box((0,0,4.5),(.18,.18,9),METAL)
    box((0,-1.3,8.9),(.16,2.8,.16),METAL)
    box((0,-2.6,8.75),(1.4,.7,.3),TRIM)
    box((0,-2.6,8.56),(1.2,.6,.06),AMBER if index%3 else CYAN)
    p=world((0,-2.6,8.5))
    lights.append({"p":[p[0],p[2],-p[1]],"color":AMBER if index%3 else CYAN,"size":3.6,"ground":origin[2]+.23})
    if index%4==0:
        box((0,3,1.5),(5.5,2.5,.16),METAL)
        box((0,3,3.6),(6,3,.3),METAL)
        box((-2.5,3,1.9),(.15,.15,3.3),TRIM)
        box((2.5,3,1.9),(.15,.15,3.3),TRIM)
        box((0,4.3,2.2),(5.3,.08,2.3),DARK)
        sign("NIGHT LINE",(0,1.45,3.1),.42,CYAN)

# The underpass is a continuous overhead volume, safely above the camera.
for distance in range(int(route["length"]*.515),int(route["length"]*.62),12):
    s=station(distance);district="UNDERPASS"
    origin,yaw=anchor(s,1,0)
    yaw += math.pi/2
    box((0,0,15),(43,12.3,1.8),METAL)
    for side in [-1,1]:
        box((side*18,0,6.5),(1.5,1.8,15),WALL)
        box((side*12,0,13.98),(.6,8,.08),CYAN)

# Meridian's roadside marquee is the home landmark, visible along the opening straight.
s=station(48);district="MOTEL"
origin,yaw=anchor(s,1,17.2)
yaw += math.pi/2
box((0,0,5),(.5,.5,10),METAL)
box((0,0,10.5),(6.2,.9,4.4),METAL)
for z in [8.5,12.5]: box((0,-.5,z),(6.2,.10,.12),PINK)
sign("MERIDIAN",(0,-.52,11),.87,PINK)
sign("M O T E L",(0,-.52,9.4),.75,WHITE)
p=world((0,-.8,10.5))
lights.append({"p":[p[0],p[2],-p[1]],"color":PINK,"size":8,"ground":origin[2]+.23})

# Dark ground beyond the service quay. All course asphalt stays above it.
origin=(160,0,-1.0);yaw=0;district="GROUND"
box((0,0,-1),(1450,1500,2),METAL)

for (sector,name),(verts,faces) in buckets.items():
    mesh=bpy.data.meshes.new(sector+"_"+name)
    mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(sector+"_"+name,mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(materials[name])
    # Box projection, metres per repeat. Horizontal and vertical facades share one texture.
    uv=mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        axis=max(range(3),key=lambda a:abs(polygon.normal[a]))
        axes=[a for a in range(3) if a!=axis]
        for loop_i in polygon.loop_indices:
            p=mesh.vertices[mesh.loops[loop_i].vertex_index].co
            uv.data[loop_i].uv=(p[axes[0]]/12,p[axes[1]]/12)

OUT.mkdir(parents=True,exist_ok=True)
# Merge the signs into their district too; glTF splits only on material.
for sector in [d["id"] for d in route["districts"]]:
    members=[obj for obj in bpy.context.scene.objects if obj.type=="MESH" and obj.name.startswith(sector+"_")]
    if members:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in members: obj.select_set(True)
        bpy.context.view_layer.objects.active=members[0]
        bpy.ops.object.join()
        members[0].name="NS_DISTRICT_"+sector
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(OUT/"nightshift_city.glb"),export_format="GLB",
    export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
(OUT/"lights.json").write_text(json.dumps(lights))
triangles=0
for obj in bpy.context.scene.objects:
    if obj.type=="MESH":
        obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
(OUT/"manifest.json").write_text(json.dumps({"name":"Night Shift", "generator":"Blender "+bpy.app.version_string,
    "buildings":buildings,"triangles":triangles,"lightAnchors":len(lights),"seed":217},indent=2)+"\n")

scene=bpy.context.scene
scene.world.color=(.025,.035,.06)
bpy.ops.object.camera_add(location=(-100,320,150))
camera=bpy.context.object
camera.rotation_euler=(Vector((145,20,10))-camera.location).to_track_quat("-Z","Y").to_euler()
scene.camera=camera
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"art/blender/nightshift_city.blend"))
print("NIGHTSHIFT_CITY",buildings,"buildings",triangles,"triangles",len(lights),"light anchors")
