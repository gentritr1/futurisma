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

/** The exposure the AgX path has run at since the renderer was set up. */
const AGX_TONE_MAPPING_EXPOSURE = 1.05;

/**
 * P4b. `agx` keeps the 2023 filmic curve the project shipped with; `ps2`
 * replaces it with the hand-authored grade that `render-mode.js` owns, which is
 * injected per material instead of running on the renderer. Presentation only —
 * neither branch is visible to physics or lap timing.
 */
export function configureToneMapping(renderer: THREE.WebGLRenderer): void {
  const ps2 = activeRenderMode() === "ps2";
  renderer.toneMapping = ps2 ? THREE.NoToneMapping : THREE.AgXToneMapping;
  // Ignored under `NoToneMapping`; the grade applies `PS2_EXPOSURE` itself, set
  // to the same 1.05 so the A/B compares curves rather than gain.
  renderer.toneMappingExposure = ps2 ? 1 : AGX_TONE_MAPPING_EXPOSURE;
}

const SKY_ZENITH_TINT = new THREE.Color(0x0a1216);
const WHITE = new THREE.Color(0xffffff);
const RIM_PRESENCE_BOOST = 1.85;
const HEMISPHERE_TRIM = 0.88;
const KEY_LIGHT_DISTANCE = 160;
const SUN_DISC_DISTANCE_RATIO = 0.72;

/**
 * Sodium vapour, matching the `sodiumMaterial` lamp strips in
 * `createHangarShell`. Deliberately *not* touched by the time-of-day ramp: an
 * artificial lamp does not follow the sun down.
 */
const HANGAR_LAMP_COLOR = 0xffb154;
/**
 * Two lamps at the quarter points of the 618-816 m shell, hung just under the
 * 15.5 m lamp strips. `distance` is set so their falloff dies before the shell
 * mouth, which keeps them from leaking onto `LINK_APRON` / `HANGAR_EXIT`.
 */
const HANGAR_LAMP_DISTANCES_METRES = [668, 766] as const;
const HANGAR_LAMP_HEIGHT_METRES = 14.2;
const HANGAR_LAMP_RANGE_METRES = 54;
const HANGAR_LAMP_DECAY = 1.35;
/** Peak candela, i.e. the value the flicker in [0.55, 1.0] scales. */
const HANGAR_LAMP_PEAK_INTENSITY = 110;

/** The one flat object `atmosphere.ts` contributes to the diagnostics report. */
export interface AtmosphereDiagnostics {
  /** Current crossfaded key direction, normalized world space. */
  keyDirection: readonly [number, number, number];
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
  }

  /**
   * Two conditional sodium lamps inside `HANGAR_SIX`. They are added to the
   * scene once, hidden, and only ever become visible between 618 m and 816 m —
   * an invisible light is skipped by the renderer's object traversal, so the
   * lit-light count is 4 everywhere except inside the shell, where it is 6.
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
          vec3 color = mix(horizonColor, topColor, smoothstep(0.0, 0.42, h));
          color = mix(color * 0.82, color, smoothstep(-0.12, 0.0, h));
          float band = exp(-pow((h - 0.035) * 16.0, 2.0));
          color += bandColor * band * 0.38;
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
      opacity: 0.5,
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
    this.skyTopTarget.copy(this.tintedFog).multiplyScalar(0.3).lerp(SKY_ZENITH_TINT, 0.45);
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
      14,
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
      hangarFlickerActive: this.hangarLampLevel > 0,
      hangarLampIntensity: Number(this.hangarLampLevel.toFixed(4)),
      timeOfDayDrift: Number(this.timeOfDayDrift.toFixed(4)),
    };
  }
}
