"""Nine original, articulated circuit scenes. Blender 5.x, metres, glTF Y-up.

The shared generated paint atlas keeps the hardware in the same art family.
Each scene has its own job, footprint, structural frame and moving hierarchy.
Static parts are joined by material; articulated parts retain named pivots.
"""
from pathlib import Path
import math
import json
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/circuit-signatures'
OUT.mkdir(parents=True, exist_ok=True)
BLENDS = ROOT / 'art/blender/circuit-signatures'
BLENDS.mkdir(parents=True, exist_ok=True)
atlas = bpy.data.images.load(str(ROOT / 'public/assets/race-polish/timing-atlas.jpg'))
atlas.pack()

def material(name, color, metal=0, rough=.7, texture=False, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if texture:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = atlas
        mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat

paint = material('signature_paint', (1, 1, 1), texture=True)
steel = material('signature_steel', (.21, .28, .29), .5, .5)
glass = material('signature_glass', (.09, .22, .27), .55, .2)
amber = material('signature_amber', (1, .51, .13), emission=.8)
water = material('signature_water', (.17, .34, .32), .4, .22)
deck = material('signature_deck', (.27, .31, .29), 0, .96)
snow = material('signature_snow', (.78, .84, .91), 0, 1)
parts = {}
scene_root = None
kind = ''
SIGN_SIZES = dict(greenwater=(7,1.8),bitterpan=(8,2.4),nightshift=(15,9),polarity=(9,2.5),
                  tideline=(13,8),ascension=(9,2),dreamisland=(8,1.8),afterglow=(10,2),frostline=(13,7))

def group(name, position=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent or scene_root
    obj.location = position
    return obj

def finish(obj, mat, quadrant=0, parent=None):
    obj.data.materials.append(mat)
    if mat == paint and obj.data.uv_layers.active:
        u, v = [(0, .5), (.5, .5), (0, 0), (.5, 0)][quadrant]
        for uv in obj.data.uv_layers.active.data:
            uv.uv = (u + .025 + uv.uv.x * .45, v + .025 + uv.uv.y * .45)
    if parent:
        obj.parent = parent
    else:
        parts.setdefault(mat.name, []).append(obj)
    return obj

def box(pos, size, mat=paint, q=0, parent=None, bevel=.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Edge wear silhouette', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj, mat, q, parent)

def cylinder(pos, radius, depth, mat=steel, q=0, parent=None, axis='Z', vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=pos)
    obj = bpy.context.object
    if axis == 'Y': obj.rotation_euler.x = math.pi / 2
    if axis == 'X': obj.rotation_euler.y = math.pi / 2
    return finish(obj, mat, q, parent)

def sphere(pos, size, mat=paint, q=1, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1, location=pos)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, q, parent)

def ring(pos, radius, tube=.16, mat=steel, parent=None, axis='Y'):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube, major_segments=24, minor_segments=6, location=pos)
    obj = bpy.context.object
    if axis == 'Y': obj.rotation_euler.x = math.pi / 2
    if axis == 'X': obj.rotation_euler.y = math.pi / 2
    return finish(obj, mat, 0, parent)

def beam(a, b, thickness=.18, mat=steel, parent=None):
    av, bv = Vector(a), Vector(b)
    obj = box((av+bv)/2, (thickness, thickness, (bv-av).length), mat, parent=parent, bevel=.02)
    obj.rotation_euler = (bv-av).to_track_quat('Z', 'Y').to_euler()
    return obj

def join(objects, name, parent=None, pivot=(0, 0, 0)):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects)>1: bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.context.scene.cursor.location = pivot
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    obj.parent = parent
    return obj

def frame(width=22, depth=16, floor=True):
    if floor: box((0, 0, -.22), (width, depth, .45), deck)
    # Balanced service perimeter. Front opening reads as access, rear rail as safety.
    for x in [-width/2+.5, width/2-.5]:
        for y in [-depth/2+.5, 0, depth/2-.5]:
            box((x, y, -3.2), (.4, .4, 6.4), steel)
            box((x, y, 1), (.12, .12, 2), steel, bevel=.02)
        box((x, 0, 1.8), (.12, depth-1, .12), steel, bevel=.02)
    for x in [-width/2+2, width/2-2]:
        box((x, depth/2-.5, 2.2), (.25, .25, 4.4), steel)
        box((x, depth/2-.5, 4.4), (1.1, .6, .15), amber)
    box((0, depth/2-.9, .06), (6, 1.6, .1), paint, 3)

def sign_frame(width, y, height):
    width, height = SIGN_SIZES[kind]
    centre = -width/2-1.75 if height<3 else 0
    for x in [centre-width/2-.35, centre+width/2+.35]:
        box((x, y-.15, height/2), (.24, .3, height), steel)
    box((centre, y-.1, height), (width+.9, .4, 1.6), paint, 0)

def propeller(name, pos, radius, parent=None, axis='Y'):
    pivot = group(name, pos, parent)
    for a in [0, math.pi/2]:
        obj = box((0, 0, 0), (.25, .16, radius*2) if axis=='Y' else (.25, radius*2, .16), steel, parent=pivot)
        if axis=='Y': obj.rotation_euler.y = a
        else: obj.rotation_euler.z = a
    cylinder((0, .1, 0) if axis=='Y' else (0, 0, .1), .28, .4, paint, 3, pivot, axis=axis)
    return pivot

def greenwater():
    frame(30, 25, False)
    box((0, -1, -.25), (28, 22, .14), water, bevel=0)
    for x in [-13, 13]: box((x, 0, -.18), (2.5, 25, .45), paint, 1)
    box((0, 11.5, -.18), (28, 2, .45), paint, 1)
    sign_frame(10, 11.7, 5)
    plane = group('survey_plane', (0, -1, -.25))
    sphere((0, 0, 3.5), (1.6, 7.5, 1.5), paint, 1, plane)
    sphere((0, 3.7, 4.45), (1.4, 2.6, .62), glass, parent=plane)
    box((0, 0, 4.9), (25, 3.8, .32), paint, 1, plane)
    for x in [-10, 10]: box((x, 0, 5.08), (3, 3.8, .12), paint, 3, plane)
    box((0, -5.6, 4.2), (9, 2.5, .2), paint, 1, plane)
    box((0, -6.1, 5), (.23, 3.2, 3), paint, 3, plane)
    for x in [-2.5, 2.5]:
        sphere((x, .3, .6), (.75, 6.2, .65), paint, 0, plane)
        for y in [-2, 3]: beam((x, y, 1), (x*.45, y, 3), .19, parent=plane)
        sphere((x*2.4, .4, 4.5), (.8, 2.2, .7), paint, 0, plane)
        propeller('prop_left' if x<0 else 'prop_right', (x*2.4, 2.7, 4.5), 1.5, plane)
    for x in [-13, 13]:
        cylinder((x, 7, 1), .9, 2, paint, 3)
        beam((x, 7, 1), (x*.7, 4, .2), .12)
        ring((x, -8, 1.8), .7, .17, paint)

def bitterpan():
    frame(28, 22)
    sign_frame(11, 10.5, 6)
    for x in [-8, 8]:
        box((x, -2, 4), (.6, 10, 8), steel)
        beam((x, -6, .3), (x, 1, 8), .3)
    cylinder((0, 0, 7), .7, 18, steel, axis='X')
    wheel = group('bucket_wheel', (0, 0, 7))
    ring((0, 0, 0), 5.6, .33, steel, wheel, 'X')
    for i in range(12):
        a = i*math.tau/12
        y, z = math.cos(a)*5.6, math.sin(a)*5.6
        beam((0, 0, 0), (0, y, z), .2, parent=wheel)
        obj = box((0, y, z), (5.4, 1.1, 1.3), paint, 3, wheel)
        obj.rotation_euler.x = a
        box((0, y*.94, z*.94), (4.9, .6, .7), paint, 2, wheel)
    box((0, -7, 2), (6, 8, .55), steel)
    for x in [-3.1, 3.1]: box((x, -7, 2.5), (.23, 8, 1), paint, 1)
    belt = group('conveyor_rollers')
    for y in [-10, -8, -6, -4]: cylinder((0, y, 2.25), .4, 6, steel, parent=belt, axis='X')
    for x in [-9, 9]:
        sphere((x, -7, 1.3), (3, 4, 2), paint, 1)
        box((x, 5, 1.5), (4, 3, 3), paint, 0)

def nightshift():
    frame(26, 16)
    box((0, -1, 4.2), (24, 12, 8.4), paint, 0)
    box((0, 6, 6.9), (27, 3.6, .3), paint, 1)
    for x in [-11, 11]: box((x, 6, 3.4), (.25, .25, 6.8), steel)
    sign_frame(15, 6, 9)
    for i, x in enumerate([-7, 0, 7]):
        box((x, 5.1, 3.3), (6, .35, 4.8), paint, 1)
        cylinder((x, 5.4, 3.5), 1.8, .18, steel, axis='Y')
        cylinder((x, 5.55, 3.5), 1.5, .2, glass, axis='Y')
        drum = group(f'washer_{i}', (x, 5.8, 3.5))
        ring((0, 0, 0), 1.25, .12, steel, drum)
        for a in [0, math.tau/3, 2*math.tau/3]:
            obj = box((math.sin(a)*.7, 0, math.cos(a)*.7), (.65, .12, .45), paint, 3, drum)
            obj.rotation_euler.y = a
        box((x, 5.4, 5.4), (3.8, .1, .28), amber)
    for x in [-11.6, 11.6]:
        cylinder((x, 6, 3.8), .12, 7, steel)
        box((x, 6, .35), (.7, .8, .7), paint, 2)
    for x in [-8, 8]: box((x, 7, .5), (3.5, .7, .6), paint, 1)
    box((0, -2, 8.8), (6, 4, 1.2), steel)
    propeller('roof_fan', (0, -2, 9.5), 1.8, axis='Z')

def polarity():
    frame(24, 20)
    sign_frame(12, 8.7, 3)
    for x in [-9, 9]:
        box((x, 0, 11), (1.3, 3, 22), paint, 1)
        beam((x, -6, 0), (x, 0, 14), .4)
        box((x, 0, 21.5), (5, 5, 1), paint, 0)
        for z in [3, 7, 11, 15, 19]: box((x, 1.57, z), (.9, .08, .4), amber)
    box((0, 0, 11), (18, .7, .7), steel)
    gyro = group('gravity_cradle', (0, 0, 11))
    ring((0, 0, 0), 6.5, .5, paint, gyro)
    ring((0, 0, 0), 4.8, .35, steel, group('gyro_inner', parent=gyro), 'X')
    ring((0, 0, 0), 3.1, .3, paint, group('gyro_core', parent=gyro), 'Z')
    sphere((0, 0, 0), (1.6, 1.6, 1.6), glass, parent=gyro)
    for x in [-5.5, 5.5]:
        box((x, 6, 2), (3, 3, 4), paint, 0)
        cylinder((x, 6, 4.3), .9, .6, paint, 3)

def tideline():
    frame(23, 20)
    sign_frame(13, 8.8, 8)
    for x in [-8.5, 8.5]: box((x, 0, 5.5), (.6, .8, 11), paint, 1)
    box((0, 0, 11), (18, 1.3, .65), paint, 3)
    for x in [-5, 5]:
        box((x, 0, .5), (1.3, 9, 1), steel)
    for x in [-2.5, 2.5]:
        cable=group('rov_cable_left' if x<0 else 'rov_cable_right',(x,0,10.6))
        box((0,0,-2.25),(.1,.1,4.5),steel,parent=cable,bevel=0)
    sub = group('inspection_rov', (0, 0, 2))
    sphere((0, 0, 1.8), (3.6, 4.7, 2.3), paint, 3, sub)
    sphere((0, 3.5, 2), (2.5, 1.5, 1.7), glass, parent=sub)
    for x in [-4, 4]:
        cylinder((x, -1, 1.7), 1.1, 3, steel, parent=sub, axis='Y')
        propeller('thruster_left' if x<0 else 'thruster_right', (x, .6, 1.7), .9, sub)
        beam((x*.65, 3, .4), (x, 5, -.1), .22, parent=sub)
        beam((x, 5, -.1), (x*.6, 6, .2), .15, parent=sub)
        box((x*.6, 6, .2), (.8, .6, .3), steel, parent=sub)
    cylinder((0, 4.9, 2.6), .48, .2, amber, parent=sub, axis='Y')
    for x in [-9.4, 9.4]:
        box((x, 4, 2.5), (2, 3, 5), paint, 0)
        cylinder((x, 4, 5.2), .7, .4, glass)

def ascension():
    frame(28, 21)
    sign_frame(13, 9, 4)
    for x in [-7, 7]:
        for y in [-4, 4]: box((x+(-2 if y<0 else 2), y, 7), (.5, .5, 14), steel)
        cylinder((x, 0, 14.5), 4.5, 6, paint, 1)
        sphere((x, 0, 17.5), (4.5, 4.5, .7), paint, 1)
        ring((x, 0, 12), 4.6, .12, steel, axis='Z')
        cylinder((x, 2.8, 6), .5, 12, paint, 3)
        cylinder((x, 5, 1), .5, 4, paint, 3, axis='Y')
        valve = group('valve_left' if x<0 else 'valve_right', (x, 3.4, 4))
        ring((0, 0, 0), 1.1, .12, paint, valve)
        for a in [0, math.pi/2]:
            obj = box((0, 0, 0), (.12, .15, 2), steel, parent=valve)
            obj.rotation_euler.y = a
        beam((x-2, -4, 0), (x+2, 4, 12), .23)
    box((0, 0, 12), (8, 2, .3), steel)
    for x in [-2, 2]: box((x, 0, 12.9), (.12, 2, 1.8), steel)
    box((0, 6.8, .12), (21, 2.5, .25), glass)

def dreamisland():
    frame(25, 22)
    sign_frame(12, 9.5, 4)
    cylinder((0, -1, 2.8), 7.5, 5.6, paint, 1, vertices=24)
    cylinder((0, -1, 5.7), 7.9, .35, paint, 0, vertices=24)
    # Retraction rails support both shells after they leave the round roof.
    # Paired outriggers tie the rails back to the deck, with visible bracing.
    for y in [-6.2, 4.2]:
        box((0,y,5.65),(27,.3,.24),steel)
        for x in [-12,12]:
            box((x,y,2.8),(.28,.28,5.6),steel)
            box((x,y,.15),(1,1,.3),paint,3)
            beam((x,y,4.8),(x*.7,y,5.5),.16)
    # Two half domes slide apart on the clock's night blend, revealing the lens.
    for side in [-1, 1]:
        shell = group('dome_left' if side<0 else 'dome_right', (0, -1, 5.8))
        vertices, faces = [], []
        for row in range(7):
            elevation=row*math.pi/12
            for column in range(13):
                a=column*math.pi/12+(math.pi if side<0 else 0)
                vertices.append((math.sin(a)*7.4*math.cos(elevation),math.cos(a)*7.4*math.cos(elevation),4.8*math.sin(elevation)))
        for row in range(6):
            for column in range(12):
                i=row*13+column
                faces.append((i,i+13,i+14,i+1))
        mesh=bpy.data.meshes.new('Split observatory dome');mesh.from_pydata(vertices,[],faces);mesh.update()
        obj=bpy.data.objects.new('Dome shell',mesh);bpy.context.collection.objects.link(obj)
        uv=mesh.uv_layers.new()
        for face in mesh.polygons:
            for index in face.loop_indices:
                v=mesh.vertices[mesh.loops[index].vertex_index].co
                uv.data[index].uv=((v.x+7.4)/14.8,(v.y+7.4)/14.8)
        finish(obj,paint,1,shell)
        for y in [-5.2,5.2]:
            cylinder((side*5.2,y,.18),.3,.28,steel,parent=shell,axis='Y',vertices=12)
    telescope = group('star_lens', (0, -1, 5.8))
    cylinder((0, 0, 2), .65, 4, steel, parent=telescope)
    cylinder((0, 2, 4.4), 1.5, 6, paint, 0, telescope, axis='Y')
    cylinder((0, 5.05, 4.4), 1.25, .15, glass, parent=telescope, axis='Y')
    for x in [-9.5, 9.5]:
        box((x, 1, .6), (2.6, 8, .5), paint, 1)
        for y in [-2, 4]: box((x, y, .4), (1.8, .6, .8), paint, 3)
        cylinder((x, -7, 1.4), 1.8, 2.8, paint, 0)

def afterglow():
    frame(26, 20)
    sign_frame(14, 8.7, 4)
    for x in [-9.5, 9.5]:
        box((x, -1, 6.5), (3, 11, 13), paint, 0)
        for z in [2, 5, 8, 11]: box((x, 4.6, z), (2.5, .18, .35), amber)
    for x in [-5, 0, 5]:
        for z in [3, 6, 9]:
            cylinder((x, -1, z), 1.2, 4, paint, 1)
            ring((x, -1, z+1.5), 1.25, .13, steel, axis='Z')
        cylinder((x, -1, 6), .3, 11, steel)
        box((x, 2.5, 6), (.35, .4, 11), paint, 3)
    for x in [-8, 8]:
        fan = group('relay_fan_left' if x<0 else 'relay_fan_right', (x, 5, 9))
        ring((0, 0, 0), 2, .22, steel, fan)
        for a in [0, math.pi/3, math.pi*2/3]:
            obj = box((0, 0, 0), (.4, .2, 3.5), paint, 1, fan)
            obj.rotation_euler.y = a
    for x in [-5, 5]: box((x, 4, 1), (4, 4, 2), paint, 0)
    box((0, -6, 10.5), (17, .4, .4), steel)

def frostline():
    frame(28, 23)
    sign_frame(13, 10, 7)
    for x in [-11.5, 11.5]:
        box((x, -2, 4), (.5, 17, 8), paint, 0)
        beam((x, -9, 0), (x, 6, 7.5), .23)
    box((0, -2, 8.2), (27, 20, .65), paint, 1)
    box((0,-2,8.57),(27.3,20.3,.16),snow,bevel=.05)
    for x in [-12, -8, -3, 3, 8, 12]: sphere((x,7.8,8.55),(1,.6,.3),snow)
    for x in [-8, 8]: box((x, 2, 7.65), (2.4, .4, .18), amber)
    groomer = group('snow_groomer', (0, 1, .3))
    box((0, 0, 2.2), (7, 9, 2.1), paint, 3, groomer)
    box((0, 1, 4.2), (5.3, 5, 2.2), paint, 0, groomer)
    box((0, 3.56, 4.3), (4.5, .16, 1.5), glass, parent=groomer)
    box((0, 1, 5.5), (5.8, 5.4, .25), paint, 1, groomer)
    for x in [-3.9, 3.9]:
        box((x, -.6, 1.2), (1.8, 9.5, 2), steel, parent=groomer)
        for i in range(9): box((x, -4.6+i, 2.22), (1.9, .3, .14), paint, 2, groomer)
        for y in [-3, 0, 3]: cylinder((x+(1 if x>0 else -1), y, 1.2), .78, .15, paint, 1, groomer, axis='X')
        beam((x*.6, 3.5, 1), (x*.8, 6, .4), .25, parent=groomer)
        box((x*.6, 4.4, 3), (.9, .16, .5), amber, parent=groomer)
    blade = group('groomer_blade', (0, 6, .5), groomer)
    box((0, 0, .6), (11.5, .5, 1.8), paint, 1, blade)
    box((0, .3, -.22), (11.5, .3, .15), steel, parent=blade)
    for x in [-8.5, 8.5]:
        box((x, -5, 1.6), (3, 4, 3.2), paint, 0)
        sphere((x, 7, .5), (3, 3, 1), paint, 1)

BUILDERS = dict(greenwater=greenwater, bitterpan=bitterpan, nightshift=nightshift,
                polarity=polarity, tideline=tideline, ascension=ascension,
                dreamisland=dreamisland, afterglow=afterglow, frostline=frostline)
report = []
for kind, build in BUILDERS.items():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    parts = {}
    scene_root = None
    scene_root = group('signature_scene')
    # group() uses the previous root; sever this new root's stale parent.
    scene_root.parent = None
    build()
    for name, objects in parts.items(): join(objects, 'static_'+name, scene_root)
    # Reduce each moving pivot to one mesh per material, without losing pivots.
    for pivot in [obj for obj in bpy.data.objects if obj.type=='EMPTY' and obj!=scene_root]:
        by_material = {}
        for child in list(pivot.children):
            if child.type == 'MESH': by_material.setdefault(child.data.materials[0].name, []).append(child)
        for mat_name, objects in by_material.items():
            # Their coordinates are local to the pivot. Joining retains them.
            saved = pivot.matrix_world.copy()
            pivot.matrix_world.identity()
            bpy.context.view_layer.update()
            join(objects, pivot.name+'_'+mat_name, pivot)
            pivot.matrix_world = saved
    bpy.context.view_layer.update()
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLENDS / (kind+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(OUT / (kind+'.glb')), export_format='GLB', export_yup=True,
                              export_cameras=False, export_lights=False)
    triangles = sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in bpy.data.objects if obj.type=='MESH')
    report.append(dict(circuit=kind, triangles=triangles, meshes=sum(obj.type=='MESH' for obj in bpy.data.objects), bytes=(OUT/(kind+'.glb')).stat().st_size))
(OUT / 'manifest.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
