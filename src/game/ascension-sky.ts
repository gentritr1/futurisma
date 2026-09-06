import * as THREE from 'three';
/** One painted dawn. The horizon dissolves into the same fog colour as geometry. */
export class AscensionSky {
 readonly root:THREE.Mesh;
 readonly ready:Promise<void>;
 private readonly haze={value:new THREE.Color(0x8e9a8e)};
 constructor(){
  const panorama={value:null as THREE.Texture|null};
  this.ready=typeof Image==='undefined'?Promise.resolve():new THREE.TextureLoader().loadAsync('/assets/ascension/horizon.png').then(texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=4;panorama.value=texture;});
  this.root=new THREE.Mesh(new THREE.SphereGeometry(560,40,20),new THREE.ShaderMaterial({uniforms:{panorama,haze:this.haze},side:THREE.BackSide,depthWrite:false,depthTest:false,
   vertexShader:'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`uniform sampler2D panorama;uniform vec3 haze;varying vec3 direction;
    void main(){vec3 d=normalize(direction);float u=fract(atan(d.z,d.x)/6.283185+.42);float v=clamp(.15+d.y*.8,0.,.99);
    // Blend both panorama edges over a narrow azimuth band, keeping a single sky state.
    float edge=smoothstep(0.,.055,min(u,1.-u));
    vec4 seam=(texture2D(panorama,vec2(.002,v))+texture2D(panorama,vec2(.998,v)))*.5;
    gl_FragColor=mix(seam,texture2D(panorama,vec2(u,v)),edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb=mix(gl_FragColor.rgb,haze,(1.-smoothstep(.01,.22,d.y))*.88);}`
  }));this.root.name='ascension_dawn_panorama';this.root.renderOrder=-990;this.root.frustumCulled=false;
 }
 update(camera:THREE.Camera,fog=new THREE.Color(0x8e9a8e)){this.root.position.copy(camera.position);fog.getRGB(this.haze.value,THREE.SRGBColorSpace);}
}
