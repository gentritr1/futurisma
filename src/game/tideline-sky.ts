import * as THREE from "three";
import { isFoundryEdition } from "./tideline-style";

/** Painted-sky treatment: broad cobalt light, an old moon and sparse star flares. */
export class TidelineSky {
  readonly root: THREE.Mesh;
  private readonly aboveWater = { value: 0 };
  constructor() {
    this.root = new THREE.Mesh(new THREE.SphereGeometry(560, 48, 24), new THREE.ShaderMaterial({
      uniforms: { aboveWater: this.aboveWater, foundry: { value: isFoundryEdition ? 1 : 0 } }, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vDirection;
        void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float aboveWater; uniform float foundry; varying vec3 vDirection;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){
          vec3 d=normalize(vDirection);
          vec2 uv=vec2(atan(d.z,d.x)/6.283185+.5,asin(d.y)/3.141593+.5);
          float clouds=noise(uv*vec2(20.,16.))*.58+noise(uv*vec2(53.,39.))*.27+noise(uv*vec2(117.,71.))*.15;
          float ridge=exp(-pow((d.y-.31-.11*sin(uv.x*12.566))/ .17,2.0));
          float filaments=pow(clouds,1.6)*ridge;
          vec3 sky=vec3(.003,.005,.029)+vec3(.012,.11,.52)*filaments;
          sky+=vec3(.11,.009,.16)*pow(clouds,2.0)*exp(-pow((d.y-.52)/.24,2.0));
          vec2 stars=uv*vec2(290.,145.); vec2 cell=floor(stars),local=fract(stars)-.5;
          float star=step(.991,hash(cell))*pow(max(0.,1.-length(local)*3.7),7.0);
          float flare=step(.9992,hash(cell))*(exp(-abs(local.x)*70.-abs(local.y)*8.)+exp(-abs(local.y)*70.-abs(local.x)*8.));
          sky+=vec3(.60,.79,1.)*(star*.85+flare*.19)*smoothstep(.03,.15,d.y);
          vec3 moonDir=normalize(vec3(-.6,.35,-.7)); float disc=dot(d,moonDir);
          float moon=smoothstep(.983,.9836,disc);
          float craters=noise(d.xz*93.)*.6+noise(d.xz*220.)*.4;
          sky=mix(sky,vec3(.10,.13,.20)*(.35+craters*.65)*(.5+.5*d.x),moon);
          sky=mix(vec3(.015,.041,.075),sky,smoothstep(-.025,.10,d.y));
          vec3 water=vec3(.008,.055,.077)+vec3(.009,.035,.047)*max(d.y,0.);
          vec3 humid=mix(vec3(.064,.081,.058),vec3(.019,.034,.034),smoothstep(.01,.75,d.y));
          humid+=vec3(.034,.029,.014)*pow(clouds,2.0);
          sky=mix(sky,humid,foundry);
          water=mix(water,vec3(.032,.060,.031),foundry);
          gl_FragColor=vec4(mix(water,sky,aboveWater),1.0);
          #include <colorspace_fragment>
        }`,
    }));
    this.root.name = "tideline_painted_cobalt_sky";
    this.root.renderOrder = -990; this.root.frustumCulled = false;
  }
  update(camera: THREE.Camera): void {
    this.root.position.copy(camera.position);
    this.aboveWater.value = THREE.MathUtils.smoothstep(camera.position.y, -4, 5);
  }
}
