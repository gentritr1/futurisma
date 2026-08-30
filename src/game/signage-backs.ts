import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import backPanelsJson from "./data/FUTURISMA_SIGNAGE_BACK_PANELS.json";
import { type RaceCourse } from "./course";
import {
  frameFor,
  SIGNAGE_PLACEMENTS,
  type SignagePlacement,
} from "./signage";

/**
 * P18 art pass 03 — the back of a board.
 *
 * The signage material is `side: THREE.FrontSide`, so today a free-standing
 * board is drawn on one face and is *not drawn at all* from behind: you pass a
 * 9.6 m hoarding and it vanishes, leaving two posts holding up nothing. (The
 * Pass 03 delivery describes the symptom as the front art appearing mirrored on
 * the back; the runtime is single-sided, so the actual read is a disappearing
 * board. Either way the fix is the same and is the one the delivery authors: a
 * real back face.)
 *
 * A board back is a panel, a welded frame, four through-bolts and a service
 * tag. Two regions on `futurisma_trim_512`, assigned per placement by
 * `FUTURISMA_SIGNAGE_BACK_PANELS.json`. One merged mesh, one material, ONE draw
 * call per map — a back face cannot ride the signage material because it does
 * not sample the signage sheet, and that sheet is hash-pinned.
 *
 * Ribs run HORIZONTALLY on the region. That is the whole design idea: the
 * change of direction against the front art's vertical layout is the cue that
 * says you are looking at the wrong side.
 */

/** The board's own footprint, offset back along its normal by a plate depth. */
const PANEL_DEPTH_METRES = 0.03;

/**
 * The region is authored square at 2.5 m. A wider board repeats the ribs along
 * U rather than stretching them, so the 0.34 m rib pitch stays 0.34 m on every
 * board — which means U tiles at the board's width over this, not over 1.
 */
const REGION_METRES = 2.5;

const BACK_MATERIAL_NAME = "FUTURISMA_SIGNAGE_BACKS";

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

interface BackPanelPlacement {
  slot: string;
  distance: number;
  region: string;
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;
const BACK_PANELS = backPanelsJson as unknown as {
  sheet: { texture: string };
  rule: { applyWhen: string[]; excludeWhen: string[] };
  placements: Record<"greenwater" | "bitterpan", BackPanelPlacement[]>;
  counts: Record<string, { tagged: number; blank: number }>;
};

export interface SignageBackStats {
  drawCalls: number;
  panels: number;
  tagged: number;
  blank: number;
  triangles: number;
  materials: number;
  textures: number;
  /**
   * Placements the apply/exclude rule selected that also resolve as a wall
   * plaque. Must be zero: those thirteen already carry the Pass 02 backing
   * panel, which is a better answer than a back face — there is no back, there
   * is a wall.
   */
  wallPlaqueSkips: number;
  shaderModel: "unlit";
}

/**
 * The selection rule, verbatim from the delivery's `rule` block.
 *
 * Apply to every free-standing board whose back face is drawn; do not apply
 * where a back face does not exist or is already art.
 */
export function backPanelApplies(placement: SignagePlacement): boolean {
  // `both faces` — CRADLE_BANNER at distance 0. The art IS double-sided by
  // design and the reverse-facing entry already covers it.
  if (/both faces/i.test(placement.mount)) return false;
  // Capping and tape strips, and pennant rows: no back face is drawn.
  if (placement.slot === "SPONSOR_TAPE" || placement.slot === "PENNANT_ROW") return false;
  // Totem panels are pit-wall mounted.
  if (placement.slot.startsWith("TOTEM_")) return false;
  if (!/post|hoarding/i.test(placement.mount)) return false;
  return placement.facing === "inward" || placement.facing === "reverse";
}

export class SignageBackPanels {
  readonly stats: SignageBackStats;

  private constructor(readonly root: THREE.Group, stats: SignageBackStats) {
    this.stats = stats;
  }

  static build(course: RaceCourse, texture: THREE.Texture): SignageBackPanels {
    const map = course.kind === "bitterpan" ? "bitterpan" : "greenwater";
    const sheet = ATLAS_SHEETS.futurisma_trim_512;
    if (!sheet) {
      throw new Error("Trim atlas futurisma_trim_512 is missing from ATLAS_REGIONS.");
    }
    const authored = BACK_PANELS.placements[map];
    const spec = SIGNAGE_PLACEMENTS[map];

    // The rule selects; the authored table names the region. Both are asserted
    // against each other rather than one trusted: a board that the rule selects
    // and the table forgot would silently ship with no back, and a table entry
    // the rule rejects would silently put a panel behind a pit wall.
    const selected = spec.placements.filter(backPanelApplies);
    const unmatched = new Set(authored.map((entry) => `${entry.slot}@${entry.distance}`));

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const scratch = course.createSampleScratch();
    const normal = new THREE.Vector3();
    let tagged = 0;
    let blank = 0;
    let wallPlaqueSkips = 0;

    for (const placement of selected) {
      const key = `${placement.slot}@${placement.distance}`;
      const entry = authored.find(
        (candidate) => `${candidate.slot}@${candidate.distance}` === key,
      );
      if (!entry) {
        throw new Error(
          `Signage placement ${placement.id} takes a back panel by rule but `
            + `FUTURISMA_SIGNAGE_BACK_PANELS.json authors none for ${key}.`,
        );
      }
      unmatched.delete(key);

      // A wall plaque has no back; it has a wall, and a Pass 02 backing panel.
      // Structurally the two systems are disjoint — plaques come off the course
      // furniture resolver, boards out of the placement table — so this counts
      // rather than filters, and a non-zero count is the signal that they met.
      if (resolvesAsWallPlaque(course, placement)) {
        wallPlaqueSkips += 1;
        continue;
      }

      const region = sheet.regions[entry.region];
      if (!region) {
        throw new Error(`Back panel ${key} names unknown trim region ${entry.region}.`);
      }
      if (entry.region === "SIGN_BACK_TAGGED") tagged += 1;
      else blank += 1;

      const u0 = region.x / sheet.width;
      const u1 = (region.x + region.w) / sheet.width;
      const v0 = 1 - (region.y + region.h) / sheet.height;
      const v1 = 1 - region.y / sheet.height;

      const frame = frameFor(course, placement, scratch);
      // Flipping the width axis flips `widthAxis x heightAxis`, which is what
      // makes this quad the BACK of the same plane the board occupies.
      const widthAxis = frame.widthAxis.clone().multiplyScalar(-1);
      normal.crossVectors(widthAxis, frame.heightAxis).normalize();
      const centre = frame.origin.clone()
        .addScaledVector(normal, PANEL_DEPTH_METRES);

      const halfWidth = placement.widthMetres / 2;
      const halfHeight = placement.heightMetres / 2;
      // Ribs keep their authored pitch: U runs over as many 2.5 m region widths
      // as the board is wide, so a 14 m hoarding gets 5.6 repeats of the panel
      // rather than one stretched to five times its rib spacing.
      const repeats = Math.max(1, placement.widthMetres / REGION_METRES);
      const vRepeats = Math.max(1, placement.heightMetres / REGION_METRES);

      const base = positions.length / 3;
      const corners: ReadonlyArray<readonly [number, number, number, number]> = [
        [-halfWidth, -halfHeight, u0, v0],
        [halfWidth, -halfHeight, u0 + (u1 - u0) * repeats, v0],
        [-halfWidth, halfHeight, u0, v0 + (v1 - v0) * vRepeats],
        [halfWidth, halfHeight, u0 + (u1 - u0) * repeats, v0 + (v1 - v0) * vRepeats],
      ];
      for (const [across, up, u, v] of corners) {
        positions.push(
          centre.x + widthAxis.x * across + frame.heightAxis.x * up,
          centre.y + widthAxis.y * across + frame.heightAxis.y * up,
          centre.z + widthAxis.z * across + frame.heightAxis.z * up,
        );
        uvs.push(u, v);
      }
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }

    if (unmatched.size > 0) {
      throw new Error(
        `FUTURISMA_SIGNAGE_BACK_PANELS.json authors panels the apply rule does `
          + `not select on ${map}: ${[...unmatched].join(", ")}.`,
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicMaterial({
      name: BACK_MATERIAL_NAME,
      map: texture,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = map === "bitterpan" ? "BP_SIGNAGE_BACKS" : "GW_SIGNAGE_BACKS";
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const root = new THREE.Group();
    root.name = `${map}_signage_back_panels`;
    root.add(mesh);

    return new SignageBackPanels(root, {
      drawCalls: 1,
      panels: tagged + blank,
      tagged,
      blank,
      triangles: indices.length / 3,
      materials: 1,
      textures: 1,
      wallPlaqueSkips,
      shaderModel: "unlit",
    });
  }

  static async load(
    course: RaceCourse,
    textureUrl: string,
  ): Promise<SignageBackPanels> {
    const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
    // Same contract as the signage sheet it sits behind: nearest, no mips. The
    // trim sheet is magnified onto ground quads and board backs alike.
    texture.name = "futurisma_trim_512";
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    // The back panels repeat their region along U; the edge band does not. One
    // texture serves both, so it wraps and the band's UVs stay inside its rect.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    try {
      return SignageBackPanels.build(course, texture);
    } catch (error) {
      texture.dispose();
      throw error;
    }
  }
}

/**
 * Whether a board placement lands where the course resolved a WALL PLAQUE.
 *
 * The plaque backings carry the world matrix of the plaque that emitted them,
 * so this compares world positions rather than trusting two coordinate systems
 * to agree.
 */
function resolvesAsWallPlaque(
  course: RaceCourse,
  placement: SignagePlacement,
): boolean {
  const backings = course.wallPlaqueBackings ?? [];
  if (backings.length === 0) return false;
  const scratch = course.createSampleScratch();
  const frame = frameFor(course, placement, scratch);
  const point = new THREE.Vector3();
  for (const backing of backings) {
    point.setFromMatrixPosition(backing.matrix);
    if (point.distanceTo(frame.origin) < 1.5) return true;
  }
  return false;
}
