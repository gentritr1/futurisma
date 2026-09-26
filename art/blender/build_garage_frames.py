"""Author the five garage frames as runtime GLBs; TOTEM itself stays untouched.

Run:  python3 art/blender/build_garage_frames.py [--render] [frame ...]
      (the `bpy` module from PyPI, or `blender -b -P` with the same arguments)

Coordinates in the modelling helpers are the game's: X right, Y up, Z aft,
metres, the model origin where TOTEM's is. `g2b` converts to Blender's Z-up so
the glTF exporter's Y-up conversion lands every vertex back where it was
authored.

THE CONTRACT each frame keeps with `TotemVehicle.mountBody`
(`scripts/validate-garage-frames.mjs` pins all of it):

  - It is a BODY, not a vehicle. The player's TOTEM stays loaded underneath
    and the rival field keeps racing the works TOTEM. Mounting a frame hides
    TOTEM's hull meshes and the kit's instrument housing, and puts this body
    in their place.
  - Animated parts sit under empties named exactly like TOTEM's pivots, with
    identity rotation, so the existing `updateVisual` drives them: steering
    fins yaw (local y), airbrakes pitch (local x; each panel lies FORWARD of
    its hinge so a positive angle lifts it into the air), elevons yaw,
    `stabiliser_ring_pivot` rolls (local z), `skids_pivot` drops at rest.
  - The race-presence anchors TOTEM carries (`FX_engine_*`, `FX_boost_center`,
    `FX_trail_wing_*`, `FX_dust_rear_*`, `FX_impact_*`) are re-authored on this
    hull, and `FX_jet_*` / `HARDPOINT_*` re-anchor the kit's jets and power-
    device mounts, so sparks, spray and devices land on THIS body rather than
    where TOTEM's would have been.
  - Materials by role: `FRAME_paint` (the painted livery atlas; parts that are
    not the hull sample its clean-paint row), `FRAME_accent` (the signal
    colour every mover wears, sampled from the accent half of that same row),
    `FRAME_trim`, `FRAME_metal`, `FRAME_glass`,
    `FRAME_lights` (tinted by the RUNNING LIGHTS paint), and the kit's four
    lamps `TE_boost` / `TE_brake` / `TE_gravity` / `TE_power`, which the runtime
    swaps for the kit's live materials so they keep reporting state.
  - Every material is single-sided, like TOTEM's.

Budget (revised at the stage-2 review, pinned by the validator): at most
3,000 triangles, 21 draw calls and 200 KiB per body. TOTEM itself is 6,186
triangles over 18 draws.

Style (the stage-1 review's family note): TOTEM's signature is a dark hull,
signal-coloured control surfaces, exposed structure and one big ring. Every
frame keeps at least one exposed spar or boom, signal-coloured movers, and an
atlas with patch plates and bolt rows at the seams. Detail comes from the
atlas and two or three strong silhouette moves per frame, not from parts.
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
PAINT = OUTPUT / 'paint'
EVIDENCE = ROOT / 'art/evidence/garage-frames'
TEXTURES = ROOT / 'art/textures/garage-frames'
for folder in (OUTPUT, EVIDENCE, TEXTURES):
    folder.mkdir(parents=True, exist_ok=True)
RENDER = '--render' in sys.argv


def g2b(p):
    return (p[0], -p[2], p[1])


# ---------------------------------------------------------------------------
# Geometry: one builder per object; faces carry a material role and UVs.
# ---------------------------------------------------------------------------

# The clean-paint row at the very top of every atlas: the paint on its left
# half, the accent on its right. Both materials sample the ONE atlas, so a body
# paint scheme is a single texture swap at runtime and recolours everything.
FLAT_UV = (0.25, 0.006)
ACCENT_UV = (0.75, 0.006)


class Builder:
    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = name, origin
        self.verts, self.faces = [], []  # faces: (indices, role, uvs)

    def v(self, p):
        self.verts.append((p[0] - self.origin[0], p[1] - self.origin[1], p[2] - self.origin[2]))
        return len(self.verts) - 1

    def face(self, points, role, uvs=None):
        ids = [self.v(p) for p in points]
        self.faces.append((ids, role, uvs or [ACCENT_UV if role == 'FRAME_accent' else FLAT_UV] * len(ids)))

    # A closed solid from rings of 3D points (same count), capped both ends.
    def loft(self, rings, role, uv_rings=None, cap_role=None, belly_edges=(), belly_role='FRAME_trim'):
        count = len(rings[0])
        for s in range(len(rings) - 1):
            a, b = rings[s], rings[s + 1]
            for k in range(count):
                k2 = (k + 1) % count
                uvs = [uv_rings[s][k], uv_rings[s][k + 1], uv_rings[s + 1][k + 1], uv_rings[s + 1][k]] if uv_rings else None
                self.face([a[k], a[k2], b[k2], b[k]], belly_role if k in belly_edges else role, uvs)
        for ring in (rings[0], rings[-1]):
            centre = tuple(sum(p[i] for p in ring) / count for i in range(3))
            for k in range(count):
                self.face([centre, ring[k], ring[(k + 1) % count]], cap_role or role)

    def box(self, centre, size, role):
        cx, cy, cz = centre
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        ring = lambda z: [(cx - hx, cy - hy, z), (cx + hx, cy - hy, z), (cx + hx, cy + hy, z), (cx - hx, cy + hy, z)]
        self.loft([ring(cz - hz), ring(cz + hz)], role)

    # A plate from a mid-surface outline (3D points) thickened along world Y.
    def plate(self, outline, thickness, role):
        lower = [(x, y - thickness / 2, z) for x, y, z in outline]
        upper = [(x, y + thickness / 2, z) for x, y, z in outline]
        self.face(upper, role)
        self.face(list(reversed(lower)), role)
        for k in range(len(outline)):
            k2 = (k + 1) % len(outline)
            self.face([lower[k], lower[k2], upper[k2], upper[k]], role)

    # A vertical plate: outline in (z, y) at lateral x, thickened along X.
    def fin(self, outline_zy, x, thickness, role):
        left = [(x - thickness / 2, y, z) for z, y in outline_zy]
        right = [(x + thickness / 2, y, z) for z, y in outline_zy]
        self.face(right, role)
        self.face(list(reversed(left)), role)
        for k in range(len(outline_zy)):
            k2 = (k + 1) % len(outline_zy)
            self.face([left[k], left[k2], right[k2], right[k]], role)

    # A faceted cylinder along Z with tapered ends.
    def pod(self, centre, radius, z0, z1, role, segments=8, nose=0.45, tail=0.6, end_role=None, squash=1.0):
        cx, cy = centre
        span = z1 - z0
        profile = [(z0, radius * nose), (z0 + span * 0.18, radius), (z1 - span * 0.12, radius), (z1, radius * tail)]
        rings = [[(cx + r * math.cos(a), cy + r * squash * math.sin(a), z)
                  for a in (math.tau * (i + 0.5) / segments for i in range(segments))] for z, r in profile]
        self.loft(rings, role, cap_role=end_role)

    # A short closed disc facing aft: throats, lit cores. A solid, so its
    # normals are recalculated the right way round and it survives culling.
    def disc(self, centre, radius, z, role, segments=8, depth=0.02):
        cx, cy = centre
        ring = lambda zz: [(cx + radius * math.cos(a), cy + radius * math.sin(a), zz)
                           for a in (math.tau * (i + 0.5) / segments for i in range(segments))]
        self.loft([ring(z - depth), ring(z)], role)

    # A faceted tube through a list of points (bars, struts, conduits).
    def tube(self, points, radius, role, segments=6):
        for start, end in zip(points, points[1:]):
            s, e = np.array(start, float), np.array(end, float)
            axis = (e - s) / np.linalg.norm(e - s)
            ref = np.array([0, 1, 0]) if abs(axis[1]) < 0.9 else np.array([1, 0, 0])
            u = np.cross(axis, ref)
            u /= np.linalg.norm(u)
            w = np.cross(axis, u)
            ring = lambda c: [tuple(c + radius * (math.cos(a) * u + math.sin(a) * w))
                              for a in (math.tau * i / segments for i in range(segments))]
            self.loft([ring(s), ring(e)], role)

    # A torus arc about the Z axis through `centre`, optionally flattened
    # (squash on Y) and raked (rotated about X; positive leans the top forward).
    def arc(self, centre, radius, thickness, depth, a0, a1, role, steps=16, squash=1.0, rake=0.0):
        cx, cy, cz = centre
        cr, sr = math.cos(rake), math.sin(rake)
        full = abs((a1 - a0) - math.tau) < 1e-6
        rings = []
        for n in range(steps if full else steps + 1):
            a = a0 + (a1 - a0) * n / steps
            c, s = math.cos(a), math.sin(a)
            ring = []
            for dr, dz in ((-thickness / 2, -depth / 2), (thickness / 2, -depth / 2),
                           (thickness / 2, depth / 2), (-thickness / 2, depth / 2)):
                x, y, z = (radius + dr) * c, (radius + dr) * s * squash, dz
                ring.append((cx + x, cy + y * cr + z * sr, cz - y * sr + z * cr))
            rings.append(ring)
        if full:
            for n in range(len(rings)):
                a, b = rings[n], rings[(n + 1) % len(rings)]
                for k in range(4):
                    self.face([a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]], role)
        else:
            self.loft(rings, role)

    # A twin-walled nozzle: metal barrel, a lit throat facing aft.
    def nozzle(self, centre, radius, z, depth, throat='FRAME_lights'):
        self.pod(centre, radius, z - depth, z, 'FRAME_metal', segments=8, nose=0.8, tail=1.0, end_role='FRAME_trim')
        self.disc(centre, radius * 0.72, z + 0.02, throat)

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


def hull(builder, stations, textured=True, offset_x=0.0):
    rings = [[(x + offset_x, y, z) for x, y, z in section(st)] for st in stations]
    builder.loft(rings, 'FRAME_paint', uv_rings=hull_uvs(stations, rings) if textured else None,
                 cap_role='FRAME_trim', belly_edges=(0, 7))


def canopy(builder, stations):
    rings = []
    for z, w, base, top in stations:
        rings.append([(-w, base, z), (w, base, z), (w * 0.62, top - 0.05, z), (0, top, z), (-w * 0.62, top - 0.05, z)])
    builder.loft(rings, 'FRAME_glass', cap_role='FRAME_trim')


def aerofoil(builder, spans, role):
    """A wing lofted through (x, y, z_leading, chord) sections."""
    rings = []
    for x, y, z, chord in spans:
        rings.append([(x, y, z), (x, y + 0.075, z + chord * 0.28), (x, y + 0.01, z + chord), (x, y - 0.035, z + chord * 0.32)])
    builder.loft(rings, role)


# ---------------------------------------------------------------------------
# The livery atlas: u runs round the hull section (0 keel, .25 right flank,
# .5 spine, .75 left flank), v runs nose (0) to tail (1).
# ---------------------------------------------------------------------------

SIZE = 512


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def to_rgb(colour, alpha=255):
    return tuple(int(max(0, min(1, c)) * 255) for c in colour) + (alpha,)


def paint_atlas(frame, stations, path, quality=90):
    livery = frame['livery']
    base = np.array(livery['base'], float)
    u = np.linspace(0, 1, SIZE)[None, :].repeat(SIZE, 0)
    v = np.linspace(0, 1, SIZE)[:, None].repeat(SIZE, 1)
    img = np.ones((SIZE, SIZE, 3)) * base

    def mirror(u0, u1):
        return ((u >= u0) & (u <= u1)) | ((u >= 1 - u1) & (u <= 1 - u0))

    for rule in livery.get('rules', []):
        colour = np.array(rule['colour'], float)
        window = (v >= rule.get('v0', 0)) & (v <= rule.get('v1', 1))
        kind = rule['kind']
        if kind == 'band':
            mask = window
        elif kind == 'spine':
            mask = np.zeros_like(u, bool)
            for centre in rule['at']:
                mask |= mirror(centre - rule['width'] / 2, centre + rule['width'] / 2)
            mask &= window
        elif kind == 'side':
            mask = mirror(rule['u0'], rule['u1']) & window
        elif kind == 'hazard':
            mask = mirror(rule['u0'], rule['u1']) & window & (((u * rule['period'] * 3 + v * rule['period']) % 1) < 0.5)
        elif kind == 'split':
            mask = (u >= rule['u']) & (u <= 1 - rule['u']) & window
        elif kind == 'fade':
            # Nose-to-tail blend from `colour` to `colour2` across the window.
            t = np.clip((v - rule['v0']) / (rule['v1'] - rule['v0']), 0, 1)[..., None]
            blend = colour * (1 - t) + np.array(rule['colour2'], float) * t
            img = np.where(window[..., None], blend, img)
            continue
        elif kind == 'dazzle':
            # Disruptive test-car camouflage, mirrored so both flanks match.
            um = np.minimum(u, 1 - u)
            phase = np.sin(um * 2 * np.pi * 4 + v * 2 * np.pi * 5 + 2.2 * np.sin(v * 2 * np.pi * 2 + um * 9))
            mask = window & (phase > 0.1)
        elif kind == 'stars':
            # Clusters a few pixels across rather than single specks, which
            # the chase camera's mip levels would average away.
            specks = np.random.default_rng(frame['seed'] + 7).random((SIZE, SIZE)) < rule['density']
            grown = specks.copy()
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    if dx * dx + dy * dy <= 5:
                        grown |= np.roll(np.roll(specks, dy, 0), dx, 1)
            mask = window & grown
        else:
            raise ValueError(kind)
        img[mask] = colour

    rng = np.random.default_rng(frame['seed'])
    # Patch plates: replaced panels a shade off the paint, the repaired-machine tell.
    patches = []
    for _ in range(livery.get('patches', 7)):
        pu, pv = rng.uniform(0.1, 0.4), rng.uniform(0.2, 0.84)
        pw, ph = rng.uniform(0.035, 0.07), rng.uniform(0.04, 0.09)
        shade = rng.choice([0.84, 0.9, 1.1])
        for cu in (pu, 1 - pu - pw):
            img[(u >= cu) & (u <= cu + pw) & (v >= pv) & (v <= pv + ph)] *= shade
            patches.append((cu, pv, pw, ph))

    # Shape light baked in the way a PS2 texture carried it: flanks darker than
    # the spine, the belly edges darker still. Grime heavier low on the flanks,
    # soot at the tail.
    img *= (0.78 + 0.22 * np.sin(np.pi * u) ** 0.6)[..., None]
    noise = Image.fromarray((rng.random((64, 64)) * 255).astype('uint8')).resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    noise = np.asarray(noise.filter(ImageFilter.GaussianBlur(6)), float) / 255
    grime = 1 - livery.get('grime', 0.16) * noise * (1 - np.sin(np.pi * u) ** 0.5) - 0.07 * noise
    soot = 1 - 0.45 * np.clip((v - 0.86) / 0.14, 0, 1) ** 1.5
    img *= (grime * soot)[..., None]
    img[rng.random((SIZE, SIZE)) < 0.004] *= 0.55

    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype('uint8')).convert('RGBA')
    draw = ImageDraw.Draw(out, 'RGBA')
    # Panel seams at every station, each with a bolt row just aft of it.
    z0, z1 = stations[0]['z'], stations[-1]['z']
    for st in stations[1:-1]:
        y = int((0.02 + 0.96 * (st['z'] - z0) / (z1 - z0)) * SIZE)
        draw.line([(0, y), (SIZE, y)], fill=(0, 0, 0, 120), width=2)
        draw.line([(0, y + 2), (SIZE, y + 2)], fill=(255, 255, 255, 26), width=1)
        for x in range(6, SIZE, 11):
            draw.point((x, y + 5), fill=(0, 0, 0, 120))
    for seam in livery.get('seams', [0.14, 0.33, 0.44]):
        for x in (seam, 1 - seam):
            draw.line([(x * SIZE, 0.03 * SIZE), (x * SIZE, 0.97 * SIZE)], fill=(0, 0, 0, 90), width=2)
            for y in range(20, SIZE - 20, 13):
                draw.point((x * SIZE + 4, y), fill=(0, 0, 0, 110))
    for cu, pv, pw, ph in patches:
        box = [cu * SIZE, pv * SIZE, (cu + pw) * SIZE, (pv + ph) * SIZE]
        draw.rectangle(box, outline=(0, 0, 0, 110), width=1)
        for bx, by in ((box[0] + 3, box[1] + 3), (box[2] - 3, box[1] + 3), (box[0] + 3, box[3] - 3), (box[2] - 3, box[3] - 3)):
            draw.point((bx, by), fill=(0, 0, 0, 150))

    # Fleet number on both flanks. The section winding mirrors both flanks in
    # (u, v), so the stencil is reflected across a diagonal rather than
    # rotated: transverse on the right flank, transpose on the left. The side
    # and rear evidence renders each show one flank to check it by.
    font = ImageFont.load_default(size=int(livery.get('number_size', 64)))
    small = ImageFont.load_default(size=13)
    # A keyline in the opposite value, so a number reads over any panel it
    # crosses (HALO's X1 used to sink into the pearl split beside it).
    light = 0.2126 * livery['number'][0] + 0.7152 * livery['number'][1] + 0.0722 * livery['number'][2] > 0.35
    keyline = (14, 15, 17, 235) if light else (226, 222, 210, 235)
    for side in ('right', 'left'):
        text = Image.new('RGBA', (220, 90), (0, 0, 0, 0))
        tdraw = ImageDraw.Draw(text)
        if 'number_plate' in livery:
            # A racing-number panel, for a number that has to cross a split.
            tdraw.rounded_rectangle([12, 4, 208, 88], radius=12, fill=to_rgb(livery['number_plate']),
                                    outline=(0, 0, 0, 160), width=2)
        tdraw.text((110, 45), frame['number'], font=font, anchor='mm', fill=to_rgb(livery['number'], 235),
                   stroke_width=3, stroke_fill=keyline)
        tdraw.text((110, 84), 'KAIRO DYNAMICS', font=small, anchor='mb', fill=to_rgb(livery['number'], 170),
                   stroke_width=1, stroke_fill=keyline[:3] + (150,))
        stencil = text.transpose(Image.Transpose.TRANSVERSE if side == 'right' else Image.Transpose.TRANSPOSE)
        cu = livery.get('number_u', 0.3)
        cx = int((cu if side == 'right' else 1 - cu) * SIZE)
        cy = int(livery.get('number_v', 0.5) * SIZE)
        out.alpha_composite(stencil, (cx - stencil.width // 2, cy - stencil.height // 2))
    out = out.convert('RGB')
    # The clean row every non-hull part samples: paint left, accent right. The
    # accent is a linear material colour, so it is encoded as sRGB here to land
    # on screen exactly as the untextured material did.
    clean = ImageDraw.Draw(out)
    clean.rectangle([0, 0, SIZE // 2 - 1, 7], fill=to_rgb(livery['base'])[:3])
    clean.rectangle([SIZE // 2, 0, SIZE, 7], fill=to_rgb([linear_to_srgb(c) for c in livery['accent']])[:3])
    out.save(path, quality=quality)
    return path


# ---------------------------------------------------------------------------
# Body paint schemes
# ---------------------------------------------------------------------------
#
# Every scheme is a whole livery for `paint_atlas`, so a scheme is one 512
# atlas the runtime swaps in for the GLB's own (paint AND accent: both sample
# it). NOIR, ARCTIC and GOLD LEAF are rules over the frame's factory livery —
# its patterns stay, its colours change, and the signal colours (the ones
# that ARE the frame) survive NOIR and ARCTIC; each signature is authored.
# `src/game/garage-rules.js` lists the same codes (`bodySchemes`), and the
# validator checks every atlas it names was built.

def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def is_signal(c):
    hi, lo = max(c), min(c)
    return hi > 0.08 and (hi - lo) / hi > 0.45


def recolour(livery, base, number, accent, rule_colour, plate):
    out = dict(livery, base=base, number=number, accent=accent,
               rules=[dict(rule, colour=rule_colour(tuple(rule['colour']))) for rule in livery.get('rules', [])])
    if 'number_plate' in livery:
        out['number_plate'] = plate
    return out


INK = (0.03, 0.03, 0.035)

SIGNATURES = {
    'lance': ('strike', lambda f: dict(
        f, base=(0.80, 0.79, 0.76), accent=(0.55, 0.025, 0.02), number=(0.04, 0.04, 0.045),
        rules=[dict(kind='band', v0=0, v1=0.2, colour=(0.62, 0.05, 0.04)),
               dict(kind='split', u=0.36, v0=0.2, v1=0.9, colour=(0.62, 0.05, 0.04)),
               dict(kind='spine', at=[0.46, 0.54], width=0.016, v0=0.2, colour=(0.82, 0.8, 0.76)),
               dict(kind='side', u0=0.18, u1=0.2, v0=0.2, colour=INK),
               dict(kind='band', v0=0.9, v1=1, colour=(0.05, 0.05, 0.055))])),
    'sidewinder': ('neon', lambda f: dict(
        f, base=(0.16, 0.17, 0.19), accent=(0.02, 0.55, 0.72), number=(0.1, 0.85, 0.95),
        rules=[dict(kind='hazard', u0=0.18, u1=0.3, v0=0.12, v1=0.32, period=7, colour=(0.05, 0.75, 0.85)),
               dict(kind='spine', at=[0.5], width=0.07, v0=0.05, v1=0.95, colour=INK),
               dict(kind='spine', at=[0.5], width=0.03, v0=0.05, v1=0.95, colour=(0.9, 0.15, 0.55)),
               dict(kind='side', u0=0.15, u1=0.17, colour=(0.05, 0.75, 0.85))])),
    'bulwark': ('hazard', lambda f: dict(
        f, base=(0.95, 0.4, 0.03), accent=(0.02, 0.02, 0.022), number=INK,
        rules=[dict(kind='hazard', u0=0.0, u1=0.5, v0=0.03, v1=0.13, period=9, colour=INK),
               dict(kind='hazard', u0=0.02, u1=0.24, v0=0.2, v1=0.86, period=5, colour=INK),
               dict(kind='spine', at=[0.5], width=0.14, v0=0.2, v1=0.85, colour=(0.05, 0.05, 0.05)),
               dict(kind='band', v0=0.9, v1=1, colour=INK)])),
    'corona': ('nebula', lambda f: dict(
        f, base=(0.55, 0.1, 0.62), accent=(0.03, 0.72, 0.82), number=(0.95, 0.95, 1.0),
        rules=[dict(kind='fade', v0=0.08, v1=0.8, colour=(0.62, 0.1, 0.66), colour2=(0.01, 0.03, 0.12)),
               dict(kind='stars', density=0.0016, v0=0.25, colour=(0.9, 0.95, 1.0)),
               dict(kind='spine', at=[0.44, 0.56], width=0.02, colour=(0.2, 0.85, 0.95)),
               dict(kind='band', v0=0.0, v1=0.06, colour=(0.2, 0.85, 0.95))])),
    'halo': ('dazzle', lambda f: dict(
        f, base=(0.86, 0.87, 0.88), accent=(0.95, 0.32, 0.03), number=(0.96, 0.46, 0.1),
        number_plate=INK,
        rules=[dict(kind='dazzle', v0=0.08, v1=0.95, colour=INK),
               dict(kind='band', v0=0.0, v1=0.1, colour=INK)])),
}


# ARCTIC on a pale base loses a frame's own structure; these put it back.
ARCTIC_EXTRAS = {
    'lance': [dict(kind='spine', at=[0.5], width=0.12, v0=0.2, v1=0.9, colour=(0.16, 0.17, 0.19))],
    'bulwark': [dict(kind='side', u0=0.02, u1=0.14, colour=(0.2, 0.21, 0.22))],
    'corona': [dict(kind='side', u0=0.16, u1=0.34, v0=0.2, v1=0.85, colour=(0.13, 0.15, 0.27))],
}


def scheme_liveries(code, frame):
    factory = frame['livery']
    accent = factory['accent']
    signature, paint = SIGNATURES[code]
    arctic = recolour(factory, (0.84, 0.85, 0.86), (0.05, 0.055, 0.065), accent,
                      lambda c: c if is_signal(c) else (0.62, 0.64, 0.66) if luminance(c) > 0.3 else (0.16, 0.17, 0.19),
                      (0.9, 0.9, 0.9))
    arctic['rules'] = [*arctic['rules'], *ARCTIC_EXTRAS.get(code, [])]
    return {
        'noir': recolour(factory, (0.035, 0.036, 0.04), (0.86, 0.86, 0.84), accent,
                         lambda c: c if is_signal(c) else (0.02 + 0.1 * luminance(c),) * 3, (0.02, 0.02, 0.022)),
        'arctic': arctic,
        signature: paint(factory),
        'gold': gilded(recolour(factory, (0.88, 0.68, 0.24), INK, INK,
                                lambda c: INK if is_signal(c) or luminance(c) < 0.3 else (0.96, 0.84, 0.5), (0.8, 0.6, 0.2))),
    }


def gilded(livery):
    """GOLD LEAF's own finish over any frame: black pinstripes down the spine and flanks."""
    return dict(livery, grime=0.08, rules=[*livery['rules'],
                dict(kind='spine', at=[0.5], width=0.006, v0=0.1, v1=0.92, colour=INK),
                dict(kind='side', u0=0.205, u1=0.212, v0=0.12, v1=0.9, colour=INK)])


def swatch(livery):
    """The two colours the paint shop's chip shows: paint, then accent, as sRGB hex."""
    base = to_rgb(livery['base'])[:3]
    accent = to_rgb([linear_to_srgb(c) for c in livery['accent']])[:3]
    return ['#%02x%02x%02x' % base, '#%02x%02x%02x' % accent]


def paint_schemes(code, frame):
    PAINT.mkdir(parents=True, exist_ok=True)
    paints = {'factory': {'swatch': swatch(frame['livery'])}}
    for scheme, livery in scheme_liveries(code, frame).items():
        path = paint_atlas(dict(frame, livery=livery), frame['stations'], PAINT / f'{code}-{scheme}.jpg', quality=85)
        paints[scheme] = {'bytes': path.stat().st_size, 'swatch': swatch(livery)}
    return paints


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def make_materials(frame, atlas_path):
    livery = frame['livery']
    specs = {
        # Closer to TOTEM's own hull (roughness 0.78, metalness 0.14): the
        # bodies read as the same painted, worked metal, not a glossier kit.
        'FRAME_paint': (livery['base'], 0.12, 0.72, None, 0),
        'FRAME_accent': (livery['accent'], 0.18, 0.70, None, 0),
        'FRAME_trim': ((0.045, 0.05, 0.055), 0.3, 0.7, None, 0),
        'FRAME_metal': ((0.30, 0.32, 0.33), 0.18, 0.65, None, 0),
        'FRAME_glass': ((0.01, 0.035, 0.05), 0.1, 0.18, None, 0),
        # Near-black under a glow, at TOTEM's own 0.62, so the paint shop's
        # emissive tint is the whole colour and nothing muddies it.
        'FRAME_lights': ((0.02, 0.02, 0.02), 0.0, 0.4, tuple(frame['glow']), 0.62),
        'TE_boost': ((0.77, 0.9, 0.49), 0.0, 0.5, (0.77, 0.9, 0.49), 0.6),
        'TE_brake': ((0.35, 0.03, 0.01), 0.0, 0.5, (0.35, 0.03, 0.01), 0.2),
        'TE_gravity': ((0.12, 0.7, 0.88), 0.0, 0.5, (0.12, 0.7, 0.88), 0.6),
        'TE_power': ((0.36, 0.16, 0.6), 0.0, 0.5, (0.36, 0.16, 0.6), 0.3),
    }
    image = bpy.data.images.load(str(atlas_path))
    materials = {}
    for name, (colour, metallic, roughness, emission, strength) in specs.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.use_backface_culling = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*colour, 1)
        shader.inputs['Metallic'].default_value = metallic
        shader.inputs['Roughness'].default_value = roughness
        if emission:
            shader.inputs['Emission Color'].default_value = (*emission, 1)
            shader.inputs['Emission Strength'].default_value = strength
        if name == 'FRAME_glass':
            shader.inputs['Alpha'].default_value = 0.62
            mat.surface_render_method = 'BLENDED'
        if name in ('FRAME_paint', 'FRAME_accent'):
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = image
            mat.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
        materials[name] = mat
    return materials


# ---------------------------------------------------------------------------
# Shared pieces
# ---------------------------------------------------------------------------

JET_X = 0.45


def rear_kit(body, jet_y, jet_z, radius=0.23, depth=0.55, afterburner=False):
    """Twin nozzles and the kit's four lamps, on every frame."""
    for side in (-1, 1):
        body.nozzle((side * JET_X, jet_y), radius, jet_z, depth)
        if afterburner:
            body.arc((side * JET_X, jet_y, jet_z + 0.01), radius + 0.035, 0.045, 0.035, 0, math.tau, 'FRAME_lights', steps=10)
    body.box((0, jet_y + radius + 0.12, jet_z - 0.14), (0.52, 0.06, 0.1), 'TE_boost')
    for side in (-1, 1):
        body.box((side * (JET_X + radius + 0.28), jet_y + 0.02, jet_z - 0.2), (0.3, 0.07, 0.05), 'TE_brake')
    body.box((-0.1, jet_y + radius + 0.2, jet_z - 0.2), (0.08, 0.05, 0.08), 'TE_gravity')
    body.box((0.1, jet_y + radius + 0.2, jet_z - 0.2), (0.08, 0.05, 0.08), 'TE_power')


def anchors(root, jet_y, jet_z, hardpoint, nose, wing, dust, flank):
    """Every anchor the race presence and the kit read, placed on this hull."""
    for name, (x, y, z) in {
        'FX_jet': (JET_X, jet_y, jet_z + 0.03),
        'FX_engine': (JET_X, jet_y, jet_z + 0.05),
        'FX_trail_wing': wing,
        'FX_dust_rear': dust,
        'FX_impact': flank,
        'HARDPOINT': hardpoint,
    }.items():
        empty(f'{name}_left', (-x, y, z), root)
        empty(f'{name}_right', (x, y, z), root)
    empty('FX_boost_center', (0, jet_y + 0.05, jet_z + 0.1), root)
    empty('FX_impact_nose', nose, root)


def skids(root, mats, x, z0, z1, y):
    pivot = empty('skids_pivot', (0, y, (z0 + z1) / 2), root)
    part = Builder('skids_body', (0, y, (z0 + z1) / 2))
    for side in (-1, 1):
        part.box((side * x, y - 0.03, (z0 + z1) / 2), (0.08, 0.06, z1 - z0), 'FRAME_metal')
        for z in (z0 + 0.4, z1 - 0.4):
            part.tube([(side * x, y, z), (side * x * 0.8, y + 0.2, z)], 0.035, 'FRAME_metal')
    part.finish(mats, pivot)


def hinged(name, root, mats, hinge, build):
    """An animated part: an empty at the hinge, geometry authored in world space."""
    pivot = empty(f'{name}_pivot', hinge, root)
    part = Builder(f'{name}_body', hinge)
    build(part)
    part.finish(mats, pivot)
    return pivot


def movers(root, mats, steering, elevon, airbrake):
    """Fins yaw, elevons yaw, airbrakes pitch; every mover wears the signal colour."""
    for s, side in ((-1, 'L'), (1, 'R')):
        hinge, outline, x = steering
        hinged(f'steering_fin_{side}', root, mats, (s * hinge[0], hinge[1], hinge[2]),
               lambda p, s=s, o=outline, x=x: p.fin(o, s * x, 0.05, 'FRAME_accent'))
        hinge, outline, x = elevon
        hinged(f'elevon_{side}', root, mats, (s * hinge[0], hinge[1], hinge[2]),
               lambda p, s=s, o=outline, x=x: p.fin(o, s * x, 0.05, 'FRAME_accent'))
        hinge, (x0, x1, y0, y1, z0, z1) = airbrake
        hinged(f'airbrake_{side}', root, mats, (s * hinge[0], hinge[1], hinge[2]),
               lambda p, s=s, a=(x0, x1, y0, y1, z0, z1): p.plate(
                   [(s * a[0], a[2], a[4]), (s * a[1], a[3], a[4]), (s * a[1], a[3], a[5]), (s * a[0], a[2], a[5])], 0.035, 'FRAME_accent'))


def st(z, w, top, mid, bot, roof=0.42, belly=0.62, drop=0.28):
    return dict(z=z, w=w, top=top, mid=mid, bot=bot, roof=roof, belly=belly, drop=drop)


# ---------------------------------------------------------------------------
# The five frames. Every number is metres in game space.
# ---------------------------------------------------------------------------

FRAMES = {
    'lance': dict(
        label='LANCE S3', number='S3', seed=31, glow=(0.29, 0.89, 1.0),
        livery=dict(base=(0.70, 0.66, 0.56), accent=(0.07, 0.50, 0.58), number=(0.06, 0.06, 0.07),
                    number_u=0.29, number_v=0.52, number_size=66, grime=0.26,
                    rules=[dict(kind='band', v0=0, v1=0.2, colour=(0.05, 0.055, 0.06)),
                           dict(kind='spine', at=[0.5], width=0.18, v0=0.18, v1=0.3, colour=(0.08, 0.085, 0.09)),
                           dict(kind='spine', at=[0.46, 0.54], width=0.016, v0=0.3, colour=(0.07, 0.55, 0.63)),
                           dict(kind='side', u0=0.18, u1=0.2, v0=0.2, colour=(0.07, 0.55, 0.63)),
                           dict(kind='band', v0=0.9, v1=1, colour=(0.12, 0.12, 0.12))]),
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
        label='SIDEWINDER D2', number='D2', seed=47, glow=(1.0, 0.25, 0.66),
        # Graphite-plum rather than near-black, so NOIR on this frame reads as
        # a change of paint rather than the same car (stage-3 review).
        livery=dict(base=(0.337, 0.22, 0.40), accent=(0.80, 0.11, 0.44), number=(0.92, 0.22, 0.58),
                    number_u=0.3, number_v=0.5, number_size=70,
                    rules=[dict(kind='hazard', u0=0.18, u1=0.3, v0=0.12, v1=0.32, period=7, colour=(0.80, 0.11, 0.44)),
                           dict(kind='spine', at=[0.5], width=0.07, v0=0.05, v1=0.95, colour=(0.6, 0.6, 0.62)),
                           dict(kind='spine', at=[0.5], width=0.03, v0=0.05, v1=0.95, colour=(0.80, 0.11, 0.44)),
                           dict(kind='side', u0=0.15, u1=0.17, colour=(0.80, 0.11, 0.44))]),
        # A coke-bottle plan (a waist behind the nose, the width at the tail)
        # and a stepped chine, so the top view reads as a drift car.
        stations=[st(-3.35, 0.28, 0.18, 0.06, -0.04, 0.5, 0.5),
                  st(-2.8, 0.95, 0.38, 0.2, -0.22, 0.45, 0.72),
                  st(-1.7, 1.08, 0.54, 0.26, -0.3, 0.4, 0.8),
                  st(-0.5, 0.95, 0.64, 0.28, -0.34, 0.36, 0.8),
                  st(0.8, 1.46, 0.64, 0.3, -0.36, 0.34, 0.8),
                  st(1.8, 1.5, 0.58, 0.3, -0.32, 0.36, 0.78),
                  st(2.4, 1.22, 0.48, 0.28, -0.24, 0.4, 0.75)],
    ),
    'bulwark': dict(
        label='BULWARK G4', number='G4', seed=59, glow=(1.0, 0.64, 0.10),
        livery=dict(base=(0.30, 0.31, 0.21), accent=(0.88, 0.60, 0.07), number=(0.93, 0.66, 0.1),
                    number_u=0.3, number_v=0.55, number_size=76, seams=[0.16, 0.3, 0.42], grime=0.22,
                    rules=[dict(kind='hazard', u0=0.0, u1=0.5, v0=0.03, v1=0.13, period=5, colour=(0.88, 0.60, 0.07)),
                           dict(kind='side', u0=0.08, u1=0.13, colour=(0.10, 0.10, 0.09)),
                           dict(kind='spine', at=[0.5], width=0.14, v0=0.2, v1=0.85, colour=(0.24, 0.25, 0.16))]),
        stations=[st(-3.45, 0.86, 0.32, 0.10, -0.18, 0.72, 0.8, 0.4),
                  st(-2.95, 1.08, 0.70, 0.20, -0.32, 0.76, 0.84, 0.35),
                  st(-1.3, 1.14, 0.90, 0.24, -0.35, 0.78, 0.86, 0.3),
                  st(0.5, 1.14, 0.92, 0.26, -0.35, 0.80, 0.86, 0.3),
                  st(1.9, 1.10, 0.86, 0.28, -0.32, 0.78, 0.85, 0.3),
                  st(2.45, 1.0, 0.76, 0.30, -0.26, 0.75, 0.84, 0.3)],
    ),
    'corona': dict(
        label='CORONA P5', number='P5', seed=71, glow=(0.6, 0.42, 1.0),
        livery=dict(base=(0.13, 0.15, 0.27), accent=(0.44, 0.27, 0.82), number=(0.76, 0.66, 1.0),
                    number_u=0.31, number_v=0.5, number_size=64,
                    rules=[dict(kind='split', u=0.4, colour=(0.18, 0.2, 0.34)),
                           dict(kind='spine', at=[0.44, 0.56], width=0.02, colour=(0.44, 0.27, 0.82)),
                           dict(kind='band', v0=0.0, v1=0.06, colour=(0.44, 0.27, 0.82))]),
        stations=[st(-3.65, 0.10, 0.20, 0.10, 0.0, 0.5, 0.5),
                  st(-3.05, 0.54, 0.48, 0.12, -0.20, 0.56, 0.6, 0.22),
                  st(-1.8, 0.84, 0.74, 0.14, -0.30, 0.56, 0.6, 0.22),
                  st(-0.4, 0.94, 0.84, 0.16, -0.34, 0.56, 0.62, 0.22),
                  st(1.0, 0.90, 0.80, 0.18, -0.32, 0.56, 0.62, 0.22),
                  st(2.0, 0.76, 0.68, 0.20, -0.26, 0.56, 0.62, 0.22),
                  st(2.5, 0.62, 0.58, 0.22, -0.18, 0.56, 0.62, 0.22)],
    ),
    'halo': dict(
        label='HALO X1', number='X1', seed=89, glow=(0.95, 0.98, 1.0),
        livery=dict(base=(0.12, 0.13, 0.14), accent=(0.80, 0.61, 0.24), number=(0.96, 0.46, 0.1),
                    number_u=0.28, number_v=0.47, number_size=58, number_plate=(0.07, 0.075, 0.08),
                    rules=[dict(kind='split', u=0.36, colour=(0.76, 0.77, 0.78)),
                           dict(kind='spine', at=[0.355, 0.645], width=0.01, colour=(0.80, 0.61, 0.24)),
                           dict(kind='band', v0=0.0, v1=0.1, colour=(0.08, 0.085, 0.09))]),
        stations=[st(-4.0, 0.05, 0.22, 0.12, 0.04),
                  st(-3.1, 0.38, 0.50, 0.14, -0.16, 0.4, 0.55),
                  st(-1.7, 0.54, 0.76, 0.16, -0.24, 0.4, 0.58),
                  st(-0.1, 0.60, 0.82, 0.18, -0.26, 0.4, 0.6),
                  st(1.4, 0.55, 0.70, 0.20, -0.22, 0.42, 0.6),
                  st(2.55, 0.44, 0.54, 0.22, -0.14, 0.45, 0.6)],
    ),
}


def build_lance(root, mats, frame):
    body = Builder('body_static')
    hull(body, frame['stations'])
    canopy(body, [(-2.9, 0.18, 0.40, 0.46), (-2.2, 0.26, 0.46, 0.74), (-1.2, 0.27, 0.56, 0.80), (-0.5, 0.22, 0.58, 0.70)])
    # A short pitot probe: the contact model measures TOTEM's 2.2 m hull, so
    # the nose stays within half a metre of it to keep wall contact honest.
    body.tube([(0, 0.1, -4.3), (0, 0.1, -4.42)], 0.03, 'FRAME_metal')
    body.plate([(-0.5, -0.13, -3.55), (0.5, -0.13, -3.55), (0.62, -0.15, -2.9), (-0.62, -0.15, -2.9)], 0.04, 'FRAME_trim')
    for s in (-1, 1):
        # Swept delta wings on a visible root spar, with exposed wingtip booms.
        body.plate([(s * 0.7, 0.06, -0.8), (s * 1.58, -0.02, 1.25), (s * 1.62, -0.02, 2.05), (s * 0.7, 0.06, 2.1)], 0.07, 'FRAME_paint')
        body.box((s * 0.78, 0.06, 0.65), (0.14, 0.16, 2.9), 'FRAME_trim')
        body.tube([(s * 1.64, -0.02, -0.2), (s * 1.64, -0.02, 2.35)], 0.05, 'FRAME_metal')
        body.box((s * 1.64, -0.02, -0.26), (0.08, 0.08, 0.1), 'FRAME_lights')
        body.box((s * 1.2, 0.05, 1.6), (0.7, 0.03, 0.05), 'FRAME_lights')
        body.box((s * 0.36, 0.60, -0.1), (0.22, 0.12, 1.3), 'FRAME_trim')
        body.box((s * 0.36, 0.66, -0.75), (0.18, 0.02, 0.05), 'FRAME_lights')
    # Ventral keel fin: the straight-line stance, readable under the tail.
    body.fin([(1.3, -0.28), (2.45, -0.24), (2.5, -0.46), (1.9, -0.48)], 0, 0.05, 'FRAME_accent')
    rear_kit(body, 0.24, 2.66, radius=0.28, depth=0.62, afterburner=True)
    body.finish(mats, root)
    anchors(root, 0.24, 2.66, hardpoint=(0.78, 0.26, -0.05), nose=(0, 0.12, -4.3),
            wing=(1.64, -0.02, 2.3), dust=(1.1, -0.1, 1.8), flank=(0.86, 0.22, 1.3))
    movers(root, mats,
           steering=((0.36, 0.55, 1.45), [(1.45, 0.55), (2.35, 0.62), (2.5, 1.12), (2.05, 1.12)], 0.36),
           elevon=((1.6, 0.0, 1.35), [(1.35, 0.0), (2.05, 0.0), (2.1, 0.34), (1.7, 0.34)], 1.6),
           airbrake=((0.55, 0.49, 1.05), (0.42, 0.7, 0.5, 0.47, 0.45, 1.05)))
    skids(root, mats, 0.42, -2.1, 1.7, -0.38)


def build_sidewinder(root, mats, frame):
    body = Builder('body_static')
    hull(body, frame['stations'])
    canopy(body, [(-1.7, 0.2, 0.52, 0.58), (-1.15, 0.34, 0.58, 0.9), (-0.35, 0.34, 0.64, 0.92), (0.2, 0.24, 0.64, 0.74)])
    body.plate([(-0.6, -0.2, -3.6), (0.6, -0.2, -3.6), (0.9, -0.22, -2.7), (-0.9, -0.22, -2.7)], 0.04, 'FRAME_trim')
    for s in (-1, 1):
        # Drift skirts along the flared rear, lit in three running segments.
        body.box((s * 1.56, -0.16, 0.45), (0.16, 0.34, 3.3), 'FRAME_accent')
        for z in (-0.7, 0.45, 1.6):
            body.box((s * 1.65, -0.2, z), (0.03, 0.05, 0.8), 'FRAME_lights')
        # Dark hazard chevrons along the skirt's upper face: the drift read
        # carries from the chase camera, not only on the flank.
        for n in range(6):
            z0 = -1.05 + n * 0.56
            body.fin([(z0, -0.13), (z0 + 0.2, -0.13), (z0 + 0.36, 0.0), (z0 + 0.16, 0.0)], s * 1.645, 0.02, 'FRAME_trim')
        # Front outrigger canards on an exposed strut.
        body.plate([(s * 0.9, 0.06, -2.95), (s * 1.78, 0.02, -2.75), (s * 1.78, 0.02, -2.25), (s * 1.0, 0.06, -2.1)], 0.06, 'FRAME_paint')
        body.tube([(s * 0.9, 0.12, -2.5), (s * 1.74, 0.06, -2.5)], 0.05, 'FRAME_metal')
        # Canted side gills.
        for z in (-0.35, -0.05, 0.25):
            body.plate([(s * 1.1, 0.44, z), (s * 1.4, 0.3, z), (s * 1.4, 0.3, z + 0.14), (s * 1.1, 0.44, z + 0.14)], 0.03, 'FRAME_trim')
        # The wing stands on two swept pylons.
        body.fin([(1.45, 0.5), (1.85, 0.5), (2.25, 1.0), (1.95, 1.0)], s * 0.62, 0.06, 'FRAME_metal')
    aerofoil(body, [(-1.38, 1.02, 2.2, 0.45), (0.0, 0.98, 1.95, 0.62), (1.38, 1.02, 2.2, 0.45)], 'FRAME_accent')
    body.box((0, 1.0, 2.6), (1.6, 0.03, 0.04), 'FRAME_lights')
    rear_kit(body, 0.26, 2.48, radius=0.25)
    body.finish(mats, root)
    anchors(root, 0.26, 2.48, hardpoint=(0.78, 0.46, -0.05), nose=(0, 0.1, -3.4),
            wing=(1.64, -0.2, 1.9), dust=(1.4, -0.3, 1.6), flank=(1.6, 0.0, 1.4))
    movers(root, mats,
           steering=((1.6, 0.04, -2.8), [(-2.8, 0.04), (-2.25, 0.04), (-2.35, 0.46), (-2.6, 0.46)], 1.6),
           elevon=((1.4, 0.8, 1.95), [(1.95, 0.8), (2.6, 0.8), (2.6, 1.28), (2.05, 1.28)], 1.4),
           airbrake=((0.72, 0.6, 1.2), (0.5, 0.95, 0.62, 0.56, 0.6, 1.2)))
    skids(root, mats, 0.6, -1.8, 1.6, -0.38)


def build_bulwark(root, mats, frame):
    body = Builder('body_static')
    hull(body, frame['stations'])
    # A slit visor of three panes instead of a bubble.
    for x0, x1 in ((-0.72, -0.27), (-0.22, 0.22), (0.27, 0.72)):
        body.plate([(x0, 0.74, -2.85), (x1, 0.74, -2.85), (x1, 0.9, -2.2), (x0, 0.9, -2.2)], 0.04, 'FRAME_glass')
    for x in (-0.745, -0.245, 0.245, 0.745):
        body.plate([(x - 0.025, 0.75, -2.9), (x + 0.025, 0.75, -2.9), (x + 0.025, 0.92, -2.15), (x - 0.025, 0.92, -2.15)], 0.06, 'FRAME_trim')
    # Bull bar.
    for x in (-0.9, 0.9):
        body.tube([(x, -0.18, -3.62), (x, 0.36, -3.5)], 0.05, 'FRAME_metal')
    # The top rail hazard-banded amber and black.
    for n in range(5):
        x0 = -1.0 + n * 0.4
        body.tube([(x0, 0.3, -3.55), (x0 + 0.4, 0.3, -3.55)], 0.055, 'FRAME_accent' if n % 2 == 0 else 'FRAME_trim')
    body.tube([(-1.0, 0.0, -3.62), (1.0, 0.0, -3.62)], 0.05, 'FRAME_metal')
    body.box((0, -0.05, -3.46), (1.5, 0.12, 0.05), 'FRAME_lights')
    # Spine spar with lift hooks, flanked by two dorsal ducts.
    body.box((0, 0.98, -0.3), (0.24, 0.12, 3.6), 'FRAME_trim')
    for z in (-1.4, 1.0):
        body.arc((0, 1.04, z), 0.14, 0.045, 0.045, 0, math.pi, 'FRAME_metal', steps=5)
    for s in (-1, 1):
        body.pod((s * 0.34, 1.0), 0.14, 0.1, 1.95, 'FRAME_trim', segments=6, nose=0.9, tail=1.0, end_role='FRAME_lights')
        # Four hover pods on plate outriggers, lit flat underneath.
        for zc in (-2.2, 1.45):
            body.pod((s * 1.46, -0.12), 0.34, zc - 0.85, zc + 0.85, 'FRAME_accent', segments=8, end_role='FRAME_trim')
            body.box((s * 1.46, -0.47, zc), (0.36, 0.04, 1.3), 'FRAME_lights')
            body.plate([(s * 1.05, 0.12, zc - 0.32), (s * 1.34, -0.02, zc - 0.32), (s * 1.34, -0.02, zc + 0.32), (s * 1.05, 0.12, zc + 0.32)], 0.1, 'FRAME_metal')
        body.box((s * 1.17, 0.46, -0.3), (0.08, 0.26, 2.4), 'FRAME_trim')
    rear_kit(body, 0.26, 2.52, radius=0.26)
    body.finish(mats, root)
    anchors(root, 0.26, 2.52, hardpoint=(0.78, 0.78, -0.05), nose=(0, 0.2, -3.62),
            wing=(1.46, -0.12, 2.3), dust=(1.46, -0.44, 1.4), flank=(1.2, 0.3, 1.5))
    movers(root, mats,
           steering=((1.46, 0.16, -2.75), [(-2.75, 0.16), (-2.0, 0.16), (-2.1, 0.5), (-2.55, 0.5)], 1.46),
           elevon=((1.46, 0.16, 1.05), [(1.05, 0.16), (2.0, 0.16), (2.1, 0.56), (1.4, 0.56)], 1.46),
           airbrake=((0.62, 0.93, 1.9), (0.58, 0.95, 0.94, 0.92, 1.46, 1.9)))
    skids(root, mats, 0.7, -2.4, 1.9, -0.38)


def build_corona(root, mats, frame):
    body = Builder('body_static')
    hull(body, frame['stations'])
    canopy(body, [(-2.6, 0.2, 0.56, 0.62), (-2.0, 0.34, 0.62, 0.92), (-1.1, 0.36, 0.72, 0.98), (-0.4, 0.28, 0.76, 0.86)])
    for s in (-1, 1):
        # The plasma cells ARE the reserve gauge: the kit drives TE_boost, and
        # garage-look.ts lights them in four bands along z -1.7..1.7 by the
        # reserve. The three sleeve rings sit on the band edges, so the four
        # segments a player sees are exactly the four bands.
        body.pod((s * 1.28, 0.12), 0.22, -1.7, 1.7, 'TE_boost', segments=8, nose=0.8, tail=0.8, end_role='FRAME_metal')
        for z in (-0.85, 0.0, 0.85):
            body.arc((s * 1.28, 0.12, z), 0.255, 0.07, 0.16, 0, math.tau, 'FRAME_trim', steps=8)
        body.pod((s * 1.28, 0.12), 0.3, -2.25, -1.55, 'FRAME_paint', segments=8, nose=0.35, tail=1.0, end_role='FRAME_trim')
        body.pod((s * 1.28, 0.12), 0.3, 1.55, 2.2, 'FRAME_paint', segments=8, nose=1.0, tail=0.8, end_role='FRAME_trim')
        for z in (-1.0, 1.0):
            body.plate([(s * 0.7, 0.2, z - 0.3), (s * 1.1, 0.14, z - 0.25), (s * 1.1, 0.14, z + 0.25), (s * 0.7, 0.2, z + 0.3)], 0.08, 'FRAME_metal')
        # Dorsal conduits from each cell up into the coil.
        body.tube([(s * 1.28, 0.36, 1.35), (s * 0.95, 0.92, 1.8), (s * 0.56, 1.0, 2.24)], 0.045, 'FRAME_metal')
    rear_kit(body, 0.26, 2.54, radius=0.24)
    body.finish(mats, root)
    anchors(root, 0.26, 2.54, hardpoint=(0.78, 0.38, -0.05), nose=(0, 0.12, -3.65),
            wing=(1.28, 0.12, 2.2), dust=(1.28, -0.2, 1.6), flank=(1.5, 0.12, 1.2))
    ring = empty('stabiliser_ring_pivot', (0, 0.26, 2.3), root)
    coil = Builder('stabiliser_ring_body', (0, 0.26, 2.3))
    coil.arc((0, 0.26, 2.3), 0.92, 0.09, 0.16, 0, math.tau, 'FRAME_metal', steps=16)
    for a0, a1 in ((20, 160), (200, 340)):
        coil.arc((0, 0.26, 2.39), 0.92, 0.06, 0.04, math.radians(a0), math.radians(a1), 'FRAME_lights', steps=8)
    for n in range(8):
        a = math.tau * (n + 0.5) / 8
        coil.box((0.99 * math.cos(a), 0.26 + 0.99 * math.sin(a), 2.3), (0.12, 0.12, 0.2), 'FRAME_metal')
    coil.finish(mats, ring)
    movers(root, mats,
           steering=((1.28, 0.4, -2.1), [(-2.1, 0.36), (-1.55, 0.36), (-1.65, 0.78), (-1.95, 0.78)], 1.28),
           elevon=((1.28, 0.4, 1.55), [(1.55, 0.36), (2.15, 0.36), (2.15, 0.72), (1.8, 0.72)], 1.28),
           airbrake=((0.45, 0.8, 1.2), (0.18, 0.62, 0.82, 0.76, 0.64, 1.2)))
    skids(root, mats, 0.5, -2.2, 1.7, -0.38)


def build_halo(root, mats, frame):
    body = Builder('body_static')
    hull(body, frame['stations'])
    canopy(body, [(-2.9, 0.16, 0.5, 0.56), (-2.2, 0.28, 0.58, 0.9), (-1.2, 0.3, 0.72, 0.98), (-0.3, 0.22, 0.8, 0.9)])
    # Chined pontoons with nose canards and lit tail cores.
    pontoon = [st(-3.7, 0.05, 0.1, 0.02, -0.06, 0.5, 0.5),
               st(-3.2, 0.24, 0.26, 0.12, -0.2, 0.5, 0.6),
               st(-1.5, 0.30, 0.34, 0.14, -0.28, 0.5, 0.6),
               st(1.2, 0.30, 0.34, 0.14, -0.28, 0.5, 0.6),
               st(2.6, 0.22, 0.26, 0.12, -0.2, 0.5, 0.6)]
    for s in (-1, 1):
        hull(body, pontoon, textured=False, offset_x=s * 1.28)
        body.disc((s * 1.28, 0.02), 0.12, 2.63, 'FRAME_lights', depth=0.04)
        body.box((s * 1.28, -0.29, -0.4), (0.3, 0.03, 4.2), 'FRAME_lights')
        body.plate([(s * 0.52, 0.12, -1.4), (s * 1.1, 0.06, -0.9), (s * 1.1, 0.06, 1.3), (s * 0.5, 0.12, 1.6)], 0.07, 'FRAME_paint')
        body.plate([(s * 1.1, 0.12, -3.3), (s * 1.66, 0.1, -3.0), (s * 1.66, 0.1, -2.6), (s * 1.1, 0.12, -2.55)], 0.05, 'FRAME_accent')
        body.tube([(s * 1.36, 0.2, 1.85), (s * 1.66, 0.4, 2.02)], 0.06, 'FRAME_metal')
    rear_kit(body, 0.24, 2.6, radius=0.24)
    body.finish(mats, root)
    anchors(root, 0.24, 2.6, hardpoint=(0.78, 0.16, -0.05), nose=(0, 0.14, -4.0),
            wing=(1.72, 0.26, 2.05), dust=(1.28, -0.28, 2.0), flank=(1.58, 0.05, 1.2))
    # The halo: a full flattened ring round the tail, wider than the hull,
    # raked forward, lit in segments; it rolls with the load like TOTEM's,
    # and sits low enough that its full roll stays inside the envelope.
    ring = empty('stabiliser_ring_pivot', (0, 0.26, 2.05), root)
    halo = Builder('stabiliser_ring_body', (0, 0.26, 2.05))
    rake = math.radians(15)
    halo.arc((0, 0.26, 2.05), 1.72, 0.14, 0.24, 0, math.tau, 'FRAME_accent', steps=24, squash=0.5, rake=rake)
    for n in range(6):
        a = math.tau * (n + 0.25) / 6
        halo.arc((0, 0.26, 2.05 + 0.13), 1.72, 0.05, 0.03, a, a + math.radians(26), 'FRAME_lights', steps=3, squash=0.5, rake=rake)
    halo.finish(mats, ring)
    movers(root, mats,
           steering=((1.28, 0.3, -2.4), [(-2.4, 0.3), (-1.7, 0.3), (-1.85, 0.72), (-2.2, 0.72)], 1.28),
           elevon=((1.28, 0.3, 1.3), [(1.3, 0.3), (1.95, 0.3), (1.9, 0.62), (1.55, 0.62)], 1.28),
           airbrake=((0.4, 0.74, 1.3), (0.14, 0.52, 0.76, 0.7, 0.7, 1.3)))
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


def render_views(code, mats):
    scene = bpy.context.scene
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
    for name, energy, colour, rotation in (('key', 3.2, (1, 1, 1), (48, 8, 38)), ('rim', 1.4, (0.6, 0.85, 1.0), (70, 0, 200))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy, light.data.color = energy, colour
        light.rotation_euler = tuple(math.radians(r) for r in rotation)
        scene.collection.objects.link(light)
    floor = Builder('floor')
    floor.box((0, -0.62, 0), (30, 0.02, 30), 'FRAME_trim')
    floor = floor.finish(mats)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam

    def look(eye, target):
        from mathutils import Vector
        cam.location = g2b(eye)
        cam.rotation_euler = (Vector(g2b(target)) - Vector(g2b(eye))).to_track_quat('-Z', 'Y').to_euler()

    shots = {}

    def shoot(view):
        shots[view] = EVIDENCE / f'{code}-{view}.png'
        scene.render.filepath = str(shots[view])
        bpy.ops.render.render(write_still=True)

    cam.data.lens = 55
    look((6.6, 3.4, -7.4), (0, 0.25, -0.3))
    shoot('hero')
    # The chase camera's own view: behind and a little above.
    look((0, 2.75, 9.8), (0, 0.5, -1.0))
    shoot('chase')
    look((-5.6, 2.2, 7.8), (0, 0.3, 0.4))
    shoot('rear')
    floor.hide_render = True
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 10.5
    look((14, 0.4, -0.6), (0, 0.4, -0.6))
    shoot('side')
    cam.location, cam.rotation_euler = g2b((0, 14, -0.6)), (0, 0, 0)
    shoot('top')
    look((0, 0.45, -14), (0, 0.45, 0))
    shoot('front')
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
    stats['glow'] = list(frame['glow'])
    stats['paints'] = paint_schemes(code, frame)
    if RENDER:
        render_views(code, mats)
    print(code, json.dumps(stats))
    return stats


if __name__ == '__main__':
    only = [a for a in sys.argv[1:] if a in FRAMES]
    results = {code: build(code) for code in (only or FRAMES)}
    manifest_path = OUTPUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.update(results)
    manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + '\n')
