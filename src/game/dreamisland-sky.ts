import * as THREE from 'three';
/**
 * One dome, two painted panoramas, one cross-fade.
 *
 * The Ascension contract otherwise unchanged: `SphereGeometry(560, 40, 20)`,
 * BackSide, no depth write, no depth test, `renderOrder = -990`, never frustum
 * culled, position copied to the camera every frame, and an edge blend across a
 * narrow azimuth band so a panorama that does not tile still closes.
 *
 * The day/night blend is TWO SAMPLERS AND ONE `mix`, not two domes cross-faded
 * on opacity: two domes would double the sky's draw cost and, worse, would
 * cross-fade through the haze term twice, so the horizon would go pale at the
 * midpoint. The mix happens BEFORE `tonemapping_fragment`, so the blended sky
 * is tone mapped once as a single sky, which is also what makes the midpoint a
 * real state rather than two states averaged after grading.
 *
 * `fog === false` is three's default for a ShaderMaterial, so this dome is the
 * one object the material walk exempts, by the name below.
 */
export class DreamIslandSky {
 readonly root:THREE.Mesh;
 readonly ready:Promise<void>;
 /** Reads zero if neither panorama ever arrived, so a silent no-op is visible. */
 loadedPanoramas=0;
 private readonly night={value:0};
 private readonly stars={value:0};
 private readonly haze={value:new THREE.Color(0xb9dbe4)};
 constructor(){
  const day={value:null as THREE.Texture|null},night={value:null as THREE.Texture|null};
  const load=(url:string,into:{value:THREE.Texture|null})=>new THREE.TextureLoader().loadAsync(url)
   .then(texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;
    texture.anisotropy=4;into.value=texture;this.loadedPanoramas++;});
  this.ready=typeof Image==='undefined'?Promise.resolve():Promise.all([
   load('/assets/dreamisland/sky-day.jpg',day),load('/assets/dreamisland/sky-night.jpg',night),
  ]).then(()=>undefined);
  this.root=new THREE.Mesh(new THREE.SphereGeometry(560,40,20),new THREE.ShaderMaterial({
   uniforms:{dayPanorama:day,nightPanorama:night,haze:this.haze,nightBlend:this.night,starReveal:this.stars},
   side:THREE.BackSide,depthWrite:false,depthTest:false,
   vertexShader:'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`uniform sampler2D dayPanorama;uniform sampler2D nightPanorama;uniform vec3 haze;uniform float nightBlend;uniform float starReveal;varying vec3 direction;
    // Perceptual pacing applies only to the panorama mix. The course still
    // owns the unmodified clock, light/fog ramp, grip and reduced-motion jump.
    vec4 panorama(vec2 uv){float mixWeight=1.-pow(1.-nightBlend,2.8);
      vec4 nightColor=texture2D(nightPanorama,uv);
      nightColor.rgb*=mix(1.,starReveal,step(0.,direction.y));
      return mix(texture2D(dayPanorama,uv),nightColor,mixWeight);}
    void main(){vec3 d=normalize(direction);float u=fract(atan(d.z,d.x)/6.283185+.42);float v=clamp(.30+max(d.y,0.)*.69,.30,.99);
    // Source row-profile places the painted day shoreline at v=.268.
    // The .30 lower bound samples sky above it throughout the dome.
    // Both panorama edges blended over a narrow azimuth band, so a source that
    // does not tile exactly still closes. Same band on both states.
    float edge=smoothstep(0.,.055,min(u,1.-u));
    vec4 seam=(panorama(vec2(.002,v))+panorama(vec2(.998,v)))*.5;
    gl_FragColor=mix(seam,panorama(vec2(u,v)),edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb=mix(gl_FragColor.rgb,haze,(1.-smoothstep(.01,.22,d.y))*.88);}`,
  }));
  this.root.name='dreamisland_panorama';this.root.renderOrder=-990;this.root.frustumCulled=false;
 }
 /** `nightBlend` comes from the course every frame; the dome never owns a clock. */
 update(camera:THREE.Camera,fog=new THREE.Color(0xb9dbe4),nightBlend=0){
  this.night.value=nightBlend;this.root.position.copy(camera.position);
  this.stars.value=THREE.MathUtils.smoothstep(nightBlend,.6,1);
  fog.getRGB(this.haze.value,THREE.SRGBColorSpace);
 }
}
