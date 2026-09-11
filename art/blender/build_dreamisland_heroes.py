"""Dream Island focal assets, metres first. No Phase B imports or writes.

Run from the repository root:
/Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/build_dreamisland_heroes.py

Only existing atlas UVs, vertex colour and geometry are exported. Texture binding
is deferred to the eventual runtime integration. Evidence renders reload the GLBs
with three r184 in scripts/visual/dreamisland-heroes/render.mjs.
"""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/dreamisland/heroes'
EVIDENCE = ROOT / 'art/evidence/dreamisland-v1/polish/round-2/build-heroes'
ATLAS_PATH = ROOT / 'public/assets/dreamisland/atlas-manifest.json'
ATLAS = json.loads(ATLAS_PATH.read_text())
ROLES = ['concrete', 'metal', 'jungle', 'water', 'signage', 'emissive']
TAU = math.tau

# Explicit game coordinates: X right, Y up, -Z front, one unit = one metre.
def blender_point(p):
    return (p[0], -p[2], p[1])


def game_point(p):
    return (p[0], p[2], -p[1])


def rect(role, cell):
    item = ATLAS['roles'][role][cell]
    return item.get('sprite', {}).get('uv', item['uv'])


def empty(name, position=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = blender_point(position)
    obj.parent = parent
    return obj


def make_materials():
    result = {}
    for role in ROLES + ['jungle-card','water-overlay']:
        material = bpy.data.materials.new('DI_MAT_' + role)
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
        bsdf.inputs['Roughness'].default_value = 1
        colour = material.node_tree.nodes.new('ShaderNodeVertexColor')
        colour.layer_name = 'Color'
        material.node_tree.links.new(colour.outputs['Color'],bsdf.inputs['Base Color'])
        material.diffuse_color = (1, 1, 1, 1)
        material.use_backface_culling = role != 'jungle-card'
        result[role] = material
    return result


MATERIALS = {}


class Mesh:
    """Accumulate a semantic feature; flat faces keep block edges explicit."""
    def __init__(self, name, role='concrete', cell='wall-block'):
        self.name, self.role, self.cell = name, role, cell
        self.points, self.faces, self.face_uvs, self.tints = [], [], [], []

    def geometry(self, points, faces, tint=(1, 1, 1, 1), uv_rect=None):
        base = len(self.points)
        self.points.extend(points)
        for face in faces:
            # Axis fans contain repeated centre coordinates; collapse those to
            # triangles before Blender sees them, not after a boolean/export.
            clean=[]
            for index in face:
                if not any((Vector(points[index])-Vector(points[other])).length<1e-8 for other in clean):
                    clean.append(index)
            if len(clean)<3:
                continue
            self.faces.append(tuple(base + i for i in clean))
            self.face_uvs.append(uv_rect)
            self.tints.append(tint)

    def box(self, center, size, tint=(1, 1, 1, 1), yaw=0):
        points = []
        for x, y, z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                         (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
            px, pz = x * size[0] / 2, z * size[2] / 2
            points.append((center[0] + px * math.cos(yaw) - pz * math.sin(yaw),
                           center[1] + y * size[1] / 2,
                           center[2] + px * math.sin(yaw) + pz * math.cos(yaw)))
        self.geometry(points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),
                               (1,2,6,5),(2,3,7,6),(3,0,4,7)], tint)

    def beam(self, start, end, width, depth=None, tint=(1,1,1,1)):
        a, b = Vector(start), Vector(end)
        axis = (b - a).normalized()
        ref = Vector((0,1,0)) if abs(axis.y) < .9 else Vector((1,0,0))
        u = axis.cross(ref).normalized() * width / 2
        v = axis.cross(u).normalized() * (depth or width) / 2
        self.geometry([p + x*u + y*v for p in [a,b] for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]],
                      [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], tint)

    def wedge(self, y0, y1, inner0, outer0, inner1, outer1, a0, a1, tint=(1,1,1,1), offset=(0,0)):
        pts = []
        for y, inner, outer in [(y0,inner0,outer0),(y1,inner1,outer1)]:
            for r,a in [(inner,a0),(outer,a0),(outer,a1),(inner,a1)]:
                pts.append((offset[0]+r*math.cos(a),y,offset[1]+r*math.sin(a)))
        self.geometry(pts, [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)], tint)

    def finish(self, parent, custom=None):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([blender_point(p) for p in self.points], [], self.faces)
        mesh.materials.append(MATERIALS[self.role])
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        obj['atlasRole'], obj['atlasCell'] = self.role, self.cell
        obj['atlasRect'] = list(rect(self.role, self.cell))
        if custom:
            for key,value in custom.items():
                obj[key] = value
        project_uvs(obj, self.role, self.cell, self.tints, self.face_uvs)
        return obj


def project_uvs(obj, role, cell, tints=None, overrides=None):
    mesh = obj.data
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name='AtlasUV')
    colour = mesh.color_attributes.get('Color') or mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    mesh.color_attributes.active_color = colour
    for face in mesh.polygons:
        pts = [Vector(game_point(mesh.vertices[i].co)) for i in face.vertices]
        normal = (pts[1]-pts[0]).cross(pts[2]-pts[0])
        axis = max(range(3), key=lambda a: abs(normal[a]))
        axes = [a for a in range(3) if a != axis]
        if 1 in axes:
            axes = [next(a for a in axes if a != 1), 1]
        low = [min(p[a] for p in pts) for a in axes]
        span = [max(p[a] for p in pts)-low[j] for j,a in enumerate(axes)]
        cell_rect = overrides[face.index] if overrides else None
        u0,v0,u1,v1 = cell_rect or rect(role,cell)
        tint = tints[face.index] if tints else (1,1,1,1)
        for loop,p in zip(face.loop_indices,pts):
            s = (p[axes[0]]-low[0])/max(span[0],1e-8)
            t = (p[axes[1]]-low[1])/max(span[1],1e-8)
            # Physical aspect for stone; a face never spills into another cell.
            if role not in ['emissive','jungle-card']:
                longest = max(*span,1e-8)
                s = .5+(s-.5)*span[0]/longest
                t = .5+(t-.5)*span[1]/longest
            uv.data[loop].uv = (u0+s*(u1-u0),v0+t*(v1-v0))
            colour.data[loop].color = tint


def prism(name, outline, z0, z1, parent=None):
    mesh = Mesh(name)
    n = len(outline)
    pts = [(x,y,z) for z in [z0,z1] for x,y in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh.geometry(pts,faces)
    obj = mesh.finish(parent)
    # Boolean operands need outward normals regardless of outline winding.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    return obj


def subtract(obj, cutter):
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Architectural void', 'BOOLEAN')
    modifier.operation, modifier.solver, modifier.object = 'DIFFERENCE', 'EXACT', cutter
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def arch_outline(half_width, spring, rise, bottom=-1, segments=20):
    return [(-half_width,bottom),(half_width,bottom)] + [
        (half_width*math.cos(i*math.pi/segments),spring+rise*math.sin(i*math.pi/segments))
        for i in range(segments+1)]


def clock_tower():
    root = empty('clock-tower')
    plinth = Mesh('clock_plinth_three_tiers','concrete','causeway-paving')
    for tier,width in enumerate([8,7.25,6.5]):
        y = .2 + tier*.4
        # Full solid slab plus jointed front/back edges, three actual tiers.
        plinth.box((0,y,0),(width,.4,width),(.82,.88,.75,1))
    plinth.finish(root, {'tiers':3,'targetWidth':8,'targetDepth':8})
    shaft = Mesh('clock_square_block_courses')
    # Recessed solid backing makes the course joints read as dark mortar;
    # without it an orthographic elevation sees sky through the hollow shaft.
    shaft.box((-.65,6.15,0),(4.27,9.9,4.27),(.44,.49,.39,1))
    moss = Mesh('clock_moss_courses','jungle','moss-blossom')
    for row in range(18):
        y = 1.2+(row+.5)*.55
        for side in range(4):
            for col in range(4):
                along = -2.2+(col+.5)*1.1
                p = [(along,y,-2.16),(2.16,y,along),(-along,y,2.16),(-2.16,y,-along)][side]
                p = (p[0]-.65,p[1],p[2])
                target = moss if (row < 6 and (row+col+side)%4==0) or (row+side*3+col*5)%29==0 else shaft
                size = (1.08,.525,.36) if side%2==0 else (.36,.525,1.08)
                shade = .74 + .04*((row*3+col+side)%5)
                target.box(p,size,(shade,shade+.045,shade*.89,1))
    shaft.finish(root)
    moss.finish(root)
    trim = Mesh('clock_cornice_and_pitched_roof')
    trim.box((-.65,11.22,0),(4.85,.3,4.85),(.82,.85,.73,1))
    # Hip roof as four pitched planes, with stone seams encoded in raised courses.
    for row in range(5):
        y0,y1 = 11.37+row*.36,11.37+(row+1)*.36
        w0,w1 = 2.62-row*.45,2.62-(row+1)*.45
        pts = [(x*w-.65,y,z*w) for y,w in [(y0,w0),(y1,w1)] for x,z in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        trim.geometry(pts,[(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],(.72,.78,.63,1))
    trim.finish(root)
    finial = Mesh('clock_roof_finial','concrete','wall-block')
    for i in range(8):
        finial.wedge(13.17,13.55,0,.32,0,.26,i*TAU/8,(i+1)*TAU/8,offset=(-.65,0))
        finial.wedge(13.55,14,0,.26,0,0,i*TAU/8,(i+1)*TAU/8,offset=(-.65,0))
    finial.finish(root)
    # Disk radius is EXACTLY 1.6. The white inset avoids baked atlas hands.
    face = Mesh('clock_face_3_2m','emissive','clock-face')
    cx,cy,cz = -.65,9.25,-2.375
    white = [820/1024,1-818/1024,850/1024,1-784/1024]
    n = 48
    pts = [(cx,cy,cz)]+[(cx+1.6*math.cos(i*TAU/n),cy+1.6*math.sin(i*TAU/n),cz) for i in range(n)]
    face.geometry(pts,[(0,(i+1)%n+1,i+1) for i in range(n)],uv_rect=white)
    face.finish(root,{'gameplaySizeException':True,'whiteSampleRect':white,'diameterMetres':3.2})
    bezel = Mesh('clock_bezel','metal','clock-ring-hands')
    for i in range(n):
        a,b = i*TAU/n,(i+1)*TAU/n
        pts = [(cx+r*math.cos(t),cy+r*math.sin(t),cz+z) for z in [-.25,.07] for r,t in [(1.6,a),(1.77,a),(1.77,b),(1.6,b)]]
        bezel.geometry(pts,[(3,2,1,0),(1,5,4,0),(2,6,5,1),(3,7,6,2),(0,4,7,3)],(.65,.67,.53,1))
    bezel.finish(root)
    ticks=Mesh('clock_twelve_hour_ticks','metal','clock-ring-hands')
    for i in range(12):
        a=i*TAU/12
        ticks.beam((cx+1.30*math.sin(a),cy+1.30*math.cos(a),cz-.035),
                   (cx+1.50*math.sin(a),cy+1.50*math.cos(a),cz-.035),.065,.035,(.025,.028,.023,1))
    ticks.finish(root,{'hourTicks':12,'numerals':False})
    pivot = empty('clock_hand_pivot',(cx,cy,cz-.1),root)
    for name,end,width in [('clock_minute_hand',(0,1.28,0),.095),('clock_hour_hand',(.92,-.65,0),.13)]:
        hand = Mesh(name,'metal','clock-ring-hands')
        hand.beam((0,0,0),end,width,.075,(.055,.058,.05,1))
        hand.finish(pivot)
    steps = Mesh('clock_winding_stair_treads','concrete','causeway-paving')
    parapet = Mesh('clock_winding_stair_parapet')
    # Two connected flights plus four winders round the back-right corner.
    path = [(2.65,-2.7+i*.45,0) for i in range(11)]
    path += [(1.95+.7*math.cos(i*math.pi/8),1.8+.7*math.sin(i*math.pi/8),i*math.pi/8) for i in range(1,5)]
    path += [(1.95-i*.45,2.5,math.pi/2) for i in range(1,11)]
    for i,(x,z,yaw) in enumerate(path):
        top = 1.2+(i+1)*.23
        steps.box((x,top-.16,z),(1.24,.32,.48),(.8,.85,.74,1),yaw)
        steps.box((x+.23*math.sin(yaw),top-.015,z-.23*math.cos(yaw)),
                  (1.30,.09,.13),(.94,.96,.87,1),yaw)
        # Short solid panels retain a readable stepped top edge.
        px,pz = x+.72*math.cos(yaw),z+.72*math.sin(yaw)
        parapet.box((px,top+.34,pz),(.22,.68,.49),(.79,.85,.72,1),yaw)
    steps.finish(root,{'stepCount':len(path),'riserMetres':.23})
    parapet.finish(root)
    empty('clock_stair_landing',(-2.55,6.95,2.5),root)
    return root


def watchtower():
    root = empty('watchtower')
    # The lower drum keeps its full width through the arch. Above Y=10 it
    # tapers to a 19.6 m body under the 20 m crown. This preserves 7 m flanks.
    def radius(y):
        return 14 if y <= 10 else 14-(y-10)*4.2/17.8

    drum_root=empty('watchtower_tapered_block_drum',parent=root)
    sources=[]
    # A closed masonry core: solid up to Y=17, then an upper chamber. The
    # recessed mortar surface closes course joints instead of exposing sky.
    core=Mesh('watchtower_structural_drum_source')
    profile=[(0,0),(14,0),(14,8),(14,10),(radius(17),17),
             (radius(27.8),27.8),(8.1,27.8),(8.1,17),(0,17)]
    segments=48
    points=[]
    for ring,(r,y) in enumerate(profile):
        for i in range(segments):
            a=i*TAU/segments
            # Cardinal edges remain exactly on the 28 m diameter. Mortar
            # between them is recessed; there are no disconnected ivy slabs.
            rr=r-(.25 if ring in range(1,6) and i%12 else 0)
            points.append((rr*math.cos(a),y,rr*math.sin(a)))
    faces=[]
    for j in range(len(profile)):
        k=(j+1)%len(profile)
        for i in range(segments):
            n=(i+1)%segments
            faces.append((j*segments+i,j*segments+n,k*segments+n,k*segments+i))
    core.geometry(points,faces)
    sources.append((core.finish(root),True))
    blocks=Mesh('watchtower_block_courses_source')
    for row in range(24):
        y0=0 if row==0 else row*27.8/24+.014
        y1=(row+1)*27.8/24-.014
        for col in range(20):
            a=col*TAU/20
            blocks.wedge(y0,y1,radius(y0)-.32,radius(y0),radius(y1)-.32,radius(y1),
                         a+.0025,a+TAU/20-.0025)
    sources.append((blocks.finish(root),False))
    # Keep the existing lower-region node/clearance contract; both regions now
    # sample stone. The historical node suffix does not select its material.
    surfaces={region:Mesh('watchtower_drum_'+region,'concrete','wall-block')
              for region in ['concrete','jungle']}
    for obj,is_core in sources:
        # Recalculate source normals as well as the cutter before booleans.
        bpy.context.view_layer.objects.active=obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=.00001)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)
        subtract(obj,prism('temporary_tunnel_cutter',arch_outline(7,8,2,segments=32),-17,17))
        for side in [-1,1]:
            outline=[(x,y+20) for x,y in arch_outline(.72,1.8,.8,bottom=0,segments=12)]
            subtract(obj,prism('temporary_window_cutter',outline,side*9.3,side*13))
        # Single-material meshes retain reliable COLOR_0 in the GLB exporter.
        for face in obj.data.polygons:
            pts=[game_point(obj.data.vertices[index].co) for index in face.vertices]
            center=sum((Vector(p) for p in pts),Vector())/len(pts)
            a=math.atan2(center.z,center.x)
            role='jungle' if center.y<10 else 'concrete'
            shade=(.48 if is_core else .76)+.025*(face.index%5)
            tint=(shade,shade+.035,shade*.91,1)
            surfaces[role].geometry(pts,[tuple(range(len(pts)))],tint)
        bpy.data.objects.remove(obj,do_unlink=True)
    for role,surface in surfaces.items():
        obj=surface.finish(drum_root,{'structuralSurface':True,'mossBand':role=='jungle','mossTintFadeMetres':10})
        colours=obj.data.color_attributes['Color']
        for face in obj.data.polygons:
            for loop in face.loop_indices:
                p=obj.data.vertices[obj.data.loops[loop].vertex_index].co
                y=p.z
                a=math.atan2(-p.y,p.x)
                amount=max(0,1-y/10)*(.65+.15*math.sin(a*7+y*.3))
                stone=tuple(colours.data[loop].color)
                moss=(.34,.47,.27,1)
                colours.data[loop].color=tuple(stone[k]*(1-amount)+moss[k]*amount for k in range(4))
    # Narrow surface strands keep the courses exposed and stay outside the bore.
    ivy=Mesh('watchtower_ivy_strands','jungle-card','fern')
    roots=Mesh('watchtower_moss_in_course_joints','jungle','moss-blossom')
    for a,top,length in [(.3,13,5),(2.5,11,4),(3.6,15,6),(5.8,12,5)]:
        # A narrow damp seam under each climbing strand, on the existing
        # masonry contour; the broad lower surface remains the stone cell.
        for y in [top-length,top-length+1.16]:
            roots.wedge(y,y+.08,radius(y)-.04,radius(y)+.015,
                        radius(y+.08)-.04,radius(y+.08)+.015,a-.035,a+.035,(.38,.52,.30,1))
        for dy in [0,length*.45]:
            y=top-dy
            pts=[]
            for tangent,height in [(-.45,y-length*.6),(.45,y-length*.6),(.45,y),(-.45,y)]:
                r=radius(height)+.06
                pts.append((r*math.cos(a)-tangent*math.sin(a),height,r*math.sin(a)+tangent*math.cos(a)))
            ivy.geometry(pts,[(0,1,2,3)],(.70,.80,.62,1))
    ivy.finish(root,{'card':True,'surfaceStrands':True})
    roots.finish(root,{'mossInMortarJoints':True})
    lamps=Mesh('watchtower_tunnel_lamp_discs','emissive','lamp-disc')
    for side in [-1,1]:
        for i in range(24):
            a,b=i*TAU/24,(i+1)*TAU/24
            lamps.geometry([(side*7.025,6,0),(side*7.025,6+.7*math.cos(a),.7*math.sin(a)),
                            (side*7.025,6+.7*math.cos(b),.7*math.sin(b))],[(0,1,2)])
    lamps.finish(root,{'lampCount':2,'flushWithBoreWall':True})
    # The exterior arch repeats the two bore lamps' atlas cell. It exposes the
    # light at the mouth without placing a luminous card across the passage.
    beacon=Mesh('watchtower_portal_lamp_arches','emissive','lamp-disc')
    for side in (-1,1):
        for i in range(24):
            a,b=i*math.pi/24,(i+1)*math.pi/24
            points=[]
            for r,t in [(7.06,a),(7.65,a),(7.65,b),(7.06,b)]:
                x=r*math.cos(t);y=8+(2.03 if r<7.1 else 2.88)*math.sin(t)
                points.append((x,y,side*(math.sqrt(max(.1,radius(y)**2-x*x))+.23)))
            beacon.geometry(points,[(0,1,2,3)])
    beacon.finish(root,{'exteriorLampArch':True,'keepsBoreOpen':True})
    crown=Mesh('watchtower_crown_cornice')
    for i in range(48):
        crown.wedge(27.65,28.5,8.1,9.95,8.1,10,i*TAU/48,(i+1)*TAU/48,(.85,.88,.79,1))
    crown.finish(root)
    merlons=Mesh('watchtower_crenellations_nine_of_twelve')
    missing=[1,5,8]
    for i in range(12):
        if i in missing:
            continue
        a=i*TAU/12
        for row in range(2):
            merlons.wedge(28.5+row*.75,29.25+row*.75,8.35,10,8.35,10,
                         a-.16,a+.16,(.86,.89,.79,1))
    merlons.finish(root,{'nominalSlots':12,'missingSlots':missing,'existingMerlons':9})
    caps=Mesh('watchtower_merlon_moss_tops','jungle','moss-blossom')
    for i in range(12):
        if i in missing:continue
        a=i*TAU/12
        caps.geometry([(r*math.cos(t),30.002,r*math.sin(t)) for r,t in
                       [(8.35,a-.16),(10,a-.16),(10,a+.16),(8.35,a+.16)]],[(0,1,2,3)],(.59,.75,.47,1))
    caps.finish(root,{'mossTopFaces':9})
    for slot in missing:
        empty('missing_merlon_%02d'%slot,(9.1*math.cos(slot*TAU/12),28.5,9.1*math.sin(slot*TAU/12)),root)
    # Both portals conform to the curved masonry; their inner edges follow
    # the same 32-segment ellipse as the full-depth tunnel cutter.
    for side,label in [(-1,'front'),(1,'back')]:
        arch=Mesh('watchtower_'+label+'_arch_voussoirs')
        def portal_quad(outline,depth0=-.12,depth1=.20):
            pts=[(x,y,side*(math.sqrt(max(.1,radius(y)**2-x*x))+depth))
                 for depth in [depth0,depth1] for x,y in outline]
            arch.geometry(pts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),
                               (1,2,6,5),(2,3,7,6),(3,0,4,7)],(.88,.89,.77,1))
        for i in range(32):
            if i in [15,16]:
                continue
            a,b=(i+.035)*math.pi/32,(i+.965)*math.pi/32
            portal_quad([(7*math.cos(a),8+2*math.sin(a)),
                         (7.75*math.cos(a),8+2.95*math.sin(a)),
                         (7.75*math.cos(b),8+2.95*math.sin(b)),
                         (7*math.cos(b),8+2*math.sin(b))])
        for side_x in [-1,1]:
            for row in range(8):
                portal_quad([(side_x*7,row+.015),(side_x*7.75,row+.015),
                             (side_x*7.75,row+.985),(side_x*7,row+.985)])
        arch.finish(root)
        key=Mesh('watchtower_'+label+'_arch_keystone')
        outline=[(-.65,10.015),(.65,10.015),(.9,11.0),(-.9,11.0)]
        pts=[(x,y,side*(math.sqrt(radius(y)**2-x*x)+depth))
             for depth in [-.1,.27] for x,y in outline]
        key.geometry(pts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],(.54,.59,.43,1))
        key.finish(root)
        frame=Mesh('watchtower_'+label+'_arched_window')
        for i in range(12):
            a,b=i*math.pi/12,(i+1)*math.pi/12
            outline=[(r*math.cos(t),21.8+r*math.sin(t)) for r,t in [(.72,a),(1.0,a),(1.0,b),(.72,b)]]
            pts=[(x,y,side*(math.sqrt(radius(y)**2-x*x)+d)) for d in [-.12,.18] for x,y in outline]
            frame.geometry(pts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
        for x in [-.86,.86]:
            frame.box((x,20.9,side*radius(20.9)),(.28,1.8,.4))
        frame.box((0,19.94,side*radius(20)),(2.08,.22,.62))
        frame.finish(root)
        dark=Mesh('watchtower_'+label+'_window_recess')
        dark.box((0,21.1,side*9.35),(1.4,2.7,.08),(.055,.07,.05,1))
        dark.finish(root)
        window=Mesh('watchtower_'+label+'_window_lamp','emissive','lamp-disc')
        outline=arch_outline(.68,1.8,.72,bottom=0,segments=12)
        points=[(x,y+20,side*9.41) for x,y in outline]
        window.geometry(points,[tuple(range(len(points)))])
        window.finish(root,{'nightWindowLamp':True})
    floor=Mesh('watchtower_upper_chamber_floor','concrete','causeway-paving')
    for i in range(32):
        floor.wedge(17,17.12,0,8.11,0,8.11,i*TAU/32,(i+1)*TAU/32)
    floor.finish(root)
    empty('watchtower_tunnel_axis',(0,4,0),root)
    return root


def waterfall_cliff():
    root=empty('waterfall-cliff')
    stone=Mesh('waterfall_stacked_block_cliff')
    stone.box((0,8,.65),(21.90,15.85,2.5),(.44,.49,.39,1))
    moss=Mesh('waterfall_mossy_ledge_caps','jungle','moss-blossom')
    # Width bounds are authored at +/-11, basin datum 0, lip datum 16.
    for row in range(8):
        count=7 if row%2==0 else 8
        step=22/count
        for col in range(count):
            x=-11+(col+.5)*step
            z=.1+.4*(row%3)+.12*((col*3+row)%4)
            top=(row+1)*2-.045
            stone.box((x,row*2+1,z),(step-.055,1.91,4.1),(.7+.03*(col%4),.78,.65,1))
            if (row+col)%3==0 or row==7:
                moss.box((x,top+.035,z),(step-.07,.11,4.08),(.59,.75,.47,1))
    stone.finish(root)
    moss.finish(root)
    ledges=Mesh('waterfall_projecting_shadow_ledges')
    for x,y,w,z in [(-7,4,7,-1.3),(6,7.6,7.4,-1.2),(-6,11.8,8.8,-1.05),(6.8,13.7,6.8,-.8)]:
        ledges.box((x,y,z),(w,.55,4.8),(.69,.79,.63,1))
    # Top lip front edge at Z=-3.5; the runtime sheet drops vertically here.
    ledges.box((0,15.76,-2.5),(9,.48,2),(.69,.8,.65,1))
    ledges.finish(root)
    sheets=Mesh('waterfall_scrolling_sheet_cards','water','waterfall')
    for x,z in [(-3,-3.68),(0,-3.76),(3,-3.68)]:
        sheets.geometry([(x-1.65,0,z),(x+1.65,0,z),(x+1.65,16,z),(x-1.65,16,z)],[(0,1,2,3)])
    sheet_obj=sheets.finish(root,{'scrollingSheet':True,'dropMetres':16})
    u0,v0,u1,v1=rect('water','waterfall')
    for face in sheet_obj.data.polygons:
        left=u0+(u1-u0)*face.index/3;right=u0+(u1-u0)*(face.index+1)/3
        for loop,uv in zip(face.loop_indices,[(left,v0),(right,v0),(right,v1),(left,v1)]):
            sheet_obj.data.uv_layers.active.data[loop].uv=uv
    # One additional draw holds the faster sheet and pool mist. Alpha is
    # retained through hero merging; the runtime chooses the matching sampler.
    overlay=Mesh('waterfall_fast_sheet_and_mist','water','waterfall')
    for x,z in [(-3,-3.84),(0,-3.92),(3,-3.84)]:
        overlay.geometry([(x-1.65,0,z),(x+1.65,0,z),(x+1.65,16,z),(x-1.65,16,z)],[(0,1,2,3)],(1,1,1,.6))
    overlay.geometry([(-6.5,.15,-5.0),(6.5,.15,-5.0),(6.5,3.2,-5.0),(-6.5,3.2,-5.0)],
                     [(0,1,2,3)],(1,1,1,.24),uv_rect=rect('emissive','lamp-disc'))
    overlay_obj=overlay.finish(root,{'fastSheetAlpha':.6,'mistAlpha':.24,'mistCell':'emissive/lamp-disc'})
    overlay_obj.data.materials[0]=MATERIALS['water-overlay']
    u0,v0,u1,v1=rect('emissive','lamp-disc')
    for loop,uv in zip(overlay_obj.data.polygons[-1].loop_indices,[(u0,v0),(u1,v0),(u1,v1),(u0,v1)]):
        overlay_obj.data.uv_layers.active.data[loop].uv=uv
    foam=Mesh('waterfall_plunge_pool_foam_ring','water','foam-gradient')
    n=48
    for i in range(n):
        a,b=i*TAU/n,(i+1)*TAU/n
        pts=[]
        for radius,t in [(1,a),(1.5,a),(1.5,b),(1,b)]:
            pts.append((6.2*radius*math.cos(t),.08+.025*math.sin(t*7),-5+2.6*radius*math.sin(t)))
        u0,v0,u1,v1=rect('water','foam-gradient')
        foam.geometry(pts,[(0,1,2,3)],uv_rect=(u0,v0+(v1-v0)*.78,u1,v1))
    foam.finish(root)
    for x,y,z,label in [(-7.4,4.3,-2.7,'left'),(7.8,7.9,-2.5,'right')]:
        cards=Mesh('waterfall_blossom_clump_'+label,'jungle-card','blossom-shrub')
        for i in range(3):
            a=i*math.pi/3
            dx,dz=1.65*math.cos(a),1.65*math.sin(a)
            cards.geometry([(x-dx,y,z-dz),(x+dx,y,z+dz),(x+dx,y+2.7,z+dz),(x-dx,y+2.7,z-dz)],[(0,1,2,3)])
        obj=cards.finish(root,{'card':True})
        # All crossed cards get the same sprite orientation, including sideways cards.
        uv=obj.data.uv_layers.active
        u0,v0,u1,v1=rect('jungle-card','blossom-shrub')
        for p in obj.data.polygons:
            for index,value in zip(p.loop_indices,[(u0,v0),(u1,v0),(u1,v1),(u0,v1)]):
                uv.data[index].uv=value
    anchor=empty('waterfall_sheet_anchor',(0,16,-3.5),root)
    anchor['widthMetres']=8
    anchor['dropMetres']=16
    empty('waterfall_pool_datum',(0,0,-3.5),root)
    return root


def sea_stacks():
    root=empty('sea-stack-set')
    # Four independent roots retain their own local origin for later placement.
    specs=[('18',18,-27,5.5,-2.2,0,6),('26',26,-9,4,2.8,.8,8),
           ('32',32,10,6.5,-3.0,-1,7),('40',40,29,5.0,3.6,.7,9)]
    for label,height,x,radius,lean,zlean,sides in specs:
        part=empty('sea_stack_'+label+'m',(x,0,0),root)
        rock=Mesh('stack_'+label+'_tapered_block_courses')
        cap=Mesh('stack_'+label+'_moss_cap','jungle','moss-blossom')
        rows=8 if height<30 else 11
        for row in range(rows):
            t0,t1=row/rows,(row+1)/rows
            # The short buttress, needle, arch and overhanging tall stack differ
            # in profile, course height, radial facet count and lean direction.
            if label=='18':
                profile=lambda t: 1-.55*t+.12*math.sin(t*math.pi)
            elif label=='26':
                profile=lambda t: 1-.64*min(t*2.2,1)+.07*math.sin(t*11)
            elif label=='32':
                profile=lambda t: 1-.46*t+.06*math.sin(t*8)
            else:
                profile=lambda t: 1-.52*t+(.20 if .58<t<.76 else 0)
            y0,y1=t0*height,(t1*height-.055 if row<rows-1 else height-.32)
            pts=[(lean*t+radius*profile(t)*math.cos(side*TAU/sides),y,
                  zlean*t+radius*profile(t)*math.sin(side*TAU/sides))
                 for y,t in [(y0,t0),(y1,t1)] for side in range(sides)]
            faces=[tuple(range(sides)),tuple(reversed(range(sides,2*sides)))]
            faces += [(i,i+sides,(i+1)%sides+sides,(i+1)%sides) for i in range(sides)]
            rock.geometry(pts,faces,(.28,.33+.012*(row%3),.37,1))
        obj=rock.finish(part)
        if label=='32':
            cutter=prism('temporary_natural_arch',[(px-1.4,py) for px,py in arch_outline(2.25,8,4.5,segments=9)],-15,15,parent=part)
            subtract(obj,cutter)
            project_uvs(obj,'concrete','wall-block',[(.28,.34,.37,1)]*len(obj.data.polygons))
            obj['naturalArch']=True
        notch=Mesh('stack_'+label+'_wave_cut_notch')
        # A narrow recessed contour with a darker tint seats each silhouette
        # into the water; its own bounds remain the authored stack's bounds.
        for i in range(sides):
            points=[]
            for y,angle in [(1.5,i*TAU/sides),(2.5,i*TAU/sides),
                            (2.5,(i+1)*TAU/sides),(1.5,(i+1)*TAU/sides)]:
                t=y/height;r=radius*profile(t)+.018
                points.append((lean*t+r*math.cos(angle),y,zlean*t+r*math.sin(angle)))
            notch.geometry(points,[(0,1,2,3)],(.10,.14,.17,1))
        notch_obj=notch.finish(part,{'waveCutHeightMetres':[1.5,2.5]})
        if label=='32':
            cutter=prism('temporary_notch_arch',[(px-1.4,py) for px,py in arch_outline(2.25,8,4.5,segments=9)],-15,15,parent=part)
            subtract(notch_obj,cutter)
            project_uvs(notch_obj,'concrete','wall-block',[(.10,.14,.17,1)]*len(notch_obj.data.polygons))
        rtop=radius*profile(1)
        for i in range(sides):
            cap.wedge(height-.32,height,0,rtop+.15,0,rtop*.93,i*TAU/sides,(i+1)*TAU/sides,
                      (.32,.45,.31,1),(lean,zlean))
        cap.finish(part)
        part['heightMetres']=height
        part['leanMetres']=[lean,zlean]
    return root


ASSETS = {
    'clock-tower': {
        'builder':clock_tower,'budget':6000,
        'targetMetres':{'height':14,'plinthWidth':8,'plinthDepth':8,'faceDiameter':3.2},
        'calibration':'Metres override sheet proportions: plinth 8 x 8, three 0.4 m tiers; 4.68 m square shaft offset X=-0.65; face diameter 3.2; eaves at 11.37; finial apex Y=14. Winding side stair has 25 individual 0.23 m risers.',
        'features':['stepped three-tier plinth','square mossy shaft with visible block courses','round white 3.2 m face with two plain metal hands','pitched hip roof with finial','winding side stair with stepped stone parapet'],
        'featureFrames':[['front','three-quarter'],['front','back'],['front','three-quarter'],['front','side'],['side','back','three-quarter']],
        'anchors':['clock_hand_pivot','clock_stair_landing'],
        'references':['sheets/s5_clock_tower_ortho.png','heroes/05d_clock_court_day.png'],
    },
    'watchtower': {
        'builder':watchtower,'budget':10000,
        'targetMetres':{'height':30,'width':28,'depth':28,'crownWidth':20,'boreWidth':14,'boreSpringHeight':8,'boreCrownHeight':10,'minimumFlank':7,'minimumOverburden':6},
        'calibration':'REVISED 2026-09-10: 28 m base drum stays full width through Y=10 to retain 7 m flanks, then tapers to a 19.6 m body and 20 m crown. Merlon tops Y=30. The full-depth elliptical bore is 14 m wide, spring Y=8, crown Y=10, tessellated into 32 arch segments. The solid drum reaches the upper chamber floor at Y=17, giving 7 m of masonry above the arch. A 14 x 10 rectangle is the arch envelope, not a clear rectangular volume. Stone-cell vertex tint fades the lower moss by Y=10; narrow keyed ivy strands and moss-filled course joints retain sparse accents. Two flush emissive discs light the bore. Projecting portal trim is included in overall depth.',
        'features':['tapered drum with individual block courses','twelve crenellation slots with exactly three missing merlons','two recessed arched windows on opposite faces','full-depth arched tunnel with a keystone at both mouths','stone-cell moss tint, narrow ivy strands and two tunnel lamps'],
        'featureFrames':[['side','three-quarter'],['three-quarter','back'],['front','back'],['front','back'],['front','side']],
        'anchors':['watchtower_tunnel_axis','missing_merlon_01','missing_merlon_05','missing_merlon_08'],
        'references':['sheets/s6_watchtower_ortho.png','heroes/03_watchtower_point_day.png'],
    },
    'waterfall-cliff': {
        'builder':waterfall_cliff,'budget':5000,
        'targetMetres':{'drop':16,'width':22},
        'calibration':'Cliff horizontal envelope X=+/-11; the named sheet lip is Y=16 and pool datum Y=0. Three scrolling sheet cards span that exact 16 m drop; the runtime wraps their UVs inside the waterfall cell. Stone/moss cap upper surface may sit slightly above the lip.',
        'features':['stacked mossy stone block cliff with ledges','elliptical plunge-pool foam ring mesh','two blossom clumps on the existing jungle-card sheet','projecting block ledges that cast distinct shadows','overhanging top lip, waterfall_sheet_anchor and full-drop scrolling sheets'],
        'featureFrames':[['front','three-quarter'],['three-quarter'],['front','three-quarter'],['side','three-quarter'],['side','three-quarter']],
        'anchors':['waterfall_sheet_anchor','waterfall_pool_datum'],
        'references':['heroes/04_basin_causeway_night.png','heroes/05d_clock_court_day.png'],
    },
    'sea-stack-set': {
        'builder':sea_stacks,'budget':6000,'perStackBudget':1500,
        'targetMetres':{'stackHeights':[18,26,32,40]},
        'calibration':'Each named child is authored from local Y=0 to its exact 18/26/32/40 m moss-cap top. Display translations X=-27/-9/10/29 are separable placement defaults. Lean is baked into the course centres without rotating the vertical height datum.',
        'features':['four tapered block silhouettes','individual moss caps','one natural through-arch in the 32 m stack','four different lean/profile combinations','distinct buttress, needle, arch and overhanging tall silhouettes'],
        'featureFrames':[['front','three-quarter'],['three-quarter'],['front','back'],['front','three-quarter'],['front','three-quarter']],
        'anchors':['sea_stack_18m','sea_stack_26m','sea_stack_32m','sea_stack_40m'],
        'references':['heroes/06_reef_shallows_day.png','heroes/06n_reef_shallows_night.png'],
    },
}


def export_asset(root, path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root]+list(root.children_recursive):
        obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
                             export_yup=True,export_texcoords=True,export_normals=True,
                             export_materials='EXPORT',export_extras=True,
                             export_image_format='NONE',export_animations=False,
                             export_vertex_color='NAME',export_vertex_color_name='Color',
                             export_all_vertex_colors=False)


def measure_glb(path):
    data=path.read_bytes()
    length,kind=struct.unpack_from('<II',data,12)
    assert kind==0x4E4F534A
    doc=json.loads(data[20:20+length])
    assert not doc.get('images') and not doc.get('textures'), 'Embedded or external glTF textures forbidden'
    triangles=0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            assert primitive.get('mode',4)==4
            count=doc['accessors'][primitive['indices']]['count'] if 'indices' in primitive else doc['accessors'][primitive['attributes']['POSITION']]['count']
            triangles+=count//3
    binary_start=28+length
    bounds_min=[math.inf]*3
    bounds_max=[-math.inf]*3
    def visit(index,parent):
        node=doc['nodes'][index]
        if 'matrix' in node:
            local=Matrix([node['matrix'][i::4] for i in range(4)])
        else:
            x,y,z,w=node.get('rotation',[0,0,0,1])
            local=Matrix.LocRotScale(Vector(node.get('translation',[0,0,0])),Quaternion((w,x,y,z)),Vector(node.get('scale',[1,1,1])))
        world=parent@local
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                accessor=doc['accessors'][primitive['attributes']['POSITION']]
                view=doc['bufferViews'][accessor['bufferView']]
                offset=binary_start+view.get('byteOffset',0)+accessor.get('byteOffset',0)
                for i in range(accessor['count']):
                    point=world@Vector(struct.unpack_from('<fff',data,offset+i*view.get('byteStride',12)))
                    for axis in range(3):
                        bounds_min[axis]=min(bounds_min[axis],point[axis])
                        bounds_max[axis]=max(bounds_max[axis],point[axis])
        for child in node.get('children',[]):
            visit(child,world)
    for index in doc['scenes'][doc.get('scene',0)]['nodes']:
        visit(index,Matrix.Identity(4))
    bounds={'min':bounds_min,'max':bounds_max,'size':[b-a for a,b in zip(bounds_min,bounds_max)]}
    return {'triangles':triangles,'bounds':bounds,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
            'materials':[m['name'] for m in doc.get('materials',[])],
            'measurement':'Exported GLB index and position accessors, with node transforms, parsed by build_dreamisland_heroes.py; independently checked by GLTFLoader.'}


def main():
    global MATERIALS
    OUT.mkdir(parents=True,exist_ok=True)
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    MATERIALS=make_materials()
    manifest={'script':'art/blender/build_dreamisland_heroes.py','roles':ROLES,
              'units':'metres','coordinates':'Y up, -Z front','textureBinding':'DI_MAT_<role> -> ../textures/<role>.jpg; DI_MAT_jungle-card -> ../jungle-card.png with magenta discard',
              'atlasManifestSha256':hashlib.sha256(ATLAS_PATH.read_bytes()).hexdigest(),
              'atlasFiles':ATLAS['files'],'assets':{}}
    chosen=next((arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--asset=')),None)
    if chosen:
        selected=chosen.split(',')
        assert all(name in ASSETS for name in selected),chosen
        manifest=json.loads((OUT/'heroes.json').read_text())
        assert manifest['atlasManifestSha256']==hashlib.sha256(ATLAS_PATH.read_bytes()).hexdigest()
    for name,spec in ASSETS.items():
        if chosen and name not in selected:
            continue
        root=spec['builder']()
        path=OUT/(name+'.glb')
        export_asset(root,path)
        measured=measure_glb(path)
        assert measured['triangles']<=spec['budget'],(name,measured)
        assert measured['bytes']<1_000_000,(name,measured)
        entry={k:v for k,v in spec.items() if k!='builder'}
        entry.update(measured)
        entry['file']=path.name
        manifest['assets'][name]=entry
        print('EXPORTED',name,json.dumps(measured))
    (OUT/'heroes.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Run the independent loader check to measure world-space bounds and full-depth bore clearance.')


if __name__=='__main__':
    main()
