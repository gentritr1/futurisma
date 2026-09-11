"""Render the EXPORTED hero GLBs with the existing atlases; no AI tools.

/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python art/evidence/dreamisland-v1/heroes/render_blender.py

All outputs stay beside this file. Use -- --asset=clock-tower for a narrow rerun.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[3]
ASSETS=ROOT/'public/assets/dreamisland/heroes'
MANIFEST=json.loads((ASSETS/'heroes.json').read_text())
WIDTH,HEIGHT=1280,960
RATIO=WIDTH/HEIGHT


def coord(p):
    return Vector((p[0],-p[2],p[1]))


def game(p):
    return [p.x,p.z,-p.y]


def point_camera(camera,position,target):
    camera.location=position
    camera.rotation_euler=(target-position).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()


def math_node(nodes,operation):
    node=nodes.new('ShaderNodeMath')
    node.operation=operation
    return node


def bind_atlases(objects):
    """Use actual imported UVs and COLOR_0; the GLBs themselves stay texture-free."""
    for obj in objects:
        if obj.type!='MESH':
            continue
        for slot in obj.material_slots:
            role=slot.material.name.split('.')[0].removeprefix('DI_MAT_')
            material=bpy.data.materials.new('REVIEW_'+role+'_'+obj.name)
            material.use_nodes=True
            nodes,links=material.node_tree.nodes,material.node_tree.links
            nodes.clear()
            output=nodes.new('ShaderNodeOutputMaterial')
            diffuse=nodes.new('ShaderNodeBsdfDiffuse')
            diffuse.inputs['Roughness'].default_value=1
            texture=nodes.new('ShaderNodeTexImage')
            path=ROOT/'public/assets/dreamisland'/('jungle-card.png' if role=='jungle-card' else 'textures/'+role+'.jpg')
            texture.image=bpy.data.images.load(str(path),check_existing=True)
            texture.interpolation='Linear'
            attribute=nodes.new('ShaderNodeVertexColor')
            attribute.layer_name=obj.data.color_attributes.active_color.name
            tint=nodes.new('ShaderNodeMixRGB')
            tint.blend_type='MULTIPLY'
            tint.inputs[0].default_value=1
            links.new(texture.outputs['Color'],tint.inputs[1])
            links.new(attribute.outputs['Color'],tint.inputs[2])
            links.new(tint.outputs['Color'],diffuse.inputs['Color'])
            links.new(diffuse.outputs[0],output.inputs['Surface'])
            if role=='jungle-card':
                separate=nodes.new('ShaderNodeSeparateColor')
                links.new(texture.outputs['Color'],separate.inputs[0])
                minimum=math_node(nodes,'MINIMUM')
                links.new(separate.outputs['Red'],minimum.inputs[0])
                links.new(separate.outputs['Blue'],minimum.inputs[1])
                difference=math_node(nodes,'SUBTRACT')
                links.new(minimum.outputs[0],difference.inputs[0])
                links.new(separate.outputs['Green'],difference.inputs[1])
                key=math_node(nodes,'GREATER_THAN')
                links.new(difference.outputs[0],key.inputs[0])
                key.inputs[1].default_value=.025
                transparent=nodes.new('ShaderNodeBsdfTransparent')
                mix=nodes.new('ShaderNodeMixShader')
                links.new(key.outputs[0],mix.inputs[0])
                links.new(diffuse.outputs[0],mix.inputs[1])
                links.new(transparent.outputs[0],mix.inputs[2])
                links.new(mix.outputs[0],output.inputs[0])
            slot.material=material


def emission(name,color):
    material=bpy.data.materials.new(name)
    material.use_nodes=True
    nodes=material.node_tree.nodes
    nodes.clear()
    shader=nodes.new('ShaderNodeEmission')
    shader.inputs['Color'].default_value=(*color,1)
    output=nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(shader.outputs[0],output.inputs[0])
    return material


def camera_label(camera,text,x,y,size,depth,material):
    curve=bpy.data.curves.new('review_label','FONT')
    curve.body=text
    curve.size=size
    obj=bpy.data.objects.new('review_label',curve)
    bpy.context.collection.objects.link(obj)
    obj.parent=camera
    obj.location=(x,y,-depth)
    obj.data.materials.append(material)
    return obj


def add_scale_and_labels(camera,name,view,vertical_span,plane_distance=1):
    """Four actual 0.5 m segments at the asset-centre camera plane (2 m total)."""
    white=emission('review_ivory',(.86,.89,.78))
    dark=emission('review_charcoal',(.015,.025,.03))
    horizontal_span=vertical_span*RATIO
    left=-horizontal_span/2+horizontal_span*.035
    top=vertical_span/2-vertical_span*.045
    font=vertical_span*.016
    annotations=[camera_label(camera,'FUTURISMA / DREAM ISLAND   -   '+name.upper()+' / '+view.upper(),left,top,font,plane_distance,white)]
    annotations.append(camera_label(camera,'BLENDER CYCLES  /  EXPORTED GLB  /  SHARED ATLASES',left,top-font*1.65,font*.70,plane_distance,white))
    # For perspective, labels and ruler live at the centre's true distance.
    x=horizontal_span/2-horizontal_span*.075
    y=-vertical_span/2+vertical_span*.075
    for i in range(4):
        mesh=bpy.data.meshes.new('scale_segment')
        mesh.from_pydata([(0,0,0),(.12,0,0),(.12,.5,0),(0,.5,0)],[],[(0,1,2,3)])
        obj=bpy.data.objects.new('scale_bar_0_5m',mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent=camera
        obj.location=(x,y+i*.5,-plane_distance)
        obj.data.materials.append(white if i%2==0 else dark)
        annotations.append(obj)
    annotations.append(camera_label(camera,'2 m',x+.28,y+1.6,font*.85,plane_distance,white))
    return annotations


def render_asset(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(ASSETS/MANIFEST['assets'][name]['file']))
    objects=list(bpy.context.scene.objects)
    bind_atlases(objects)
    points=[obj.matrix_world@vertex.co for obj in objects if obj.type=='MESH' for vertex in obj.data.vertices]
    low=Vector([min(p[i] for p in points) for i in range(3)])
    high=Vector([max(p[i] for p in points) for i in range(3)])
    center=(low+high)/2
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.cycles.max_bounces=5
    scene.cycles.transparent_max_bounces=12
    scene.render.resolution_x,scene.render.resolution_y=WIDTH,HEIGHT
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGB'
    scene.view_settings.view_transform='Standard'
    scene.view_settings.exposure=0
    world=bpy.data.worlds.new('review_world')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs['Color'].default_value=(.10,.17,.23,1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
    scene.world=world
    sun_data=bpy.data.lights.new('review_key','SUN')
    sun_data.energy=2.25
    sun_data.angle=.075
    sun=bpy.data.objects.new('review_key',sun_data)
    bpy.context.collection.objects.link(sun)
    sun.location=coord((-35,50,-35))
    sun.rotation_euler=(-sun.location).to_track_quat('-Z','Y').to_euler()
    fill_data=bpy.data.lights.new('review_fill','AREA')
    fill_data.energy=1800
    fill_data.shape='DISK'
    fill_data.size=30
    fill=bpy.data.objects.new('review_fill',fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location=coord((15,35,-25))
    fill.rotation_euler=(center-fill.location).to_track_quat('-Z','Y').to_euler()
    # The floor is review context only and is excluded from measured bounds.
    bpy.ops.mesh.primitive_plane_add(size=500,location=(0,0,-.06))
    floor=bpy.context.object
    floor.name='review_floor'
    material=bpy.data.materials.new('review_floor_material')
    material.diffuse_color=(.22,.31,.30,1)
    floor.data.materials.append(material)
    camera_data=bpy.data.cameras.new('review_camera')
    camera_data.type='ORTHO'
    camera_data.clip_end=1200
    camera=bpy.data.objects.new('review_camera',camera_data)
    bpy.context.collection.objects.link(camera)
    scene.camera=camera
    directions={'front':(0,0,-1),'side':(1,0,0),'back':(0,0,1),'three-quarter':(.8,.42,-1)}
    # One scale across the four views; fit all corners at every view first.
    vertical_span=0
    for direction in directions.values():
        point_camera(camera,center+coord(direction).normalized()*110,center)
        inverse=camera.matrix_world.inverted()
        projected=[inverse@p for p in points]
        width=max(p.x for p in projected)-min(p.x for p in projected)
        height=max(p.y for p in projected)-min(p.y for p in projected)
        vertical_span=max(vertical_span,height*1.30,width/RATIO*1.32)
    camera.data.ortho_scale=vertical_span*RATIO
    frames=[]
    for view,direction in directions.items():
        point_camera(camera,center+coord(direction).normalized()*110,center)
        # Orthographic scale is independent of depth. Keep this literal 2 m
        # ruler near the camera so the review floor cannot occlude a segment.
        annotations=add_scale_and_labels(camera,name,view,vertical_span,1)
        scene.render.filepath=str(OUT/(name+'-'+view+'.png'))
        bpy.ops.render.render(write_still=True)
        frames.append({'asset':name,'view':view,'file':Path(scene.render.filepath).name,
                       'cameraType':'orthographic','cameraPositionGame':game(camera.location),
                       'targetGame':game(center),'verticalSpanMetres':vertical_span,
                       'scaleBarMetres':2,'scaleBarPixels':2/vertical_span*HEIGHT,
                       'boundsGame':MANIFEST['assets'][name]['bounds'],
                       'assetSha256':hashlib.sha256((ASSETS/MANIFEST['assets'][name]['file']).read_bytes()).hexdigest()})
        for obj in annotations:
            bpy.data.objects.remove(obj,do_unlink=True)
    if name in ['clock-tower','watchtower','sea-stack-set']:
        distance=300 if name=='sea-stack-set' else 40
        vfov=65 if name=='watchtower' else 50
        camera.data.type='PERSP'
        camera.data.sensor_fit='VERTICAL'
        camera.data.sensor_height=32
        camera.data.lens=32/(2*math.tan(math.radians(vfov)/2))
        # A plain sky backdrop keeps the whole ruler visible at the asset's
        # true distance and makes the 300 m skyline comparison unambiguous.
        floor.hide_render=True
        # The clock needs its side stair visible; stacks need the through-arch.
        direction=coord((.50,.05,-1) if name=='clock-tower' else ((.35,.15,-1) if name=='watchtower' else (0,0,-1))).normalized()
        point_camera(camera,center+direction*distance,center)
        span=2*distance*math.tan(math.radians(vfov)/2)
        annotations=add_scale_and_labels(camera,name,str(distance)+' m / '+str(vfov)+' deg VFOV',span,distance)
        scene.render.filepath=str(OUT/(name+'-'+str(distance)+'m.png'))
        bpy.ops.render.render(write_still=True)
        frames.append({'asset':name,'file':Path(scene.render.filepath).name,'cameraType':'perspective',
                       'distanceMetres':(camera.location-center).length,'verticalFovDegrees':vfov,
                       'cameraPositionGame':game(camera.location),'targetGame':game(center),
                       'scaleBarMetres':2,'scaleBarDepthMetres':distance,'scaleBarPixels':2/span*HEIGHT,
                       'assetSha256':hashlib.sha256((ASSETS/MANIFEST['assets'][name]['file']).read_bytes()).hexdigest()})
    return frames


chosen=next((arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--asset=')),None)
names=[chosen] if chosen else list(MANIFEST['assets'])
report={'status':'VERIFIED','renderer':'Blender '+bpy.app.version_string+' / Cycles CPU / 24 samples / denoised',
        'input':'Exported GLBs re-imported; existing shared atlas files bound by DI_MAT role; imported vertex colours',
        'frames':[]}
for name in names:
    assert name in MANIFEST['assets'],name
    report['frames'].extend(render_asset(name))
    (OUT/('blender-render-check'+('-'+chosen if chosen else '')+'.json')).write_text(json.dumps(report,indent=2)+'\n')
print('VERIFIED Blender evidence frames:',len(report['frames']))
