import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import { PLAQUE_BACKING_CLASSES, type PlaqueBackingPlacement } from "./course";

/**
 * P15 art pass 02 — the thing the Hangar Six plaques are bolted to.
 *
 * P13 moved 13 pieces of edge furniture off the road and onto the hangar wall:
 * 7 turn chevrons and 6 braking boards became wall plaques, because the hangar
 * span authors no verge to stand a post on. What it could not give them was
 * anything to be bolted TO — the hangar shell is an open pillar frame, so the
 * plaques have been floating in front of a gap ever since.
 *
 * Two `InstancedMesh`es, 7 + 6 instances, 26 triangles, 2 draw calls, one
 * 512 sheet shared with nothing else.
 *
 * The placements are NOT authored here and NOT read from a position list.
 * `GreenwaterCourse.createTurnMarkers` emits one entry per group whose
 * `resolveFurniturePlacement` came back `mode === "wall"`, from the same
 * resolver call that placed the plaque — see `course.ts#recordPlaqueBacking`.
 * This module only turns those matrices into geometry once the sheet has
 * loaded, so it cannot put a panel anywhere the plaque is not.
 *
 * Lit, not unlit: these are surfaces inside a lit shell, and a flat-bright
 * panel behind a Lambert-shaded plaque would read as a hole in the wall rather
 * than as a plate on it.
 */

const MATERIAL_NAME = "GW_HANGAR_FIXTURES";
const SHEET_KEY = "hangar_fixtures_512";
const MESH_NAMES = {
  chevron: "GW_HANGAR_PLAQUE_BACK_CHEVRON",
  board: "GW_HANGAR_PLAQUE_BACK_BOARD",
} as const;

/**
 * Drawn before the plaque it backs. The 60 mm stand-off already resolves the
 * depth test on its own; this is what the spec asks for, and what keeps the
 * ordering explicit if a future pass ever makes either surface transparent.
 */
const BACKING_RENDER_ORDER = -1;

interface AtlasRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasSheet {
  texture: string;
  width: number;
  height: number;
  regions: Record<string, AtlasRegion>;
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;

export interface PlaqueBackingStats {
  drawCalls: number;
  panels: number;
  chevronPanels: number;
  boardPanels: number;
  triangles: number;
  materials: number;
  textures: number;
}

export class HangarPlaqueBacking {
  readonly stats: PlaqueBackingStats;

  private constructor(readonly root: THREE.Group, stats: PlaqueBackingStats) {
    this.stats = stats;
  }

  static build(
    placements: readonly PlaqueBackingPlacement[],
    texture: THREE.Texture,
  ): HangarPlaqueBacking {
    const sheet = ATLAS_SHEETS[SHEET_KEY];
    if (!sheet) {
      throw new Error(`Plaque-backing atlas ${SHEET_KEY} is missing from ATLAS_REGIONS.`);
    }
    if (placements.length === 0) {
      throw new Error(
        "No wall plaques were resolved, so there is nothing to back. The hangar "
          + "span authors no apron, so this is a course-assembly failure rather "
          + "than an empty layer.",
      );
    }

    const material = new THREE.MeshLambertMaterial({
      name: MATERIAL_NAME,
      map: texture,
      side: THREE.FrontSide,
      fog: true,
    });

    const root = new THREE.Group();
    root.name = "greenwater_hangar_plaque_backing";
    const counts = { chevron: 0, board: 0 };
    let triangles = 0;

    for (const klass of ["chevron", "board"] as const) {
      const forClass = placements.filter((placement) => placement.klass === klass);
      counts[klass] = forClass.length;
      if (forClass.length === 0) continue;
      const region = sheet.regions[PLAQUE_BACKING_CLASSES[klass].slot];
      if (!region) {
        throw new Error(
          `Plaque backing class ${klass} names slot `
            + `${PLAQUE_BACKING_CLASSES[klass].slot}, which has no region.`,
        );
      }
      const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
      bakeRegionUvs(geometry, region, sheet);
      const mesh = new THREE.InstancedMesh(geometry, material, forClass.length);
      mesh.name = MESH_NAMES[klass];
      forClass.forEach((placement, index) => mesh.setMatrixAt(index, placement.matrix));
      mesh.instanceMatrix.needsUpdate = true;
      // P20.1. A backing plate proud of the wall it hangs on is exactly the
      // kind of small caster that makes an interior read as built.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = BACKING_RENDER_ORDER;
      triangles += forClass.length * 2;
      root.add(mesh);
    }

    return new HangarPlaqueBacking(root, {
      drawCalls: (counts.chevron > 0 ? 1 : 0) + (counts.board > 0 ? 1 : 0),
      panels: placements.length,
      chevronPanels: counts.chevron,
      boardPanels: counts.board,
      triangles,
      materials: 1,
      textures: 1,
    });
  }

  static async load(
    placements: readonly PlaqueBackingPlacement[],
    textureUrl: string,
  ): Promise<HangarPlaqueBacking> {
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    texture.name = SHEET_KEY;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    try {
      return HangarPlaqueBacking.build(placements, texture);
    } catch (error) {
      texture.dispose();
      throw error;
    }
  }
}

/**
 * Rewrites a unit plane's UVs onto one atlas rectangle. `PlaneGeometry` emits
 * its corners top-left, top-right, bottom-left, bottom-right, so the V it
 * carries is 1 at the top; image space runs the other way.
 */
function bakeRegionUvs(
  geometry: THREE.PlaneGeometry,
  region: AtlasRegion,
  sheet: AtlasSheet,
): void {
  const u0 = region.x / sheet.width;
  const u1 = (region.x + region.w) / sheet.width;
  const v0 = 1 - (region.y + region.h) / sheet.height;
  const v1 = 1 - region.y / sheet.height;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      uv.getX(index) === 0 ? u0 : u1,
      uv.getY(index) === 0 ? v0 : v1,
    );
  }
  uv.needsUpdate = true;
}
