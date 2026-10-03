"""Original Y2K roadside booths. Run with Blender --background --python.

Coordinates in helpers use the game's Y-up convention. Exported groups have
identity transforms, shared materials and UVs addressing the generated atlas.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/circuit-booths'
EVIDENCE = ROOT / 'art/evidence/circuit-booths'
bpy.ops.wm.read_factory_settings(use_empty=True)
OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
atlas = bpy.data.images.load(str(OUT / 'materials.jpg'))
materials = {}
for name in ['paint', 'metal', 'chrome', 'fabric', 'glow']:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .38 if name == 'metal' else .65
    shader.inputs['Metallic'].default_value = .65 if name == 'metal' else .15
    if name != 'glow':
        texture = material.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = atlas
        material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    else:
        color = material.node_tree.nodes.new('ShaderNodeVertexColor')
        color.layer_name = 'Color'
        material.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])
        material.node_tree.links.new(color.outputs['Color'], shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value = 2
    materials[name] = material

def position(p):
    return (-p[0], -p[2], p[1])

parts = {}
def finish(obj, role, cell=0, color=(1, 1, 1, 1)):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(materials[role])
    uv = obj.data.uv_layers.active or obj.data.uv_layers.new()
    # Primitive UVs retain the panel orientation; pad each cell against mips.
    for loop in uv.data:
        u, v = loop.uv
        loop.uv = ((cell % 4 + .035 + u * .93) / 4,
                   (1 - cell // 4 + .035 + v * .93) / 2)
    colors = obj.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for entry in colors.data:
        entry.color = color
    parts.setdefault(role, []).append(obj)
    return obj

def box(p, size, role='metal', cell=0, bevel=0, color=(1, 1, 1, 1)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position(p))
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Machined corners', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=obj.modifiers[-1].name)
    return finish(obj, role, cell, color)

def cylinder(p, radius, depth, role='metal', cell=4, axis='y', color=(1, 1, 1, 1), vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=position(p))
    obj = bpy.context.object
    if axis == 'z':
        obj.rotation_euler.x = math.pi / 2
    if axis == 'x':
        obj.rotation_euler.y = math.pi / 2
    return finish(obj, role, cell, color)

def ring(p, radius, tube, role='metal', cell=4, axis='y'):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube, major_segments=16, minor_segments=6, location=position(p))
    obj = bpy.context.object
    if axis == 'z':
        obj.rotation_euler.x = math.pi / 2
    return finish(obj, role, cell)

def sphere(p, size, role='paint', cell=1, color=(1, 1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1, location=position(p))
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    return finish(obj, role, cell, color)

def interior_wall():
    # Vertex shading preserves a warm work-light falloff at PS2 texture scales.
    vertices, faces = [], []
    columns, rows = 12, 6
    for row in range(rows + 1):
        for column in range(columns + 1):
            vertices.append(position((-2.45 + 4.9 * column / columns, 1.305 + 1.55 * row / rows, 1.78)))
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            faces.append((a, a + 1, a + columns + 2, a + columns + 1))
    mesh = bpy.data.meshes.new('recessed_backwall')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new('recessed_backwall', mesh); bpy.context.collection.objects.link(obj)
    finish(obj, 'glow', 1)
    for polygon in mesh.polygons:
        for index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[index].vertex_index].co
            x, y = vertex.x, vertex.z
            light = .055 + .66 * math.exp(-((x - .35) / 1.65) ** 2 - ((y - 1.95) / .62) ** 2)
            mesh.color_attributes['Color'].data[index].color = (light, light * .66, light * .43, 1)
            mesh.uv_layers.active.data[index].uv = ((1.04 + (x + 2.45) / 4.9 * .92) / 4, (.04 + (y - 1.305) / 1.55 * .92) / 2 + .5)

nodes = []
def join_parts(prefix):
    for role, objects in parts.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = f'{prefix}_{role}'
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # All faces in this node share one material, including distinct UV cells.
        obj.data.materials.clear()
        obj.data.materials.append(materials[role])
        for polygon in obj.data.polygons:
            polygon.material_index = 0
        nodes.append(obj)
    parts.clear()

warm = (1, .42, .21, 1)
pink = (1, .2, .45, 1)
cyan = (.13, .85, 1, 1)
for variant in ['cafe', 'market', 'service']:
    # Rounded shell, split serving counter, inset side panels and corner posts.
    box((0, .55, .3), (5.6, 1.1, 3), 'paint', 1, .16)
    box((0, 2.0, 2), (5.6, 2.9, .22), 'paint', 1, .1)
    for x in [-2.65, 2.65]:
        box((x, 2.1, .3), (.3, 2.7, 3), 'metal', 0, .12)
        cylinder((x, 1.9, -1.25), .24, 2.7, 'chrome')
    box((0, 3.8, .1), (7.25, .82, 4.25), 'chrome', 4, .36)
    box((0, 3.77, -2.02), (6.95, .085, .055), 'glow', color=pink, bevel=.03)
    box((0, 1.16, -1.62), (5.8, .17, 1.05), 'fabric', 5, .07)
    box((0, .59, -1.25), (5.4, .85, .09), 'metal', 0, .03)
    for x in [-1.7, 0, 1.7]:
        box((x, .59, -1.31), (.04, .78, .02), 'metal', 4)
    if variant == 'service':
        box((0, 2.1, 1.42), (4.8, 1.65, .12), 'metal', 0)
        for row in range(9):
            box((0, 1.45 + row * .17, 1.33), (4.7, .06, .06), 'metal', 4)
        for x in [-1.8, -.6, .6, 1.8]:
            cylinder((x, 1.42, -1.55), .22, .38, 'paint', 3)
            cylinder((x, 1.68, -1.55), .08, .15, 'metal')
    else:
        interior_wall()
        for x in [-2.4, 2.4]:
            box((x, 2.05, .35), (.22, 1.6, 3), 'metal', 0)
        box((0, 3.12, .35), (4.9, .17, 3), 'metal', 0)
        box((0, 1.84, .83), (4.35, .08, .65), 'fabric', 5)
        box((0, 1.76, 1.15), (4.3, .1, .07), 'metal', 0)
        for x in [-1.75, -.7, .7, 1.75]:
            cylinder((x, 2.03, .83), .12, .32, 'metal', 1)
        box((0, 2.82, .8), (4.6, .07, .06), 'glow', color=warm)
        for x in [-1.6, 0, 1.6]:
            box((x, 2.08, 1.36), (.07, 1.6, .12), 'metal', 4)
        for i in range(10):
            valance = box((-2.65 + i * .59, 2.92, -1.82), (.6, .64, .085), 'fabric', 6)
            # Sample one woven stripe per hanging panel so the low-resolution
            # pattern survives the driving camera instead of aliasing away.
            for loop in valance.data.uv_layers.active.data:
                local_u = (loop.uv.x * 4 - 2 - .035) / .93
                loop.uv.x = (2 + .04 + (i % 2) * .12 + local_u * .05) / 4
            valance.rotation_euler.x = -.13
        for x in ([-.45, .45] if variant == 'cafe' else [-1.65, 0, 1.65]):
            if variant == 'cafe':
                sphere((x, 1.34, -1.63), (.3, .12, .27), 'metal', 1)
                cylinder((x, 1.435, -1.63), .255, .018, 'metal', 1, color=(1, .65, .2, 1))
                for noodle in range(3):
                    ring((x, 1.45, -1.63), .075 + noodle * .052, .009, 'metal', 1)
                for dx in [-.055, .055]:
                    stick = box((x + dx, 1.64, -1.59), (.035, .035, .67), 'fabric', 5)
                    stick.rotation_euler.z = -.24
            else:
                box((x, 1.38, -1.6), (1.3, .25, .6), 'fabric', 5)
                for fruit in range(4):
                    sphere((x - .4 + fruit * .25, 1.6, -1.6), (.14, .15, .14), 'paint', 3)
    # Ribbed paper lanterns stay below the sign and outside the serving opening.
    for x in [-2.35, 2.35]:
        cylinder((x, 2.86, -1.85), .035, .5, 'metal', 0)
        lantern = sphere((x, 2.45, -1.85), (.27, .44, .27), 'glow', color=warm)
        for polygon in lantern.data.polygons:
            for index in polygon.loop_indices:
                vertex = lantern.data.vertices[lantern.data.loops[index].vertex_index].co
                light = .62 + .38 * max(0, vertex.y / .27)
                lantern.data.color_attributes['Color'].data[index].color = (*[channel * light for channel in warm[:3]], 1)
        for y in [2.15 + i * .15 for i in range(5)]:
            radius = .265 * math.sqrt(max(.15, 1 - ((y - 2.45) / .44) ** 2))
            ring((x, y, -1.85), radius, .005, 'metal', 1)
        cylinder((x, 2.87, -1.85), .14, .08, 'metal', 0)
        cylinder((x, 2.03, -1.85), .14, .08, 'metal', 0)
    # Curved exhaust and a caged fan with a separately instanced moving rotor.
    cylinder((-1.9, 4.53, .65), .28, 1, 'chrome', 4)
    elbow = cylinder((-1.72, 5.05, .65), .28, .65, 'chrome', 4, axis='x')
    elbow.rotation_euler.y = .8
    ring((-1.9, 4.13, .65), .3, .045, 'chrome', 4)
    box((1.8, 4.65, .65), (1.2, 1.15, .45), 'metal', 0, .1)
    ring((1.8, 4.65, .37), .46, .04, axis='z')
    for x in [-.24, 0, .24]:
        box((1.8 + x, 4.65, .30), (.027, .9, .035), 'metal', 4)
    # Vending cabinet and real seats anchor the forecourt to human scale.
    box((3.35, 1.1, -.5), (.85, 2.2, .8), 'metal', 0, .07)
    box((3.2, 1.45, -.915), (.42, .85, .04), 'glow', color=cyan)
    for y in [1.15, 1.42, 1.69]:
        box((3.61, y, -.925), (.11, .12, .035), 'paint', 3)
    box((3.35, .55, -.925), (.6, .2, .04), 'metal', 4)
    for x in [-1.1, 1.1]:
        cylinder((x, .08, -3.3), .27, .07, 'chrome')
        cylinder((x, .53, -3.3), .055, .9, 'chrome')
        ring((x, .38, -3.3), .26, .025, 'chrome')
        cylinder((x, 1, -3.3), .37, .15, 'metal', 1, color=(.58, .13, .19, 1))
    join_parts(variant)

# Fan blades are authored around their own pivot. The runtime rotates this
# one shared geometry at each roof vent, independent of static booth batches.
for blade in range(5):
    angle = blade * math.tau / 5
    obj = box((math.sin(angle) * .23, math.cos(angle) * .23, 0), (.15, .43, .045), 'metal', 4, .025)
    obj.rotation_euler.y = angle
cylinder((0, 0, 0), .13, .09, 'metal', 3, axis='z')
join_parts('rotor')

manifest = []
for obj in nodes:
    obj.data.calc_loop_triangles()
    count = len(obj.data.loop_triangles)
    bounds = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    manifest.append({'name': obj.name, 'triangles': count, 'boundsBlender': [[min(v[i] for v in bounds), max(v[i] for v in bounds)] for i in range(3)]})
assert sum(row['triangles'] for row in manifest) < 35000
bpy.ops.object.select_all(action='DESELECT')
for obj in nodes:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'booths.glb'), export_format='GLB', use_selection=True, export_yup=True, export_vertex_color='ACTIVE')
atlas.pack()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art/blender/circuit_booths.blend'))
(EVIDENCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('BOOTH_EXPORT', json.dumps({'triangles': sum(row['triangles'] for row in manifest), 'nodes': len(nodes), 'bytes': (OUT / 'booths.glb').stat().st_size}))
