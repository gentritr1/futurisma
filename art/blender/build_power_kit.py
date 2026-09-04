"""Mechanical powers, refined after inspecting art/references/power-kit/multiview-refinement.png."""
import bpy, json, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/power-kit';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0

def mat(name,color,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*color,1)
    s.inputs['Roughness'].default_value=.44;s.inputs['Metallic'].default_value=.35
    s.inputs['Emission Color'].default_value=(*color,1);s.inputs['Emission Strength'].default_value=emission
    return m
ALLOY=mat('PK_alloy',(.12,.18,.22));SILVER=mat('PK_ceramic',(.48,.59,.59))
COPPER=mat('PK_copper',(.55,.21,.045));CYAN=mat('PK_surge_light',(.10,.86,.92),2.4)
PURPLE=mat('PK_shield_light',(.55,.17,.96),2.2)
def coord(p):return(p[0],-p[2],p[1])
def empty(name,parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;return o
class Mesh:
    def __init__(self,name,material,parent):self.name=name;self.material=material;self.parent=parent;self.v=[];self.f=[]
    def box(self,c,s):
        n=len(self.v)
        self.v += [coord((c[0]+x*s[0]/2,c[1]+y*s[1]/2,c[2]+z*s[2]/2)) for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        self.f += [tuple(n+i for i in q) for q in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]
    def beam(self,start,end,width,depth=None):
        # A rectangular member follows two endpoints without leaving floating joints.
        first=len(self.v);a=Vector(start);b=Vector(end);axis=(b-a).normalized()
        reference=Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))
        across=axis.cross(reference).normalized()*width/2
        normal=axis.cross(across).normalized()*(depth or width)/2
        for center in [a,b]:
            for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:self.v.append(coord(center+across*x+normal*y))
        self.f += [tuple(first+i for i in q) for q in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]
    def barrel(self,center,axis,radius,length,sides=8):
        first=len(self.v);direction=Vector(axis).normalized();c=Vector(center)
        reference=Vector((0,1,0)) if abs(direction.y)<.9 else Vector((1,0,0))
        u=direction.cross(reference).normalized();v=direction.cross(u).normalized()
        for end in [-1,1]:
            for i in range(sides):
                angle=i*math.tau/sides
                self.v.append(coord(c+direction*length/2*end+radius*(u*math.cos(angle)+v*math.sin(angle))))
        self.f += [tuple(first+i for i in reversed(range(sides))),tuple(first+sides+i for i in range(sides))]
        for i in range(sides):self.f.append((first+i,first+(i+1)%sides,first+sides+(i+1)%sides,first+sides+i))
    def shroud(self,angle,y0,y1,a0,a1):
        # Flared armor patch. Separate patches leave genuine open cooling slots.
        first=len(self.v);segments=3
        for i in range(segments+1):
            a=angle+a0+(a1-a0)*i/segments
            for y,inset in [(y0,0),(y0,-.055),(y1,0),(y1,-.055)]:
                radius=.58-(y+.53)*.20+inset
                self.v.append(coord((math.cos(a)*radius,y,math.sin(a)*radius)))
        for i in range(segments):
            a=first+i*4;b=a+4
            self.f += [(a,b,b+2,a+2),(a+1,a+3,b+3,b+1),(a,a+1,b+1,b),(a+2,b+2,b+3,a+3)]
        self.f += [(first,first+2,first+3,first+1),(first+12,first+13,first+15,first+14)]
    def ring(self,r,t,y,h,segments=24,start=0,end=math.tau):
        n=len(self.v)
        for i in range(segments+1):
            a=start+(end-start)*i/segments
            for radius,dy in [(r-t/2,-h/2),(r+t/2,-h/2),(r-t/2,h/2),(r+t/2,h/2)]:self.v.append(coord((math.cos(a)*radius,y+dy,math.sin(a)*radius)))
        for i in range(segments):
            a=n+i*4;b=a+4;self.f +=[(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a,b,a+2+4,a+2),(a+1,a+3,b+3,b+1)]
        self.f +=[(n,n+2,n+3,n+1),(n+segments*4,n+segments*4+1,n+segments*4+3,n+segments*4+2)]
    def crystal(self,r,y,h,sides=6):
        n=len(self.v);self.v +=[coord((0,y-h/2,0)),coord((0,y+h/2,0))]
        for i in range(sides):
            a=i*math.tau/sides;self.v.append(coord((r*math.cos(a),y,r*math.sin(a))))
        for i in range(sides):self.f +=[(n,n+2+(i+1)%sides,n+2+i),(n+1,n+2+i,n+2+(i+1)%sides)]
    def plate(self,a):
        # Each broad hex petal has a chamfered nose and inset light gap.
        n=len(self.v);c,s=math.cos(a),math.sin(a)
        for dy in [-.05,.05]:
            for x,z in [(.36,-.16),(.62,-.20),(.86,-.10),(.86,.10),(.62,.20),(.36,.16)]:self.v.append(coord((x*c-z*s,.08+dy,x*s+z*c)))
        self.f +=[tuple(n+i for i in reversed(range(6))),tuple(n+6+i for i in range(6))]
        for i in range(6):self.f.append((n+i,n+(i+1)%6,n+6+(i+1)%6,n+6+i))
    def finish(self):
        m=bpy.data.meshes.new(self.name);m.from_pydata(self.v,[],self.f);m.materials.append(self.material);m.update()
        o=bpy.data.objects.new(self.name,m);bpy.context.collection.objects.link(o);o.parent=self.parent;return o
root=empty('PowerKit')
surge=empty('PK_surge',root)
cage=Mesh('PK_surge_cage',ALLOY,surge)
for y in [-.53,.53]:cage.ring(.54,.11,y,.11)
for i in range(3):
    a=i*math.tau/3;cage.box((math.cos(a)*.51,0,math.sin(a)*.51),(.13,1.12,.13))
    # Reference refinement: three vented lower shrouds retain the exposed core.
    for y0,y1 in [(-.53,-.43),(-.365,-.29),(-.225,-.14)]:cage.shroud(a,y0,y1,-.34,.34)
    for a0,a1 in [(-.34,-.27),(.27,.34)]:cage.shroud(a,-.43,-.14,a0,a1)
cage.finish()
capacitors=Mesh('PK_surge_capacitors',COPPER,surge)
for y in [-.38,-.19,0,.19,.38]:capacitors.ring(.31,.12,y,.075,18)
capacitors.finish()
core=Mesh('PK_surge_core',CYAN,surge);core.crystal(.23,0,1.15,8)
for y in [-.56,.56]:core.ring(.41,.035,y,.02,24)
core.finish()
mount=Mesh('PK_surge_mount',SILVER,surge)
mount.ring(.34,.15,-.72,.10,12);mount.box((0,-.63,0),(.14,.17,.14));mount.box((0,.66,0),(.12,.17,.12))
for side in [-1,1]:mount.box((side*.42,-.72,0),(.24,.08,.12))
for i in range(3):
    a=i*math.tau/3
    mount.beam((math.cos(a)*.08,.64,math.sin(a)*.08),(math.cos(a)*.45,.57,math.sin(a)*.45),.075,.06)
for i in range(6):
    a=i*math.tau/6
    mount.barrel((math.cos(a)*.37,-.76,math.sin(a)*.37),(0,1,0),.036,.055,6)
for side in [-1,1]:
    mount.box((side*.53,-.72,0),(.11,.18,.24))
    mount.barrel((side*.595,-.72,0),(1,0,0),.046,.03,6)
mount.finish()
shield=empty('PK_shield',root)
housing=Mesh('PK_shield_housing',ALLOY,shield)
housing.ring(.39,.105,-.12,.22,6);housing.ring(.48,.08,-.30,.09,6)
housing.box((0,-.55,0),(.18,.38,.18));housing.ring(.32,.13,-.76,.08,6)
for i in range(6):
    a=i*math.tau/6;radial=Vector((math.cos(a),0,math.sin(a)));tangent=Vector((-math.sin(a),0,math.cos(a)))
    housing.beam(radial*.27+Vector((0,-.29,0)),radial*.63+Vector((0,-.06,0)),.11,.12)
    # Rear/sides expose two real horizontal vent openings between three ribs.
    for y in [-.34,-.245,-.15]:
        center=radial*.425+Vector((0,y,0))
        housing.beam(center-tangent*.15,center+tangent*.15,.047,.075)
for side in [-1,1]:housing.box((side*.39,-.76,0),(.14,.13,.20))
housing.finish()
petals=Mesh('PK_shield_petals',SILVER,shield)
for i in range(6):
    a=i*math.tau/6;petals.plate(a)
    # Visible hinge barrels travel with the deployed iris, under each plate root.
    petals.barrel((math.cos(a)*.43,-.04,math.sin(a)*.43),(-math.sin(a),0,math.cos(a)),.075,.24,8)
    petals.beam((math.cos(a)*.44,-.045,math.sin(a)*.44),(math.cos(a)*.67,.055,math.sin(a)*.67),.09,.07)
petals.finish()
light=Mesh('PK_shield_core',PURPLE,shield);light.crystal(.27,.15,.78,6)
for i in range(6):
    a=i*math.tau/6;light.box((math.cos(a)*.58,.15,math.sin(a)*.58),(.085,.06,.085))
light.ring(.34,.025,.03,.025,6);light.finish()
lattice=Mesh('PK_shield_lattice',PURPLE,shield)
for y,r in [(.43,.22),(.59,.14)]:lattice.ring(r,.021,y,.025,6)
lattice.finish()
objects=[root,*root.children_recursive]
tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects if o.type=='MESH')
assert tris<=4000,tris
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(OUT/'power_kit.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
(OUT/'manifest.json').write_text(json.dumps({'name':'Surge turbine and Phase iris projector','triangles':tris,'meshes':8,'materials':5,'textures':0,'groups':['PK_surge','PK_shield'],'source':'art/blender/build_power_kit.py','refinementReference':'art/references/power-kit/multiview-refinement.png','refinements':['three vented flared turbine shrouds','three-prong aperture crown','bolted docking cleats','six articulated iris hinge barrels','six projector support arms','open housing vents']},indent=2)+'\n')
# Inspection scene: the device on the right is shown deployed.
surge.location.x=-1.15;shield.location.x=1.15
bpy.data.objects['PK_shield_petals'].scale=(1.22,1.22,1)
bpy.ops.object.camera_add(location=(4,-6,4.3));cam=bpy.context.object
cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=5.2
scene=bpy.context.scene;scene.camera=cam
for pos,energy,size in [((2,-3,6),950,4),((-4,1,3),750,4)]:
    bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=energy;o.data.size=size;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Power kit studio');scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.018,.026,.040,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.3
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/power_kit.blend'))
bpy.ops.render.render(write_still=True)
print(f'Power kit: {tris} triangles, 8 mesh batches, 5 materials, no textures')

# A second review render shows the same devices deployed on the accepted craft.
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/totem/models/totem_runtime.glb'))
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/totem-evolution/totem_evolution.glb'))
for obj in bpy.data.objects:
    if obj.name=='collision_proxy':obj.hide_render=True
for obj,side in [(surge,-1),(shield,1)]:
    obj.location=coord((side*.78,1.1,-.05));obj.rotation_euler.x=math.pi/2;obj.scale=(.62,.62,.62)
for side in [-1,1]:
    for depth in [-.14,.14]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=.075,depth=.435,location=coord((side*.78,.5975,-.05+depth)))
        bpy.context.object.data.materials.append(ALLOY)
cam.location=(4.5,-8,3.5);cam.rotation_euler=(Vector((0,0,.3))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=8.7
scene.render.filepath=str(OUT/'vehicle-preview.png');bpy.ops.render.render(write_still=True)
