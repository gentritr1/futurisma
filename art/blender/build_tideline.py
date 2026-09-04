"""Tideline: drowned reactor, coastal drydock and two ocean flight crossings."""
import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/tideline"
route = json.loads((ROOT / "src/game/data/tideline/route.json").read_text())
random.seed(508)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
materials, buckets, lights = {}, {}, []
origin, yaw, district = (0,0,0), 0, "REACTOR"
census = {"aqueductRibs":0,"reactors":0,"kelpBeds":0,"mantas":0,"portHalls":0,"cranes":0,"boats":0,"flightLenses":0,"pelagicCrowns":0}


def material(name,color,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    shader=m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value=(*color,1)
    shader.inputs["Roughness"].default_value=.74
    if emission:
        shader.inputs["Emission Color"].default_value=(*color,1)
        shader.inputs["Emission Strength"].default_value=emission
    materials[name]=m
    return name

METAL=material("TL_ocean_steel",(.055,.065,.19))
CONCRETE=material("TL_weathered_ceramic",(.42,.46,.55))
CERAMIC=material("TL_ochre_hull",(.46,.28,.085))
DARK=material("TL_deep_glass",(.009,.017,.055))
CYAN=material("TL_aqueduct_cyan",(.075,.72,.77),1.7)
AMBER=material("TL_port_amber",(1,.49,.16),1.65)
BIO=material("TL_living_teal",(.06,.34,.27),.12)
WHITE=material("TL_navigation_white",(.73,.84,.94),.8)
CHROME=material("TL_polished_chrome",(.63,.69,.79))
chrome_shader=materials[CHROME].node_tree.nodes.get("Principled BSDF")
chrome_shader.inputs["Metallic"].default_value=.78
chrome_shader.inputs["Roughness"].default_value=.25
VIOLET=material("TL_crown_violet",(.38,.065,.85),1.4)
HAZARD=material("TL_hazard_yellow",(.90,.68,.075),.08)

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
    if min(size)<.15 and mat in [DARK,AMBER,CYAN,BIO,WHITE,HAZARD,VIOLET]:
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


def anchor(s,side,offset,height=None):
    p,t=s["p"],s["t"];rx,rz=-t[2],t[0]
    return (p[0]+rx*offset*side,-p[2]-rz*offset*side,p[1] if height is None else height),math.atan2(-rx*side,-rz*side)


def clear(center,radius,vertical_radius=None):
    # Spheres are conservative for roofs, fauna and props. The mode's guided
    # flight path is checked just as strictly as its actual deck.
    vr=radius if vertical_radius is None else vertical_radius
    for s in route["stations"]:
        p=s["p"]
        if abs(center[2]-p[1])>vr+9:continue
        if (center[0]-p[0])**2+(-center[1]-p[2])**2<(s["width"]/2+radius+2)**2:return False
    return True


def lamp(local,mat,size=4,ground=None):
    p=world(local)
    lights.append({"p":[p[0],p[2],-p[1]],"color":mat,"size":size,
        "ground":origin[2]+.035 if ground is None else ground})


def arch(width,height,base=0,thickness=.65,mat=METAL):
    points=[(width*math.cos(i*math.pi/24),0,base+height*math.sin(i*math.pi/24)) for i in range(25)]
    tube(points,thickness,mat,6)


def reactor():
    cylinder((0,0,-3),24,6,CONCRETE,28)
    cylinder((0,0,10),18,22,METAL,28)
    for z,r in [(2,20),(7,19),(12,20),(17,19),(22,21)]:
        cylinder((0,0,z),r,.8,CONCRETE,32)
        points=[((r+.15)*math.cos(a*math.tau/48),(r+.15)*math.sin(a*math.tau/48),z+.5) for a in range(48)]
        tube(points,.18,CYAN,4,True)
    for a in range(12):
        theta=a*math.tau/12
        x,y=18*math.cos(theta),18*math.sin(theta)
        tube([(x,y,0),(x,y,24),(x*.62,y*.62,29)],.75,CONCRETE)
    cylinder((0,0,25),9,5,DARK,24)
    cylinder((0,0,28),8.5,.4,CYAN,24)
    for side in [-1,1]:
        tube([(side*18,0,6),(side*28,0,6),(side*32,0,-4)],1.25,METAL,10)
    census["reactors"]+=1


def kelp_bed():
    for i in range(8):
        x,y=random.uniform(-4,4),random.uniform(-4,4)
        height=random.uniform(6,15)
        vertices=[]
        for j in range(7):
            z=j/6*height;lean=math.sin(j*.72+i)*1.4
            width=(1-j/6)*.7+.12
            vertices.extend([(x+lean-width,y+math.sin(j*.5),z),(x+lean+width,y+math.sin(j*.5),z)])
        geometry(vertices,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(6)],BIO)
        if i%3==0:cylinder((x,y,.6),.8,1.2,CONCRETE,7)
    census["kelpBeds"]+=1


def manta():
    # A recognisable ray silhouette: sweeping wing lobes, a rounded head and
    # a long whip tail, with bioluminescent gill markings along its underside.
    vertices=[]
    columns,rows=18,10
    for j in range(rows+1):
        v=j/rows
        for i in range(columns+1):
            u=i/columns*2-1
            x=u*(19*math.sin(v*math.pi)**.45+1.5)
            y=-8+15*v+abs(u)**1.7*5
            z=(1-u*u)*math.sin(v*math.pi)*1.8-abs(u)**1.4*3
            vertices.append((x,y,z))
    faces=[]
    for j in range(rows):
        for i in range(columns):
            a=j*(columns+1)+i;faces.append((a,a+1,a+columns+2,a+columns+1))
    geometry(vertices,faces,BIO)
    tube([(0,6,.4),(0,15,-1),(2,24,-2),(1,34,-2)],.3,METAL,6)
    for x in [-1.8,1.8]:
        tube([(x,-6,.5),(x*1.4,-8,.2),(x*1.6,-9,-.3)],.45,BIO,6)
    for i in range(5):tube([(-3+i*.35,-2+i*.9,-.25),(3-i*.35,-2+i*.9,-.25)],.10,CYAN,4)
    census["mantas"]+=1


def hall(width,depth,height,word):
    box((0,0,height/2),(width,depth,height),CONCRETE)
    # Barrel roofs and exposed ribs distinguish the drydock from city boxes.
    points=[]
    for y in [-depth/2,depth/2]:
        points.extend((width/2*math.cos(i*math.pi/16),y,height+width*.22*math.sin(i*math.pi/16)) for i in range(17))
    geometry(points,[(i,i+1,i+18,i+17) for i in range(16)],METAL)
    for y in [-depth/2,0,depth/2]:
        tube([(width/2*math.cos(i*math.pi/16),y,height+width*.22*math.sin(i*math.pi/16)) for i in range(17)],.22,CERAMIC)
    front=-depth/2
    box((0,front-.10,4),(width*.72,.10,6.5),METAL)
    for z in [1,2,3,4,5,6]:box((0,front-.17,z),(width*.68,.06,.075),AMBER)
    for x in [-width*.36,width*.36]:
        box((x,front-.06,height-2),(width*.17,.08,2.2),DARK)
        box((x,front-.13,height-2),(width*.14,.07,.16),WHITE)
    sign(word,(0,front-.18,height-1),.8,AMBER)
    lamp((0,front-1,height-1),AMBER,6)
    census["portHalls"]+=1


def crane():
    for x in [-7,7]:
        box((x,0,13),(1.3,2.1,26),CERAMIC)
        tube([(x,-.8,1),(-x,-.8,12),(x,-.8,25)],.19,METAL,5)
    box((0,0,27),(17,4,2),CERAMIC)
    box((0,-7,27),(2,22,1.6),METAL)
    tube([(0,-16,27),(0,-16,17)],.09,WHITE,4)
    box((0,1,29),(6,4,3),METAL)
    box((0,-1.1,29),(4.7,.08,1.7),DARK)
    lamp((0,-2,29),AMBER,4)
    census["cranes"]+=1


def boat():
    # Keel, tapered bow, small wheelhouse and a navigation mast.
    vertices=[(-7,-16,1),(7,-16,1),(9,10,1),(0,20,1),(-9,10,1),
              (-5,-15,-2),(5,-15,-2),(6,8,-2),(0,17,-2),(-6,8,-2)]
    geometry(vertices,[(0,1,2,3,4),(9,8,7,6,5),(0,5,6,1),(1,6,7,2),(2,7,8,3),(3,8,9,4),(4,9,5,0)],CERAMIC)
    box((0,-5,3),(10,9,5),CONCRETE)
    box((0,-5,6),(11,10,.7),METAL)
    box((0,-9.55,3.8),(8,.08,1.8),DARK)
    box((0,-9.6,3.8),(7,.06,.15),AMBER)
    tube([(0,0,1),(0,0,17)],.16,WHITE,6)
    box((0,0,15),(9,.18,.18),METAL)
    lamp((0,0,17),AMBER,3,0.035)
    census["boats"]+=1


def hazard_plate(center,width,height):
    x,y,z=center
    box(center,(width,.08,height),HAZARD)
    # Black diagonal islands remain inside the yellow panel, leaving a border.
    for offset in [-.65,0,.65]:
        left=x+offset*width*.5
        half=width*.10
        low=z-height*.39;high=z+height*.39
        lean=width*.20
        geometry([(left-half-lean,y-.055,low),(left+half-lean,y-.055,low),
                  (left+half+lean,y-.055,high),(left-half+lean,y-.055,high)],[(0,1,2,3)],DARK)


def ring_band(inner,outer,front,back,height,mat,segments=64):
    vertices=[]
    for radius,depth in [(inner,front),(outer,front),(outer,back),(inner,back)]:
        for i in range(segments):
            angle=i*math.tau/segments
            vertices.append((radius*math.cos(angle),depth,height+radius*math.sin(angle)))
    faces=[]
    for loop in range(4):
        for i in range(segments):
            j=(i+1)%segments;n=(loop+1)%4
            faces.append((loop*segments+i,loop*segments+j,n*segments+j,n*segments+i))
    geometry(vertices,faces,mat)


def pressure_sphere(x,z,radius):
    vertices=[];cols,rows=24,12
    for row in range(rows+1):
        latitude=-math.pi/2+row/rows*math.pi
        for col in range(cols):
            angle=col/cols*math.tau
            vertices.append((x+radius*math.cos(latitude)*math.cos(angle),
                            radius*math.cos(latitude)*math.sin(angle),z+radius*math.sin(latitude)))
    geometry(vertices,[(row*cols+col,row*cols+(col+1)%cols,(row+1)*cols+(col+1)%cols,(row+1)*cols+col)
                       for row in range(rows) for col in range(cols)],CHROME)
    for height in [-5,0,5]:
        radius_at=math.sqrt(radius**2-height**2)+.45
        cylinder((x,0,z+height),radius_at,1.15,METAL,32)
        cylinder((x,0,z+height+.63),radius_at+.08,.20,CHROME,32)
    for i in range(16):
        angle=i*math.tau/16
        a,b=angle-.10,angle+.10
        radius_at=radius+.12
        geometry([(x+radius_at*math.cos(a),radius_at*math.sin(a),z+.9),
                  (x+radius_at*math.cos(b),radius_at*math.sin(b),z+.9),
                  (x+radius_at*math.cos(b),radius_at*math.sin(b),z+2.8),
                  (x+radius_at*math.cos(a),radius_at*math.sin(a),z+2.8)],[(0,1,2,3)],AMBER)
    # The turbine port is a shallow cylindrical opening facing the arriving road.
    tube([(x,-radius+.5,z-2),(x,-radius-1.8,z-2)],3.5,METAL,24)
    tube([(x,-radius-1.85,z-2),(x,-radius-1.98,z-2)],2.8,DARK,24)
    for i in range(10):
        a=i*math.tau/10
        tube([(x+.7*math.cos(a),-radius-2,z-2+.7*math.sin(a)),
              (x+2.4*math.cos(a+.35),-radius-2,z-2+2.4*math.sin(a+.35))],.12,CHROME,4)
    box((x,0,6),(24,23,12),METAL)
    box((x,0,1.5),(29,29,3),CHROME)
    for side in [-1,1]:
        box((x+side*9,-11,7),(5,5,10),CONCRETE)
    lamp((x,-radius-2,z+2),AMBER,6,origin[2]+2)


def pelagic_crown():
    # The three-view image was approved as a modelling guide before this pass:
    # 90 m pressure ring, 76 m aperture, 12 m depth, twin 24 m spherical pods.
    # The race passes through the lower aperture; the connecting plinth is below it.
    ring_band(38,45,-6,6,54,METAL)
    ring_band(39.3,44.5,-6.7,-6.1,54,CHROME)
    ring_band(39.3,44.5,6.1,6.7,54,CHROME)
    ring_band(38,38.45,-6.95,-6.6,54,CYAN)
    ring_band(38,38.45,6.6,6.95,54,CYAN)
    # Segmented outer armour plates and dark radial seams provide metallic contrast.
    for i in range(24):
        angle=(i+.5)*math.tau/24
        a,b=angle-.105,angle+.105
        for depth in [-6.8,6.8]:
            geometry([(39.9*math.cos(a),depth,54+39.9*math.sin(a)),
                      (44*math.cos(a),depth,54+44*math.sin(a)),
                      (44*math.cos(b),depth,54+44*math.sin(b)),
                      (39.9*math.cos(b),depth,54+39.9*math.sin(b))],[(0,1,2,3)],CONCRETE)
        if i%3==1:
            tube([(40.0*math.cos(a),-7.02,54+40*math.sin(a)),
                  (40.0*math.cos(b),-7.02,54+40*math.sin(b))],.25,VIOLET,4)
    for x,z in [(0,98),(0,10),(-44,54),(44,54)]:
        box((x,0,z),(6,15,7),METAL)
        hazard_plate((x,-7.6,z),4.5,5.4)
    pressure_sphere(-49,22,12)
    pressure_sphere(49,22,12)
    box((0,0,4),(126,28,8),METAL)
    box((0,-14.4,4),(35,1,5),CONCRETE)
    for x in range(-14,15,4):box((x,-15,4),(1.4,.08,2.8),DARK)
    lamp((0,-7,91),VIOLET,7,origin[2]+.035)
    census["pelagicCrowns"]+=1

# The underwater aqueduct and reentry tunnel are physical frames around a clear
# central driving volume. Runtime glass panes and water supply transparency.
for distance in range(0,int(route["length"]),22):
    s=station(distance);p=s["p"];district=s["sector"]
    if s["mode"]!="submerged" and not (.89<distance/route["length"]<.95):continue
    origin,yaw=anchor(s,1,0);yaw+=math.pi/2
    arch(17,15,base=4,thickness=.95)
    arch(16.8,14.8,base=4,thickness=.08,mat=CYAN)
    for side in [-1,1]:
        box((side*17,0,2.5),(1.8,2.4,5.8),CONCRETE)
        hazard_plate((side*17,-1.3,4.8),2.25,2.7)
        box((side*16.55,-.8,4.2),(.15,.08,1.8),CYAN)
    if distance%66==0:lamp((0,0,17),CYAN,4,p[1]+.035)
    census["aqueductRibs"]+=1

# Seabed ecosystems and flooded energy infrastructure, kept off the aqueduct.
for index,distance in enumerate(range(0,int(route["length"]),28)):
    s=station(distance);district=s["sector"]
    if s["mode"]!="submerged":continue
    for side in [-1,1]:
        origin,yaw=anchor(s,side,28+random.random()*15,height=-32-random.random()*5)
        if clear(origin,5,17):kelp_bed()
    if index%6==0:
        origin,yaw=anchor(s,-1 if index%2 else 1,78,height=-49)
        if clear(origin,34,35):reactor()
    if index%8==0:
        origin,yaw=anchor(s,-1 if index%2 else 1,76,height=-13)
        if clear(origin,27,7):manta()

# Port Afterlight hugs the service road; lit cranes and drydock sheds make the
# return to the surface unmistakable. Their concrete quays sit above the tide.
words=["COUNTERTIDE","SALVAGE WORKS","PORT AFTERLIGHT","DEEP SERVICE"]
for index,distance in enumerate(range(int(route["length"]*.275),int(route["length"]*.455),48)):
    # Leave breathing room around the Crown's two pressure housings.
    if abs(distance-route["length"]*.435)<55:continue
    s=station(distance);district=s["sector"]
    for side in [-1,1]:
        origin,yaw=anchor(s,side,45+random.random()*10,height=.8)
        if not clear(origin,22,30):continue
        box((0,0,-1),(43,37,3),CONCRETE)
        if index%3==0:crane()
        else:hall(28,25,random.uniform(9,15),words[index%4])

# Navigation lenses frame the takeoff and landing points, above and outside the
# glide corridor. The road and its guidance beacons are owned by the course.
for arc in route["flightArcs"]:
    for progress in [arc["from"]-.006,arc["to"]+.006]:
        s=station(progress*route["length"]);district=s["sector"]
        origin,yaw=anchor(s,1,0);yaw+=math.pi/2
        arch(20,14,base=5,thickness=.8,mat=CONCRETE)
        arch(19.4,13.4,base=5,thickness=.15,mat=WHITE)
        for side in [-1,1]:
            box((side*20,0,2),(2,3,5),METAL)
            box((side*20,-1.6,5),(1.6,.1,.3),CYAN)
        census["flightLenses"]+=1

# Slow ships below the flight routes and lighthouse pylons along the sea wall.
for index,progress in enumerate([.38,.46,.52,.59,.69,.76,.81,.88]):
    s=station(progress*route["length"]);district=s["sector"]
    origin,yaw=anchor(s,-1 if index%2 else 1,68+index%3*25,height=0)
    if clear(origin,22,24):boat()
for progress in [.28,.4,.665,.7,.89]:
    s=station(progress*route["length"]);district=s["sector"]
    origin,yaw=anchor(s,1,48,height=-2)
    if not clear(origin,9,55):continue
    cylinder((0,0,18),5,40,CONCRETE,16)
    cylinder((0,0,39),7,2,METAL,20)
    cylinder((0,0,42),5,4,DARK,20)
    cylinder((0,0,42),5.1,.4,AMBER,20)
    cylinder((0,0,45),7,.8,METAL,20)
    lamp((0,0,43),AMBER,8,0.035)

# One landmark is readable across the port, then frames the first takeoff.
s=station(route["length"]*.435);district=s["sector"]
origin,yaw=anchor(s,1,0,height=s["p"][1]-32);yaw+=math.pi/2
pelagic_crown()

origin=(0,0,-55);yaw=0;district="REACTOR"
box((0,0,-3),(2200,2200,6),METAL)
for (sector,name),(vertices,faces) in buckets.items():
    mesh=bpy.data.meshes.new(sector+"_"+name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(sector+"_"+name,mesh);bpy.context.collection.objects.link(obj)
    mesh.materials.append(materials[name])
for sector in [d["id"] for d in route["districts"]]:
    members=[o for o in bpy.context.scene.objects if o.type=="MESH" and o.name.startswith(sector+"_")]
    if not members:continue
    bpy.ops.object.select_all(action="DESELECT")
    for obj in members:obj.select_set(True)
    bpy.context.view_layer.objects.active=members[0];bpy.ops.object.join();members[0].name="TL_DISTRICT_"+sector
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/"tideline_world.glb"),export_format="GLB",export_yup=True,
    export_animations=False,export_cameras=False,export_lights=False)
(OUT/"lights.json").write_text(json.dumps(lights))
triangles=0
for obj in bpy.context.scene.objects:
    if obj.type=="MESH":obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
(OUT/"manifest.json").write_text(json.dumps({"name":"Tideline","generator":"Blender "+bpy.app.version_string,
    **census,"triangles":triangles,"lightAnchors":len(lights),"waterLevel":0,"seed":508,"reference":"art/reference/pelagic-crown-three-view.png","landmarkProgress":.435},indent=2)+"\n")
scene=bpy.context.scene;scene.world.color=(.018,.035,.048)
bpy.ops.object.camera_add(location=(720,850,460));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,5))-camera.location).to_track_quat("-Z","Y").to_euler();scene.camera=camera
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"art/blender/tideline_world.blend"))
print("TIDELINE",json.dumps(census),triangles,"triangles",len(lights),"light anchors")
