"""POLISH-3 hardware, modelled from the supplied orthographic sheet.

Reuses the hero builder's metre basis, flat mesh writer and shared atlas UVs.
No generated textures, embedded images, collision solids or new power rules.
"""
import json
import math
import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_dreamisland_heroes as hero

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/dreamisland/power-kit.glb'
EVIDENCE = ROOT / 'art/evidence/dreamisland-v1/polish-3/hardware'
COLORS = json.loads((ROOT/'src/game/data/dreamisland/power-colors.json').read_text())


def ring(mesh, y, radius, thickness, height, sides=12):
    for i in range(sides):
        a, b = i * math.tau / sides, (i + 1) * math.tau / sides
        mesh.wedge(y, y + height, radius - thickness, radius,
                   radius - thickness, radius, a, b)


def cylinder(mesh, center, radius, height, sides=8, top_radius=None):
    top = radius if top_radius is None else top_radius
    x, y, z = center
    points = [(x + r * math.cos(i * math.tau / sides), y + dy,
               z + r * math.sin(i * math.tau / sides))
              for r, dy in [(radius, -height/2), (top, height/2)] for i in range(sides)]
    faces = [tuple(reversed(range(sides))), tuple(range(sides, sides*2))]
    faces += [(i, (i+1) % sides, (i+1) % sides+sides, i+sides) for i in range(sides)]
    mesh.geometry(points, [tuple(reversed(face)) for face in faces])


def mount(root, name, striped):
    stone = hero.Mesh(name, 'concrete', 'kerb-cyan' if striped else 'causeway-paving')
    stone.box((0, .14, 0), (.96, .28, .86))
    stone.box((0, .34, 0), (.86, .12, .76))
    stone.finish(root)


def surge(parent):
    root = hero.empty('PK_surge', parent=parent)
    mount(root, 'PK_surge_mount', True)
    cage = hero.Mesh('PK_surge_cage', 'metal', 'clock-ring-hands')
    for y in [.42, .78, 1.18]:
        ring(cage, y, .29, .035, .045, 10)
    for i in range(8):
        a = i * math.tau / 8
        cage.beam((.26*math.cos(a), .43, .26*math.sin(a)),
                  (.26*math.cos(a), 1.23, .26*math.sin(a)), .032)
    cylinder(cage, (0, 1.255, 0), .30, .08, 10, .17)
    # A radial sunburst in the front plane: clear silhouette, few faces.
    for i in range(10):
        a = i * math.tau / 10
        b = a + math.tau / 20
        cage.geometry([(.075*math.sin(a), 1.43+.075*math.cos(a), -.018),
                       (.17*math.sin(b), 1.43+.17*math.cos(b), 0),
                       (.075*math.sin(a+math.tau/10), 1.43+.075*math.cos(a+math.tau/10), -.018),
                       (0, 1.43, .022)], [(0,1,2), (0,3,1), (1,3,2), (2,3,0)])
    cage.finish(root)
    capacitors = hero.Mesh('PK_surge_capacitors', 'metal', 'gate-lamp-post')
    for x, z in [(-.32,-.29),(.32,-.29),(.32,.29),(-.32,.29)]:
        cylinder(capacitors, (x,.80,z), .065, .51, 6)
        cylinder(capacitors, (x,.54,z), .087, .07, 6)
        cylinder(capacitors, (x,1.065,z), .087, .07, 6)
    capacitors.finish(root)
    core = hero.Mesh('PK_surge_core', 'emissive', 'lamp-disc')
    cylinder(core, (0,.83,0), .20, .64, 10, .15)
    core.finish(root)
    return root


def shield(parent):
    root = hero.empty('PK_shield', parent=parent)
    housing = hero.empty('PK_shield_housing', parent=root)
    mount(housing, 'PK_shield_mount', False)
    moss = hero.Mesh('PK_shield_moss', 'concrete', 'wall-block')
    for x in [-.32,.27]:
        for z in [-.432,.432]:
            moss.box((x,.14,z),(.025,.25,.008),(*COLORS['moss'],1))
    moss.finish(housing)
    bell = hero.Mesh('PK_shield_crown', 'metal', 'rail')
    cylinder(bell, (0,1.31,0), .19, .15, 12, .07)
    cylinder(bell, (0,1.49,0), .068, .18, 8, 0)
    bell.finish(housing, {'metalFinish':'bronze'})
    petals = hero.empty('PK_shield_petals', parent=root)
    for i in range(4):
        hinge = hero.empty('PK_shield_hinge_'+str(i), (0,1.24,0), petals)
        # Author each petal about a real top hinge. Runtime rotates the whole
        # mesh, never the vertices. The corridor validator checks both envelopes on the verge.
        mesh = hero.Mesh('PK_shield_petal_'+str(i), 'metal', 'rail')
        for segment in range(3):
            a = -.52 + segment*1.04/3
            b = -.52 + (segment+1)*1.04/3
            mesh.wedge(-.75, 0, .34, .37, .105, .13, a, b)
        mesh.finish(hinge, {'metalFinish':'bronze'})
        hinge.rotation_euler.z = -i*math.pi/2
    core = hero.Mesh('PK_shield_core', 'emissive', 'shallows-glow')
    cylinder(core, (0,.84,0), .27, .64, 12, .065)
    core.finish(root)
    lattice = hero.Mesh('PK_shield_lattice', 'metal', 'clock-ring-hands')
    for y in [.41,.55]:
        ring(lattice, y, .37, .025, .025, 12)
    for i in range(16):
        a, b = i*math.tau/16, (i+1)*math.tau/16
        for low, high in [(a,b),(b,a)]:
            lattice.beam((.35*math.cos(low), .44, .35*math.sin(low)),
                         (.35*math.cos(high), .56, .35*math.sin(high)), .018)
    lattice.finish(root)
    return root


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    hero.MATERIALS = hero.make_materials()
    library = hero.empty('dreamisland_power_kit')
    devices = [surge(library), shield(library)]
    report = {}
    for device in devices:
        triangles = 0
        for obj in device.children_recursive:
            if obj.type != 'MESH':
                continue
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
        assert triangles <= 1200, (device.name, triangles)
        report[device.name] = dict(triangles=triangles, nodes=[o.name for o in device.children_recursive])
    hero.export_asset(library, OUT)
    measured = hero.measure_glb(OUT)
    (EVIDENCE / 'build.json').write_text(json.dumps(dict(script=__file__, devices=report, **measured), indent=2)+'\n')
    print(json.dumps(dict(devices=report, **measured)))


if __name__ == '__main__':
    main()
