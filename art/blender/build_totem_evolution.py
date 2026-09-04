"""Author the player-only TOTEM gyro and instrument kit; original assets stay untouched.
Coordinates in the modelling helpers are the game's: X right, Y up, Z aft.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'public/assets/totem-evolution'
OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0


def material(name, color, emission=0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = .24 if emission == 0 else .1
    shader.inputs['Roughness'].default_value = .52
    shader.inputs['Emission Color'].default_value = (*color, 1)
    shader.inputs['Emission Strength'].default_value = emission
    return result


ALLOY = material('TE_alloy', (.24, .30, .33))
CERAMIC = material('TE_ceramic', (.62, .66, .60))
BOOST = material('TE_boost', (.65, .88, .25), 1.7)
BRAKE = material('TE_brake', (.35, .025, .01), .25)
GRAVITY = material('TE_gravity', (.12, .7, .88), 1.2)
POWER = material('TE_power', (.36, .16, .6), .4)


def blender(p):
    return (p[0], -p[2], p[1])


class Part:
    def __init__(self, name, mat, parent=None, location=(0, 0, 0)):
        self.name, self.mat = name, mat
        self.parent, self.location = parent, location
        self.vertices, self.faces = [], []

    def box(self, center, size, angle=0):
        start = len(self.vertices)
        c, s = math.cos(angle), math.sin(angle)
        for x, y, z in [(-1,-1,-1), (1,-1,-1), (1,1,-1), (-1,1,-1),
                         (-1,-1,1), (1,-1,1), (1,1,1), (-1,1,1)]:
            dx, dy, dz = x*size[0]/2, y*size[1]/2, z*size[2]/2
            self.vertices.append(blender((center[0]+c*dx-s*dy, center[1]+s*dx+c*dy, center[2]+dz)))
        self.faces.extend(tuple(start+i for i in face) for face in
                          [(0,3,2,1), (4,5,6,7), (0,1,5,4), (1,2,6,5), (2,3,7,6), (3,0,4,7)])

    def arc(self, radius, thickness, depth, start_angle=0, end_angle=math.tau, steps=48, z=0):
        start = len(self.vertices)
        for n in range(steps+1):
            angle = start_angle+(end_angle-start_angle)*n/steps
            for r, dz in [(radius-thickness/2, -depth/2), (radius+thickness/2, -depth/2),
                          (radius-thickness/2, depth/2), (radius+thickness/2, depth/2)]:
                self.vertices.append(blender((r*math.cos(angle), r*math.sin(angle), z+dz)))
        for n in range(steps):
            a, b = start+n*4, start+(n+1)*4
            self.faces.extend([(a, b, b+1, a+1), (a+2, a+3, b+3, b+2),
                               (a, a+2, b+2, b), (a+1, b+1, b+3, a+3)])
        self.faces.extend([(start, start+1, start+3, start+2),
                           (start+steps*4+2, start+steps*4+3, start+steps*4+1, start+steps*4)])

    def finish(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.materials.append(self.mat)
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = self.parent
        obj.location = blender(self.location)
        return obj


def empty(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = blender(location)
    obj.parent = parent
    return obj


root = empty('TOTEM_evolution')
rotor = empty('TE_gyro_pivot', (0, .235659, 2.51), root)
rotor_body = Part('TE_gyro_alloy', ALLOY, rotor)
rotor_body.arc(.984, .064, .075, steps=48)
rotor_light = Part('TE_gyro_instruments', GRAVITY, rotor)
for index in range(3):
    a = index*math.tau/3 + .15
    rotor_body.arc(.887, .045, .045, a, a+1.16, steps=11, z=.015)
    # Three asymmetric vanes make rotation readable instead of a featureless wheel.
    rotor_body.box((.95*math.cos(a), .95*math.sin(a), .01), (.17, .13, .12), a)
    rotor_light.arc(.99, .021, .01, a+.14, a+.82, steps=8, z=.045)
    rotor_light.box((.925*math.cos(a), .925*math.sin(a), .077), (.085, .032, .015), a)
rotor_body.finish()
rotor_light.finish()

housing = Part('TE_instrument_housing', ALLOY, root)
ceramic = Part('TE_service_markings', CERAMIC, root)
boost = Part('TE_boost_meter', BOOST, root)
brake = Part('TE_brake_lamps', BRAKE, root)
power = Part('TE_power_lamps', POWER, root)
# Aft beam carries a readable four-segment reserve indicator.
housing.box((0, .015, 2.568), (1.48, .20, .10))
for index in range(4):
    boost.box((-.48+index*.32, .034, 2.626), (.24, .061, .025))
for side in (-1, 1):
    housing.box((side*1.29, .12, 2.33), (.22, .3, .12))
    for height in (.04, .14, .24):
        brake.box((side*1.29, height, 2.404), (.145, .044, .025))
    housing.box((side*.69, .76, 1.43), (.2, .12, .46))
    power.box((side*.69, .837, 1.43), (.095, .025, .30))
    ceramic.box((side*1.29, .31, 2.337), (.17, .025, .13))
    ceramic.box((side*.76, .12, 2.63), (.045, .10, .018))
    # Collars use the measured nozzle centres; legacy FX anchors sit above them.
    collar = Part(f'TE_collar_{side}', BOOST, root, (side*.45, .215659, 2.455))
    collar.arc(.343, .026, .045, steps=20)
    collar_obj = collar.finish()
    # Merge collars into the boost lamp mesh below for one shared draw call.
for part in (housing, ceramic, boost, brake, power):
    part.finish()

bpy.ops.object.select_all(action='DESELECT')
for name in ('TE_boost_meter', 'TE_collar_-1', 'TE_collar_1'):
    bpy.data.objects[name].select_set(True)
bpy.context.view_layer.objects.active = bpy.data.objects['TE_boost_meter']
bpy.ops.object.join()

# Runtime kit exports only the new assembly, with no images or decoder extensions.
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for obj in root.children_recursive:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
kit_objects = [root, *root.children_recursive]
triangles = sum(sum(len(poly.vertices)-2 for poly in obj.data.polygons)
                for obj in kit_objects if obj.type == 'MESH')
assert triangles <= 3000, triangles
bpy.ops.export_scene.gltf(filepath=str(OUTPUT/'totem_evolution.glb'), export_format='GLB',
                          use_selection=True, export_cameras=False, export_lights=False,
                          export_animations=False, export_yup=True)
manifest = {
    'name': 'TOTEM Evolution / rear gyro and driver instruments',
    'source': 'art/blender/build_totem_evolution.py',
    'runtime': 'totem_evolution.glb',
    'triangles': triangles,
    'meshes': sum(o.type == 'MESH' for o in kit_objects),
    'materials': 6,
    'textures': 0,
    'originalModelModified': False,
    'gyroPivot': [0, .235659, 2.51],
    'signals': {
        'TE_boost': 'lime ready, amber recharging, cyan boost, white overdrive',
        'TE_brake': 'red under braking',
        'TE_gravity': 'cyan floor, pink ceiling, amber changing surface',
        'TE_power': 'amber power ready, violet shield, icy blue overdrive',
    },
}
(OUTPUT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')

# Preserve an inspectable source scene with the accepted craft as a separate reference.
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/totem/models/totem_runtime.glb'))
for obj in bpy.context.selected_objects:
    if obj.name == 'collision_proxy':
        obj.hide_render = True
bpy.ops.object.camera_add(location=(4.5, -8, 3.5))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, .3))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 8.7
scene = bpy.context.scene
scene.camera = camera
for location, energy, size in [((2,-4,6),1300,5), ((-4,2,4),1000,4), ((3,4,1),500,3)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    lamp = bpy.context.object
    lamp.data.energy, lamp.data.size = energy, size
    lamp.rotation_euler = (-lamp.location).to_track_quat('-Z','Y').to_euler()
scene.world = bpy.data.worlds.new('Inspection world')
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.08,.105,.12,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value = .3
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1200, 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(OUTPUT/'preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/totem_evolution.blend'))
bpy.ops.render.render(write_still=True)
print(f'TOTEM evolution: {triangles} triangles, 7 mesh batches, no textures')
