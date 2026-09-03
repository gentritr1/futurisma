import * as THREE from "three";
import type { RaceCourse } from "./course";
import {
  ATMOSPHERE_UPDATE_INTERVAL_SECONDS,
  createHangarFlicker,
  createTimeOfDayTint,
  evaluateTimeOfDay,
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
  SHADOW_LIGHT_DISTANCE_METRES,
  SHADOW_LOOKAHEAD_METRES,
  shadowMapSize,
  shadowTexelMetres,
  shadowsEnabled,
  snapShadowCentre,
} from "./shadow-settings.js";
import { armKeyLightShadow, promoteUnlitShadowReceivers } from "./shadows";
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

const SKY_ZENITH_TINT = new THREE.Color(0x0a1216);
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
const SUN_DISC_DISTANCE_RATIO = 0.72;

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
  private readonly skyUniforms = {
    topColor: { value: new THREE.Color(0x1a2226) },
    horizonColor: { value: new THREE.Color(0xa9bbb0) },
    bandColor: { value: new THREE.Color(0xc8ff2e) },
  };
  private readonly skyDome: THREE.Mesh;
  private readonly sunDisc: THREE.Mesh;
  private readonly skyTopTarget = new THREE.Color();
  private readonly skyBandTarget = new THREE.Color();
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
    this.installLighting(progress);
    this.skyDome = this.createSkyBackdrop();
    this.sunDisc = this.createSunDisc();
    this.scene.add(this.skyDome, this.sunDisc);
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
   * Graded sky dome + horizon accent band. The horizon matches the sector fog
   * colour so geometry melts into it, while the zenith drops toward a cool
   * near-black and a restrained sector-accent band glows at the horizon line.
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
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bandColor;
        varying vec3 vDirection;
        void main() {
          float h = normalize(vDirection).y;
          // P19: the gradient used to reach the zenith only at h=0.42, which a
          // chase camera never frames — the whole visible dome sat on the flat
          // horizon fog colour and the sky read as one pale wash. The ramp now
          // resolves inside the framed band, so there is real air overhead.
          vec3 color = mix(horizonColor, topColor, smoothstep(-0.03, 0.26, h));
          color = mix(color * 0.78, color, smoothstep(-0.12, 0.0, h));
          float band = exp(-pow((h - 0.035) * 16.0, 2.0));
          color += bandColor * band * 0.42;
          gl_FragColor = vec4(color, 1.0);
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

  /** Small additive key-light disc that anchors the sky composition. */
  private createSunDisc(): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(this.camera.far * 0.055, 20);
    const material = new THREE.MeshBasicMaterial({
      color: this.keyLight.color.clone(),
      transparent: true,
      // P11: 0.5 -> 0.62.
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const disc = new THREE.Mesh(geometry, material);
    disc.name = "sun_disc";
    disc.renderOrder = -999;
    return disc;
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
    fog.density = THREE.MathUtils.lerp(fog.density, target.density, response);
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

    // Sky gradient follows the sector palette: the horizon stays glued to the
    // fog colour, the zenith drops cool and dark, and the accent band picks up
    // the sector rim hue so each sector gets a contrasting sky accent. The
    // horizon and zenith inherit the drift through the tinted fog colour; the
    // band takes it at reduced strength so the navigation accent stays legible.
    // P19: the zenith drop was 0.3/0.45 — barely darker than the horizon under
    // a pale pan fog, which is why the sky read flat. A deeper multiplier and a
    // harder pull toward the zenith tint restore the dome's vertical read.
    this.skyTopTarget.copy(this.tintedFog).multiplyScalar(0.22).lerp(SKY_ZENITH_TINT, 0.55);
    this.skyBandTarget.setRGB(
      lighting.rim.r * (1 + (tint.keyR - 1) * 0.45),
      lighting.rim.g * (1 + (tint.keyG - 1) * 0.45),
      lighting.rim.b * (1 + (tint.keyB - 1) * 0.45),
    );
    this.skyUniforms.horizonColor.value.lerp(this.tintedFog, response);
    this.skyUniforms.topColor.value.lerp(this.skyTopTarget, response);
    this.skyUniforms.bandColor.value.lerp(this.skyBandTarget, response);
    this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);
    const sunMaterial = this.sunDisc.material as THREE.MeshBasicMaterial;
    sunMaterial.color.lerp(this.tintedKey, lightingResponse);
    // The disc rides the same swinging direction, so the sun in the sky and the
    // sun lighting the deck can never disagree.
    this.sunDisc.position
      .copy(this.camera.position)
      .addScaledVector(this.keyDirection, this.camera.far * SUN_DISC_DISTANCE_RATIO);
    this.sunDisc.lookAt(this.camera.position);

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
    };
  }
}
