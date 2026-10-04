"""Original low-poly timing pylon. Run with Blender --background --python.

The generated atlas supplies paint only; geometry, UVs and lights are authored
here. Export uses glTF's metre scale and Y-up convention.
"""
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

image = bpy.data.images.load(str(ROOT / 'art/references/race-polish/timing-kit-atlas.png'))
image.scale(1024, 1024)
image.filepath_raw = str(ROOT / 'public/assets/race-polish/timing-atlas.jpg')
image.file_format = 'JPEG'
bpy.context.scene.render.image_settings.quality = 85
image.save()
atlas_path = image.filepath_raw
bpy.data.images.remove(image)
image = bpy.data.images.load(atlas_path)
image.pack()

def material(name, color, metal=0, roughness=.65):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

paint = material('timing_paint', (1, 1, 1))
texture = paint.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
paint.node_tree.links.new(texture.outputs['Color'], paint.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
steel = material('timing_steel', (.24, .29, .31), .6, .4)
lens = material('timing_light', (1, 1, 1), 0, .35)
parts = {'timing_shell': [], 'timing_metal': [], 'timing_lens': []}

def cube(name, position, size, role, quadrant=0, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Machined edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(paint if role == 'timing_shell' else steel if role == 'timing_metal' else lens)
    if role == 'timing_shell':
        # Inset UVs protect each quadrant from mip filtering across its seam.
        x, y = [(0, .5), (.5, .5), (0, 0), (.5, 0)][quadrant]
        for uv in obj.data.uv_layers.active.data:
            uv.uv = (x + .025 + uv.uv.x * .45, y + .025 + uv.uv.y * .45)
    parts[role].append(obj)
    return obj

# +Y is the approaching driver's face; glTF exports it as -Z.
cube('Anchored foot', (0, 0, .14), (1.7, 1.35, .28), 'timing_shell', 2)
cube('Elevated road piling', (0, 0, -4), (.38, .38, 8), 'timing_metal', bevel=.015)
cube('Lower housing', (0, 0, .62), (1.12, .86, .78), 'timing_shell', 0)
cube('Stem', (0, 0, 2.3), (.56, .6, 3.1), 'timing_shell', 1)
cube('Rear spine', (0, -.36, 2.45), (.18, .18, 3.4), 'timing_metal')
cube('Reader housing', (0, 0, 3.78), (1.65, .92, 1.66), 'timing_shell', 0)
cube('Reader face', (0, .49, 3.73), (1.42, .08, 1.37), 'timing_shell', 2, .015)
cube('Sun hood', (0, .12, 4.68), (1.92, 1.3, .18), 'timing_shell', 3)
for x in [-.67, .67]:
    cube('Status rail', (x, .57, 3.77), (.1, .055, 1.34), 'timing_lens', bevel=.015)
    cube('Foot reflector', (x, .7, .25), (.18, .035, .14), 'timing_lens', bevel=.01)
for z in [1.4, 2.4]:
    cube('Collar', (0, 0, z), (.66, .69, .14), 'timing_shell', 3, .02)
for x in [-.52, .52]:
    for y in [-.4, .4]:
        cube('Hold-down bolt', (x, y, .31), (.1, .1, .07), 'timing_metal', bevel=.01)
cube('Service vent', (0, .451, .65), (.58, .04, .35), 'timing_shell', 2, .01)
for x in [-.32, .32]:
    cube('Reader bracket', (x, -.47, 3.55), (.12, .18, .6), 'timing_metal')

for role, objects in parts.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = role
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    obj.data.name = role

bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/blender/race_timing_kit.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/assets/race-polish/timing-kit.glb'), export_format='GLB', export_yup=True, export_cameras=False, export_lights=False)
print('Timing kit exported: three shared meshes, height 4.77m, footprint 1.92 x 1.35m')
