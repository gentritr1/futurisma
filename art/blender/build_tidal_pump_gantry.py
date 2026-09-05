"""Foundry service portal. References are inspected before this modeling pass.

Rebuild: Blender --background --factory-startup --python this_file.py
Runtime uses indexed geometry and painted vertex colours; reference images never export.
"""
import bpy
import hashlib
import json
import math
import struct
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/tideline-foundry'
REF = ROOT / 'art/references/tideline-foundry'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0

def to_blender(p):
    return (p[0], -p[2], p[1])

def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

COLORS = {
    'concrete': (.70, .65, .52),
    'metal': (.35, .39, .29),
    'jungle': (.16, .25, .13),
    'signage': (.76, .72, .51),
    'emissive': (.85, .54, .16),
}

def make_material(role):
    material = bpy.data.materials.new('GW_MAT_' + role)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = 1
    shader.inputs['Metallic'].default_value = 0
    image = bpy.data.images.load(str(OUT / 'textures' / (role + '.jpg')), check_existing=True)
    image.pack()
    texture = material.node_tree.nodes.new('ShaderNodeTexImage'); texture.image = image
    material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    if role == 'emissive':
        material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value = .7
    if role in ['jungle', 'signage']:
        material.surface_render_method = 'DITHERED'
        material['gltf_alpha_mode'] = 'MASK'
        material.alpha_threshold = .5
    material.diffuse_color = (*COLORS[role], 1)
    return material

materials = {role: make_material(role) for role in COLORS}
runtime = bpy.data.collections.new('GW_RUNTIME_TIDAL_PUMP')
bpy.context.scene.collection.children.link(runtime)
root = bpy.data.objects.new('GW_LM_TIDAL_PUMP_GANTRY', None)
runtime.objects.link(root)
parts = []

def part(name, category, center):
    marker = bpy.data.objects.new(name, None)
    runtime.objects.link(marker)
    marker.parent = root
    marker.location = to_blender(center)
    marker['part_role'] = category
    parts.append({'name': name, 'role': category, 'center': list(center)})

class Batch:
    def __init__(self, role):
        self.role = role
        self.vertices = []
        self.faces = []
        self.colors = []
        self.uvs = []
        self.region = 0

    def mesh(self, vertices, faces, color=None, region=None):
        start = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(start + i for i in face) for face in faces)
        self.colors.extend([color or COLORS[self.role]] * len(vertices))
        tile=self.region if region is None else region
        for face in faces:
            points=[Vector(vertices[i]) for i in face]
            normal=(points[1]-points[0]).cross(points[2]-points[0])
            axis=max(range(3),key=lambda i:abs(normal[i]))
            axes=[i for i in range(3) if i!=axis]
            if 1 in axes: axes=[next(i for i in axes if i!=1),1]
            mins=[min(p[a] for p in points) for a in axes]; spans=[max(p[a] for p in points)-mins[j] for j,a in enumerate(axes)]
            for point in points:
                u=(point[axes[0]]-mins[0])/max(.001,spans[0]);v=(point[axes[1]]-mins[1])/max(.001,spans[1])
                self.uvs.append(((tile%2)*.5+.014+u*.472,(1-tile//2)*.5+.014+v*.472))

    def box(self, center, size, color=None):
        vertices = [(center[0]+x*size[0]/2, center[1]+y*size[1]/2, center[2]+z*size[2]/2)
                    for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        self.mesh(vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], color)

    def beam(self, start, end, width, depth=None, color=None):
        a, b = Vector(start), Vector(end)
        direction = (b-a).normalized()
        reference = Vector((0,1,0)) if abs(direction.y) < .9 else Vector((1,0,0))
        across = direction.cross(reference).normalized() * width/2
        normal = direction.cross(across).normalized() * (depth or width)/2
        vertices = [tuple(center+across*x+normal*y) for center in [a,b] for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        self.mesh(vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], color, region=3)

    def cylinder(self, center, radius, length, axis=(0,0,1), sides=12, color=None):
        direction = Vector(axis).normalized()
        reference = Vector((0,1,0)) if abs(direction.y)<.9 else Vector((1,0,0))
        u = direction.cross(reference).normalized()
        v = direction.cross(u).normalized()
        vertices = [tuple(Vector(center)+direction*end*length/2+radius*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides)))
                    for end in [-1,1] for i in range(sides)]
        faces = [tuple(reversed(range(sides))), tuple(sides+i for i in range(sides))]
        faces += [(i,(i+1)%sides,sides+(i+1)%sides,sides+i) for i in range(sides)]
        self.mesh(vertices, faces, color)

    def tapered_foot(self, x):
        corners = [(-.82,-1),(.82,-1),(1,-.82),(1,.82),(.82,1),(-.82,1),(-1,.82),(-1,-.82)]
        vertices = [(x+u*width/2,y,v*depth/2) for y,width,depth in [(0,4.8,8),(2.9,3.8,6.8),(3.4,3.4,6.2)] for u,v in corners]
        faces = [tuple(reversed(range(8))), tuple(16+i for i in range(8))]
        faces += [(j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i) for j in range(2) for i in range(8)]
        self.mesh(vertices, faces)

    def finish(self):
        mesh = bpy.data.meshes.new('GW_GEO_TIDAL_PUMP_' + self.role)
        mesh.from_pydata([to_blender((p[0],p[1],-p[2])) for p in self.vertices], [], [tuple(reversed(f)) for f in self.faces])
        mesh.materials.append(materials[self.role])
        mesh.update()
        uv = mesh.uv_layers.new(name='UVMap')
        col = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                # Texture carries the wear and baked shading. Vertex colour is
                # only a restrained tint; it cannot darken the painted detail away.
                col.data[loop_index].color = (.96,.96,.93,1)
                uv.data[loop_index].uv = self.uvs[polygon.loop_start + polygon.loop_total - 1 - (loop_index - polygon.loop_start)]
        obj = bpy.data.objects.new('GW_MOD_structure_tidal_pump_' + self.role, mesh)
        runtime.objects.link(obj)
        obj.parent = root
        return obj

batches = {role: Batch(role) for role in COLORS}
concrete, metal, jungle, signage, emissive = [batches[role] for role in COLORS]
rust = (.43,.29,.17)
dark = (.22,.25,.21)
bleached = (.44,.46,.34)

for side in [-1,1]:
    x = side*21
    concrete.region = 0 if side < 0 else 2
    concrete.tapered_foot(x)
    part(f'GW_PART_concrete_foot_{1 if side<0 else 2:02}', 'concrete_foot', (x,1.7,0))
    metal.box((x,11.6,0),(3.2,16.4,5.6))
    metal.box((x,19.9,0),(3.45,.3,5.8),bleached)
    # Broad seams and collar repairs use geometry over the painted atlas.
    for z in [-2.84,2.84]:
        for offset in [-1.38,1.38]: metal.beam((x+offset,3.5,z),(x+offset,19.6,z),.10,.08,rust)
        for y in [3.6,10.8,19.3]: metal.box((x,y,z),(3.25,.12,.10),dark)
    # Exactly one welded repair plate per tower.
    metal.region=1
    metal.box((x,7.8,-2.89),(2.25,2.4,.14),(.28,.30,.28))
    metal.region=0
    part(f'GW_PART_welded_repair_{1 if side<0 else 2:02}', 'repair_plate', (x,7.8,-2.89))
    for y in [6.6,9.0]: metal.box((x,y,-2.99),(2.32,.085,.07),rust)
    for offset in [-1.14,1.14]: metal.box((x+offset,7.8,-2.99),(.085,2.4,.07),rust)
    for y in [6.85,8.75]:
        for offset in [-.89,.89]: metal.cylinder((x+offset,y,-3.05),.07,.10,sides=6,color=rust)
    # Human-scale identity plate. Largest painted letters are below 0.3 m.
    signage.region = 0 if side < 0 else 1
    signage.box((x,5.3,-2.88),(1.3,.62,.035))
    # Small irregular moss drapes; the concrete atlas supplies the broad damp foot.
    jungle.region=side%3
    for z in [-3.7,3.7]:
        jungle.box((x-1.8,.55,z),(.45,1.05,.08))

# Three parallel trusses are at the SAME elevation, not stacked in the opening.
for truss,z in enumerate([-2.9,0,2.9],1):
    part(f'GW_PART_overhead_truss_{truss:02}', 'overhead_truss', (0,16.7,z))
    for y in [15.2,18.2]: metal.beam((-19.4,y,z),(19.4,y,z),.48,.45,bleached if y>18 else None)
    count=20
    for i in range(count):
        x0=-19.4+38.8*i/count
        x1=-19.4+38.8*(i+1)/count
        metal.beam((x0,15.4 if i%2==0 else 18.0,z),(x1,18.0 if i%2==0 else 15.4,z),.31,.31)
for x in [-19.3,-9.7,0,9.7,19.3]:
    for y in [15.2,18.2]: metal.beam((x,y,-2.9),(x,y,2.9),.35,.35)

# The side pump stays wholly outside the racing corridor.
part('GW_PART_side_pump_drum_01','pump_drum',(25.2,9.4,0))
for y in [7.0,11.9]: metal.beam((22.4,y,0),(25.5,y,0),.42,.5,dark)
metal.cylinder((25.2,9.4,0),2.1,4.2,sides=16)
for z in [-2.2,2.2]:
    metal.cylinder((25.2,9.4,z),2.25,.24,sides=16,color=dark)
    metal.cylinder((25.2,9.4,z+(-.15 if z<0 else .15)),1.75,.12,sides=16,color=bleached)
for i in range(6):
    angle=i*math.tau/6
    x=25.2+math.cos(angle)*1.6
    y=9.4+math.sin(angle)*1.6
    metal.cylinder((x,y,-2.47),.12,.15,sides=6,color=rust)
metal.cylinder((25.2,9.4,-2.65),.42,.4,sides=8,color=dark)

# Front-facing exterior ladder: its rungs must read from the hero chase camera.
part('GW_PART_ladder_01','ladder',(-23.1,11.7,-3.3))
for x in [-23.65,-22.55]: metal.beam((x,3.7,-3.3),(x,19.5,-3.3),.13,.13,bleached)
for i in range(26): metal.beam((-23.65,3.8+i*.6,-3.3),(-22.55,3.8+i*.6,-3.3),.10,.10,bleached)
for y in [5,9.5,14,18.5]:
    for i in range(8):
        a=i*math.pi/8;b=(i+1)*math.pi/8
        metal.beam((-23.1+math.cos(a)*.66,y,-3.3-math.sin(a)*.66),(-23.1+math.cos(b)*.66,y,-3.3-math.sin(b)*.66),.075,.075)

# Four physical lamp heads. The last is dead, so only three lenses are emissive.
for lamp,x in enumerate([-15,-5,5,15],1):
    part(f'GW_PART_caged_lamp_{lamp:02}', 'lamp_working' if lamp<4 else 'lamp_dead', (x,13.8,-2.9))
    metal.beam((x,15.2,-2.9),(x,14.45,-2.9),.15,.15)
    metal.cylinder((x,14.4,-2.9),.50,.28,axis=(0,1,0),sides=8,color=dark)
    target=emissive if lamp<4 else metal
    target.cylinder((x,13.8,-2.9),.35,.85,axis=(0,1,0),sides=8,color=None if lamp<4 else (.12,.14,.12))
    metal.cylinder((x,13.28,-2.9),.43,.15,axis=(0,1,0),sides=8,color=dark)
    for i in range(6):
        a=i*math.tau/6
        metal.beam((x+math.cos(a)*.43,13.27,-2.9+math.sin(a)*.43),(x+math.cos(a)*.43,14.35,-2.9+math.sin(a)*.43),.055,.055,dark)

# Match the hero's taller silhouette while preserving the 36 m open portal.
# Concrete feet retain their scale; the steelwork above them gains height.
def hero_height(y): return y if y <= 3.4 else 3.4 + (y-3.4)*1.22
for batch in batches.values():
    batch.vertices=[(x,hero_height(y),z) for x,y,z in batch.vertices]
for entry in parts:
    entry['center'][1]=hero_height(entry['center'][1])
    x,y,z=entry['center']
    bpy.data.objects[entry['name']].location=to_blender((x,y,-z))
objects = [batch.finish() for batch in batches.values()]
triangles = sum(sum(len(face.vertices)-2 for face in obj.data.polygons) for obj in objects)
assert triangles <= 5500, triangles
positions = [p for batch in batches.values() for p in batch.vertices]
for x,y,z in positions:
    assert abs(x)>=18 or y>=12.5, f'Portal intrusion at {(x,y,z)}'
minimum = [min(p[axis] for p in positions) for axis in range(3)]
maximum = [max(p[axis] for p in positions) for axis in range(3)]
bpy.ops.object.select_all(action='DESELECT')
for obj in list(runtime.objects): obj.select_set(True)
bpy.context.view_layer.objects.active=root
asset_path=OUT/'tidal-pump-gantry.glb'
bpy.ops.export_scene.gltf(filepath=str(asset_path),export_format='GLB',export_vertex_color='ACTIVE',export_all_vertex_colors=False,use_selection=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_attributes=True)
# glTF has no vertex-colour input for emissiveFactor. Preserve the intended amber
# explicitly, and normalize role alpha modes instead of relying on Blender's inference.
blob=asset_path.read_bytes()
json_size=struct.unpack_from('<I',blob,12)[0]
gltf=json.loads(blob[20:20+json_size])
for material in gltf['materials']:
    role=material['name'].removeprefix('GW_MAT_')
    material['alphaMode']='MASK' if role in ['jungle','signage'] else 'OPAQUE'
    if role in ['jungle','signage']: material['alphaCutoff']=.5
    if role=='emissive': material['emissiveFactor']=[.7,.7,.7]
json_bytes=json.dumps(gltf,separators=(',',':')).encode()
json_bytes+=b' '*((-len(json_bytes))%4)
tail=blob[20+json_size:]
asset_path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(json_bytes)+len(tail))+struct.pack('<II',len(json_bytes),0x4e4f534a)+json_bytes+tail)
manifest = {
    'name':'Tidal Pump Gantry','root':root.name,'coordinates':'metres, +Y up, local X across route, +Z along route',
    'triangles':triangles,'primitives':len(objects),'materials':[m.name for m in materials.values()],
    'textures':len(materials),'bounds':{'min':minimum,'max':maximum},'minimumCentralClearance':hero_height(13.205),
    'minimumSupportLateral':18.6,'parts':[{**p,'center':[p['center'][0],p['center'][1],-p['center'][2]]} for p in parts],'source':'art/blender/build_tidal_pump_gantry.py',
    'referenceDirectory':'art/references/tideline-foundry','bytes':asset_path.stat().st_size,
    'sha256':hashlib.sha256(asset_path.read_bytes()).hexdigest(),
    'referenceCalibration':'Imagegen orthographic panels have scale drift. Imported plane crops calibrated to 46m width, 20m height, 8m depth. Hero silhouette calibrated to 23.7m overall height; feet retain their metre scale. All three trusses share elevation.'
}
(OUT/'tidal-pump-gantry-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

# Editable image planes are packed into the Blender source and excluded from export.
reference_collection=bpy.data.collections.new('REFERENCE_PLANES_NOT_EXPORTED')
bpy.context.scene.collection.children.link(reference_collection)
def reference_plane(name,file,vertices,crop=(0,0,1,1)):
    image=bpy.data.images.load(str(REF/file),check_existing=True)
    image.pack()
    material=bpy.data.materials.new(name+'_image');material.use_nodes=True
    nodes=material.node_tree.nodes;nodes.clear()
    texture=nodes.new('ShaderNodeTexImage');texture.image=image
    emission=nodes.new('ShaderNodeEmission');output=nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(texture.outputs['Color'],emission.inputs['Color'])
    material.node_tree.links.new(emission.outputs[0],output.inputs[0])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([to_blender(p) for p in vertices],[],[(0,1,2,3)])
    mesh.materials.append(material);uv=mesh.uv_layers.new()
    u0,v0,u1,v1=crop
    for i,p in enumerate([(u0,v0),(u1,v0),(u1,v1),(u0,v1)]):uv.data[i].uv=p
    obj=bpy.data.objects.new(name,mesh);reference_collection.objects.link(obj);obj.hide_render=True
    obj['purpose']='Imported image plane calibrated to metre dimensions; reference only.'
reference_plane('REF_ORTHO_FRONT','tidal-pump-orthographic.png',[(-23,0,6),(23,0,6),(23,20,6),(-23,20,6)],(28/1774,1-608/887,681/1774,1-225/887))
reference_plane('REF_ORTHO_SIDE','tidal-pump-orthographic.png',[(30,0,-4),(30,0,4),(30,20,4),(30,20,-4)],(910/1774,1-608/887,1000/1774,1-225/887))
reference_plane('REF_ORTHO_TOP','tidal-pump-orthographic.png',[(-23,-2,-4),(23,-2,-4),(23,-2,4),(-23,-2,4)],(1245/1774,1-616/887,1720/1774,1-519/887))
reference_plane('REF_HERO','tidal-pump-hero.png',[(40,0,8),(88,0,8),(88,32,8),(40,32,8)])
reference_plane('REF_MATERIAL_ID','tidal-pump-material-id.png',[(95,0,8),(149,0,8),(149,27,8),(95,27,8)])
reference_collection.hide_render=True
reference_collection.hide_viewport=True

scene=bpy.context.scene
scene.world=bpy.data.worlds.new('Foundry humid studio');scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.25,.28,.25,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.7
bpy.ops.object.camera_add(location=to_blender((4,2.4,74)))
camera=bpy.context.object;camera.name='CAM_CHASE_HERO'
camera.rotation_euler=(Vector(to_blender((0,9.5,0)))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=39;scene.camera=camera
for position,energy,size in [((-15,28,-22),14000,32),((12,22,14),9500,24)]:
    bpy.ops.object.light_add(type='AREA',location=to_blender(position))
    light=bpy.context.object;light.data.energy=energy;light.data.size=size
    light.rotation_euler=(Vector(to_blender((0,9,0)))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1536;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard'
scene.render.image_settings.file_format='WEBP'
scene.render.image_settings.quality=86
scene.render.filepath=str(OUT/'tidal-pump-gantry-preview.webp')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/tidal_pump_gantry.blend'))
bpy.ops.render.render(write_still=True)
scene.render.image_settings.file_format='PNG'
bpy.data.images['Render Result'].save_render(str(REF/'tidal-pump-gantry-preview.png'),scene=scene)
print(f'Tidal Pump Gantry: {triangles} triangles, {len(objects)} material batches, painted role atlases, bounds {minimum}..{maximum}')
