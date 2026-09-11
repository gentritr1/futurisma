import * as THREE from "three";

/** One blue-hour panorama; the world flare faces the same azimuth as its painting. */
export const TIDELINE_FLARE_DIRECTION = new THREE.Vector3(.982, .25, .187).normalize();

export class TidelineSky {
  readonly root: THREE.Mesh;
  readonly ready: Promise<void>;
  private readonly aboveWater = { value: 0 };
  private readonly time = { value: 0 };
  private readonly hazeColor = { value: new THREE.Color() };

  constructor() {
    const horizon = { value: null as THREE.Texture | null };
    this.ready = typeof Image === "undefined" ? Promise.resolve()
      : new THREE.TextureLoader().loadAsync("/assets/tideline-v4/horizon.jpg").then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = 4;
        horizon.value = texture;
      });
    this.root = new THREE.Mesh(new THREE.SphereGeometry(560, 40, 20), new THREE.ShaderMaterial({
      uniforms: { aboveWater: this.aboveWater, horizon, time: this.time, hazeColor: this.hazeColor },
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vDirection;
        void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform sampler2D horizon;
        uniform float aboveWater,time; uniform vec3 hazeColor; varying vec3 vDirection;
        void main(){
          vec3 direction=normalize(vDirection);
          float u=fract(atan(direction.z,direction.x)/6.283185+.42);
          float v=clamp(.055+direction.y*.95,0.,.99);
          vec3 paint=texture2D(horizon,vec2(u+time*.00008*max(0.,direction.y),v)).rgb;
          vec3 underwater=vec3(.008,.065,.072)+vec3(.01,.04,.045)*max(direction.y,0.);
          gl_FragColor=vec4(mix(underwater,paint*vec3(1.10,1.24,1.55),aboveWater),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float haze=(1.-smoothstep(.01,.24,direction.y))*.82*aboveWater;
          gl_FragColor.rgb=mix(gl_FragColor.rgb,hazeColor,haze);
        }`
    }));
    this.root.name = "tideline_refinery_horizon";
    this.root.renderOrder = -990;
    this.root.frustumCulled = false;
  }

  update(camera: THREE.Camera, waterLevel = 0, time = 0, fogColor = new THREE.Color(0x242f33)): void {
    this.root.position.copy(camera.position);
    this.aboveWater.value = THREE.MathUtils.smoothstep(camera.position.y - waterLevel, -3, 2);
    this.time.value = time;
    fogColor.getRGB(this.hazeColor.value, THREE.SRGBColorSpace);
  }
}
