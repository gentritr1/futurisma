"""Foundry art edition: authored weathered vertex colour, six material roles.

The proven Tideline centreline and collision contract are read-only. Reuses the
accepted scenery silhouettes; the new pump gantry is produced from its own
orthographic, hero and material-ID images before it enters this assembly.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/tideline-foundry'
ROUTE=json.loads((ROOT/'src/game/data/tideline/route.json').read_text())
GANTRY=OUT/'tidal-pump-gantry.glb'
PLACEMENTS=[.055,.185,.325]
ROLE_NAMES=['concrete','metal','jungle','water','signage','emissive']
PALETTE={
    'concrete':(.53,.48,.38), 'metal':(.27,.255,.19),
    'jungle':(.105,.19,.085), 'water':(.055,.09,.055),
    'signage':(.67,.57,.35), 'emissive':(.78,.42,.10),
}
SOURCE_ROLE={
    'TL_weathered_ceramic':'concrete', 'TL_ocean_steel':'metal',
    'TL_ochre_hull':'metal', 'TL_polished_chrome':'metal',
    'TL_deep_glass':'metal', 'TL_aqueduct_cyan':'metal',
    'TL_crown_violet':'signage', 'TL_port_amber':'emissive',
    'TL_navigation_white':'signage', 'TL_living_teal':'jungle',
    'TL_hazard_yellow':'signage',
}
SOURCE_VARIANT={
    'TL_ochre_hull':(.39,.24,.105), 'TL_deep_glass':(.055,.065,.041),
    'TL_aqueduct_cyan':(.26,.27,.13), 'TL_crown_violet':(.42,.42,.28),
    'TL_polished_chrome':(.32,.32,.26), 'TL_hazard_yellow':(.60,.43,.12),
}

def material(role):
    m=bpy.data.materials.new('GW_MAT_'+role);m.use_nodes=True
    m.diffuse_color=(1,1,1,1)
    shader=m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(1,1,1,1)
    shader.inputs['Metallic'].default_value=0
    shader.inputs['Roughness'].default_value=1
    color=m.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name='FoundryPaint'
    m.node_tree.links.new(color.outputs['Color'],shader.inputs['Base Color'])
    if role=='emissive':
        shader.inputs['Emission Color'].default_value=(.48,.23,.05,1)
        shader.inputs['Emission Strength'].default_value=.22
    if role in ['jungle','signage']:
        m.surface_render_method='DITHERED'
        clip=m.node_tree.nodes.new('ShaderNodeMath');clip.operation='ROUND'
        m.node_tree.links.new(color.outputs['Alpha'],clip.inputs[0])
        m.node_tree.links.new(clip.outputs[0],shader.inputs['Alpha'])
    return m


def apply_transform(obj):
    obj.data.transform(obj.matrix_world);obj.matrix_world=Matrix.Identity(4)


def box(name,center,size,role):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center)
    obj=bpy.context.object;obj.name=name;obj.dimensions=size
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    obj.data.materials.append(MATERIALS[role]);return obj


def stage_gantries():
    if not GANTRY.exists():raise RuntimeError('Missing reference-led pump gantry: '+str(GANTRY))
    placements=[]
    for index,progress in enumerate(PLACEMENTS):
        before=set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(GANTRY))
        added=[obj for obj in bpy.context.scene.objects if obj not in before]
        station=ROUTE['stations'][int(progress*ROUTE['count'])]
        # Imported glTF is Blender Z-up: local X right, local -Y forward.
        tangent=Vector((station['t'][0],-station['t'][2],station['t'][1])).normalized()
        right=tangent.cross(Vector((0,0,1))).normalized()
        up=right.cross(tangent).normalized()
        position=Vector((station['p'][0],-station['p'][2],station['p'][1]))
        transform=Matrix((right,-tangent,up)).transposed().to_4x4()
        transform.translation=position
        for obj in added:
            if obj.parent is None:obj.matrix_world=transform@obj.matrix_world
        bpy.context.view_layer.update()
        for obj in added:
            if obj.type=='MESH':
                world=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=world;apply_transform(obj)
                obj['foundry_sector']=station['sector'];obj['gantry']=True
        # Four sodium fixtures, three working: weathered machine, not an arc.
        gantry_manifest=json.loads((OUT/'tidal-pump-gantry-manifest.json').read_text())
        for part in gantry_manifest['parts']:
            if part['role']!='lamp_working':continue
            x,y,z=part['center'];p=transform@Vector((x,-z,y))
            LIGHTS.append({'p':[p.x,p.z,-p.y],'color':'GW_MAT_emissive','size':2.6,'ground':station['p'][1]+.035})
        placements.append({'id':f'GW_PLACE_TIDAL_PUMP_{index:03}', 'progress':progress,
                           'sector':station['sector'],'position':station['p'],
                           'basis':list(transform),'cullDistance':200})
    return placements


bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/tideline_world.blend'))
# Keep only the authored opaque scenery. Runtime owns water/glass and all gameplay.
for obj in list(bpy.context.scene.objects):
    if obj.type!='MESH':bpy.data.objects.remove(obj,do_unlink=True)
MATERIALS={role:material(role) for role in ROLE_NAMES}
LIGHTS=[]
for obj in list(bpy.context.scene.objects):
    apply_transform(obj)
    obj['foundry_sector']=obj.name.removeprefix('TL_DISTRICT_')
    # Lower the repeated ring/pipe tessellation before adding three focal assets.
    modifier=obj.modifiers.new('Foundry_low_poly_budget','DECIMATE');modifier.ratio=.62
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
placements=stage_gantries()

# Replace the original arc glow with actual caged sodium fixtures. One third of
# the fixtures stay dark. All mounts sit outside the 24 m racing envelope.
for index,distance in enumerate(range(0,int(ROUTE['length']),66)):
    station=ROUTE['stations'][int(distance/ROUTE['length']*ROUTE['count'])]
    if station['mode']!='submerged':continue
    for side in [-1,1]:
        p,t=station['p'],station['t'];right=Vector((-t[2],t[0],0)).normalized()
        center=Vector((p[0],-p[2],p[1]+5.2))
        center+=Vector((-t[2],-t[0],0)).normalized()*side*16.6
        fixture=box('FD_caged_sodium',center,(.75,1.6,.32),'metal')
        fixture['foundry_sector']=station['sector']
        if index%3!=1:
            light=box('FD_sodium_tube',center+Vector((0,0,-.22)),(.40,1.2,.15),'emissive')
            light['foundry_sector']=station['sector']
            LIGHTS.append({'p':[center.x,center.z-.35,-center.y], 'color':'GW_MAT_emissive',
                           'size':2.3,'ground':p[1]+.035})
        for offset in [-.50,0,.50]:
            cage=box('FD_sodium_cage',center+Vector((0,offset,-.23)),(.79,.10,.35),'metal')
            cage['foundry_sector']=station['sector']

objects=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
# Actual hemisphere ray occlusion, baked into vertex colour together with damp
# staining and faded repair paint; no AO/normal/roughness texture maps are used.
vertices=[];polygons=[]
for obj in objects:
    base=len(vertices);vertices.extend(tuple(v.co) for v in obj.data.vertices)
    polygons.extend(tuple(base+i for i in poly.vertices) for poly in obj.data.polygons)
bvh=BVHTree.FromPolygons(vertices,polygons,all_triangles=False,epsilon=.001)
AO_SAMPLES=[(0,0),(.65,0),(-.65,0),(0,.65),(0,-.65)]
paint_range=[1,0]
for obj in objects:
    mesh=obj.data;mesh.update()
    source_materials=list(mesh.materials)
    old_color=mesh.color_attributes.active_color
    preserved=([tuple(old_color.data[loop.index if old_color.domain=='CORNER' else loop.vertex_index].color) for loop in mesh.loops] if old_color else None)
    if old_color:mesh.color_attributes.remove(old_color)
    colors=mesh.color_attributes.new(name='FoundryPaint',type='FLOAT_COLOR',domain='CORNER')
    mesh.color_attributes.active_color=colors
    uv=mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    vertex_ao=[]
    for vertex in mesh.vertices:
        n=vertex.normal.normalized()
        if n.length<.1:n=Vector((0,0,1))
        tangent=n.cross(Vector((0,0,1)))
        if tangent.length<.1:tangent=n.cross(Vector((0,1,0)))
        tangent.normalize();bitangent=n.cross(tangent).normalized()
        occlusion=0
        for a,b in AO_SAMPLES:
            direction=(n+tangent*a+bitangent*b).normalized()
            hit=bvh.ray_cast(vertex.co+n*.035,direction,7)
            if hit[0] is not None:occlusion+=max(0,1-hit[3]/7)
        vertex_ao.append(.68+.32*(1-occlusion/len(AO_SAMPLES)))
    role_index={role:index for index,role in enumerate(ROLE_NAMES)}
    polygon_roles=[]
    for poly in mesh.polygons:
        source=source_materials[poly.material_index] if poly.material_index<len(source_materials) else None
        name=source.name.split('.')[0] if source else 'TL_ocean_steel'
        role=name.removeprefix('GW_MAT_') if name.startswith('GW_MAT_') else SOURCE_ROLE.get(name,'metal')
        if role not in PALETTE:role='metal'
        base=SOURCE_VARIANT.get(name,PALETTE[role])
        normal=poly.normal
        for loop_index in poly.loop_indices:
            loop=mesh.loops[loop_index];p=mesh.vertices[loop.vertex_index].co
            ao=vertex_ao[loop.vertex_index]
            grain=.5+.5*math.sin(p.x*.47+math.sin(p.y*.35))*math.cos(p.z*.39+p.y*.17)
            streak=.5+.5*math.sin(p.x*.29+p.y*.33+math.sin(p.x*.09))
            damp=(.30 if p.z<0 else .18*max(0,1-p.z/16))*streak
            top_fade=max(0,normal.z)*.10
            factor=ao*(.82+grain*.16+top_fade)*(1-damp)
            rgb=[min(.95,c*factor) for c in base]
            if obj.get('gantry') and preserved:
                # The gantry's image-led material boundaries and wear remain authoritative.
                rgb=[preserved[loop_index][axis]*ao for axis in range(3)]
            elif role in ['concrete','metal'] and damp>.12:
                rgb=[rgb[i]*(1-damp*.6)+(.075,.13,.052)[i]*damp*.6 for i in range(3)]
            colors.data[loop_index].color=(*rgb,1)
            paint_range[0]=min(paint_range[0],*rgb);paint_range[1]=max(paint_range[1],*rgb)
            # Metric planar coordinates keep UV0 valid and stable if a role atlas is added later.
            axis=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=axis]
            uv.data[loop_index].uv=(p[axes[0]]/8,p[axes[1]]/8)
        polygon_roles.append(role_index[role])
    mesh.materials.clear()
    for role in ROLE_NAMES:mesh.materials.append(MATERIALS[role])
    for poly,index in zip(mesh.polygons,polygon_roles):poly.material_index=index

# Repeated props are merged per authored district; material roles split them
# into a small number of draw calls and keep unrelated sectors independently culled.
for sector in [d['id'] for d in ROUTE['districts']]:
    members=[obj for obj in bpy.context.scene.objects if obj.type=='MESH' and obj.get('foundry_sector')==sector]
    if not members:continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in members:obj.select_set(True)
    bpy.context.view_layer.objects.active=members[0];bpy.ops.object.join()
    members[0].name='GW_SECTOR_'+sector
    apply_transform(members[0])
    members[0].data.validate(clean_customdata=False)
    members[0].data.update()
for obj in list(bpy.context.scene.objects):
    if obj.type!='MESH':bpy.data.objects.remove(obj,do_unlink=True)
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'foundry_world.glb'),export_format='GLB',export_yup=True,
    export_animations=False,export_cameras=False,export_lights=False)
triangles=0
for obj in bpy.context.scene.objects:
    if obj.type=='MESH':obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
(OUT/'lights.json').write_text(json.dumps(LIGHTS))
(OUT/'placements.json').write_text(json.dumps(placements,indent=2,default=lambda x:list(x)))
(OUT/'manifest.json').write_text(json.dumps({'name':'Tideline Foundry','generator':'Blender '+bpy.app.version_string,
    'triangles':triangles,'gantries':len(placements),'roles':ROLE_NAMES,'lightAnchors':len(LIGHTS),
    'vertexPaintRange':paint_range,'sourceGeometry':'art/blender/tideline_world.blend',
    'recipe':'docs/GREENWATER_ENVIRONMENT_ART_BRIEF.md','decimationRatio':.62,
    'routeLength':ROUTE['length'],'routeCount':ROUTE['count']},indent=2)+'\n')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/tideline_foundry.blend'))
print('TIDELINE FOUNDRY',triangles,'triangles',len(LIGHTS),'lights',paint_range)
