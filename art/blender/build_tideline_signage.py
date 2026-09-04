"""Place an image-generated Pelagic Authority atlas on framed Blender placards.
The image is an original built-in image_gen output, optimized without repainting.
"""
import bpy, json, math, random
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/tideline'
route=json.loads((ROOT/'src/game/data/tideline/route.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version=0

def coord(v):return(v[0],-v[2],v[1])
def material(name,color):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*color,1)
    s.inputs['Roughness'].default_value=.88;s.inputs['Metallic'].default_value=.15
    return m
frame=material('TS_salt_worn_frames',(.16,.22,.23))
bolts=material('TS_oxidized_fasteners',(.35,.23,.12))
face=material('TS_generated_signage',(.9,.9,.9))
image=bpy.data.images.load(str(OUT/'signage.webp'));image.pack()
texture=face.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image;texture.interpolation='Linear'
shader=face.node_tree.nodes.get('Principled BSDF')
face.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
face.node_tree.links.new(texture.outputs['Color'],shader.inputs['Emission Color'])
shader.inputs['Emission Strength'].default_value=.25
buckets={}
def bucket(name,mat):
    if name not in buckets:buckets[name]={'v':[],'f':[],'uv':[],'material':mat}
    return buckets[name]
def box(name,mat,center,xaxis,yaxis,zaxis,size):
    b=bucket(name,mat);n=len(b['v'])
    for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
        p=center+xaxis*(x*size[0]/2)+yaxis*(y*size[1]/2)+zaxis*(z*size[2]/2)
        b['v'].append(coord(p));b['uv'].append((0,0))
    b['f'] += [tuple(n+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]

# The underwater ribs stand at ±17m. A 22m centre plus the angled 5.2m
# face keeps its inner edge beyond19m; port halls begin beyond45m.
placements=[(.035,-1,0),(.08,1,2),(.125,-1,0),(.195,1,3),(.235,-1,3),
            (.32,1,1),(.365,-1,1),(.41,1,2),(.72,-1,0)]
up=Vector((0,1,0));records=[]
for number,(progress,side,tile) in enumerate(placements):
    scaled=progress*route['count'];index=int(scaled);alpha=scaled-index
    a=route['stations'][index];b=route['stations'][(index+1)%route['count']]
    assert a['mode']!='air', 'No flight-arc furniture'
    origin=Vector(a['p']).lerp(Vector(b['p']),alpha)
    tangent=Vector(a['t']).lerp(Vector(b['t']),alpha);tangent.y=0;tangent.normalize()
    road_right=tangent.cross(up).normalized()
    normal=(-road_right*side*math.cos(math.radians(40))-tangent*math.sin(math.radians(40))).normalized()
    axis=up.cross(normal).normalized()
    center=origin+road_right*(side*22)+up*7.4
    width=5.2
    quad=bucket('Tideline_generated_placards',face);n=len(quad['v'])
    col=tile%2;row=tile//2;u0=col*.5+.003;u1=(col+1)*.5-.003
    v0=(1-row)*.5+.003;v1=(2-row)*.5-.003
    for dx,dy,uv in [(-1,-1,(u0,v0)),(1,-1,(u1,v0)),(1,1,(u1,v1)),(-1,1,(u0,v1))]:
        quad['v'].append(coord(center+axis*(dx*width/2)+up*(dy*width/2)+normal*.145));quad['uv'].append(uv)
    quad['f'].append((n,n+1,n+2,n+3))
    box('Tideline_sign_frames',frame,center,axis,up,normal,(width+.22,width+.22,.22))
    for edge in [-1,1]:
        box('Tideline_sign_frames',frame,center+axis*(edge*(width/2+.06))+normal*.17,axis,up,normal,(.14,width+.24,.15))
        box('Tideline_sign_frames',frame,center+up*(edge*(width/2+.06))+normal*.17,axis,up,normal,(width+.24,.14,.15))
        for height in [-1,1]:
            box('Tideline_sign_bolts',bolts,center+axis*(edge*2.46)+up*(height*2.46)+normal*.21,axis,up,normal,(.10,.10,.035))
    # The posts stay outboard too, with short rails carrying the placard.
    for sidepost in [-1,1]:
        post=center+axis*(sidepost*1.72)-up*3.5-normal*.20
        box('Tideline_sign_frames',frame,post,axis,up,normal,(.19,7.8,.19))
        box('Tideline_sign_bolts',bolts,post-up*3.72,axis,up,normal,(.58,.14,.58))
    min_lateral=min(abs((Vector((p[0],p[2],-p[1]))-origin).dot(road_right)) for p in quad['v'][-4:])
    assert min_lateral>=route['stations'][index]['width']/2+3
    records.append({'progress':progress,'side':side,'tile':tile,'position':list(center),'sector':a['sector'],
                    'minimumFaceLateral':min_lateral,'minimumFaceHeight':4.8,'mode':a['mode']})

for name,data in buckets.items():
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(data['v'],[],data['f']);mesh.materials.append(data['material']);mesh.update()
    uv=mesh.uv_layers.new(name='Sign atlas UV')
    for polygon in mesh.polygons:
        for loop in polygon.loop_indices:uv.data[loop].uv=data['uv'][mesh.loops[loop].vertex_index]
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
objects=[o for o in bpy.data.objects if o.type=='MESH']
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
assert triangles<=3000
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(filepath=str(OUT/'signage.glb'),export_format='GLB',use_selection=True,
                          export_yup=True,export_animations=False,export_cameras=False,export_lights=False,
                          export_image_format='WEBP')
manifest={'name':'Pelagic Authority environmental signage','atlas':'signage.webp','imageSource':'Built-in image_gen original four-face atlas',
          'source':'art/blender/build_tideline_signage.py','triangles':triangles,'materials':len(buckets),'signs':records,
          'flightArcsClear':True,'minimumRoadFaceClearance':min(r['minimumFaceLateral']-12 for r in records)}
(OUT/'signage-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Verify the mapped first quadrant on its actual framed 3D placard.
first=records[0];s=route['stations'][int(first['progress']*route['count'])]
tangent=Vector(s['t']);tangent.y=0;tangent.normalize();right=tangent.cross(up).normalized()
n=(-right*first['side']*math.cos(math.radians(40))-tangent*math.sin(math.radians(40))).normalized()
c=Vector(first['position'])
bpy.ops.object.camera_add(location=coord(c+n*13+up*1.5));camera=bpy.context.object
camera.rotation_euler=(Vector(coord(c))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=7.3
scene=bpy.context.scene;scene.camera=camera
bpy.ops.object.light_add(type='AREA',location=coord(c+n*8+up*7));lamp=bpy.context.object;lamp.data.energy=1700;lamp.data.size=10
lamp.rotation_euler=(Vector(coord(c))-lamp.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Signage inspection');scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.025,.045,.055,1);scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.4
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.filepath=str(OUT/'signage-preview.png');scene.render.image_settings.file_format='PNG'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/tideline_signage.blend'));bpy.ops.render.render(write_still=True)
print(f'Tideline signage: {len(records)} signs, {triangles} triangles, {len(buckets)} draws/materials; atlas embedded as WebP')
