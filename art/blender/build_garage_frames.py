"""Author the five garage frames as runtime GLBs; TOTEM itself stays untouched.

Run:  python3 art/blender/build_garage_frames.py [--render]
      (the `bpy` module from PyPI, or `blender -b -P` with the same arguments)

Coordinates in the modelling helpers are the game's: X right, Y up, Z aft,
metres, the hover deck at y = 0. `g2b` converts to Blender's Z-up so the glTF
exporter's Y-up conversion lands every vertex back where it was authored.

THE CONTRACT each frame keeps with `TotemVehicle` (`scripts/validate-garage-frames.mjs`
pins all of it):

  - It is a BODY, not a vehicle. The player's TOTEM stays loaded underneath:
    its FX anchors, hover blob, effects and the enhancement kit's jets keep
    working, and the rival field keeps racing the works TOTEM. Mounting a
    frame hides TOTEM's hull meshes and puts this body in their place.
  - Animated parts sit under empties named exactly like TOTEM's pivots, with
    identity rotation, so the existing `updateVisual` drives them unchanged:
    steering fins yaw (local y), airbrakes pitch (local x, panel forward of
    its hinge so a positive angle lifts it into the air), elevons yaw,
    `stabiliser_ring_pivot` rolls (local z), `skids_pivot` drops 0.22 m at rest.
  - `FX_jet_left` / `FX_jet_right` mark the twin nozzle exits; the kit's jets
    are re-anchored there.
  - Materials by role: `FRAME_paint` (the painted livery atlas), `FRAME_flat`
    (the same paint, untextured), `FRAME_accent`, `FRAME_trim`, `FRAME_metal`,
    `FRAME_glass`, `FRAME_lights` (recoloured by the RUNNING LIGHTS paint), and
    `TE_boost` / `TE_brake`, which the runtime swaps for the kit's live lamp
    materials so the reserve and brake lamps keep reporting.
  - Power-device hardpoints: the hull top at x = +-0.78 near z = 0 sits low
    enough that the kit's mounts reach it.

Style: the TOTEM family — faceted hard-surface, flat-shaded, dark trim, one
painted atlas per frame carrying panel seams, grime, exhaust soot, stripes and
a fleet number. PS2-era memory, not photoreal: every facet is honest geometry.
"""
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'public/assets/garage/frames'
EVIDENCE = ROOT / 'art/evidence/garage-frames'
TEXTURES = ROOT / 'art/textures/garage-frames'
for folder in (OUTPUT, EVIDENCE, TEXTURES):
    folder.mkdir(parents=True, exist_ok=True)
RENDER = '--render' in sys.argv


def g2b(p):
    return (p[0], -p[2], p[1])


# ---------------------------------------------------------------------------
# Geometry: one builder per object, faces carry a material role and UVs.
# ---------------------------------------------------------------------------

ROLES = ['FRAME_paint', 'FRAME_flat', 'FRAME_accent', 'FRAME_trim', 'FRAME_metal',
         'FRAME_glass', 'FRAME_lights', 'TE_boost', 'TE_brake']
FLAT_UV = (0.5, 0.004)  # the clean-paint row at the very top of every atlas


class Builder:
    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = name, origin
        self.verts, self.faces = [], []  # faces: (indices, role, uvs)

    def v(self, p):
        self.verts.append((p[0] - self.origin[0], p[1] - self.origin[1], p[2] - self.origin[2]))
        return len(self.verts) - 1

    def face(self, points, role, uvs=None):
        ids = [self.v(p) for p in points]
        self.faces.append((ids, role, uvs or [FLAT_UV] * len(ids)))

    # A closed solid from rings of 3D points (same count), capped both ends.
    def loft(self, rings, role, uv_rings=None, cap_roles=(None, None), belly_edges=(), belly_role='FRAME_trim'):
        count = len(rings[0])
        for s in range(len(rings) - 1):
            a, b = rings[s], rings[s + 1]
            for k in range(count):
                k2 = (k + 1) % count
                uvs = None
                if uv_rings:
                    ua, ub = uv_rings[s], uv_rings[s + 1]
                    uvs = [ua[k], ua[k + 1], ub[k + 1], ub[k]]
                self.face([a[k], a[k2], b[k2], b[k]], belly_role if k in belly_edges else role, uvs)
        for ring, cap in ((rings[0], cap_roles[0]), (rings[-1], cap_roles[1])):
            centre = tuple(sum(p[i] for p in ring) / count for i in range(3))
            for k in range(count):
                self.face([centre, ring[k], ring[(k + 1) % count]], cap or role)

    def box(self, centre, size, role):
        cx, cy, cz = centre
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        ring = lambda z: [(cx - hx, cy - hy, z), (cx + hx, cy - hy, z), (cx + hx, cy + hy, z), (cx - hx, cy + hy, z)]
        self.loft([ring(cz - hz), ring(cz + hz)], role)

    # A plate from a mid-surface outline (3D points) thickened along world Y.
    def plate(self, outline, thickness, role, edge_role=None):
        lower = [(x, y - thickness / 2, z) for x, y, z in outline]
        upper = [(x, y + thickness / 2, z) for x, y, z in outline]
        self.face(upper, role)
        self.face(list(reversed(lower)), role)
        n = len(outline)
        for k in range(n):
            k2 = (k + 1) % n
            self.face([lower[k], lower[k2], upper[k2], upper[k]], edge_role or role)

    # A vertical plate: outline in (z, y) at lateral x, thickened along X.
    def fin(self, outline_zy, x, thickness, role, edge_role=None):
        left = [(x - thickness / 2, y, z) for z, y in outline_zy]
        right = [(x + thickness / 2, y, z) for z, y in outline_zy]
        self.face(right, role)
        self.face(list(reversed(left)), role)
        n = len(outline_zy)
        for k in range(n):
            k2 = (k + 1) % n
            self.face([left[k], left[k2], right[k2], right[k]], edge_role or role)

    # A faceted cylinder along Z with tapered ends.
    def pod(self, centre, radius, z0, z1, role, segments=8, nose=0.45, tail=0.6, end_role=None, squash=1.0):
        cx, cy = centre
        span = z1 - z0
        profile = [(z0, radius * nose), (z0 + span * 0.18, radius), (z1 - span * 0.12, radius), (z1, radius * tail)]
        rings = []
        for z, r in profile:
            rings.append([(cx + r * math.cos(a), cy + r * squash * math.sin(a), z)
                          for a in (math.tau * (i + 0.5) / segments for i in range(segments))])
        self.loft(rings, role, cap_roles=(end_role, end_role))

    # A faceted tube between two points (bars, struts, cages).
    def tube(self, start, end, radius, role, segments=6):
        s, e = np.array(start, float), np.array(end, float)
        axis = e - s
        axis /= np.linalg.norm(axis)
        ref = np.array([0, 1, 0]) if abs(axis[1]) < 0.9 else np.array([1, 0, 0])
        u = np.cross(axis, ref); u /= np.linalg.norm(u)
        w = np.cross(axis, u)
        ring = lambda c: [tuple(c + radius * (math.cos(a) * u + math.sin(a) * w))
                          for a in (math.tau * i / segments for i in range(segments))]
        self.loft([ring(s), ring(e)], role)

    # A torus arc around the Z axis through `centre` (rings, halos, coils).
    def arc(self, centre, radius, thickness, depth, a0, a1, role, steps=16, squash=1.0):
        cx, cy, cz = centre
        rings = []
        for n in range(steps + 1):
            a = a0 + (a1 - a0) * n / steps
            c, s = math.cos(a), math.sin(a)
            rings.append([(cx + (radius + dr) * c, cy + (radius + dr) * s * squash, cz + dz)
                          for dr, dz in ((-thickness / 2, -depth / 2), (thickness / 2, -depth / 2),
                                         (thickness / 2, depth / 2), (-thickness / 2, depth / 2))])
        full = abs((a1 - a0) - math.tau) < 1e-6
        if full:
            rings = rings[:-1]
            for n in range(len(rings)):
                a, b = rings[n], rings[(n + 1) % len(rings)]
                for k in range(4):
                    self.face([a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]], role)
        else:
            self.loft(rings, role)

    # A twin-walled nozzle: metal barrel, a lit throat facing aft.
    def nozzle(self, centre, radius, z, depth, role='FRAME_metal', throat='FRAME_lights'):
        cx, cy = centre
        self.pod((cx, cy), radius, z - depth, z, role, segments=8, nose=0.8, tail=1.0, end_role='FRAME_trim')
        inner = [(cx + radius * 0.72 * math.cos(a), cy + radius * 0.72 * math.sin(a), z + 0.012)
                 for a in (math.tau * (i + 0.5) / 8 for i in range(8))]
        self.face(inner, throat)

    def finish(self, materials, parent=None, location=(0, 0, 0)):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([g2b(p) for p in self.verts], [], [f[0] for f in self.faces])
        used = []
        for _, role, _ in self.faces:
            if role not in used:
                used.append(role)
        for role in used:
            mesh.materials.append(materials[role])
        uv = mesh.uv_layers.new(name='UVMap')
        for poly, (_, role, uvs) in zip(mesh.polygons, self.faces):
            poly.material_index = used.index(role)
            poly.use_smooth = False
            for loop, (u, vv) in zip(poly.loop_indices, uvs):
                uv.data[loop].uv = (u, 1 - vv)
        mesh.update()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        obj.location = g2b(location)
        return obj


def empty(name, location, parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.2
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = g2b(location)
    return obj


# ---------------------------------------------------------------------------
# The hull: stations lofted into an eight-sided faceted section.
# ---------------------------------------------------------------------------

def section(st):
    """Keel -> right belly -> right chine -> right shoulder -> spine -> left side."""
    z, w, top, mid, bot = st['z'], st['w'], st['top'], st['mid'], st['bot']
    roof, belly = st.get('roof', 0.42), st.get('belly', 0.62)
    shoulder = top - (top - mid) * st.get('drop', 0.28)
    return [(0, bot, z), (w * belly, bot, z), (w, mid, z), (w * roof, shoulder, z),
            (0, top, z), (-w * roof, shoulder, z), (-w, mid, z), (-w * belly, bot, z)]


def hull_uvs(stations, rings):
    z0, z1 = stations[0]['z'], stations[-1]['z']
    uv_rings = []
    for st, ring in zip(stations, rings):
        pts = ring + [ring[0]]
        lengths = [0.0]
        for a, b in zip(pts, pts[1:]):
            lengths.append(lengths[-1] + math.dist(a, b))
        total = lengths[-1] or 1
        v = 0.02 + 0.96 * (st['z'] - z0) / (z1 - z0)
        uv_rings.append([(l / total, v) for l in lengths])
    return uv_rings


def hull(builder, stations, role='FRAME_paint', offset_x=0.0):
    rings = [[(x + offset_x, y, z) for x, y, z in section(st)] for st in stations]
    uvs = hull_uvs(stations, rings) if role == 'FRAME_paint' else None
    builder.loft(rings, role, uv_rings=uvs, cap_roles=('FRAME_trim', 'FRAME_trim'), belly_edges=(0, 7))
    return rings


def canopy(builder, stations):
    rings = []
    for st in stations:
        z, w, base, top = st
        rings.append([(-w, base, z), (w, base, z), (w * 0.62, top - 0.05, z), (0, top, z), (-w * 0.62, top - 0.05, z)])
    builder.loft(rings, 'FRAME_glass', cap_roles=('FRAME_trim', 'FRAME_trim'))


# ---------------------------------------------------------------------------
# The livery atlas: u runs round the hull section (0 keel, .25 right side,
# .5 spine, .75 left side), v runs nose (0) to tail (1).
# ---------------------------------------------------------------------------

SIZE = 512


def paint_atlas(frame, stations, path):
    livery = frame['livery']
    base = np.array(livery['base'], float)
    u = np.linspace(0, 1, SIZE)[None, :].repeat(SIZE, 0)
    v = np.linspace(0, 1, SIZE)[:, None].repeat(SIZE, 1)
    img = np.ones((SIZE, SIZE, 3)) * base

    def mirror_mask(u0, u1):
        return ((u >= u0) & (u <= u1)) | ((u >= 1 - u1) & (u <= 1 - u0))

    for rule in livery.get('rules', []):
        colour = np.array(rule['colour'], float)
        kind = rule['kind']
        if kind == 'band':  # a length of hull, all the way round (nose cones, tail rings)
            mask = (v >= rule['v0']) & (v <= rule['v1'])
        elif kind == 'spine':  # stripes either side of the spine
            mask = np.zeros_like(u, bool)
            for centre in rule['at']:
                mask |= mirror_mask(centre - rule['width'] / 2, centre + rule['width'] / 2)
            mask &= (v >= rule.get('v0', 0)) & (v <= rule.get('v1', 1))
        elif kind == 'side':  # a band along each flank between two u values
            mask = mirror_mask(rule['u0'], rule['u1']) & (v >= rule.get('v0', 0)) & (v <= rule.get('v1', 1))
        elif kind == 'hazard':  # diagonal hazard chevrons inside a u/v window
            window = mirror_mask(rule['u0'], rule['u1']) & (v >= rule['v0']) & (v <= rule['v1'])
            mask = window & (((u * rule['period'] * 3 + v * rule['period']) % 1) < 0.5)
        elif kind == 'split':  # everything above a u line on both flanks
            mask = (u >= rule['u']) & (u <= 1 - rule['u'])
            mask &= (v >= rule.get('v0', 0)) & (v <= rule.get('v1', 1))
        else:
            raise ValueError(kind)
        img[mask] = colour

    # Shape light baked into the paint the way a PS2 texture would carry it:
    # flanks slightly darker than the spine, the belly edges darker still.
    img *= (0.78 + 0.22 * np.sin(np.pi * u) ** 0.6)[..., None]
    # Grime: low-frequency noise, heavier low on the flanks; soot at the tail.
    rng = np.random.default_rng(frame['seed'])
    noise = Image.fromarray((rng.random((64, 64)) * 255).astype('uint8')).resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    noise = np.asarray(noise.filter(ImageFilter.GaussianBlur(6)), float) / 255
    grime = 1 - 0.16 * noise * (1 - np.sin(np.pi * u) ** 0.5) - 0.07 * noise
    soot = 1 - 0.45 * np.clip((v - 0.86) / 0.14, 0, 1) ** 1.5
    img *= (grime * soot)[..., None]
    speck = rng.random((SIZE, SIZE)) < 0.004
    img[speck] *= 0.55

    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype('uint8'))
    draw = ImageDraw.Draw(out, 'RGBA')
    # Panel seams: every station round the hull, and the chine/shoulder lines.
    z0, z1 = stations[0]['z'], stations[-1]['z']
    for st in stations[1:-1]:
        y = int((0.02 + 0.96 * (st['z'] - z0) / (z1 - z0)) * SIZE)
        draw.line([(0, y), (SIZE, y)], fill=(0, 0, 0, 120), width=2)
        draw.line([(0, y + 2), (SIZE, y + 2)], fill=(255, 255, 255, 26), width=1)
    for seam in livery.get('seams', [0.14, 0.33, 0.44]):
        for x in (seam, 1 - seam):
            draw.line([(x * SIZE, 0.03 * SIZE), (x * SIZE, 0.97 * SIZE)], fill=(0, 0, 0, 90), width=2)
    # Rivet rows along the seams.
    for seam in (0.33, 0.67):
        for y in range(24, SIZE - 24, 14):
            draw.point((seam * SIZE + 4, y), fill=(0, 0, 0, 110))
    # Fleet number on both flanks, reading from outside: nose right on the
    # right flank, nose left on the left flank (checked in the evidence renders).
    font = ImageFont.load_default(size=int(livery.get('number_size', 64)))
    out = out.convert('RGBA')
    for side in ('right', 'left'):
        text = Image.new('RGBA', (220, 90), (0, 0, 0, 0))
        tdraw = ImageDraw.Draw(text)
        tdraw.text((110, 45), frame['number'], font=font, anchor='mm', fill=tuple(int(c * 255) for c in livery['number']) + (235,))
        tdraw.text((110, 84), 'KAIRO', font=ImageFont.load_default(size=13), anchor='mb',
                   fill=tuple(int(c * 255) for c in livery['number']) + (170,))
        # The section winding mirrors both flanks in (u, v), so the number is
        # reflected across a diagonal rather than rotated: transverse on the
        # right flank, transpose on the left.
        rotated = text.transpose(Image.Transpose.TRANSVERSE if side == 'right' else Image.Transpose.TRANSPOSE)
        cx = int((livery.get('number_u', 0.3) if side == 'right' else 1 - livery.get('number_u', 0.3)) * SIZE)
        cy = int(livery.get('number_v', 0.5) * SIZE)
        out.alpha_composite(rotated, (cx - rotated.width // 2, cy - rotated.height // 2))
    out = out.convert('RGB')
    # The clean-paint row every untextured painted part samples.
    ImageDraw.Draw(out).rectangle([0, 0, SIZE, 4], fill=tuple(int(c * 255) for c in base))
    out.save(path, quality=90)
    return path


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def make_materials(frame, atlas_path):
    livery = frame['livery']
    glow = tuple(frame['glow'])
    specs = {
        'FRAME_paint': (livery['base'], 0.12, 0.62, 0),
        'FRAME_flat': (livery['base'], 0.12, 0.62, 0),
        'FRAME_accent': (livery['accent'], 0.18, 0.55, 0),
        'FRAME_trim': ((0.045, 0.05, 0.055), 0.3, 0.7, 0),
        'FRAME_metal': ((0.30, 0.32, 0.33), 0.55, 0.42, 0),
        'FRAME_glass': ((0.01, 0.035, 0.05), 0.1, 0.18, 0),
        # The frame's signature; the runtime re-tints it from the paint shop.
        'FRAME_lights': (glow, 0.0, 0.4, 1.0),
        'TE_boost': ((0.77, 0.9, 0.49), 0.0, 0.5, 0.6),
        'TE_brake': ((0.35, 0.03, 0.01), 0.0, 0.5, 0.2),
    }
    image = bpy.data.images.load(str(atlas_path))
    materials = {}
    for name, (colour, metallic, roughness, emission) in specs.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*colour, 1)
        shader.inputs['Metallic'].default_value = metallic
        shader.inputs['Roughness'].default_value = roughness
        if emission:
            shader.inputs['Emission Color'].default_value = (*colour, 1)
            shader.inputs['Emission Strength'].default_value = emission
        if name == 'FRAME_glass':
            shader.inputs['Alpha'].default_value = 0.62
            mat.surface_render_method = 'BLENDED'
        if name in ('FRAME_paint', 'FRAME_flat'):
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = image
            tex.interpolation = 'Linear'
            mat.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
        materials[name] = mat
    return materials


# ---------------------------------------------------------------------------
# The five frames. Every number is metres in game space.
# ---------------------------------------------------------------------------

def st(z, w, top, mid, bot, roof=0.42, belly=0.62, drop=0.28):
    return dict(z=z, w=w, top=top, mid=mid, bot=bot, roof=roof, belly=belly, drop=drop)


FRAMES = {
    'lance': dict(
        label='LANCE S3', number='S3', seed=31,
        glow=(0.29, 0.89, 1.0),
        livery=dict(base=(0.66, 0.68, 0.66), accent=(0.07, 0.42, 0.50), number=(0.05, 0.06, 0.07),
                    number_u=0.29, number_v=0.52, number_size=66,
                    rules=[dict(kind='band', v0=0, v1=0.2, colour=(0.05, 0.055, 0.06)),
                           dict(kind='spine', at=[0.47, 0.53], width=0.018, v0=0.12, colour=(0.07, 0.55, 0.63)),
                           dict(kind='side', u0=0.18, u1=0.2, v0=0.2, colour=(0.07, 0.55, 0.63)),
                           dict(kind='band', v0=0.9, v1=1, colour=(0.12, 0.13, 0.13))]),
        stations=[st(-4.35, 0.05, 0.16, 0.10, 0.04),
                  st(-3.7, 0.34, 0.30, 0.12, -0.12, 0.45, 0.55),
                  st(-2.5, 0.60, 0.46, 0.14, -0.24, 0.42, 0.6),
                  st(-1.2, 0.76, 0.58, 0.16, -0.30, 0.40, 0.62),
                  st(0.0, 0.84, 0.62, 0.18, -0.32, 0.40, 0.64),
                  st(1.3, 0.82, 0.60, 0.20, -0.30, 0.42, 0.66),
                  st(2.2, 0.70, 0.54, 0.22, -0.24, 0.45, 0.66),
                  st(2.6, 0.62, 0.48, 0.24, -0.18, 0.46, 0.66)],
    ),
    'sidewinder': dict(
        label='SIDEWINDER D2', number='D2', seed=47,
        glow=(1.0, 0.25, 0.66),
        livery=dict(base=(0.085, 0.085, 0.095), accent=(0.78, 0.10, 0.42), number=(0.9, 0.2, 0.55),
                    number_u=0.3, number_v=0.47, number_size=70,
                    rules=[dict(kind='hazard', u0=0.2, u1=0.3, v0=0.14, v1=0.34, period=7, colour=(0.78, 0.10, 0.42)),
                           dict(kind='spine', at=[0.5], width=0.07, v0=0.05, v1=0.95, colour=(0.62, 0.62, 0.64)),
                           dict(kind='spine', at=[0.5], width=0.03, v0=0.05, v1=0.95, colour=(0.78, 0.10, 0.42)),
                           dict(kind='side', u0=0.13, u1=0.16, colour=(0.78, 0.10, 0.42))]),
        stations=[st(-3.35, 0.28, 0.18, 0.06, -0.04, 0.5, 0.5),
                  st(-2.8, 0.92, 0.36, 0.08, -0.22, 0.45, 0.7),
                  st(-1.7, 1.28, 0.54, 0.10, -0.32, 0.34, 0.78),
                  st(-0.5, 1.42, 0.66, 0.12, -0.36, 0.32, 0.8),
                  st(0.8, 1.45, 0.64, 0.14, -0.36, 0.34, 0.8),
                  st(1.8, 1.36, 0.58, 0.16, -0.32, 0.36, 0.78),
                  st(2.4, 1.16, 0.48, 0.18, -0.24, 0.40, 0.75)],
    ),
    'bulwark': dict(
        label='BULWARK G4', number='G4', seed=59,
        glow=(1.0, 0.64, 0.10),
        livery=dict(base=(0.33, 0.34, 0.22), accent=(0.86, 0.60, 0.08), number=(0.92, 0.66, 0.1),
                    number_u=0.3, number_v=0.55, number_size=76, seams=[0.16, 0.3, 0.42],
                    rules=[dict(kind='hazard', u0=0.0, u1=0.5, v0=0.03, v1=0.13, period=9, colour=(0.86, 0.60, 0.08)),
                           dict(kind='side', u0=0.08, u1=0.13, colour=(0.10, 0.10, 0.09)),
                           dict(kind='spine', at=[0.5], width=0.14, v0=0.2, v1=0.85, colour=(0.27, 0.28, 0.18))]),
        stations=[st(-3.45, 0.86, 0.32, 0.10, -0.18, 0.72, 0.8, 0.4),
                  st(-2.95, 1.08, 0.70, 0.20, -0.32, 0.76, 0.84, 0.35),
                  st(-1.3, 1.14, 0.90, 0.24, -0.35, 0.78, 0.86, 0.3),
                  st(0.5, 1.14, 0.92, 0.26, -0.35, 0.80, 0.86, 0.3),
                  st(1.9, 1.10, 0.86, 0.28, -0.32, 0.78, 0.85, 0.3),
                  st(2.45, 1.0, 0.76, 0.30, -0.26, 0.75, 0.84, 0.3)],
    ),
    'corona': dict(
        label='CORONA P5', number='P5', seed=71,
        glow=(0.6, 0.42, 1.0),
        livery=dict(base=(0.075, 0.09, 0.17), accent=(0.40, 0.24, 0.78), number=(0.72, 0.62, 1.0),
                    number_u=0.31, number_v=0.5, number_size=64,
                    rules=[dict(kind='split', u=0.4, v0=0.0, v1=1.0, colour=(0.12, 0.14, 0.26)),
                           dict(kind='spine', at=[0.44, 0.56], width=0.02, colour=(0.40, 0.24, 0.78)),
                           dict(kind='band', v0=0.0, v1=0.06, colour=(0.40, 0.24, 0.78))]),
        stations=[st(-3.65, 0.10, 0.20, 0.10, 0.0, 0.5, 0.5),
                  st(-3.05, 0.54, 0.48, 0.12, -0.20, 0.56, 0.6, 0.22),
                  st(-1.8, 0.84, 0.74, 0.14, -0.30, 0.56, 0.6, 0.22),
                  st(-0.4, 0.94, 0.84, 0.16, -0.34, 0.56, 0.62, 0.22),
                  st(1.0, 0.90, 0.80, 0.18, -0.32, 0.56, 0.62, 0.22),
                  st(2.0, 0.76, 0.68, 0.20, -0.26, 0.56, 0.62, 0.22),
                  st(2.5, 0.62, 0.58, 0.22, -0.18, 0.56, 0.62, 0.22)],
    ),
    'halo': dict(
        label='HALO X1', number='X1', seed=89,
        glow=(0.95, 0.98, 1.0),
        livery=dict(base=(0.74, 0.75, 0.76), accent=(0.78, 0.60, 0.24), number=(0.10, 0.11, 0.12),
                    number_u=0.3, number_v=0.46, number_size=58,
                    rules=[dict(kind='split', u=0.24, v0=0.0, v1=1.0, colour=(0.74, 0.75, 0.76)),
                           dict(kind='side', u0=0.0, u1=0.24, colour=(0.10, 0.11, 0.12)),
                           dict(kind='side', u0=0.235, u1=0.255, colour=(0.78, 0.60, 0.24)),
                           dict(kind='band', v0=0.0, v1=0.1, colour=(0.10, 0.11, 0.12))]),
        stations=[st(-4.0, 0.05, 0.22, 0.12, 0.04),
                  st(-3.1, 0.38, 0.50, 0.14, -0.16, 0.4, 0.55),
                  st(-1.7, 0.54, 0.76, 0.16, -0.24, 0.4, 0.58),
                  st(-0.1, 0.60, 0.82, 0.18, -0.26, 0.4, 0.6),
                  st(1.4, 0.55, 0.70, 0.20, -0.22, 0.42, 0.6),
                  st(2.55, 0.44, 0.54, 0.22, -0.14, 0.45, 0.6)],
    ),
}

# The twin exits every frame shares with the kit's jets (x +-0.45).
JET_X = 0.45


def common_parts(root, mats, frame_code, jet_y, jet_z, hardpoint_y):
    """Pieces every frame carries: nozzles, FX anchors, brake bar, boost meter."""
    body = Builder('rear_static')
    for side in (-1, 1):
        body.nozzle((side * JET_X, jet_y), 0.23, jet_z, 0.55)
    body.box((0, jet_y + 0.34, jet_z - 0.12), (0.62, 0.06, 0.1), 'TE_boost')
    for side in (-1, 1):
        body.box((side * 0.92, jet_y + 0.05, jet_z - 0.18), (0.36, 0.07, 0.05), 'TE_brake')
    body.finish(mats, root)
    empty('FX_jet_left', (-JET_X, jet_y, jet_z + 0.02), root)
    empty('FX_jet_right', (JET_X, jet_y, jet_z + 0.02), root)
    empty('HARDPOINT_left', (-0.78, hardpoint_y, -0.05), root)
    empty('HARDPOINT_right', (0.78, hardpoint_y, -0.05), root)


def skids(root, mats, x, z0, z1, y):
    pivot = empty('skids_pivot', (0, y, (z0 + z1) / 2), root)
    part = Builder('skids_body', (0, y, (z0 + z1) / 2))
    for side in (-1, 1):
        part.box((side * x, y - 0.03, (z0 + z1) / 2), (0.08, 0.06, z1 - z0), 'FRAME_metal')
        for z in (z0 + 0.4, z1 - 0.4):
            part.tube((side * x, y, z), (side * x * 0.8, y + 0.2, z), 0.035, 'FRAME_trim')
    part.finish(mats, pivot)


def hinged(name, root, mats, hinge, build):
    """An animated part: an empty at the hinge, the geometry authored in world space."""
    pivot = empty(f'{name}_pivot', hinge, root)
    part = Builder(f'{name}_body', hinge)
    build(part)
    part.finish(mats, pivot)
    return pivot


def build_lance(root, mats, frame):
    stations = frame['stations']
    body = Builder('body_static')
    hull(body, stations)
    canopy(body, [(-2.9, 0.18, 0.40, 0.46), (-2.2, 0.26, 0.46, 0.74), (-1.2, 0.27, 0.56, 0.80), (-0.5, 0.22, 0.58, 0.70)])
    # Needle probe and a nose splitter.
    body.tube((0, 0.1, -4.3), (0, 0.1, -4.72), 0.03, 'FRAME_metal')
    body.plate([(-0.5, -0.13, -3.55), (0.5, -0.13, -3.55), (0.62, -0.15, -2.9), (-0.62, -0.15, -2.9)], 0.04, 'FRAME_trim')
    # Low swept delta wings, slight anhedral.
    for s in (-1, 1):
        body.plate([(s * 0.7, 0.06, -0.8), (s * 1.58, -0.02, 1.25), (s * 1.62, -0.02, 2.05), (s * 0.7, 0.06, 2.1)], 0.07, 'FRAME_flat', 'FRAME_trim')
        body.box((s * 1.18, 0.05, 1.6), (0.7, 0.03, 0.05), 'FRAME_lights')
        # Dorsal intakes along the spine.
        body.box((s * 0.36, 0.60, -0.1), (0.22, 0.12, 1.3), 'FRAME_trim')
        body.box((s * 0.36, 0.66, -0.75), (0.18, 0.02, 0.05), 'FRAME_lights')
    common_parts(root, mats, 'lance', 0.24, 2.62, 0.52)
    body.finish(mats, root)
    # Twin canted tail fins steer; wingtip winglets are the elevons.
    for s, side in ((-1, 'L'), (1, 'R')):
        hinged(f'steering_fin_{side}', root, mats, (s * 0.36, 0.55, 1.45),
               lambda p, s=s: p.fin([(1.45, 0.55), (2.35, 0.62), (2.5, 1.12), (2.05, 1.12)], s * 0.36, 0.05, 'FRAME_accent', 'FRAME_trim'))
        hinged(f'elevon_{side}', root, mats, (s * 1.6, 0.0, 1.35),
               lambda p, s=s: p.fin([(1.35, 0.0), (2.05, 0.0), (2.1, 0.34), (1.7, 0.34)], s * 1.6, 0.04, 'FRAME_accent', 'FRAME_trim'))
        hinged(f'airbrake_{side}', root, mats, (s * 0.55, 0.49, 1.05),
               lambda p, s=s: p.plate([(s * 0.42, 0.5, 0.45), (s * 0.7, 0.47, 0.45), (s * 0.7, 0.47, 1.05), (s * 0.42, 0.5, 1.05)], 0.035, 'FRAME_flat', 'FRAME_trim'))
    skids(root, mats, 0.42, -2.1, 1.7, -0.38)


def build_sidewinder(root, mats, frame):
    stations = frame['stations']
    body = Builder('body_static')
    hull(body, stations)
    canopy(body, [(-1.7, 0.2, 0.52, 0.56), (-1.15, 0.34, 0.58, 0.9), (-0.35, 0.34, 0.64, 0.92), (0.2, 0.24, 0.64, 0.74)])
    for s in (-1, 1):
        # Drift skirts: long, low, the frame's whole stance.
        body.box((s * 1.52, -0.16, -0.15), (0.18, 0.34, 4.3), 'FRAME_accent')
        body.box((s * 1.62, -0.22, -0.15), (0.03, 0.05, 3.9), 'FRAME_lights')
        # Front outrigger canards.
        body.plate([(s * 0.9, 0.06, -2.95), (s * 1.78, 0.02, -2.75), (s * 1.78, 0.02, -2.25), (s * 1.0, 0.06, -2.1)], 0.06, 'FRAME_flat', 'FRAME_trim')
        # Spoiler struts.
        body.tube((s * 0.62, 0.55, 1.85), (s * 0.66, 0.98, 2.12), 0.05, 'FRAME_metal')
        # Side intakes.
        body.box((s * 1.3, 0.28, -0.8), (0.22, 0.2, 0.9), 'FRAME_trim')
    body.plate([(-1.32, 1.0, 1.9), (1.32, 1.0, 1.9), (1.32, 1.02, 2.45), (-1.32, 1.02, 2.45)], 0.07, 'FRAME_accent', 'FRAME_trim')
    body.box((0, 1.04, 2.42), (2.4, 0.03, 0.04), 'FRAME_lights')
    common_parts(root, mats, 'sidewinder', 0.22, 2.45, 0.58)
    body.finish(mats, root)
    for s, side in ((-1, 'L'), (1, 'R')):
        hinged(f'steering_fin_{side}', root, mats, (s * 1.74, 0.04, -2.8),
               lambda p, s=s: p.fin([(-2.8, 0.04), (-2.25, 0.04), (-2.35, 0.46), (-2.6, 0.46)], s * 1.74, 0.05, 'FRAME_accent', 'FRAME_trim'))
        hinged(f'elevon_{side}', root, mats, (s * 1.34, 1.0, 1.9),
               lambda p, s=s: p.fin([(1.85, 0.72), (2.5, 0.72), (2.5, 1.24), (2.0, 1.24)], s * 1.34, 0.05, 'FRAME_accent', 'FRAME_trim'))
        hinged(f'airbrake_{side}', root, mats, (s * 0.72, 0.6, 1.2),
               lambda p, s=s: p.plate([(s * 0.5, 0.62, 0.6), (s * 0.95, 0.56, 0.6), (s * 0.95, 0.56, 1.2), (s * 0.5, 0.62, 1.2)], 0.035, 'FRAME_flat', 'FRAME_trim'))
    skids(root, mats, 0.6, -1.8, 1.6, -0.38)


def build_bulwark(root, mats, frame):
    stations = frame['stations']
    body = Builder('body_static')
    hull(body, stations)
    canopy(body, [(-2.95, 0.5, 0.62, 0.66), (-2.55, 0.62, 0.66, 0.92), (-1.8, 0.64, 0.84, 0.98), (-1.3, 0.6, 0.9, 0.96)])
    # Bull bar across the nose and a roll cage on the roof.
    for x in (-0.9, 0.9):
        body.tube((x, -0.18, -3.62), (x, 0.36, -3.5), 0.05, 'FRAME_metal')
    body.tube((-1.0, 0.3, -3.55), (1.0, 0.3, -3.55), 0.05, 'FRAME_metal')
    body.tube((-1.0, 0.0, -3.62), (1.0, 0.0, -3.62), 0.05, 'FRAME_metal')
    for z in (-1.0, 0.8):
        body.tube((-0.8, 0.9, z), (-0.7, 1.12, z), 0.04, 'FRAME_trim')
        body.tube((0.8, 0.9, z), (0.7, 1.12, z), 0.04, 'FRAME_trim')
        body.tube((-0.7, 1.12, z), (0.7, 1.12, z), 0.04, 'FRAME_trim')
    body.tube((-0.7, 1.12, -1.0), (-0.7, 1.12, 0.8), 0.04, 'FRAME_trim')
    body.tube((0.7, 1.12, -1.0), (0.7, 1.12, 0.8), 0.04, 'FRAME_trim')
    body.box((0, 1.14, -1.02), (1.1, 0.06, 0.08), 'FRAME_lights')
    # Four hover pods on struts: the grip.
    for s in (-1, 1):
        for zc in (-2.2, 1.45):
            body.pod((s * 1.46, -0.12), 0.3, zc - 0.85, zc + 0.85, 'FRAME_accent', segments=8, end_role='FRAME_trim')
            body.box((s * 1.46, -0.43, zc), (0.36, 0.04, 1.3), 'FRAME_lights')
            body.tube((s * 1.05, 0.2, zc), (s * 1.4, -0.02, zc), 0.07, 'FRAME_metal')
        body.box((s * 1.18, 0.5, -0.2), (0.12, 0.32, 2.6), 'FRAME_trim')
    body.box((0, -0.05, -3.46), (1.5, 0.12, 0.05), 'FRAME_lights')
    common_parts(root, mats, 'bulwark', 0.26, 2.5, 0.72)
    body.finish(mats, root)
    for s, side in ((-1, 'L'), (1, 'R')):
        hinged(f'steering_fin_{side}', root, mats, (s * 1.46, 0.16, -2.75),
               lambda p, s=s: p.fin([(-2.75, 0.16), (-2.0, 0.16), (-2.1, 0.5), (-2.55, 0.5)], s * 1.46, 0.05, 'FRAME_flat', 'FRAME_trim'))
        hinged(f'elevon_{side}', root, mats, (s * 1.46, 0.16, 1.05),
               lambda p, s=s: p.fin([(1.05, 0.16), (2.0, 0.16), (2.1, 0.56), (1.4, 0.56)], s * 1.46, 0.05, 'FRAME_flat', 'FRAME_trim'))
        hinged(f'airbrake_{side}', root, mats, (s * 0.55, 0.93, 1.8),
               lambda p, s=s: p.plate([(s * 0.25, 0.94, 1.2), (s * 0.85, 0.92, 1.2), (s * 0.85, 0.92, 1.8), (s * 0.25, 0.94, 1.8)], 0.04, 'FRAME_accent', 'FRAME_trim'))
    skids(root, mats, 0.7, -2.4, 1.9, -0.38)


def build_corona(root, mats, frame):
    stations = frame['stations']
    body = Builder('body_static')
    hull(body, stations)
    canopy(body, [(-2.6, 0.2, 0.56, 0.62), (-2.0, 0.34, 0.62, 0.92), (-1.1, 0.36, 0.72, 0.98), (-0.4, 0.28, 0.76, 0.86)])
    for s in (-1, 1):
        # The plasma cells: glowing cylinders in caged sleeves.
        body.pod((s * 1.28, 0.12), 0.24, -1.7, 1.7, 'FRAME_lights', segments=8, nose=0.7, tail=0.7, end_role='FRAME_metal')
        for z in (-1.35, -0.45, 0.45, 1.35):
            body.pod((s * 1.28, 0.12), 0.29, z - 0.1, z + 0.1, 'FRAME_trim', segments=8, nose=1, tail=1)
        body.pod((s * 1.28, 0.12), 0.3, -2.25, -1.55, 'FRAME_flat', segments=8, nose=0.35, tail=1.0, end_role='FRAME_trim')
        body.pod((s * 1.28, 0.12), 0.3, 1.55, 2.2, 'FRAME_flat', segments=8, nose=1.0, tail=0.8, end_role='FRAME_trim')
        for z in (-1.0, 1.0):
            body.plate([(s * 0.7, 0.2, z - 0.3), (s * 1.1, 0.14, z - 0.25), (s * 1.1, 0.14, z + 0.25), (s * 0.7, 0.2, z + 0.3)], 0.08, 'FRAME_metal')
    common_parts(root, mats, 'corona', 0.26, 2.52, 0.62)
    body.finish(mats, root)
    # The coil ring rolls with the load, like TOTEM's stabiliser.
    ring = empty('stabiliser_ring_pivot', (0, 0.26, 2.3), root)
    coil = Builder('stabiliser_ring_body', (0, 0.26, 2.3))
    coil.arc((0, 0.26, 2.3), 0.92, 0.09, 0.16, 0, math.tau, 'FRAME_metal', steps=16)
    coil.arc((0, 0.26, 2.33), 0.92, 0.05, 0.05, math.radians(200), math.radians(340), 'FRAME_lights', steps=8)
    for a in (math.radians(20), math.radians(160)):
        coil.tube((0.6 * math.cos(a), 0.26 + 0.6 * math.sin(a), 2.3), (0.92 * math.cos(a), 0.26 + 0.92 * math.sin(a), 2.3), 0.04, 'FRAME_trim')
    coil.finish(mats, ring)
    for s, side in ((-1, 'L'), (1, 'R')):
        hinged(f'steering_fin_{side}', root, mats, (s * 1.28, 0.4, -2.1),
               lambda p, s=s: p.fin([(-2.1, 0.36), (-1.55, 0.36), (-1.65, 0.78), (-1.95, 0.78)], s * 1.28, 0.05, 'FRAME_accent', 'FRAME_trim'))
        hinged(f'elevon_{side}', root, mats, (s * 1.28, 0.4, 1.55),
               lambda p, s=s: p.fin([(1.55, 0.36), (2.15, 0.36), (2.15, 0.72), (1.8, 0.72)], s * 1.28, 0.05, 'FRAME_accent', 'FRAME_trim'))
        hinged(f'airbrake_{side}', root, mats, (s * 0.45, 0.8, 1.2),
               lambda p, s=s: p.plate([(s * 0.18, 0.82, 0.55), (s * 0.62, 0.76, 0.55), (s * 0.62, 0.76, 1.2), (s * 0.18, 0.82, 1.2)], 0.035, 'FRAME_flat', 'FRAME_trim'))
    skids(root, mats, 0.5, -2.2, 1.7, -0.38)


def build_halo(root, mats, frame):
    stations = frame['stations']
    body = Builder('body_static')
    hull(body, stations)
    canopy(body, [(-2.9, 0.16, 0.5, 0.56), (-2.2, 0.28, 0.58, 0.9), (-1.2, 0.3, 0.72, 0.98), (-0.3, 0.22, 0.8, 0.9)])
    pontoon = [st(-3.7, 0.05, 0.1, 0.02, -0.06, 0.5, 0.5),
               st(-3.2, 0.24, 0.26, 0.04, -0.2, 0.5, 0.6),
               st(-1.5, 0.30, 0.34, 0.06, -0.28, 0.5, 0.6),
               st(1.2, 0.30, 0.34, 0.08, -0.28, 0.5, 0.6),
               st(2.6, 0.22, 0.26, 0.1, -0.2, 0.5, 0.6)]
    for s in (-1, 1):
        hull(body, pontoon, role='FRAME_flat', offset_x=s * 1.28)
        body.box((s * 1.28, -0.29, -0.4), (0.3, 0.03, 4.2), 'FRAME_lights')
        # Swept blades joining pontoons to the blade hull.
        body.plate([(s * 0.52, 0.12, -1.4), (s * 1.1, 0.06, -0.9), (s * 1.1, 0.06, 1.3), (s * 0.5, 0.12, 1.6)], 0.07, 'FRAME_flat', 'FRAME_accent')
        body.plate([(s * 1.1, 0.12, -3.3), (s * 1.62, 0.1, -3.0), (s * 1.62, 0.1, -2.6), (s * 1.1, 0.12, -2.55)], 0.05, 'FRAME_accent', 'FRAME_trim')
        body.tube((s * 1.28, 0.26, 1.9), (s * 1.28, 0.36, 2.0), 0.06, 'FRAME_metal')
    common_parts(root, mats, 'halo', 0.24, 2.6, 0.5)
    body.finish(mats, root)
    # The halo: an arc over the tail between the pontoons, rolling like a stabiliser.
    ring = empty('stabiliser_ring_pivot', (0, 0.34, 2.0), root)
    halo = Builder('stabiliser_ring_body', (0, 0.34, 2.0))
    halo.arc((0, 0.34, 2.0), 1.28, 0.13, 0.26, 0, math.pi, 'FRAME_accent', steps=18, squash=0.62)
    halo.arc((0, 0.34, 2.14), 1.2, 0.035, 0.04, math.radians(12), math.radians(168), 'FRAME_lights', steps=14, squash=0.62)
    halo.finish(mats, ring)
    for s, side in ((-1, 'L'), (1, 'R')):
        hinged(f'steering_fin_{side}', root, mats, (s * 1.28, 0.3, -2.4),
               lambda p, s=s: p.fin([(-2.4, 0.3), (-1.7, 0.3), (-1.85, 0.72), (-2.2, 0.72)], s * 1.28, 0.05, 'FRAME_accent', 'FRAME_trim'))
        hinged(f'elevon_{side}', root, mats, (s * 1.28, 0.3, 1.3),
               lambda p, s=s: p.fin([(1.3, 0.3), (1.95, 0.3), (1.9, 0.62), (1.55, 0.62)], s * 1.28, 0.05, 'FRAME_flat', 'FRAME_trim'))
        hinged(f'airbrake_{side}', root, mats, (s * 0.4, 0.74, 1.3),
               lambda p, s=s: p.plate([(s * 0.14, 0.76, 0.7), (s * 0.52, 0.7, 0.7), (s * 0.52, 0.7, 1.3), (s * 0.14, 0.76, 1.3)], 0.035, 'FRAME_flat', 'FRAME_trim'))
    skids(root, mats, 1.28, -2.8, 1.8, -0.36)


BUILDERS = dict(lance=build_lance, sidewinder=build_sidewinder, bulwark=build_bulwark,
                corona=build_corona, halo=build_halo)


# ---------------------------------------------------------------------------
# Build, measure, export, render.
# ---------------------------------------------------------------------------

def measure(root):
    tris, meshes, draws = 0, 0, 0
    lo, hi = [9e9] * 3, [-9e9] * 3
    deps = bpy.context.evaluated_depsgraph_get()
    for obj in [root, *root.children_recursive]:
        if obj.type != 'MESH':
            continue
        meshes += 1
        draws += len(obj.data.materials)
        mesh = obj.evaluated_get(deps).to_mesh()
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
        for vert in mesh.vertices:
            w = obj.matrix_world @ vert.co
            game = (w.x, w.z, -w.y)
            lo = [min(a, b) for a, b in zip(lo, game)]
            hi = [max(a, b) for a, b in zip(hi, game)]
        obj.evaluated_get(deps).to_mesh_clear()
    return dict(triangles=tris, meshes=meshes, drawCalls=draws,
                min=[round(x, 3) for x in lo], max=[round(x, 3) for x in hi])


def setup_render(scene):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('bay')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.045, 0.06, 0.07, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    key.data.energy = 3.2
    key.rotation_euler = (math.radians(48), math.radians(8), math.radians(38))
    scene.collection.objects.link(key)
    rim = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'SUN'))
    rim.data.energy = 1.4
    rim.data.color = (0.6, 0.85, 1.0)
    rim.rotation_euler = (math.radians(70), 0, math.radians(200))
    scene.collection.objects.link(rim)
    floor = Builder('floor')
    floor.box((0, -0.62, 0), (30, 0.02, 30), 'FRAME_trim')
    return floor


def render_views(code, mats):
    scene = bpy.context.scene
    floor = setup_render(scene).finish(mats)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam

    def look(eye, target):
        from mathutils import Vector
        cam.location = g2b(eye)
        direction = Vector(g2b(target)) - Vector(g2b(eye))
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

    shots = {}
    cam.data.type = 'PERSP'
    cam.data.lens = 55
    look((6.6, 3.4, -7.4), (0, 0.25, -0.3))
    shots['hero'] = EVIDENCE / f'{code}-hero.png'
    scene.render.filepath = str(shots['hero'])
    bpy.ops.render.render(write_still=True)
    look((-5.6, 2.2, 7.8), (0, 0.3, 0.4))
    shots['rear'] = EVIDENCE / f'{code}-rear.png'
    scene.render.filepath = str(shots['rear'])
    bpy.ops.render.render(write_still=True)
    floor.hide_render = True
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 10.5
    for view, eye, target in (('side', (14, 0.4, -0.6), (0, 0.4, -0.6)),
                              ('top', (0, 14, -0.6), (0, 0, -0.6)),
                              ('front', (0, 0.45, -14), (0, 0.45, 0))):
        look(eye, target)
        if view == 'top':
            cam.rotation_euler = (0, 0, 0)
            cam.location = g2b((0, 14, -0.6))
        shots[view] = EVIDENCE / f'{code}-{view}.png'
        scene.render.filepath = str(shots[view])
        bpy.ops.render.render(write_still=True)
    return shots


def build(code):
    frame = FRAMES[code]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    atlas = paint_atlas(frame, frame['stations'], TEXTURES / f'{code}_livery_512.jpg')
    mats = make_materials(frame, atlas)
    root = empty(f'FRAME_{code}', (0, 0, 0))
    BUILDERS[code](root, mats, frame)
    stats = measure(root)
    path = OUTPUT / f'{code}.glb'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', use_selection=True, export_yup=True,
        export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
        export_image_format='JPEG', export_jpeg_quality=86, export_cameras=False, export_lights=False,
        export_animations=False, export_extras=False)
    stats['bytes'] = path.stat().st_size
    stats['label'] = frame['label']
    stats['glow'] = frame['glow']
    if RENDER:
        stats['renders'] = {k: str(v.relative_to(ROOT)) for k, v in render_views(code, mats).items()}
    print(code, json.dumps(stats))
    return stats


if __name__ == '__main__':
    only = [a for a in sys.argv[1:] if a in FRAMES]
    manifest = {code: build(code) for code in (only or FRAMES)}
    if not only:
        (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
