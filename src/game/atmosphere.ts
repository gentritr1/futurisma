import * as THREE from "three";
import type { RaceCourse } from "./course";
import {
  ATMOSPHERE_UPDATE_INTERVAL_SECONDS,
  createHangarFlicker,
  createTimeOfDayTint,
  evaluateTimeOfDay,
  // Both maps author a 90 m sector crossfade — Greenwater in course.ts, which
  // this constant mirrors, and Bitterpan in `lighting.crossfadeMetres` in its
  // own JSON. One window for both is what keeps the sky and the light changing
  // sector on the same metre; validate-lighting.mjs pins the JSON to it.
  LIGHTING_CROSSFADE_METRES,
  resolveHangarLampLevel,
  resolveLapProgress,
  resolveTimeOfDayDrift,
} from "./lighting-motion.js";
import {
  activeRenderMode,
  ps2ColorGradeChunk,
  PS2_TONE_MAPPING_ANCHOR,
} from "./render-mode.js";
import {
  bandStrengthFor,
  cloudProfileFor,
  resolveSkyBlend,
  skyZonesFor,
  SKY_FOG_FADE_DEGREES,
  SKY_HAZE_TOP_DEGREES,
} from "./sky-profile.js";
import {
  SHADOW_LIGHT_DISTANCE_METRES,
  SHADOW_LOOKAHEAD_METRES,
  shadowMapSize,
  shadowTexelMetres,
  shadowsEnabled,
  snapShadowCentre,
} from "./shadow-settings.js";
import { armKeyLightShadow, promoteUnlitShadowReceivers } from "./shadows";
import { trackEventFogMultiplier } from "./track-events";
import { publishTimeOfDayDrift } from "./time-of-day";

/** The exposure the AgX path has run at since the renderer was set up. */
// P11: 1.05 -> 1.10. A half-stop of headroom under AgX; the markers that now
// opt out of tone mapping clip to glow rather than being rolled grey.
// P19: 1.10 -> 1.04. The extra headroom was reading as milk — both maps graded
// pale against their own assets. A touch under P11 keeps the glow markers
// legible while the decks and pans keep their pigment.
const AGX_TONE_MAPPING_EXPOSURE = 1.04;

/**
 * P4b. `agx` keeps the 2023 filmic curve the project shipped with; `ps2`
 * replaces it with the hand-authored grade that `render-mode.js` owns, which is
 * injected per material instead of running on the renderer. Presentation only —
 * neither branch is visible to physics or lap timing.
 */
export function configureToneMapping(renderer: THREE.WebGLRenderer): void {
  const ps2 = activeRenderMode() === "ps2";
  renderer.toneMapping = ps2 ? THREE.NoToneMapping : THREE.AgXToneMapping;
  // Ignored under `NoToneMapping`; the grade applies `PS2_EXPOSURE` itself.
  // P11 lifted the AgX exposure to 1.10 and left `PS2_EXPOSURE` at 1.05, so the
  // A/B is no longer gain-matched — `ps2` is now the darker of the two by a
  // twentieth of a stop. Deliberate: the PS2 grade already has its own
  // black-crush and highlight knee, and raising its exposure would move the
  // knees this project's render-quality validator pins.
  renderer.toneMappingExposure = ps2 ? 1 : AGX_TONE_MAPPING_EXPOSURE;
}

const WHITE = new THREE.Color(0xffffff);
// P11: 1.85 -> 1.35. The rim was doing the work the key should: pulling it back
// and pushing key intensity up per sector is what gives the deck form again.
const RIM_PRESENCE_BOOST = 1.35;
const HEMISPHERE_TRIM = 0.88;
// Equal to SHADOW_LIGHT_DISTANCE_METRES by construction: the shadow camera's
// near/far were derived from where the light sits relative to the box centre,
// and the two numbers must move together. A DirectionalLight reads only the
// direction, so neither number changes the lighting.
const KEY_LIGHT_DISTANCE = SHADOW_LIGHT_DISTANCE_METRES;
/**
 * Where the sun sits, as a fraction of `camera.far`, and how wide it is.
 *
 * P20.5 moved the sun out of its own additive `MeshBasicMaterial` circle and
 * into the dome's fragment shader. The mesh could not be occluded correctly:
 * `transparent: true` put it in the transparent queue at `renderOrder -999`,
 * i.e. before every other transparent surface, and a transparent surface writes
 * no depth — so any geometry drawn with `depthWrite: false` (Greenwater's water
 * plane, for one) could not stop it. Measured on the merged base with the disc
 * forced to screen centre inside HANGAR_SIX: 472 of its 15,652 pixels drew over
 * geometry that should have hidden it (see scripts/visual/sun-disc-occlusion.mjs).
 * Painted inside the dome the sun is drawn first, before anything else in the
 * frame, so every surface in the scene covers it — opaque or not — and the
 * scene loses one object rather than gaining a sorting rule.
 *
 * The angular radius is preserved exactly: `atan(0.055 / 0.72)` = 4.37 degrees,
 * the half-angle the old `CircleGeometry(far * 0.055)` at `far * 0.72` subtended.
 */
const SUN_DISC_DISTANCE_RATIO = 0.72;
const SUN_ANGULAR_RADIUS_RADIANS = Math.atan(0.055 / SUN_DISC_DISTANCE_RATIO);
/** Inner/outer cosines of the soft edge, and the linear-space add at centre. */
const SUN_COS_INNER = Math.cos(SUN_ANGULAR_RADIUS_RADIANS);
const SUN_COS_OUTER = Math.cos(SUN_ANGULAR_RADIUS_RADIANS * 1.55);
const SUN_INTENSITY = 0.55;

/**
 * Sodium vapour, matching the `sodiumMaterial` lamp strips in
 * `createHangarShell`. Deliberately *not* touched by the time-of-day ramp: an
 * artificial lamp does not follow the sun down.
 */
const HANGAR_LAMP_COLOR = 0xffb154;
/**
 * P11: three lamps down the 618-816 m shell rather than two at the quarter
 * points, hung just under the 15.5 m lamp strips. The lamps hang 14.2 m up, so
 * a `distance` of R only reaches sqrt(R² - 14.2²) along the deck: the old pair
 * left the shell's middle third at 94% of range, all but unlit. Three fixtures
 * at a 62 m range put the darkest deck point at 65%.
 *
 * The trade, stated because the old comment claimed the opposite: the falloff
 * no longer dies before the shell mouth. It now reaches ~38 m back onto
 * `LINK_APRON` and ~34 m forward onto `HANGAR_EXIT`, which three lamps covering
 * the middle cannot avoid. The lamps are only visible while the player is
 * inside 618-816 m, so the spill appears and vanishes with them;
 * validate-lighting.mjs pins it so it cannot grow unnoticed.
 *
 * Cost: the in-shell lit-light count goes 6 -> 7, i.e. one extra shader
 * recompile on first entry.
 */
const HANGAR_LAMP_DISTANCES_METRES = [640, 715, 790] as const;
const HANGAR_LAMP_HEIGHT_METRES = 14.2;
const HANGAR_LAMP_RANGE_METRES = 62;
const HANGAR_LAMP_DECAY = 1.35;
/** Peak candela, i.e. the value the flicker in [0.55, 1.0] scales. */
const HANGAR_LAMP_PEAK_INTENSITY = 150;

/** The one flat object `atmosphere.ts` contributes to the diagnostics report. */
export interface AtmosphereDiagnostics {
  /** Current crossfaded key direction, normalized world space. */
  keyDirection: readonly [number, number, number];
  /**
   * P20.1 — proof a soak can read that the shadow pass is actually running.
   * `casters` is the live count of `castShadow` meshes in the scene graph, not
   * an authored expectation, so a family that quietly lost its flag shows up
   * here rather than only in a screenshot.
   */
  shadows: {
    enabled: boolean;
    mapSize: number;
    casters: number;
    /**
     * Authored unlit overlays swapped for a shadow-receiving stand-in. Exactly
     * 1 on Bitterpan (its drivable deck), 0 on Greenwater, 0 with shadows off.
     */
    promotedReceivers: number;
  };
  hangarFlickerActive: boolean;
  /**
   * Normalized lamp level: exactly `0` when the lamps are off, otherwise the
   * flicker value in [0.55, 1.0]. Reported normalized rather than in candela so
   * a soak can check it against the authored band directly; the three.js
   * intensity is this times `HANGAR_LAMP_PEAK_INTENSITY`.
   */
  hangarLampIntensity: number;
  timeOfDayDrift: number;
  /**
   * P20.5 — the sky as numbers, so a soak can prove the dome stopped being the
   * fog without anyone opening a screenshot. `horizonHex` is the authored haze
   * currently in the uniform (NOT the fog, which now only owns the bottom 1.5
   * degrees) and `zenithHex` the authored top; a build that regressed to the
   * old derivation would report the fog's own khaki in both.
   */
  sky: {
    horizonHex: string;
    zenithHex: string;
    cloudCoverage: number;
    /** False only while the sun is framed AND nothing stands in front of it. */
    sunOccluded: boolean;
  };
}

/**
 * Scene lighting, sky backdrop, sun disc, craft presence light and the fog /
 * palette blend that keeps them glued to the sector the player is driving.
 *
 * P4a added three motions on top of that static blend, all allocation-free and
 * all costing zero draw calls: the key light's *direction* now crossfades per
 * sector, two conditional hangar lamps flicker on a seeded 30 Hz schedule
 * inside `HANGAR_SIX`, and an authored 5-stop ramp drifts the whole atmosphere
 * from overcast day toward dusk across the race.
 */
export class RaceAtmosphere {
  private readonly hemisphereLight = new THREE.HemisphereLight();
  private readonly keyLight = new THREE.DirectionalLight();
  private readonly rimLight = new THREE.DirectionalLight();
  /**
   * P20.5. `horizonColor` is still the sector fog, but it now only owns the
   * bottom {@link SKY_FOG_FADE_DEGREES}; `hazeColor` and `topColor` are the
   * authored sky above it. `skyRamp`/`cloudShape`/`cloudBand`/`sunShape` are
   * packed into vec4s rather than kept as eight separate uniforms so the
   * per-frame write is four `set` calls instead of a dozen.
   */
  private readonly skyUniforms = {
    topColor: { value: new THREE.Color(0x1a2226) },
    horizonColor: { value: new THREE.Color(0xa9bbb0) },
    hazeColor: { value: new THREE.Color(0xa9bbb0) },
    bandColor: { value: new THREE.Color(0xc8ff2e) },
    sunColor: { value: new THREE.Color(0xffffff) },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    /** x fog-fade deg, y haze-top deg, z zenith-resolved deg, w band strength */
    skyRamp: { value: new THREE.Vector4() },
    /** x coverage, y edge softness, z contrast, w azimuth period (integer) */
    cloudShape: { value: new THREE.Vector4() },
    /** x low deg, y high deg, z drift phase, w shadow-side cool mix */
    cloudBand: { value: new THREE.Vector4() },
    /** Cell aspect ratio, wide to tall. 6 = cirrus streaks; 1 = round blobs. */
    cloudStretch: { value: 1 },
    /** x cos(inner), y cos(outer), z intensity */
    sunShape: { value: new THREE.Vector3(SUN_COS_INNER, SUN_COS_OUTER, SUN_INTENSITY) },
  };
  private readonly skyDome: THREE.Mesh;
  private readonly skyBandTarget = new THREE.Color();
  /**
   * Authored per-sector sky, built once from the map's own table. Assigned in
   * the constructor rather than as a field initializer: `course` is a parameter
   * property, and under ES class-field semantics initializers run before the
   * constructor body has assigned it.
   */
  private readonly skyZones: {
    distance: number;
    horizon: THREE.Color;
    zenith: THREE.Color;
    blendDegrees: number;
  }[];
  private readonly cloudProfile: ReturnType<typeof cloudProfileFor>;
  private readonly skyBlend = { index: 0, next: 0, amount: 0 };
  private readonly skyHazeTarget = new THREE.Color();
  private readonly skyZenithTarget = new THREE.Color();
  private skyBlendDegrees = SKY_HAZE_TOP_DEGREES + 20;
  private cloudPhase = 0;
  private readonly sunWorldPosition = new THREE.Vector3();
  private readonly sunRaycaster = new THREE.Raycaster();
  private readonly sunNdc = new THREE.Vector3();
  private readonly presenceLight = new THREE.PointLight(0xffffff, 0, 26, 1.8);

  // --- P4a scratch. Every one of these exists so the per-frame path allocates
  // nothing; none of them is read outside the frame that writes it.
  private readonly keyDirection = new THREE.Vector3(0.510841, 0.830116, -0.223493);
  private readonly tintScratch = createTimeOfDayTint();
  private readonly tintedSky = new THREE.Color();
  private readonly tintedGround = new THREE.Color();
  private readonly tintedKey = new THREE.Color();
  private readonly tintedFog = new THREE.Color();

  // --- P20.1 shadow scratch. Same rule as the P4a block above: the shadow
  // frustum is repositioned every frame and must allocate nothing to do it.
  private readonly shadowActive = shadowsEnabled();
  private shadowReceiversPromoted = 0;
  private readonly shadowForward = new THREE.Vector3();
  private readonly shadowCentre = new THREE.Vector3();
  private readonly shadowSnapped = new THREE.Vector3();
  private readonly shadowRight = new THREE.Vector3();
  private readonly shadowUp = new THREE.Vector3();

  private readonly hangarLamps: THREE.PointLight[] = [];
  private readonly hangarFlicker = createHangarFlicker();
  private hangarFlickerClock = 0;
  private hangarFlickerTick = 0;
  private hangarLampLevel = 0;
  private timeOfDayDrift = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly course: RaceCourse,
    progress: number,
    vehicleRoot: THREE.Object3D,
    private readonly reducedMotion = false,
  ) {
    this.skyZones = skyZonesFor(course.kind).map((zone) => ({
      distance: zone.distance,
      horizon: new THREE.Color(zone.horizon),
      zenith: new THREE.Color(zone.zenith),
      blendDegrees: zone.blendDegrees,
    }));
    this.cloudProfile = cloudProfileFor(course.kind);
    if (course.kind === "nightshift" || course.kind === "polarity" || course.kind === "tideline") {
      this.skyUniforms.sunShape.value.z = 0;
      this.skyUniforms.hazeColor.value.copy(this.skyZones[0].horizon);
      this.skyUniforms.topColor.value.copy(this.skyZones[0].zenith);
    }
    // Static half of the sky uniforms: the ramp geometry, the cloud shape and
    // the elevation gate never change after construction, so they are written
    // once here and the per-frame path only touches colours and the drift phase.
    this.skyUniforms.skyRamp.value.set(
      SKY_FOG_FADE_DEGREES,
      SKY_HAZE_TOP_DEGREES,
      this.skyBlendDegrees,
      bandStrengthFor(course.kind),
    );
    this.skyUniforms.cloudShape.value.set(
      this.cloudProfile.coverage,
      this.cloudProfile.softness,
      this.cloudProfile.strength,
      this.cloudProfile.azimuthPeriod,
    );
    // The seed is the drift phase's starting offset: one number, so the two maps
    // never show the same cloud arrangement, and a soak replays the same sky.
    this.cloudPhase = this.cloudProfile.seed;
    this.skyUniforms.cloudBand.value.set(
      this.cloudProfile.lowDegrees,
      this.cloudProfile.highDegrees,
      this.cloudPhase,
      this.cloudProfile.shadowCool,
    );
    this.skyUniforms.cloudStretch.value = this.cloudProfile.stretch;
    this.installLighting(progress);
    this.skyDome = this.createSkyBackdrop();
    this.scene.add(this.skyDome);
    this.presenceLight.position.set(0, 2.3, 0.9);
    vehicleRoot.add(this.presenceLight);
    this.installHangarLamps();
  }

  private installLighting(progress: number): void {
    const lighting = this.course.lightingAt(progress);
    this.hemisphereLight.color.copy(lighting.sky);
    this.hemisphereLight.groundColor.copy(lighting.ground);
    this.hemisphereLight.intensity = lighting.hemisphereIntensity * HEMISPHERE_TRIM;
    this.keyLight.color.copy(lighting.key);
    this.keyLight.intensity = lighting.keyIntensity;
    this.keyDirection.copy(lighting.keyDirection);
    this.keyLight.position
      .copy(this.keyDirection)
      .multiplyScalar(KEY_LIGHT_DISTANCE);
    this.rimLight.color.copy(lighting.rim);
    this.rimLight.intensity = lighting.rimIntensity * RIM_PRESENCE_BOOST;
    this.rimLight.position.set(-100, 25, -80);
    this.scene.add(this.hemisphereLight, this.keyLight, this.rimLight);
    // The key is the only shadow caster in the game. Its target has to be in
    // the scene graph for three to read a world matrix off it; without shadows
    // the target is never moved and the light behaves exactly as it did before
    // this phase, so adding it is unconditional and free.
    this.scene.add(this.keyLight.target);
    armKeyLightShadow(this.keyLight);
    this.shadowReceiversPromoted = promoteUnlitShadowReceivers(this.course.group);
  }

  /**
   * Walks the shadow box to a texel-snapped point ~45 m ahead of the chase
   * camera, once per frame.
   *
   * The direction is whatever the sector crossfade last set — this phase moves
   * the frustum, never the sun. Snapping happens in the same basis
   * `Object3D.lookAt` will rebuild inside `LightShadow.updateMatrices`, which is
   * the only reason it removes shimmer rather than adding a different one.
   */
  private updateShadowCamera(): void {
    if (!this.shadowActive) return;
    this.camera.getWorldDirection(this.shadowForward);
    this.shadowCentre
      .copy(this.camera.position)
      .addScaledVector(this.shadowForward, SHADOW_LOOKAHEAD_METRES);
    snapShadowCentre(
      this.shadowCentre,
      this.keyDirection,
      shadowTexelMetres(),
      this.shadowRight,
      this.shadowUp,
      this.shadowSnapped,
    );
    this.keyLight.target.position.copy(this.shadowSnapped);
    this.keyLight.target.updateMatrixWorld();
    this.keyLight.position
      .copy(this.shadowSnapped)
      .addScaledVector(this.keyDirection, KEY_LIGHT_DISTANCE);
  }

  /**
   * Live caster census. Only ever called from `diagnostics()`, i.e. at the ~1 Hz
   * the diagnostics sampler runs and only under `?diagnostics=1`.
   */
  private countShadowCasters(): number {
    let casters = 0;
    this.scene.traverse((object) => {
      if (object.castShadow && (object as THREE.Mesh).isMesh) casters += 1;
    });
    return casters;
  }

  /**
   * Three conditional sodium lamps inside `HANGAR_SIX`. They are added to the
   * scene once, hidden, and only ever become visible between 618 m and 816 m —
   * an invisible light is skipped by the renderer's object traversal, so the
   * lit-light count is 4 everywhere except inside the shell, where it is 7.
   *
   * Greenwater only: Bitterpan has no hangar and P8 owns its lighting.
   */
  private installHangarLamps(): void {
    if (this.course.kind !== "greenwater") return;
    for (const distance of HANGAR_LAMP_DISTANCES_METRES) {
      const sample = this.course.sampleAtDistance(distance);
      const lamp = new THREE.PointLight(
        HANGAR_LAMP_COLOR,
        0,
        HANGAR_LAMP_RANGE_METRES,
        HANGAR_LAMP_DECAY,
      );
      lamp.name = `hangar_six_lamp_${Math.round(distance)}`;
      lamp.position
        .copy(sample.position)
        .addScaledVector(sample.up, HANGAR_LAMP_HEIGHT_METRES);
      lamp.visible = false;
      this.hangarLamps.push(lamp);
      this.scene.add(lamp);
    }
  }

  /**
   * The whole sky, in one material and one draw call: fog hand-off, authored
   * haze, zenith ramp, sector accent band, sun and cloud band.
   *
   * P20.5 rewrote it. Before this phase the dome's horizon WAS the sector fog
   * colour all the way up, so the framed sky (a chase camera sees ~0-25 degrees)
   * was a wash of the ground's own hue — measured on Bitterpan at 20% saturation
   * in the same khaki as the pan. Now the fog only survives for
   * `skyRamp.x` = {@link SKY_FOG_FADE_DEGREES} degrees above the horizon line,
   * which is all distance needs to melt into it; above that the authored haze
   * takes over and ramps to the authored zenith by `skyRamp.z`.
   *
   * The cloud band and the sun are evaluated here rather than as geometry:
   * clouds because a dome that already shades every sky pixel can afford three
   * octaves of value noise inside a 4-30 degree elevation gate and cannot afford
   * another draw call; the sun because painting it first is the only way to have
   * every surface in the scene occlude it (see {@link SUN_DISC_DISTANCE_RATIO}).
   */
  private createSkyBackdrop(): THREE.Mesh {
    const radius = this.camera.far * 0.8;
    const geometry = new THREE.SphereGeometry(radius, 24, 12);
    const material = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      /**
       * Sky fragment, in the order the eye reads it: fog hand-off, haze, zenith
       * ramp, accent band, sun, cloud band. Every explanation lives out here
       * rather than inside the template literal, because GLSL comments are
       * string content that survives minification and ships to every player.
       *
       * - The haze-to-zenith ramp mixes in GAMMA space (`sqrt` in, square out),
       *   not linear light. Measured: with a linear mix and the ramp resolving
       *   at 22 degrees the framed upper sky came out at 140 luma against a
       *   60-105 target, because a pale haze at ~0.19 linear dominates a ~0.02
       *   zenith and half way up the ramp is still three quarters as bright as
       *   the horizon. Two hardware sqrts are the cheapest honest fix and put
       *   the midpoint where a colourist drawing the gradient would put it.
       * - `skyNoise` wraps its x lattice at `period` so the cloud band closes on
       *   itself around the horizon instead of seaming at due east; `period`
       *   doubles per octave for the same reason.
       * - The drift phase is in TURNS OF AZIMUTH, so the layer rotates. At the
       *   authored 0.0022-0.0035/s the band swings 0.8-1.3 degrees of sky per
       *   second: weather moving, never a texture scrolling.
       * - Three octaves of value noise land in a narrow hump around 0.5
       *   (measured sd ~0.12), so a raw threshold at `1 - coverage` would sit
       *   two standard deviations out and produce almost no cloud. The stretch
       *   before `puff` spreads that hump over [0,1] so `coverage` means what it
       *   says.
       * - `cloudStretch` is the cell ASPECT RATIO, wide to tall, and the
       *   vertical frequency is derived from it rather than authored: one cell
       *   spans `360 / azimuthPeriod` degrees of azimuth, so a 6:1 streak needs
       *   `stretch / 360 * azimuthPeriod` cells per degree of elevation. P20.5
       *   round 1 shipped the two frequencies independently at roughly 1:1 and
       *   the band read as soft round blobs — smoke, not cirrus. The ratio is
       *   the authored number now, which is the thing an art note is actually
       *   about.
       * - The cloud ADDS light and never removes it, and the add is capped at
       *   `hazeColor`. Round 1 had a symmetric term that also darkened: it
       *   punched black holes in Greenwater's zenith (~0.02 linear against a
       *   coverage of 0.52), and even after that was made proportional the dark
       *   half is what read as storm cloud. A cloud that can only lift the sky
       *   toward — never past — the haze it sits under is brighter than the
       *   zenith and never darker than the horizon, by construction rather than
       *   by tuning.
       * - The whole cloud block sits behind an elevation gate, so the noise is
       *   only evaluated on the ~20% of the screen the band can occupy.
       */
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 hazeColor;
        uniform vec3 bandColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        uniform vec3 sunShape;
        uniform vec4 skyRamp;
        uniform vec4 cloudShape;
        uniform vec4 cloudBand;
        uniform float cloudStretch;
        varying vec3 vDirection;

        float skyHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.56);
          return fract(p.x * p.y);
        }

        float skyNoise(vec2 p, float period) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          vec2 i0 = vec2(mod(i.x, period), i.y);
          vec2 i1 = vec2(mod(i.x + 1.0, period), i.y);
          float a = skyHash(i0);
          float b = skyHash(i1);
          float c = skyHash(i0 + vec2(0.0, 1.0));
          float d = skyHash(i1 + vec2(0.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          vec3 dir = normalize(vDirection);
          float elevation = degrees(asin(clamp(dir.y, -1.0, 1.0)));
          vec3 sky = mix(sqrt(hazeColor), sqrt(topColor),
            smoothstep(skyRamp.y, skyRamp.z, elevation));
          sky *= sky;
          vec3 color = mix(horizonColor, sky, smoothstep(0.0, skyRamp.x, elevation));
          color = mix(color * 0.78, color, smoothstep(-7.0, 0.0, elevation));
          float band = exp(-pow((elevation - 2.0) * 0.33, 2.0));
          color += bandColor * band * skyRamp.w;
          color += sunColor
            * (smoothstep(sunShape.y, sunShape.x, dot(dir, sunDirection)) * sunShape.z);
          float cloudMask = smoothstep(cloudBand.x, cloudBand.x + 3.0, elevation)
            * (1.0 - smoothstep(cloudBand.y - 8.0, cloudBand.y, elevation));
          if (cloudMask > 0.002) {
            float azimuth = atan(dir.z, dir.x) * 0.15915494;
            vec2 uv = vec2(
              (azimuth + cloudBand.z) * cloudShape.w,
              elevation * cloudShape.w * cloudStretch / 360.0
            );
            float n = skyNoise(uv, cloudShape.w) * 0.4
              + skyNoise(uv * 2.0, cloudShape.w * 2.0) * 0.34
              + skyNoise(uv * 4.0, cloudShape.w * 4.0) * 0.26;
            n = clamp((n - 0.5) * 2.6 + 0.5, 0.0, 1.0);
            float puff = smoothstep(
              1.0 - cloudShape.x - cloudShape.y,
              1.0 - cloudShape.x + cloudShape.y,
              n
            );
            vec2 flat2 = normalize(vec2(dir.x, dir.z) + vec2(1e-5));
            vec2 sunFlat = normalize(vec2(sunDirection.x, sunDirection.z) + vec2(1e-5));
            vec3 warm = mix(hazeColor, sunColor, 0.75);
            vec3 lit = mix(hazeColor * cloudBand.w, warm, dot(flat2, sunFlat) * 0.5 + 0.5);
            vec3 add = lit * (min(puff, 0.8) * cloudMask * cloudShape.z);
            color += min(add, max(hazeColor - color, vec3(0.0)));
          }
          gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `.replace(
        PS2_TONE_MAPPING_ANCHOR,
        // The dome already ran through tone mapping, so in `ps2` it takes the
        // replacement grade too — leaving it raw would blow the sky out and
        // poison the A/B. It is deliberately *not* vertex-snapped or dithered:
        // a stepping horizon reads as a bug, and a 24x12 dome has no edges the
        // raster would flatter.
        activeRenderMode() === "ps2"
          ? ps2ColorGradeChunk()
          : PS2_TONE_MAPPING_ANCHOR,
      ),
    });
    const dome = new THREE.Mesh(geometry, material);
    dome.name = "sky_backdrop";
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    return dome;
  }

  /**
   * Crossfades the authored sky between the two sectors the lap is between and
   * writes it into the dome, tinted by the time-of-day drift.
   *
   * The `blendDegrees` of the zone the lap is *leaving* wins outright rather
   * than being interpolated: it moves the elevation at which the zenith has
   * resolved by a degree or two between sectors, and a lerped ramp edge is a
   * moving target the eye reads as the sky breathing. Colours crossfade;
   * geometry of the ramp steps once, inside a 90 m window, under a colour
   * change that hides it.
   */
  private updateSkyPalette(
    distanceMetres: number,
    tint: ReturnType<typeof createTimeOfDayTint>,
    response: number,
  ): void {
    resolveSkyBlend(
      this.skyZones,
      distanceMetres,
      this.course.length,
      LIGHTING_CROSSFADE_METRES,
      this.skyBlend,
    );
    const zone = this.skyZones[this.skyBlend.index];
    const next = this.skyZones[this.skyBlend.next];
    this.skyHazeTarget.lerpColors(zone.horizon, next.horizon, this.skyBlend.amount);
    this.skyZenithTarget.lerpColors(zone.zenith, next.zenith, this.skyBlend.amount);
    this.skyHazeTarget.setRGB(
      this.skyHazeTarget.r * tint.fogR,
      this.skyHazeTarget.g * tint.fogG,
      this.skyHazeTarget.b * tint.fogB,
    );
    this.skyZenithTarget.setRGB(
      this.skyZenithTarget.r * tint.fogR,
      this.skyZenithTarget.g * tint.fogG,
      this.skyZenithTarget.b * tint.fogB,
    );
    this.skyUniforms.hazeColor.value.lerp(this.skyHazeTarget, response);
    this.skyUniforms.topColor.value.lerp(this.skyZenithTarget, response);
    this.skyBlendDegrees = SKY_HAZE_TOP_DEGREES + zone.blendDegrees;
    this.skyUniforms.skyRamp.value.z = this.skyBlendDegrees;
  }

  /**
   * Is the sun drawing into the frame right now, and is anything covering it?
   *
   * Only ever called from `diagnostics()`, i.e. at the ~1 Hz the sampler runs
   * and only under `?diagnostics=1`. The raycast is gated behind the frustum
   * test on purpose: on both shipped maps the key sits 56-74 degrees up and the
   * sun is never framed (measured: 588 Bitterpan and 586 Greenwater samples over
   * three laps each, zero on screen — scripts/visual/sun-disc-sweep.mjs), so the
   * expensive branch costs nothing today and still tells the truth on the day a
   * sector drops its sun toward the horizon.
   */
  private isSunOccluded(): boolean {
    this.sunWorldPosition
      .copy(this.camera.position)
      .addScaledVector(this.keyDirection, this.camera.far * SUN_DISC_DISTANCE_RATIO);
    this.sunNdc.copy(this.sunWorldPosition).project(this.camera);
    const framed = Math.abs(this.sunNdc.x) <= 1
      && Math.abs(this.sunNdc.y) <= 1
      && this.sunNdc.z <= 1;
    if (!framed) return true;
    this.sunRaycaster.set(this.camera.position, this.keyDirection);
    this.sunRaycaster.far = this.camera.far * SUN_DISC_DISTANCE_RATIO;
    return this.sunRaycaster.intersectObject(this.course.group, true).length > 0;
  }

  /**
   * @param lap current lap, 1-based, and @param totalLaps the race length. The
   * race @param phase decides whether there is lap data at all: the pre-race
   * standby screen and the countdown have none, and the drift must read zero
   * there rather than guess.
   */
  updateFog(
    delta: number,
    progress: number,
    lap = 1,
    totalLaps = 0,
    phase = "standby",
  ): void {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    const lapProgress = resolveLapProgress(
      phase,
      lap,
      totalLaps,
      progress,
      this.course.startProgress,
    );
    const reducedMotion = this.reducedMotion;
    const target = this.course.fogAt(progress);
    const lighting = this.course.lightingAt(progress);
    const distanceMetres = THREE.MathUtils.euclideanModulo(progress, 1) * this.course.length;

    // --- Time-of-day drift. Sampled once and applied as a multiplier over
    // whatever the sector palette just returned, so sector identity survives.
    this.timeOfDayDrift = resolveTimeOfDayDrift(lapProgress, reducedMotion);
    // P18: published, not threaded. The Bitterpan facade window strips
    // cross-fade DEAD -> DUSK on this exact number; see time-of-day.ts.
    publishTimeOfDayDrift(this.timeOfDayDrift);
    const stops = this.course.timeOfDayStops;
    const tint = this.tintScratch;
    if (stops && stops.length > 0) {
      evaluateTimeOfDay(stops, this.timeOfDayDrift, tint);
    }
    this.tintedFog.setRGB(
      target.color.r * tint.fogR,
      target.color.g * tint.fogG,
      target.color.b * tint.fogB,
    );
    this.tintedSky.setRGB(
      lighting.sky.r * tint.skyR,
      lighting.sky.g * tint.skyG,
      lighting.sky.b * tint.skyB,
    );
    this.tintedGround.setRGB(
      lighting.ground.r * tint.groundR,
      lighting.ground.g * tint.groundG,
      lighting.ground.b * tint.groundB,
    );
    this.tintedKey.setRGB(
      lighting.key.r * tint.keyR,
      lighting.key.g * tint.keyG,
      lighting.key.b * tint.keyB,
    );

    const response = 1 - Math.exp(-delta * 5.5);
    // G3 — the squall thickens the air over the two sectors it covers. A
    // MULTIPLIER over whatever the sector palette just returned, on the same
    // footing as the time-of-day tint above: the sector keeps its authored
    // identity, it just gets denser, and outside a squall the term is exactly 1
    // so nothing about the accepted fog grade moves. Published rather than
    // threaded — see track-events.ts.
    fog.density = THREE.MathUtils.lerp(
      fog.density,
      target.density * trackEventFogMultiplier(),
      response,
    );
    fog.color.lerp(this.tintedFog, response);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.tintedFog, response);
    }
    const lightingResponse = 1 - Math.exp(-delta * 2.8);
    this.hemisphereLight.color.lerp(this.tintedSky, lightingResponse);
    this.hemisphereLight.groundColor.lerp(this.tintedGround, lightingResponse);
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(
      this.hemisphereLight.intensity,
      lighting.hemisphereIntensity * HEMISPHERE_TRIM * tint.hemisphereScale,
      lightingResponse,
    );
    this.keyLight.color.lerp(this.tintedKey, lightingResponse);
    this.keyLight.intensity = THREE.MathUtils.lerp(
      this.keyLight.intensity,
      lighting.keyIntensity * tint.keyScale,
      lightingResponse,
    );
    // --- Sector-lerped key direction. The course already crossfaded it; the
    // same exponential response the colours use keeps the swing smooth across
    // a frame-rate hitch, and the light position is just the direction pushed
    // out to a fixed radius (a DirectionalLight only reads the direction).
    this.keyDirection.lerp(lighting.keyDirection, lightingResponse).normalize();
    this.keyLight.position
      .copy(this.keyDirection)
      .multiplyScalar(KEY_LIGHT_DISTANCE);
    // P20.1 overwrites that position with the same direction taken from the
    // shadow box centre instead of from the world origin. The direction — the
    // only thing the light contributes to shading — is identical either way.
    this.updateShadowCamera();
    this.rimLight.color.lerp(lighting.rim, lightingResponse);
    this.rimLight.intensity = THREE.MathUtils.lerp(
      this.rimLight.intensity,
      lighting.rimIntensity * RIM_PRESENCE_BOOST,
      lightingResponse,
    );

    // P20.5 — the sky is authored, not derived. `horizonColor` is still the
    // sector fog, but the shader only lets it own the bottom 1.5 degrees; the
    // haze and the zenith come from the map's own sky table, crossfaded on the
    // same sector window the palette uses so the sky and the light change
    // sector on the same metre. Both still take the time-of-day drift, as a
    // multiplier over the authored colour rather than as its source — a dusk
    // that reddens the fog reddens the sky with it, and reduced motion (drift
    // pinned to stop 0) leaves the authored noon look untouched.
    this.updateSkyPalette(distanceMetres, tint, response);
    this.skyBandTarget.setRGB(
      lighting.rim.r * (1 + (tint.keyR - 1) * 0.45),
      lighting.rim.g * (1 + (tint.keyG - 1) * 0.45),
      lighting.rim.b * (1 + (tint.keyB - 1) * 0.45),
    );
    this.skyUniforms.horizonColor.value.lerp(this.tintedFog, response);
    this.skyUniforms.bandColor.value.lerp(this.skyBandTarget, response);
    this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);
    // The sun rides the same swinging direction the key light does, so the sun
    // in the sky and the sun lighting the deck can never disagree.
    this.skyUniforms.sunColor.value.lerp(this.tintedKey, lightingResponse);
    this.skyUniforms.sunDirection.value.copy(this.keyDirection);
    // Cloud drift. `driftPerSecond` is an azimuth-lattice rate, not a wind
    // speed: at the authored 0.0022-0.0035 it takes four to seven minutes for
    // the band to move one noise cell, which is the difference between "the sky
    // is alive" and "the sky is a screensaver". Reduced motion stops it dead —
    // the phase is simply never advanced, so two frames any distance apart are
    // identical from the same pose.
    if (!reducedMotion) {
      this.cloudPhase += delta * this.cloudProfile.driftPerSecond;
      this.skyUniforms.cloudBand.value.z = this.cloudPhase;
    }

    // A restrained craft-following light lifts TOTEM off the bright deck and
    // pools a sector-tinted glow beneath it as a grounding cue.
    this.skyBandTarget.copy(lighting.rim).lerp(WHITE, 0.45);
    this.presenceLight.color.lerp(this.skyBandTarget, lightingResponse);
    this.presenceLight.intensity = THREE.MathUtils.lerp(
      this.presenceLight.intensity,
      // P11: 14 -> 17, to keep the craft reading against the lifted key.
      17,
      lightingResponse,
    );

    this.updateHangarLamps(delta, progress, reducedMotion);
  }

  /**
   * Seeded hangar flicker, advanced on whole 30 Hz ticks so the sequence is a
   * pure function of elapsed time and reproducible from the seed alone — a soak
   * replays the same lamp behaviour at any frame rate.
   */
  private updateHangarLamps(
    delta: number,
    progress: number,
    reducedMotion: boolean,
  ): void {
    if (this.hangarLamps.length === 0) return;
    this.hangarFlickerClock += delta;
    if (this.hangarFlickerClock >= ATMOSPHERE_UPDATE_INTERVAL_SECONDS) {
      const ticks = Math.floor(
        this.hangarFlickerClock / ATMOSPHERE_UPDATE_INTERVAL_SECONDS,
      );
      this.hangarFlickerClock -= ticks * ATMOSPHERE_UPDATE_INTERVAL_SECONDS;
      this.hangarFlickerTick += ticks;
    }
    const distance = THREE.MathUtils.euclideanModulo(progress, 1) * this.course.length;
    const level = resolveHangarLampLevel(
      distance,
      this.hangarFlickerTick,
      reducedMotion,
      this.hangarFlicker,
    );
    this.hangarLampLevel = level;
    const active = level > 0;
    const intensity = level * HANGAR_LAMP_PEAK_INTENSITY;
    for (let index = 0; index < this.hangarLamps.length; index += 1) {
      const lamp = this.hangarLamps[index];
      lamp.visible = active;
      lamp.intensity = intensity;
    }
  }

  diagnostics(): AtmosphereDiagnostics {
    return {
      keyDirection: [
        Number(this.keyDirection.x.toFixed(4)),
        Number(this.keyDirection.y.toFixed(4)),
        Number(this.keyDirection.z.toFixed(4)),
      ],
      shadows: {
        enabled: this.shadowActive,
        mapSize: this.shadowActive ? shadowMapSize() : 0,
        // Reported whether or not the pass runs: the flags are armed
        // unconditionally (see shadows.ts) and a family that lost one is worth
        // catching under the kill switch too.
        casters: this.countShadowCasters(),
        promotedReceivers: this.shadowReceiversPromoted,
      },
      hangarFlickerActive: this.hangarLampLevel > 0,
      hangarLampIntensity: Number(this.hangarLampLevel.toFixed(4)),
      timeOfDayDrift: Number(this.timeOfDayDrift.toFixed(4)),
      sky: {
        horizonHex: `#${this.skyUniforms.hazeColor.value.getHexString()}`,
        zenithHex: `#${this.skyUniforms.topColor.value.getHexString()}`,
        cloudCoverage: this.cloudProfile.coverage,
        sunOccluded: this.isSunOccluded(),
      },
    };
  }
}
