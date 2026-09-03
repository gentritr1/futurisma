import * as THREE from "three";
import atlasRegionsJson from "./data/ATLAS_REGIONS.json";
import setDressingJson from "./data/BITTERPAN_SET_DRESSING.json";
import surfaceCrustJson from "./data/BITTERPAN_SURFACE_CRUST.json";
import { type CourseSample, type RaceCourse, surfaceHeightAtLateral } from "./course";
import {
  PAN_FLOOR_BRINE_DEEP_FAR_METRES,
  PAN_FLOOR_BRINE_DEEP_LUMA,
  PAN_FLOOR_BRINE_DEEP_NEAR_METRES,
  PAN_FLOOR_BRINE_LUMA,
  PAN_FLOOR_BRINE_SCALE_METRES,
  PAN_FLOOR_BRINE_THRESHOLD_DRY,
  PAN_FLOOR_BRINE_THRESHOLD_WET,
  PAN_FLOOR_BRINE_TINT,
  PAN_FLOOR_DETAIL_FADE_FAR,
  PAN_FLOOR_DETAIL_FADE_NEAR,
  PAN_FLOOR_FEATURE_FADE_FAR,
  PAN_FLOOR_FEATURE_FADE_NEAR,
  PAN_FLOOR_FEATURE_TRIM,
  PAN_FLOOR_MACRO_FADE_FAR,
  PAN_FLOOR_MACRO_FADE_NEAR,
  PAN_FLOOR_MACRO_RAMP_FAR,
  PAN_FLOOR_MACRO_RAMP_NEAR,
  PAN_FLOOR_MACRO_SEED,
  PAN_FLOOR_RIM_LIFT,
  PAN_FLOOR_RIM_METRES,
  PAN_FLOOR_ROTATED_SCALE,
  PAN_FLOOR_SCOUR_STEP,
  PAN_FLOOR_SCOUR_STRETCH,
  PAN_FLOOR_SCOUR_THRESHOLD,
  PAN_FLOOR_SECONDARY_BLEND,
  PAN_FLOOR_SECONDARY_SCALE,
  PAN_FLOOR_SEGMENTS,
  PAN_FLOOR_SHORE_METRES,
  PAN_FLOOR_STREAK_BANDS,
  PAN_FLOOR_STREAK_LENGTH_METRES,
  PAN_FLOOR_STREAK_OCTAVE_SCALE,
  PAN_FLOOR_STREAK_WIDTH_METRES,
  PAN_FLOOR_WIND_DEGREES,
  PAN_FLOOR_TILE_MEAN_LINEAR,
  PAN_FLOOR_WIND_VECTOR,
  generatePanFloorColours,
} from "./pan-floor-colour.js";
import { activeRenderMode } from "./render-mode.js";
import { applyPs2MaterialTreatment, composeShaderInjection } from "./totem";

/**
 * P15 art pass 02 — the Bitterpan pan, given a ground and what was left on it.
 *
 * Two payloads, two draw calls, and the second number is the interesting one.
 *
 * 1. **The pan floor.** Bitterpan shipped with *no ground at all*: the ribbon
 *    and the site massing hang over fog, which is why the dust devils and the
 *    dry scud in the living-world layer have never read as crossing anything.
 *    `BITTERPAN_SURFACE_CRUST.json`'s `ground` block describes this as a re-map
 *    of "the existing pan plane" — there is no such plane in the runtime, so
 *    this builds the one Greenwater has had since Phase 1 (`createGroundPlane`)
 *    and puts the crust tile on it. That is one draw call the spec did not
 *    budget for; it is called out in the phase report rather than absorbed.
 *
 *    It is the one texture in the project that is deliberately NOT on the
 *    point-sampled class. Pass 02 principle 4: this plane is read from 2 m to
 *    900 m, and `NearestFilter` with no mip chain turns a crust tile into
 *    sparkle the moment the craft moves — era-accurate degradation rather than
 *    era-accurate atmosphere. `?render=ps2` still forces the pixel class on it,
 *    because that mode's whole contract is that nothing escapes the raster.
 *
 * 2. **The crust decals and the set dressing.** 297 + 110 = 407 decals on ONE
 *    mesh, ONE material, ONE draw call, 814 triangles. The two specs are
 *    separate authoring documents but name the same sheet and the same material
 *    contract, and `BITTERPAN_SET_DRESSING.json` says so in `mergesInto`, so
 *    they are built as one payload here — `validate-art-pass.mjs` asserts the
 *    two sides agree about every field on that shared material.
 *
 * The decal builder is the sibling of `opening-surface.ts` and deliberately
 * carries the identical contract: unlit, vertex-coloured, nearest-filtered with
 * no mip chain, `polygonOffset -2/-2` and `depthWrite: false`. Every corner is
 * sampled at its OWN distance around the lap so a 46 m span shadow on a curve
 * follows the centreline instead of cutting the chord, and rides the authored
 * apron cross-section through `surfaceHeightAtLateral` rather than a flat
 * extrapolation of the deck plane.
 *
 * Nothing here is furniture. Every entry is zero-height painted road under
 * `FLAT_FURNITURE_MAX_HEIGHT_METRES`; the 18 conveyor span shadows cross the
 * drivable corridor on purpose, because a shadow that stops at the deck edge is
 * not a shadow.
 */

const DECAL_MESH_NAME = "BP_SURFACE_CRUST";
const DECAL_MATERIAL_NAME = "BP_SURFACE_CRUST";
const GROUND_MESH_NAME = "BP_PAN_FLOOR";
const GROUND_MATERIAL_NAME = "BP_PAN_FLOOR";
const VERTICES_PER_DECAL = 4;
const TRIANGLES_PER_DECAL = 2;

/** Matches `opening-surface.ts`; see the note there. */
const DECAL_LIFT_METRES = 0.012;

/**
 * Where the pan floor sits, in world Y.
 *
 * The authored ribbon runs between -1.872 m and +1.872 m and the accepted
 * blockout's lowest *visible* vertex is the deck at -2.4916 m, so the floor has
 * to clear the deck surface at its lowest station without swallowing the road:
 * -1.95 m is 0.078 m under the lowest deck surface and above nothing that is
 * drawn. The deck's underside and barrier skirts fall below it and are hidden,
 * which is correct — you should not be able to see under the road.
 *
 * The consequence, stated rather than hidden: the crust and dressing decals are
 * authored course-relative and ride the ribbon, so where the ribbon is at its
 * high point an off-deck windrow sits up to 3.8 m above this plane. That is the
 * spec's own placement rule ("honouring the ribbon"), and it reads as the road
 * running on a raised shelf over the pan.
 */
export const GROUND_Y_METRES = -1.95;

/**
 * Half-extent of the pan floor, in metres, and where it is centred.
 *
 * Bitterpan renders at `camera.far = 1800` against Greenwater's 650, so the far
 * plane cannot be relied on to hide the ground's own edge. The track occupies
 * x -13..576 and z -335..878; a 6,048 m square centred on that box's middle
 * puts its nearest edge 2,417 m from the furthest point of the track, which
 * clears the far plane from anywhere a player can be. 6,048 is 504 whole tiles,
 * so the repeat lands on a texel boundary rather than half a crust plate.
 */
const GROUND_SIZE_METRES = 6_048;
const GROUND_CENTRE_X_METRES = 281;
const GROUND_CENTRE_Z_METRES = 271;

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
  sha256: string;
  regions: Record<string, AtlasRegion>;
}

interface SurfaceDecal {
  slot: string;
  distance: number;
  lateral: number;
  width: number;
  length: number;
  rotationDeg: number;
  tint: string;
  alpha: number;
}

const ATLAS_SHEETS = atlasRegionsJson as unknown as Record<string, AtlasSheet>;
const SURFACE_CRUST = surfaceCrustJson as unknown as {
  ground: { metresPerTile: number };
  decalCount: number;
  triangles: number;
  decals: SurfaceDecal[];
};
const SET_DRESSING = setDressingJson as unknown as {
  itemCount: number;
  triangles: number;
  items: SurfaceDecal[];
};

export interface BitterpanSurfaceStats {
  drawCalls: number;
  /** 297 crust decals + 110 dressing items, on one mesh. */
  decals: number;
  crustDecals: number;
  dressingItems: number;
  triangles: number;
  materials: number;
  textures: number;
  groundMetresPerTile: number;
  groundAnisotropy: number;
  shaderModel: "unlit+lambert";
  /**
   * P20.6 — the pan floor's macro field, as the numbers a soak can see.
   *
   * The floor is not interactive, so nothing else in the diagnostics moves if
   * this pass silently fails to run: `segments` reading 1 or `meanLuma`
   * drifting off 1.0 is the only automated evidence that the field is on the
   * mesh and that it is a variation pass rather than a re-grade.
   */
  panFloor: {
    segments: number;
    macroSeed: number;
    secondaryScale: number;
    vertices: number;
    /** Mean of the generated vertex colours, as a luma multiplier. 1.0 = the
     *  flat white the floor shipped with. */
    meanLuma: number;
    peakBrightness: number;
    peakHue: number;
    /** The wind the streaks lie along, and how many terrace bands cut them. */
    windDegrees: number;
    streakBands: number;
    /** Mean brine-flat weight over the plane: 0 means no pool will ever be
     *  drawn, which is the one silent failure this layer can have. */
    brineWeightMean: number;
    /** True only under `?floorprobe=1`, the review-only view. */
    probe: boolean;
  };
}

/** Corner order and winding, identical to `opening-surface.ts`. */
const CORNERS: ReadonlyArray<{ u: number; v: number; su: number; sv: number }> = [
  { u: -0.5, v: -0.5, su: 0, sv: 0 },
  { u: 0.5, v: -0.5, su: 1, sv: 0 },
  { u: -0.5, v: 0.5, su: 0, sv: 1 },
  { u: 0.5, v: 0.5, su: 1, sv: 1 },
];

const CORNER_INDICES = [0, 1, 2, 2, 1, 3];

export class BitterpanSurface {
  readonly stats: BitterpanSurfaceStats;

  private constructor(readonly root: THREE.Group, stats: BitterpanSurfaceStats) {
    this.stats = stats;
  }

  /**
   * @param probeMode the review-only `?floorprobe` mode, PASSED IN rather than
   *   read here. `floor-probe.js` lives in the initial chunk (`scene-assets.ts`
   *   reads it to hide the other layers); importing it from this lazily loaded
   *   module would make Rollup hoist it to a shared chunk and push the initial
   *   JS over its 226 KiB gzip budget. Threading one number costs nothing.
   */
  static build(
    course: RaceCourse,
    groundTexture: THREE.Texture,
    decalTexture: THREE.Texture,
    probeMode: 0 | 1 | 2 = 0,
  ): BitterpanSurface {
    const sheetKey = "bitterpan_crust_1024";
    const sheet = ATLAS_SHEETS[sheetKey];
    if (!sheet) {
      throw new Error(`Bitterpan crust atlas ${sheetKey} is missing from ATLAS_REGIONS.`);
    }
    if (SURFACE_CRUST.decals.length !== SURFACE_CRUST.decalCount) {
      throw new Error(
        `The pan crust declares ${SURFACE_CRUST.decalCount} decals but ships `
          + `${SURFACE_CRUST.decals.length}.`,
      );
    }
    if (SET_DRESSING.items.length !== SET_DRESSING.itemCount) {
      throw new Error(
        `The pan set dressing declares ${SET_DRESSING.itemCount} items but ships `
          + `${SET_DRESSING.items.length}.`,
      );
    }

    // One list, one buffer, one draw call. The dressing is not a second layer:
    // it names the same sheet and the same material, which is the whole reason
    // it costs nothing to draw.
    const decals: SurfaceDecal[] = [...SURFACE_CRUST.decals, ...SET_DRESSING.items];

    const positions = new Float32Array(decals.length * VERTICES_PER_DECAL * 3);
    const uvs = new Float32Array(decals.length * VERTICES_PER_DECAL * 2);
    const colors = new Float32Array(decals.length * VERTICES_PER_DECAL * 4);
    const indices = new Uint16Array(decals.length * TRIANGLES_PER_DECAL * 3);

    const scratch = course.createSampleScratch();
    const tint = new THREE.Color();
    const point = new THREE.Vector3();

    decals.forEach((decal, decalIndex) => {
      const region = sheet.regions[decal.slot];
      if (!region) {
        throw new Error(`Pan surface decal ${decalIndex} names unknown slot ${decal.slot}.`);
      }
      const u0 = region.x / sheet.width;
      const u1 = (region.x + region.w) / sheet.width;
      // Image space runs top-down, UV space bottom-up.
      const v0 = 1 - (region.y + region.h) / sheet.height;
      const v1 = 1 - region.y / sheet.height;

      const radians = THREE.MathUtils.degToRad(decal.rotationDeg);
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      tint.set(decal.tint).convertSRGBToLinear();

      CORNERS.forEach((corner, cornerIndex) => {
        const localU = corner.u * decal.width;
        const localV = corner.v * decal.length;
        const acrossMetres = localU * cos - localV * sin;
        const alongMetres = localU * sin + localV * cos;

        const sample: CourseSample = course.sample(
          wrapDistance(decal.distance + alongMetres, course.length) / course.length,
          scratch,
        );
        const lateral = decal.lateral + acrossMetres;
        const height = surfaceHeightAtLateral(sample, lateral) + DECAL_LIFT_METRES;

        point.copy(sample.position)
          .addScaledVector(sample.right, lateral)
          .addScaledVector(sample.up, height);

        const vertex = decalIndex * VERTICES_PER_DECAL + cornerIndex;
        positions[vertex * 3] = point.x;
        positions[vertex * 3 + 1] = point.y;
        positions[vertex * 3 + 2] = point.z;
        uvs[vertex * 2] = corner.su === 0 ? u0 : u1;
        uvs[vertex * 2 + 1] = corner.sv === 0 ? v0 : v1;
        colors[vertex * 4] = tint.r;
        colors[vertex * 4 + 1] = tint.g;
        colors[vertex * 4 + 2] = tint.b;
        colors[vertex * 4 + 3] = decal.alpha;
      });

      CORNER_INDICES.forEach((corner, slot) => {
        indices[decalIndex * TRIANGLES_PER_DECAL * 3 + slot] =
          decalIndex * VERTICES_PER_DECAL + corner;
      });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    const decalMaterial = new THREE.MeshBasicMaterial({
      name: DECAL_MATERIAL_NAME,
      map: decalTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexColors: true,
      side: THREE.FrontSide,
      fog: true,
      alphaTest: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const decalMesh = new THREE.Mesh(geometry, decalMaterial);
    decalMesh.name = DECAL_MESH_NAME;
    // Unlike the opening straight this layer wraps the whole 3,050 m lap, so a
    // single bounding sphere covers the entire site and the frustum test can
    // never retire it. Culling it costs a sphere test that always says yes.
    decalMesh.frustumCulled = false;
    decalMesh.castShadow = false;
    decalMesh.receiveShadow = false;
    decalMesh.renderOrder = 1;

    const panFloor = buildPanFloor(course, groundTexture, probeMode);
    const [meanR, meanG, meanB] = panFloor.colours.mean;
    // `?floorprobe=1` — see `panFloorProbeActive`. The decals and the set
    // dressing are what make the acceptance metric unable to see the floor, so
    // the probe view drops them; `scene-assets.ts` drops the mid-ground and the
    // living world the same way.
    if (probeMode !== 0) decalMesh.visible = false;

    const root = new THREE.Group();
    root.name = "bitterpan_surface_layer";
    root.add(panFloor.mesh, decalMesh);

    return new BitterpanSurface(root, {
      drawCalls: 2,
      decals: decals.length,
      crustDecals: SURFACE_CRUST.decals.length,
      dressingItems: SET_DRESSING.items.length,
      triangles: decals.length * TRIANGLES_PER_DECAL,
      materials: 2,
      textures: 2,
      groundMetresPerTile: SURFACE_CRUST.ground.metresPerTile,
      groundAnisotropy: groundTexture.anisotropy,
      shaderModel: "unlit+lambert",
      panFloor: {
        segments: PAN_FLOOR_SEGMENTS,
        macroSeed: PAN_FLOOR_MACRO_SEED,
        secondaryScale: PAN_FLOOR_SECONDARY_SCALE,
        vertices: panFloor.colours.vertices,
        meanLuma: 0.2126 * meanR + 0.7152 * meanG + 0.0722 * meanB,
        peakBrightness: panFloor.colours.extremes.brightness,
        peakHue: panFloor.colours.extremes.hue,
        windDegrees: PAN_FLOOR_WIND_DEGREES,
        streakBands: PAN_FLOOR_STREAK_BANDS.length + 1,
        brineWeightMean: panFloor.colours.brineWeightMean,
        probe: probeMode !== 0,
      },
    });
  }

  static async load(
    course: RaceCourse,
    groundTextureUrl: string,
    decalTextureUrl: string,
    probeMode: 0 | 1 | 2 = 0,
  ): Promise<BitterpanSurface> {
    const loader = new THREE.TextureLoader();
    const [groundTexture, decalTexture] = await Promise.all([
      loader.loadAsync(groundTextureUrl),
      loader.loadAsync(decalTextureUrl),
    ]);
    groundTexture.name = "bitterpan_crust_tile_256";
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    const tiles = GROUND_SIZE_METRES / SURFACE_CRUST.ground.metresPerTile;
    groundTexture.repeat.set(tiles, tiles);
    groundTexture.needsUpdate = true;

    decalTexture.name = "bitterpan_crust_1024";
    decalTexture.colorSpace = THREE.SRGBColorSpace;
    decalTexture.magFilter = THREE.NearestFilter;
    decalTexture.minFilter = THREE.NearestFilter;
    decalTexture.wrapS = THREE.ClampToEdgeWrapping;
    decalTexture.wrapT = THREE.ClampToEdgeWrapping;
    decalTexture.generateMipmaps = false;
    decalTexture.needsUpdate = true;

    try {
      return BitterpanSurface.build(course, groundTexture, decalTexture, probeMode);
    } catch (error) {
      groundTexture.dispose();
      decalTexture.dispose();
      throw error;
    }
  }
}

/** A GLSL float literal, so a JS constant cannot land in a shader as `16`. */
const glsl = (value: number): string => value.toFixed(6);

/**
 * The varyings the feature stage needs and Lambert does not provide.
 *
 * `vFogDepth` carries the same number as `vPanDepth`, but only while `USE_FOG`
 * is defined — one switch away from a shader that will not link. `vPanWorld` is
 * the ground position in metres, which is what lets a shoreline be 2 m wide
 * instead of 2 somethings.
 */
const PAN_VARYINGS = [
  "varying float vPanDepth;",
  "varying vec2 vPanWorld;",
  "varying float vPanBrine;",
  "",
].join("\n");

/**
 * Value noise, and the ridge transform the wind streaks are cut from.
 *
 * The hash is Dave Hoskins' `hash12` — no `sin`, no integer ops, so it behaves
 * the same on every driver this ships to. It is NOT the same hash as the
 * generator's `hash2` in `pan-floor-colour.js`, and it does not need to be: the
 * two fields live at different scales and are never compared, only summed.
 */
const PAN_NOISE_GLSL = /* glsl */ `
float panHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float panNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( panHash( i ), panHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( panHash( i + vec2( 0.0, 1.0 ) ), panHash( i + vec2( 1.0, 1.0 ) ), u.x ),
		u.y );
}
/** A ridge crest: 1 where the field passes through its own middle. */
float panRidge( vec2 p ) {
	return 1.0 - abs( 2.0 * panNoise( p ) - 1.0 );
}
/**
 * A terrace step whose edge is as wide as one pixel of this field — measured
 * ANISOTROPICALLY.
 *
 * This is the whole aliasing strategy, and the anisotropy is not a detail. A
 * chase camera 1.5 m above a plain sees the ground at a grazing angle: one
 * pixel row can span 30 m of DEPTH while the same pixel spans 0.4 m ACROSS the
 * view. \`fwidth\` (|ddx| + |ddy|) takes the worst of the two, so it reports a
 * 30 m footprint and dissolves a feature that is still perfectly resolvable
 * horizontally — measured, that is what made the first cut of this pass
 * invisible: cranking every feature step by 3.7x moved the pan band's stdev
 * from 23.55 to 26.47, because the edges were being averaged away before they
 * reached the frame.
 *
 * Taking the SMALLER of the two derivatives is what anisotropic filtering does
 * for a texture, for the same reason. A streak running toward the horizon keeps
 * its edge; one running across the view still softens, because there its
 * smaller derivative is the large one.
 */
float panBand( float threshold, float value ) {
	float w = max( min( abs( dFdx( value ) ), abs( dFdy( value ) ) ) * 0.5, 1e-4 );
	return smoothstep( threshold - w, threshold + w, value );
}

/** The ground footprint of one pixel, in metres, on the same anisotropic
 *  reading. Clamped so a near-horizon pixel cannot ask for a 400 m shoreline. */
float panFootprint( vec2 world ) {
	return clamp( min( length( dFdx( world ) ), length( dFdy( world ) ) ), 0.25, 24.0 );
}
`;

/**
 * P20.6 round 2 — the pan's surface features, in the fragment stage.
 *
 * Round 1 put a smooth field in vertex colours and it was invisible. A plain
 * reads as a plain because of EDGES, and an edge cannot exist between two
 * vertices 47 m apart. So:
 *
 * 1. **Wind streaks.** Ridged noise stretched 25:1 along the authored 292
 *    degree wind, terraced into two bright bands and one sparser dark one.
 *    Because they are anisotropic and the ground is flat, the streaks converge
 *    toward the horizon under perspective, which is the strongest depth cue a
 *    plain has.
 * 2. **Brine flats.** A thresholded region field, cool and darker, whose
 *    shoreline is measured in METRES: the signed distance to the threshold is
 *    recovered by dividing the field by its own world-space gradient, so the
 *    2 m shoreline and the 3 m dried-salt rim are 2 m and 3 m at any distance
 *    rather than a fixed fraction of a noise cell. The gradient costs two
 *    extra noise taps and is the reason a pool has a shore instead of a blur.
 *    How common pools are is `vPanBrine`, one float per vertex from the
 *    generator — the wet sectors and the low side of the ribbon.
 * 3. The tile break and the crust-detail fade, unchanged from round 1.
 *
 * Everything ramps in between 16 m and 52 m so the near-field crack pattern is
 * untouched, and out again near `camera.far`.
 *
 * Composed through `composeShaderInjection` rather than assigned: in
 * `?render=ps2` this material already carries the snap/grade/dither injection,
 * and `material.onBeforeCompile = fn` would delete it while leaving its program
 * cache key in place.
 */
function injectPanFloorMacro(shader: THREE.WebGLProgramParametersWithUniforms): void {
  const [meanR, meanG, meanB] = PAN_FLOOR_TILE_MEAN_LINEAR;
  const [windX, windZ] = PAN_FLOOR_WIND_VECTOR;
  const [tintR, tintG, tintB] = PAN_FLOOR_BRINE_TINT;
  // In at 16-52 m so the near field is untouched, out again at 500-1,400 m for
  // the smooth vertex field and only at 1,150-1,800 m for the features, which
  // antialias themselves.
  const nearRamp = `smoothstep( ${glsl(PAN_FLOOR_MACRO_RAMP_NEAR)}, `
    + `${glsl(PAN_FLOOR_MACRO_RAMP_FAR)}, vPanDepth )`;
  const vertexRamp = `( ${nearRamp} * ( 1.0 - smoothstep( `
    + `${glsl(PAN_FLOOR_MACRO_FADE_NEAR)}, ${glsl(PAN_FLOOR_MACRO_FADE_FAR)}, vPanDepth ) ) )`;
  const featureRamp = `( ${nearRamp} * ( 1.0 - smoothstep( `
    + `${glsl(PAN_FLOOR_FEATURE_FADE_NEAR)}, ${glsl(PAN_FLOOR_FEATURE_FADE_FAR)}, `
    + "vPanDepth ) ) )";

  shader.vertexShader = `attribute float panBrine;\n${PAN_VARYINGS}`
    + shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n"
        + "\tvPanDepth = - mvPosition.z;\n"
        + "\tvPanWorld = ( modelMatrix * vec4( position, 1.0 ) ).xz;\n"
        + "\tvPanBrine = panBrine;",
    );

  shader.fragmentShader = PAN_VARYINGS + PAN_NOISE_GLSL + shader.fragmentShader
    .replace(
      "#include <map_fragment>",
      /* glsl */ `
	vec3 panTileMean = vec3( ${glsl(meanR)}, ${glsl(meanG)}, ${glsl(meanB)} );
	vec3 panCrust = texture2D( map, vMapUv ).rgb;
	float panDetail = 1.0 - smoothstep( ${glsl(PAN_FLOOR_DETAIL_FADE_NEAR)}, ${glsl(PAN_FLOOR_DETAIL_FADE_FAR)}, vPanDepth );
	panCrust = mix( panTileMean, panCrust, panDetail );

	// --- the 12 m tile stops repeating -------------------------------------
	vec3 panWide = texture2D( map, vMapUv * ${glsl(PAN_FLOOR_SECONDARY_SCALE)} + vec2( 0.317, 0.611 ) ).rgb;
	vec2 panTurnedUv = vec2( vMapUv.y, - vMapUv.x ) * ${glsl(PAN_FLOOR_ROTATED_SCALE)} + vec2( 0.083, 0.457 );
	vec3 panCross = texture2D( map, panTurnedUv ).rgb;
	vec3 panMacro = 0.5 * ( panWide + panCross ) / panTileMean;
	panCrust *= mix( vec3( 1.0 ), panMacro, ${glsl(PAN_FLOOR_SECONDARY_BLEND)} * ${vertexRamp} * panDetail );

	// --- wind streaks -------------------------------------------------------
	vec2 panAlong = vec2( ${glsl(windX)}, ${glsl(windZ)} );
	vec2 panAcross = vec2( - panAlong.y, panAlong.x );
	vec2 panStreakUv = vec2(
		dot( vPanWorld, panAlong ) / ${glsl(PAN_FLOOR_STREAK_LENGTH_METRES)},
		dot( vPanWorld, panAcross ) / ${glsl(PAN_FLOOR_STREAK_WIDTH_METRES)} );
	// Two octaves along the same wind. The fine one is the authored 6-14 m
	// streak and reads from 20 m to about 120 m; past that it is sub-pixel from
	// this camera whatever the filtering does. The coarse one is the same
	// pattern at ${glsl(PAN_FLOOR_STREAK_OCTAVE_SCALE)}x, so its bands are tens
	// of metres across and carry the read all the way to the horizon. Same
	// bearing, so they never read as two patterns.
	float panStreak = panRidge( panStreakUv );
	float panStreakWide = panRidge( panStreakUv / ${glsl(PAN_FLOOR_STREAK_OCTAVE_SCALE)} + 11.37 );
	float panBloom = ${glsl(PAN_FLOOR_STREAK_BANDS[0].step)} * panBand( ${glsl(PAN_FLOOR_STREAK_BANDS[0].threshold)}, panStreak )
		+ ${glsl(PAN_FLOOR_STREAK_BANDS[1].step)} * panBand( ${glsl(PAN_FLOOR_STREAK_BANDS[1].threshold)}, panStreak )
		+ ${glsl(PAN_FLOOR_STREAK_BANDS[0].step)} * panBand( ${glsl(PAN_FLOOR_STREAK_BANDS[0].threshold)}, panStreakWide )
		+ ${glsl(PAN_FLOOR_STREAK_BANDS[1].step)} * panBand( ${glsl(PAN_FLOOR_STREAK_BANDS[1].threshold)}, panStreakWide );
	float panScour = panRidge( panStreakUv * vec2( ${glsl(PAN_FLOOR_SCOUR_STRETCH[0])}, ${glsl(PAN_FLOOR_SCOUR_STRETCH[1])} ) + 37.19 );
	float panScourWide = panRidge( panStreakUv * vec2( ${glsl(PAN_FLOOR_SCOUR_STRETCH[0])}, ${glsl(PAN_FLOOR_SCOUR_STRETCH[1])} ) / ${glsl(PAN_FLOOR_STREAK_OCTAVE_SCALE)} + 5.51 );
	float panScourBand = ${glsl(PAN_FLOOR_SCOUR_STEP)} * panBand( ${glsl(PAN_FLOOR_SCOUR_THRESHOLD)}, panScour )
		+ ${glsl(PAN_FLOOR_SCOUR_STEP)} * panBand( ${glsl(PAN_FLOOR_SCOUR_THRESHOLD)}, panScourWide );
	// Clamped to ONE octave's worth, so the accepted contrast ratios are the
	// ratios that ship: a bloom core is 1.22:1 against the crust and a scour
	// streak 0.85:1, whether one octave fires there or both.
	panBloom = min( panBloom, ${glsl(PAN_FLOOR_STREAK_BANDS[0].step + PAN_FLOOR_STREAK_BANDS[1].step)} );
	panScourBand = min( panScourBand, ${glsl(PAN_FLOOR_SCOUR_STEP)} );

	// --- brine flats, with a shoreline measured in metres --------------------
	vec2 panPoolUv = vPanWorld / ${glsl(PAN_FLOOR_BRINE_SCALE_METRES)};
	float panPoolField = panNoise( panPoolUv );
	float panPoolStep = 2.0 / ${glsl(PAN_FLOOR_BRINE_SCALE_METRES)};
	vec2 panPoolGradient = vec2(
		panNoise( panPoolUv + vec2( panPoolStep, 0.0 ) ) - panPoolField,
		panNoise( panPoolUv + vec2( 0.0, panPoolStep ) ) - panPoolField ) * 0.5;
	float panPoolSlope = max( length( panPoolGradient ), 1e-5 );
	float panPoolThreshold = mix( ${glsl(PAN_FLOOR_BRINE_THRESHOLD_DRY)}, ${glsl(PAN_FLOOR_BRINE_THRESHOLD_WET)}, clamp( vPanBrine, 0.0, 1.0 ) );
	// Signed distance to the shoreline, in metres on the ground.
	float panShoreMetres = ( panPoolField - panPoolThreshold ) / panPoolSlope;
	float panEdge = max( ${glsl(PAN_FLOOR_SHORE_METRES)}, panFootprint( vPanWorld ) );
	float panPool = smoothstep( - panEdge, panEdge, panShoreMetres );
	float panRimBand = panPool * ( 1.0 - smoothstep( ${glsl(PAN_FLOOR_RIM_METRES)} - panEdge, ${glsl(PAN_FLOOR_RIM_METRES)} + panEdge, panShoreMetres ) );

	// --- one product, trimmed so the features do not darken the pan ---------
	vec3 panFeature = vec3( ${glsl(PAN_FLOOR_FEATURE_TRIM)} );
	panFeature *= 1.0 + panBloom - panScourBand;
	// A flat is damp crust at the rim and standing brine in the middle, so the
	// depth ramps with distance inside the shoreline rather than being one step.
	float panPoolDeep = smoothstep( ${glsl(PAN_FLOOR_BRINE_DEEP_NEAR_METRES)}, ${glsl(PAN_FLOOR_BRINE_DEEP_FAR_METRES)}, panShoreMetres );
	float panPoolLuma = mix( ${glsl(PAN_FLOOR_BRINE_LUMA)}, ${glsl(PAN_FLOOR_BRINE_DEEP_LUMA)}, panPoolDeep );
	panFeature *= mix( vec3( 1.0 ), vec3( ${glsl(tintR)}, ${glsl(tintG)}, ${glsl(tintB)} ) * panPoolLuma, panPool );
	panFeature *= 1.0 + ${glsl(PAN_FLOOR_RIM_LIFT)} * panRimBand;
	panCrust *= mix( vec3( 1.0 ), panFeature, ${featureRamp} );

	diffuseColor.rgb *= panCrust;
`,
    )
    .replace(
      "#include <color_fragment>",
      /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, ${vertexRamp} );
#endif
`,
    );
}

/**
 * The ground the pan never had — and, since P20.6, a ground with a distance
 * cue on it.
 *
 * Still ONE mesh, ONE material, ONE draw call and ONE texture. What changed is
 * that the quad is subdivided and carries a per-vertex colour field (see
 * `pan-floor-colour.js` for the field and for why 128 segments rather than the
 * 96 the phase brief suggested), and that the material's fragment stage samples
 * the crust tile twice more at macro scales. 32,768 triangles is the whole cost;
 * they are static, in one buffer, and never re-uploaded.
 */
function buildPanFloor(course: RaceCourse, texture: THREE.Texture, probeMode: 0 | 1 | 2): {
  mesh: THREE.Mesh;
  colours: ReturnType<typeof generatePanFloorColours>;
} {
  const geometry = new THREE.PlaneGeometry(
    GROUND_SIZE_METRES,
    GROUND_SIZE_METRES,
    PAN_FLOOR_SEGMENTS,
    PAN_FLOOR_SEGMENTS,
  );
  // `?floorprobe=2` — the controlled baseline. Everything this phase adds is
  // skipped and the floor renders as the flat Lambert quad it was before it,
  // in the SAME binary as the treated build. See `panFloorProbeMode`.
  const bypass = probeMode === 2;
  const colours = generatePanFloorColours({
    segments: PAN_FLOOR_SEGMENTS,
    sizeMetres: GROUND_SIZE_METRES,
    centreXMetres: GROUND_CENTRE_X_METRES,
    centreZMetres: GROUND_CENTRE_Z_METRES,
    seed: PAN_FLOOR_MACRO_SEED,
    lapLengthMetres: course.length,
    ribbon: buildPanRibbon(course),
  });
  if (!bypass) {
    geometry.setAttribute("color", new THREE.BufferAttribute(colours.colors, 3));
    // One float per vertex: how common brine flats are here. The SHAPE of a
    // pool is procedural and per-pixel — a shoreline authored on a 47 m grid is
    // not a shoreline — so all the geometry carries is where they belong.
    geometry.setAttribute("panBrine", new THREE.BufferAttribute(colours.brineWeights, 1));
  }

  const material = new THREE.MeshLambertMaterial({
    name: GROUND_MATERIAL_NAME,
    map: texture,
    fog: true,
    vertexColors: !bypass,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = GROUND_MESH_NAME;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(GROUND_CENTRE_X_METRES, GROUND_Y_METRES, GROUND_CENTRE_Z_METRES);
  mesh.castShadow = false;
  // P20.1 owns this line: the pan floor is where the craft's contact shadow
  // lands, and subdividing the plane does not change that.
  mesh.receiveShadow = true;
  // Always under the camera, never worth a bounding-sphere test.
  mesh.frustumCulled = false;

  // The floor is world geometry: in `?render=ps2` it snaps, dithers and takes
  // the grade with everything else, and it takes that mode's pixel filter class
  // too. Outside ps2 the treatment's default class would leave a 900 m ground
  // plane point-sampled with a nearest mip chain, so the spec's own filtering
  // is applied over the top — the stated exception, made in one place.
  applyPs2MaterialTreatment(mesh, { worldGeometry: true });
  if (activeRenderMode() !== "ps2") {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }
  // AFTER the PS2 treatment, so the composition wraps that injection rather
  // than being wrapped by it — and so a ps2 run keeps both.
  if (!bypass) composeShaderInjection(material, "bpPanFloorMacro", injectPanFloorMacro);
  return { mesh, colours };
}

/**
 * The centreline as a flat polyline, for the pan floor's sector biases.
 *
 * Sampled at the same 5 m as `CENTRELINE_STATIONS.json` so the validator's
 * re-run of the generator — which reads that file, because it cannot build a
 * `RaceCourse` under Node — walks a ribbon of the same shape and spacing.
 */
function buildPanRibbon(course: RaceCourse): Array<{
  x: number;
  z: number;
  rightX: number;
  rightZ: number;
  distance: number;
  curvature: number;
}> {
  const scratch = course.createSampleScratch();
  const count = Math.max(2, Math.round(course.length / 5));
  const nodes = [];
  for (let index = 0; index < count; index += 1) {
    const distance = (index * course.length) / count;
    const sample = course.sample(distance / course.length, scratch);
    nodes.push({
      x: sample.position.x,
      z: sample.position.z,
      rightX: sample.right.x,
      rightZ: sample.right.z,
      distance,
      curvature: sample.curvature,
    });
  }
  return nodes;
}

/** Keeps a decal corner on the lap when it straddles the start line. */
function wrapDistance(distance: number, length: number): number {
  const wrapped = distance % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}
