import * as THREE from "three";
import type { RaceCourse } from "./course";

const SKY_ZENITH_TINT = new THREE.Color(0x0a1216);
const WHITE = new THREE.Color(0xffffff);
const SUN_DIRECTION = new THREE.Vector3(80, 130, -35).normalize();
const RIM_PRESENCE_BOOST = 1.85;
const HEMISPHERE_TRIM = 0.88;

/**
 * Scene lighting, sky backdrop, sun disc, craft presence light and the fog /
 * palette blend that keeps them glued to the sector the player is driving.
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

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly course: RaceCourse,
    progress: number,
    vehicleRoot: THREE.Object3D,
  ) {
    this.installLighting(progress);
    this.skyDome = this.createSkyBackdrop();
    this.sunDisc = this.createSunDisc();
    this.scene.add(this.skyDome, this.sunDisc);
    this.presenceLight.position.set(0, 2.3, 0.9);
    vehicleRoot.add(this.presenceLight);
  }

  private installLighting(progress: number): void {
    const lighting = this.course.lightingAt(progress);
    this.hemisphereLight.color.copy(lighting.sky);
    this.hemisphereLight.groundColor.copy(lighting.ground);
    this.hemisphereLight.intensity = lighting.hemisphereIntensity * HEMISPHERE_TRIM;
    this.keyLight.color.copy(lighting.key);
    this.keyLight.intensity = lighting.keyIntensity;
    this.keyLight.position.set(80, 130, -35);
    this.rimLight.color.copy(lighting.rim);
    this.rimLight.intensity = lighting.rimIntensity * RIM_PRESENCE_BOOST;
    this.rimLight.position.set(-100, 25, -80);
    this.scene.add(this.hemisphereLight, this.keyLight, this.rimLight);
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
      `,
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

  updateFog(delta: number, progress: number): void {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    const target = this.course.fogAt(progress);
    const response = 1 - Math.exp(-delta * 5.5);
    fog.density = THREE.MathUtils.lerp(fog.density, target.density, response);
    fog.color.lerp(target.color, response);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(target.color, response);
    }
    const lighting = this.course.lightingAt(progress);
    const lightingResponse = 1 - Math.exp(-delta * 2.8);
    this.hemisphereLight.color.lerp(lighting.sky, lightingResponse);
    this.hemisphereLight.groundColor.lerp(lighting.ground, lightingResponse);
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(
      this.hemisphereLight.intensity,
      lighting.hemisphereIntensity * HEMISPHERE_TRIM,
      lightingResponse,
    );
    this.keyLight.color.lerp(lighting.key, lightingResponse);
    this.keyLight.intensity = THREE.MathUtils.lerp(
      this.keyLight.intensity,
      lighting.keyIntensity,
      lightingResponse,
    );
    this.rimLight.color.lerp(lighting.rim, lightingResponse);
    this.rimLight.intensity = THREE.MathUtils.lerp(
      this.rimLight.intensity,
      lighting.rimIntensity * RIM_PRESENCE_BOOST,
      lightingResponse,
    );

    // Sky gradient follows the sector palette: the horizon stays glued to the
    // fog colour, the zenith drops cool and dark, and the accent band picks up
    // the sector rim hue so each sector gets a contrasting sky accent.
    this.skyTopTarget.copy(target.color).multiplyScalar(0.3).lerp(SKY_ZENITH_TINT, 0.45);
    this.skyBandTarget.copy(lighting.rim);
    this.skyUniforms.horizonColor.value.lerp(target.color, response);
    this.skyUniforms.topColor.value.lerp(this.skyTopTarget, response);
    this.skyUniforms.bandColor.value.lerp(this.skyBandTarget, response);
    this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);
    const sunMaterial = this.sunDisc.material as THREE.MeshBasicMaterial;
    sunMaterial.color.lerp(lighting.key, lightingResponse);
    this.sunDisc.position
      .copy(this.camera.position)
      .addScaledVector(SUN_DIRECTION, this.camera.far * 0.72);
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
  }
}
