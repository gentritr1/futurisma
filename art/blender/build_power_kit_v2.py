"""V4 salvaged pump hardware authored from the orthographic/hero/ID triplet.
Y-up input, batched atlas geometry, real turbine and individual iris pivots.
Legacy pivot names are a runtime interface only; no legacy shapes are reused.
"""
import bpy, json, math
from itertools import product, combinations
from mathutils.bvhtree import BVHTree
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/power-kit-v2';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0

def material(role):
    m=bpy.data.materials.new('GW_MAT_'+role);m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF');shader.inputs['Roughness'].default_value=.88;shader.inputs['Metallic'].default_value=0
    path=OUT/'textures'/f'{role}.jpg' if role in ['signage','metal','emissive'] else ROOT/'public/assets/tideline-foundry/textures'/f'{role}.jpg'
    texture=m.node_tree.nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(path),check_existing=True);texture.image.pack()
    m.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    if role=='emissive':
        m.node_tree.links.new(texture.outputs['Color'],shader.inputs['Emission Color']);shader.inputs['Emission Strength'].default_value=.9
    return m
METAL=material('metal');CONCRETE=material('concrete');SIGNAGE=material('signage');LIGHT=material('emissive')
def coord(p):return(p[0],-p[2],p[1])
def empty(name,parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;return o
class Mesh:
    def __init__(self,name,material,parent):self.name=name;self.material=material;self.parent=parent;self.v=[];self.f=[];self.smooth=[]
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
        for i in range(sides):
            self.smooth.append(len(self.f));self.f.append((first+i,first+(i+1)%sides,first+sides+(i+1)%sides,first+sides+i))
    def finish(self,tile=0):
        m=bpy.data.meshes.new(self.name);m.from_pydata(self.v,[],self.f);m.materials.append(self.material);m.update()
        for index in self.smooth:m.polygons[index].use_smooth=True
        uv=m.uv_layers.new(name='Painted atlas')
        for poly in m.polygons:
            points=[m.vertices[i].co for i in poly.vertices]
            axis=max(range(3),key=lambda a:abs(poly.normal[a]));axes=[a for a in range(3) if a!=axis]
            lo=[min(v[a] for v in points) for a in axes];span=[max(v[a] for v in points)-lo[j] for j,a in enumerate(axes)]
            for loop,point in zip(poly.loop_indices,points):
                u=(point[axes[0]]-lo[0])/max(.00001,span[0]);v=(point[axes[1]]-lo[1])/max(.00001,span[1])
                if self.material==METAL:
                    u=max(.03,min(.97,point[axes[0]]*.45+.5));v=max(.03,min(.97,point[axes[1]]*.45+.5))
                if self.material==CONCRETE:
                    u=max(.03,min(.97,point[axes[0]]*.4+.5));v=max(.55,min(.97,(point[axes[1]]+.85)*.5+.65))
                uv.data[loop].uv=((tile%2)*.5+.018+u*.464,(1-tile//2)*.5+.018+v*.464)
        o=bpy.data.objects.new(self.name,m);bpy.context.collection.objects.link(o);o.parent=self.parent;return o
    def bevel_box(self,c,s,b=.015):
        half=[n/2 for n in s];b=min(b,min(half)*.3)
        def face(points):
            normal=(Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0]))
            center=sum((Vector(p) for p in points),Vector())/len(points)
            if normal.dot(center)<0:points=list(reversed(points))
            n=len(self.v);self.v.extend(coord(Vector(c)+Vector(p)) for p in points);self.f.append(tuple(range(n,n+len(points))))
        for axis in range(3):
            a,baxis=[i for i in range(3) if i!=axis]
            for sign in [-1,1]:
                pts=[]
                for sa,sb in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                    p=[0,0,0];p[axis]=sign*half[axis];p[a]=sa*(half[a]-b);p[baxis]=sb*(half[baxis]-b);pts.append(p)
                face(pts)
        for a,baxis in combinations(range(3),2):
            other=next(i for i in range(3) if i not in [a,baxis])
            for sa,sb in product([-1,1],repeat=2):
                pts=[]
                for endpoint,edge in [(-1,0),(1,0),(1,1),(-1,1)]:
                    p=[0,0,0];p[a]=sa*(half[a]-(b if edge else 0));p[baxis]=sb*(half[baxis]-(0 if edge else b));p[other]=endpoint*(half[other]-b);pts.append(p)
                face(pts)
        for signs in product([-1,1],repeat=3):
            face([[signs[i]*(half[i]-(0 if i==axis else b)) for i in range(3)] for axis in range(3)])
    def front_ring(self,r,t,z,h,segments=20):
        first=len(self.v)
        for i in range(segments):
            a=i*math.tau/segments
            for radius,dz in [(r-t/2,-h/2),(r+t/2,-h/2),(r-t/2,h/2),(r+t/2,h/2)]:self.v.append(coord((math.cos(a)*radius,math.sin(a)*radius,z+dz)))
        for i in range(segments):
            a=first+i*4;b=first+((i+1)%segments)*4
            self.f += [(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),(a+1,b+1,b+3,a+3)]
    def blade(self,points,z,thickness=.035):
        n=len(self.v);count=len(points)
        for dz in [-thickness/2,thickness/2]:self.v.extend(coord((x,y,z+dz)) for x,y in points)
        self.f += [tuple(n+i for i in reversed(range(count))),tuple(n+count+i for i in range(count))]
        for i in range(count):self.f.append((n+i,n+(i+1)%count,n+count+(i+1)%count,n+count+i))
root=empty('PowerKitPumpWorks')
for kind in ['surge','shield']:
    device=empty('PK_'+kind,root);device['pumpHardware']=True
    frame=Mesh('PK_'+kind+('_mount' if kind=='surge' else '_housing'),METAL,device)
    # A closed crash frame with substantial feet and a visible pump barrel.
    for x in [-.59,.59]:frame.bevel_box((x,-.02,0),(.12,1.35,.78))
    for y in [-.66,.65]:frame.bevel_box((0,y,0),(1.30,.13,.78))
    if kind=='shield':frame.bevel_box((0,0,-.15),(1.08,1.17,.46))
    frame.barrel((0,0,-.12),(0,0,1),.55,.68,20)
    frame.front_ring(.52,.12,.33,.15,24)
    bolts=Mesh('PK_'+kind+'_flange_bolts',METAL,device)
    for i in range(16):
        a=i*math.tau/16;bolts.barrel((.52*math.cos(a),.52*math.sin(a),.447),(0,0,1),.034,.05,6)
    for x in [-.59,.59]:
        for y in [-.60,.60]:
            bolts.box((x,y,.408),(.14,.14,.035));bolts.barrel((x,y,.44),(0,0,1),.023,.04,6)
    bolts.finish(3)
    for side in [-1,1]:
        if kind=='surge':
            frame.barrel((side*.66,0,-.08),(1,0,0),.19,.22,12)
            frame.barrel((side*.72,0,-.08),(1,0,0),.23,.05,12)
            frame.beam((side*.48,-.6,.02),(side*.48,.52,.02),.045)
        else:
            frame.barrel((side*.65,-.03,.16),(0,1,0),.095,.70,10)
            frame.barrel((side*.65,-.04,.16),(0,1,0),.035,1.04,8)
            for y in [-.45,.37]:frame.box((side*.65,y,.16),(.23,.09,.28))
    # Exactly one caged lamp per machine, bolted onto its frame.
    lampX=.52
    frame.barrel((lampX,.73,.02),(0,1,0),.13,.07,10)
    for y in [.79,.94]:
        for i in range(8):
            a=i*math.tau/8;b=(i+1)*math.tau/8
            frame.beam((lampX+.115*math.cos(a),y,.02+.115*math.sin(a)),(lampX+.115*math.cos(b),y,.02+.115*math.sin(b)),.012)
    for i in range(4):
        a=i*math.tau/4
        frame.beam((lampX+.115*math.cos(a),.75,.02+.115*math.sin(a)),(lampX+.115*math.cos(a),.97,.02+.115*math.sin(a)),.014)
    frame.finish(0 if kind=='surge' else 1)
    base=Mesh('PK_'+kind+'_plinth',CONCRETE,device);base.bevel_box((0,-.77,0),(1.40,.18,1.10));base.finish(0)
    lamp=Mesh('PK_'+kind+'_core',LIGHT,device);lamp.barrel((lampX,.85,.02),(0,1,0),.085,.20,8);lamp.finish(0 if kind=='surge' else 1)
    # Runtime tints the single shared emissive role per instance (amber/cyan).
    plate=Mesh('PK_'+kind+'_stencil',SIGNAGE,device)
    plate.box((.38 if kind=='surge' else -.38,.48,.43),(.40,.29,.035));plate.finish(0 if kind=='surge' else 1)
    if kind=='surge':
        rotor=Mesh('PK_surge_cage',METAL,device)
        for i in range(6):
            a=i*math.tau/6
            pts=[(.12,-.04),(.43,-.12),(.455,.11),(.19,.12)]
            rotor.blade([(x*math.cos(a)-y*math.sin(a),x*math.sin(a)+y*math.cos(a)) for x,y in pts],.37)
        rotor.barrel((0,0,.40),(0,0,1),.14,.10,12);rotor.finish(1)
        gauge=Mesh('PK_surge_capacitors',METAL,device)
        gauge.barrel((-.40,.45,.32),(0,0,1),.115,.06,16);gauge.finish(3)
        needle=Mesh('PK_surge_gauge_needle',METAL,device);needle.beam((-.40,.45,.36),(-.35,.51,.36),.014);
        for i in range(9):
            a=i*math.pi/6-.8
            needle.beam((-.40+.077*math.cos(a),.45+.077*math.sin(a),.357),(-.40+.096*math.cos(a),.45+.096*math.sin(a),.357),.005)
        needle.finish(2)
    else:
        iris=empty('PK_shield_petals',device)
        for i in range(6):
            a=i*math.tau/6
            blade=Mesh('PK_shield_iris_blade_'+str(i),METAL,iris)
            pts=[(0,0),(.20,-.12),(.43,-.08),(.46,.12),(.34,.28),(.11,.19)]
            anchor=Vector((.40*math.cos(a),.40*math.sin(a),0))
            blade.blade([(x*math.cos(a)-y*math.sin(a)-anchor.x,x*math.sin(a)+y*math.cos(a)-anchor.y) for x,y in pts],.40+i*.006,.025)
            part=blade.finish(1);part.location=coord(anchor)
        hydraulics=empty('PK_shield_lattice',device)
        hydraulics['mechanism']='iris actuator'
# Contact AO is baked into a dedicated vertex tint; painted colour remains in
# the role atlases. Sixty-four deterministic hemisphere probes per face corner.
bpy.context.view_layer.update()
for kind in ['surge','shield']:
    device=bpy.data.objects['PK_'+kind];meshes=[o for o in device.children_recursive if o.type=='MESH']
    verts=[];faces=[]
    for obj in meshes:
        offset=len(verts);verts.extend(obj.matrix_world@v.co for v in obj.data.vertices)
        faces.extend(tuple(offset+i for i in poly.vertices) for poly in obj.data.polygons)
    bvh=BVHTree.FromPolygons(verts,faces)
    for obj in meshes:
        colors=obj.data.color_attributes.new(name='Baked contact AO',type='FLOAT_COLOR',domain='CORNER')
        obj.data.color_attributes.active_color=colors
        for poly in obj.data.polygons:
            normal=(obj.matrix_world.to_3x3()@poly.normal).normalized()
            tangent=normal.cross(Vector((0,0,1)))
            if tangent.length<.01:tangent=normal.cross(Vector((1,0,0)))
            tangent.normalize();bitangent=normal.cross(tangent)
            for loop in poly.loop_indices:
                origin=obj.matrix_world@obj.data.vertices[obj.data.loops[loop].vertex_index].co+normal*.004
                hits=0
                for ray in range(64):
                    z=math.sqrt((ray+.5)/64);a=ray*2.399963229728653;r=math.sqrt(1-z*z)
                    direction=normal*z+tangent*(r*math.cos(a))+bitangent*(r*math.sin(a))
                    if bvh.ray_cast(origin,direction,.45)[0] is not None:hits+=1
                ao=1-.72*hits/64
                colors.data[loop].color=(ao,ao,ao,1)
objects=[root,*root.children_recursive]
tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects if o.type=='MESH')
assert tris<=4000,tris
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(OUT/'power_kit.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True,export_vertex_color="ACTIVE")
(OUT/'manifest.json').write_text(json.dumps({'name':'S-07 Surge pump / P-12 Phase bulkhead projector','triangles':tris,'materialRoles':['concrete','metal','signage','emissive'],'allowedMaterialRoles':['concrete','metal','signage','emissive','water','jungle'],'textures':4,'referenceTriplet':'art/references/power-kit-v2','source':'art/blender/build_power_kit_v2.py','lampsPerDevice':1,'pivots':{'surge':'PK_surge_cage','shield':'PK_shield_petals'},'details':{'surge':['chipped rectangular crash frame','six turbine vanes','bolted circular pump flange','pressure gauge','S-07 stencil','single caged amber lamp'],'shield':['grey rectangular pressure case','six overlapping iris blades','bolted circular flange','side hydraulic barrels','P-12 stencil','single caged cyan lamp']}},indent=2)+'\n')
# Saved authoring scene and separate same-camera device renders.
scene=bpy.context.scene;scene.world=bpy.data.worlds.new('Blue hour studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.20,.24,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
bpy.ops.object.camera_add(location=coord((.25,.22,3.8)));cam=bpy.context.object
cam.rotation_euler=(Vector(coord((0,0,0)))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.35;scene.camera=cam
for pos,energy,size in [((1,3,3),170,3),((-2,1,1),95,2)]:
    bpy.ops.object.light_add(type='AREA',location=coord(pos));light=bpy.context.object;light.data.energy=energy;light.data.size=size;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=768;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/power_kit_v2.blend'))
for kind in ['surge','shield']:
    for other in ['surge','shield']:
        for o in [bpy.data.objects['PK_'+other],*bpy.data.objects['PK_'+other].children_recursive]:o.hide_render=kind!=other
    scene.render.filepath=str(OUT/(kind+'-preview.png'));bpy.ops.render.render(write_still=True)
print(f'Pump works hardware: {tris} triangles; four painted atlas roles; exactly one caged lamp per machine.')
