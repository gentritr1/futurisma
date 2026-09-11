"""Tideline tide rebuild: textured reactor, enclosed port and drained pump-hall cut."""
import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/assets/tideline-foundry"
route = json.loads((ROOT / "src/game/data/tideline/route.json").read_text())
random.seed(508)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
materials, buckets, lights = {}, {}, []
motion_pivots={}
variant=0
placements=[]
instance_markers=[]
origin, yaw, district = (0,0,0), 0, "REACTOR"
census = {"aqueductRibs":0,"reactors":0,"kelpBeds":0,"mantas":0,"portHalls":0,"cranes":0,"boats":0,"flightLenses":0,"pelagicCrowns":0}


def mark_instance(kind):
    census[kind]+=1
    instance_markers.append((kind,census[kind],origin))


def material(role):
    name="GW_MAT_"+role
    m=bpy.data.materials.new(name);m.use_nodes=True
    shader=m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value=1;shader.inputs["Metallic"].default_value=0
    image=bpy.data.images.load(str(OUT/'textures'/(role+'.jpg')),check_existing=True);image.pack()
    texture=m.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
    m.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    if role=='emissive':
        m.node_tree.links.new(texture.outputs['Color'],shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value=.7
    if role in ['jungle','signage']:
        m.surface_render_method='DITHERED';m.alpha_threshold=.5
    materials[name]=m;return name
METAL=material('metal');CONCRETE=material('concrete');BIO=material('jungle')
HAZARD=material('signage');AMBER=material('emissive')
CERAMIC=CHROME=DARK=METAL
CYAN=WHITE=VIOLET=AMBER

def world(p):
    x,y,z = p
    return (origin[0]+math.cos(yaw)*x-math.sin(yaw)*y,
            origin[1]+math.sin(yaw)*x+math.cos(yaw)*y,origin[2]+z)


def geometry(vertices, faces, mat, tile=None):
    verts, polys, uvs = buckets.setdefault((district,mat),([],[],[]))
    offset=len(verts);verts.extend(world(p) for p in vertices)
    polys.extend(tuple(offset+i for i in f) for f in faces)
    region=(3 if mat==HAZARD else 0 if mat==AMBER else variant%3) if tile is None else tile
    for face in faces:
        points=[Vector(vertices[i]) for i in face]
        normal=(points[1]-points[0]).cross(points[2]-points[0])
        axis=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=axis]
        # Blender Z is height, therefore v follows gravity on vertical panels.
        if 2 in axes:axes=[next(a for a in axes if a!=2),2]
        lo=[min(v[a] for v in points) for a in axes];span=[max(v[a] for v in points)-lo[j] for j,a in enumerate(axes)]
        for point in points:
            u=(point[axes[0]]-lo[0])/max(.001,span[0]);v=(point[axes[1]]-lo[1])/max(.001,span[1])
            uvs.append(((region%2)*.5+.012+u*.476,(1-region//2)*.5+.012+v*.476))

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
    x,y,z=p
    geometry([(x-1,y,z-.4),(x+1,y,z-.4),(x+1,y,z+.4),(x-1,y,z+.4)],[(0,1,2,3)],HAZARD,tile=variant%3)

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
    mark_instance('reactors')


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
    mark_instance('kelpBeds')


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
    mark_instance('mantas')


def hall(width,depth,height,word):
    foundation=origin[2]+26
    box((0,0,-foundation/2),(width+.7,depth+.7,foundation),CONCRETE)
    # Historic wet bands are projected over these concrete retaining walls at runtime.
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
    # Recessed access ladder and two mooring levels on the exposed foundation.
    for x in [-.8,.8]:box((x,front-.35,-foundation/2),( .10,.18,foundation),METAL)
    # Flat rungs are sufficient at chase distance, and share the sector batch.
    for level in range(-25,1,2):box((0,front-.46,level-origin[2]),(1.8,.16,.12),METAL)
    for level in [-12,-23]:
        points=[(3+.7*math.cos(i*math.tau/8),front-.48,level-origin[2]+.7*math.sin(i*math.tau/8)) for i in range(8)]
        tube(points,.09,METAL,3,True)
    mark_instance('portHalls')


def crane():
    global district
    for x in [-7,7]:
        box((x,0,13),(1.3,2.1,26),CERAMIC)
        tube([(x,-.8,1),(-x,-.8,12),(x,-.8,25)],.19,METAL,5)
    static_district=district
    if census['cranes']<2:
        district='MOTION_CRANE_'+str(census['cranes'])
        motion_pivots[district]=world((0,0,27))
    box((0,0,27),(17,4,2),CERAMIC)
    box((0,-7,27),(2,22,1.6),METAL)
    tube([(0,-16,27),(0,-16,17)],.09,WHITE,4)
    box((0,1,29),(6,4,3),METAL)
    box((0,-1.1,29),(4.7,.08,1.7),DARK)
    # The fixed mast lamp is not attached to the moving boom.
    lamp((0,0,26),AMBER,4)
    district=static_district
    mark_instance('cranes')


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
    mark_instance('boats')


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
    mark_instance('pelagicCrowns')


# All placement tests include the lap-three branch as well as the main road.
original_clear=clear
def branch_clear(center,radius,vertical_radius=None):
    vr=radius if vertical_radius is None else vertical_radius
    for st in route['shortcut']['stations']:
        if abs(center[2]-st['p'][1])>vr+10:continue
        if (center[0]-st['p'][0])**2+(-center[1]-st['p'][2])**2<(route['shortcut']['width']/2+radius+2)**2:return False
    return True
def clear(center,radius,vertical_radius=None):
    return original_clear(center,radius,vertical_radius) and branch_clear(center,radius,vertical_radius)

def cable_clear(points):
    candidates=[]
    for a,b in zip(points,points[1:]):
        for step in range(9):candidates.append(Vector(world(Vector(a).lerp(Vector(b),step/8))))
    for st in route['stations']+route['shortcut']['stations']:
        p=Vector((st['p'][0],-st['p'][2],st['p'][1]))
        t=Vector((st['t'][0],-st['t'][2],st['t'][1])).normalized()
        right=t.cross(Vector((0,0,1))).normalized();up=right.cross(t).normalized()
        for candidate in candidates:
            relative=candidate-p
            if abs(relative.dot(t))<2 and -.5<relative.dot(up)<7.7 and abs(relative.dot(right))<st.get('width',route['shortcut']['width'])/2+2.7:return False
    return True

# At least three wear variants; every fourth rib is a heavier structural bay.
# Two upper-rib breaks leave only high fragments, never debris in the driving volume.
for index,distance in enumerate(range(0,int(route['length']),24)):
    st=station(distance)
    if st['p'][1]>-3:continue
    # The inner branch passes through these bays: leave an unobstructed mouth.
    progress=distance/route['length']
    if .035<progress<.105 or .215<progress<.29:continue
    district=st['sector'];variant=index%3
    origin,yaw=anchor(st,1,0);yaw+=math.pi/2
    if any(not branch_clear(world((side*17,0,2.3)),2,3) for side in [-1,1]):continue
    heavy=index%4==0;broken=index in [13,67]
    if broken:variant=2
    thickness=1.0 if heavy else .42
    if broken:
        for first,last in [(0,8),(13,24)]:
            tube([(17*math.cos(i*math.pi/24),0,4+10*math.sin(i*math.pi/24)) for i in range(first,last+1)],thickness,METAL,6)
    else:arch(17,10,base=4,thickness=thickness)
    for side in [-1,1]:
        box((side*17,0,2.3),(1.9,2.5,5.8),CONCRETE)
        if heavy:
            box((side*16.4,-.3,5.4),(.65,1.8,.4),METAL)
            box((side*16.4,-.4,5.13),(.45,1.4,.14),AMBER if index%3!=1 else METAL)
            for y in [-.85,-.4,.05]:box((side*16.4,y,5.0),(.64,.09,.40),METAL)
            if index%3!=1:lamp((side*16.4,-.4,5.1),AMBER,2.3,st['p'][1]+.035)
    # Crown pipes and cables span to the next frame, creating close parallax.
    for side in [-1,1]:
        tube([(side*8,0,12.5),(side*8,24,12.5)],.32,METAL,6)
        saved_district=district
        district='MOTION_CABLES'
        cable=[(side*13,0,9.2),(side*13,8,8.4),(side*13,16,8.4),(side*13,24,9.2)]
        # Omit a span on rising approaches if its sag would enter headroom.
        if cable_clear(cable):tube(cable,.10,METAL,5)
        district=saved_district
    placements.append({'kind':'rib','index':index,'progress':distance/route['length'],'variant':variant,'heavy':heavy,'damaged':broken})
    mark_instance('aqueductRibs')

# Close retaining walls and drain joints keep the eye moving even on the quay.
for index,distance in enumerate(range(0,int(route['length']),12)):
    st=station(distance);district=st['sector'];variant=index%3
    origin,yaw=anchor(st,1,0);yaw+=math.pi/2
    for side in [-1,1]:
        # Leave real mouths at the pump-hall fork, on its inner side.
        if side==1 and (.035<distance/route['length']<.105 or .215<distance/route['length']<.29):continue
        if not branch_clear(world((side*16.9,0,-.3)),6,2.6):continue
        if st['p'][1]>-3:
            # The quay is a deep retaining wall, not a road-height floating box.
            # A waist-height cap lets the chase view read the water against it.
            bottom=-29-st['p'][1];top=1.05
            box((side*16.9,0,(bottom+top)/2),(2.2,11.6,top-bottom),CONCRETE)
        else:box((side*16.9,0,-.3),(2.2,11.6,5.2),CONCRETE)
        if st['p'][1]>-3:
            tube([(side*17.3,-6,2.3),(side*17.3,6,2.3)],.30,METAL,6)
        if index%3==0:box((side*15.72,0,1.8),(.07,2.1,.10),AMBER)

for index,distance in enumerate(range(20,int(route['length']),90)):
    st=station(distance)
    if st['p'][1]>-3:continue
    district=st['sector'];variant=index%3
    for side in [-1,1]:
        origin,yaw=anchor(st,side,29,height=-26)
        if clear(origin,7,15):kelp_bed()
for index,progress in enumerate([.02,.16,.82,.96]):
    st=station(progress*route['length']);district=st['sector'];variant=index%3
    for side in [-1,1]:
        origin,yaw=anchor(st,side,60,height=-25)
        if clear(origin,34,35):reactor()

# Port sheds and service machinery flank, rather than swallow, the road.
for index,progress in enumerate([.35,.41,.48,.55,.62,.68]):
    st=station(progress*route['length']);district=st['sector'];variant=index%3
    for side in [-1,1]:
        origin,yaw=anchor(st,side,51)
        if clear(origin,30,25):hall(28,33,13,'PUMP WORKS')
        origin,yaw=anchor(st,side,43)
        if index%2==0 and clear(origin,17,35):crane()

# The newly usable pump hall follows the narrower branch with clear shoulders.
cut=route['shortcut'];district='LOCK';hall_side=cut['width']/2+4
for index in range(28,len(cut['stations'])-30,7):
    st=cut['stations'][index];variant=(index//7)%3
    origin,yaw=anchor(st,1,0);yaw+=math.pi/2
    for side in [-1,1]:
        if not original_clear(world((side*hall_side,0,5.5)),1.3,5.5):continue
        box((side*hall_side,0,5.5),(1.1,2.0,11),CONCRETE)
        tube([(side*hall_side,0,10),(side*6,0,14),(0,0,14.5)],.4,METAL,6)
    box((0,0,15),(hall_side*2+1,18,.8),METAL)
    lamp((0,0,13.5),AMBER,2.4,st['p'][1]+.035)
    box((0,0,13.7),(1.4,.6,.24),AMBER)
placements.append({'kind':'pump_hall','from':cut['from'],'to':cut['to'],'width':cut['width']})

# A silted workboat rests outside the sealed tunnel. A second hull crosses the
# deep channel at the far quay after drainage; both reuse the painted role atlas.
district='STRANDED_BOAT';variant=2
st=station(.115*route['length']);origin,yaw=anchor(st,-1,64,height=-24.2)
if clear(origin,22,20):boat()
# A second stranded hull sits beside the port quay, visible as the last basin drains.
district='STRANDED_PORT_BOAT';variant=2
st=station(.535*route['length']);origin,yaw=anchor(st,1,34,height=-24.2)
if clear(origin,22,12):boat()
district='MOTION_FERRY';variant=0;origin,yaw=(0,-510,-26.3),math.pi/2
motion_pivots[district]=origin
boat()

# Build indexed per-sector/material meshes. Every surface has UV0 and an atlas.
for (sector,mat),(vertices,faces,uvs) in buckets.items():
    mesh=bpy.data.meshes.new('GW_GEO_'+sector+'_'+mat);mesh.from_pydata(vertices,[],faces);mesh.update()
    mesh.materials.append(materials[mat]);uv=mesh.uv_layers.new(name='UVMap')
    col=mesh.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='CORNER')
    for i,value in enumerate(uvs):uv.data[i].uv=value;col.data[i].color=(.98,.98,.96,1)
    obj=bpy.data.objects.new('GW_SECTOR_'+sector+'_'+mat,mesh);bpy.context.collection.objects.link(obj)
    if sector in motion_pivots:
        pivot=Vector(motion_pivots[sector])
        for vertex in mesh.vertices:vertex.co-=pivot
        obj.location=pivot

# Import complete textured gantries, preserving their UV islands and paint.
from mathutils import Matrix
for index,progress in enumerate([.035,.325,.645]):
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(OUT/'tidal-pump-gantry.glb'))
    added=[o for o in bpy.context.scene.objects if o not in before]
    st=station(progress*route['length']);t=Vector((st['t'][0],-st['t'][2],st['t'][1])).normalized()
    right=t.cross(Vector((0,0,1))).normalized();up=right.cross(t).normalized()
    transform=Matrix((right,-t,up)).transposed().to_4x4();transform.translation=Vector((st['p'][0],-st['p'][2],st['p'][1]))
    for obj in added:
        if obj.parent is None:obj.matrix_world=transform@obj.matrix_world
    bpy.context.view_layer.update()
    for obj in added:
        if obj.type=='MESH':
            matrix=obj.matrix_world.copy();obj.parent=None;obj.data.transform(matrix);obj.matrix_world=Matrix.Identity(4)
            obj.name=f'GW_GANTRY_{index}_'+obj.name
            # Reuse the five atlas roles across all imported instances.
            for slot in obj.material_slots:
                slot.material=materials[slot.material.name.split('.')[0]]
            # Whole gantry wear varies by instance, while atlas detail remains authoritative.
            uv=obj.data.uv_layers.active
            role=obj.data.materials[0].name if obj.data.materials else ''
            if uv and index and any(r in role for r in ['metal','concrete','signage']):
                for coord in uv.data:
                    u,v=coord.uv
                    if u<.5 and v>.5:
                        coord.uv=(u+.5,v) if index==1 else (u,v-.5)
            colors=obj.data.color_attributes.active_color
            if colors:
                for c in colors.data:c.color=(1-index*.035,1-index*.028,1-index*.02,1)
    for x in [-15,-5,5]:
        p=transform@Vector((x,-2.9,16.088));lights.append({'p':[p.x,p.z,-p.y],'color':AMBER,'size':2.4,'ground':st['p'][1]+.035})
    placements.append({'kind':'gantry','progress':progress,'variant':index,'damaged':index==2})
    instance_markers.append(('gantries',index+1,tuple(transform.translation)))

# A shallow silt bed emerges above the final -27m tide. Depressions remain wet;
# the outer channel stays deep enough for the ferry. Always below either road.
grid=32;vertices=[];faces=[]
for j in range(grid+1):
    for i in range(grid+1):
        x=-850+i*1700/grid;y=-850+j*1700/grid
        radius=math.sqrt((x/850)**2+(y/700)**2)
        height=-26.0+.35*math.sin(x*.027)*math.cos(y*.031)
        height-=1.7*max(0,math.sin(x*.037+y*.015))**8
        height-=12*min(1,max(0,(radius-1)*3))
        # Preserve the working ferry channel through the exposed harbour shoal.
        height-=14*math.exp(-((y+510)/36)**4)
        vertices.append((x,y,height))
for j in range(grid):
    for i in range(grid):
        a=j*(grid+1)+i;faces.append((a,a+1,a+grid+2,a+grid+1))
mesh=bpy.data.meshes.new('GW_GEO_BASIN');mesh.from_pydata(vertices,[],faces)
mesh.materials.append(materials[CONCRETE]);uv=mesh.uv_layers.new(name='UVMap')
for polygon in mesh.polygons:
    for loop in polygon.loop_indices:
        p=mesh.vertices[mesh.loops[loop].vertex_index].co
        uv.data[loop].uv=((p.x+850)/48,(p.y+850)/48)
col=mesh.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='CORNER')
for c in col.data:c.color=(.4,.44,.35,1)
obj=bpy.data.objects.new('GW_SECTOR_BASIN',mesh);bpy.context.collection.objects.link(obj)
for obj in list(bpy.context.scene.objects):
    if obj.type!='MESH':bpy.data.objects.remove(obj,do_unlink=True)
for index,lamp_data in enumerate(lights):
    p=lamp_data['p'];instance_markers.append(('lightAnchors',index+1,(p[0],-p[2],p[1])))
for kind,index,position in instance_markers:
    marker=bpy.data.objects.new(f'TL_INSTANCE_{kind}_{index:03d}',None)
    marker['tidelineInstanceKind']=kind;marker.location=position;bpy.context.collection.objects.link(marker)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/tideline_foundry.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'foundry_world.glb'),export_format='GLB',export_extras=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_yup=True,export_animations=False,export_lights=False,export_cameras=False)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH')
(OUT/'lights.json').write_text(json.dumps(lights))
(OUT/'placements.json').write_text(json.dumps(placements,indent=2))
(OUT/'manifest.json').write_text(json.dumps({'name':'Tideline / tide rebuild','triangles':triangles,'routeLength':route['length'],'routeCount':route['count'],
 'roles':['concrete','metal','jungle','water','signage','emissive'],'atlasSize':1024,'gantries':3,'lightAnchors':len(lights),'census':census,'source':'art/blender/build_tideline.py'},indent=2))
print('TIDE WORLD',triangles,'triangles',census,len(lights),'lights')
