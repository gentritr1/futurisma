import * as THREE from "three";

/** Painted refinery silhouette and a directional storm-cloud opening. */
export class TidelineSky {
 readonly root:THREE.Mesh;
 readonly ready:Promise<void>;
 private readonly aboveWater={value:0};
 private readonly time={value:0};
 constructor(){
  const horizon={value:null as THREE.Texture|null};
  this.ready=typeof Image==='undefined'?Promise.resolve():new THREE.TextureLoader().loadAsync('/assets/tideline-v3/horizon.jpg').then(texture=>{texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;horizon.value=texture;});
  this.root=new THREE.Mesh(new THREE.SphereGeometry(560,40,20),new THREE.ShaderMaterial({
   uniforms:{aboveWater:this.aboveWater,horizon,time:this.time},side:THREE.BackSide,depthWrite:false,depthTest:false,
   vertexShader:`varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`uniform sampler2D horizon;uniform float aboveWater,time;varying vec3 vDirection;
    void main(){vec3 d=normalize(vDirection);float u=fract(atan(d.z,d.x)/6.283185+.42);float v=clamp(.055+d.y*.95,0.,.99);
     vec3 paint=texture2D(horizon,vec2(u+time*.00012*max(0.,d.y),v)).rgb;
     vec3 underwater=vec3(.008,.065,.072)+vec3(.01,.04,.045)*max(d.y,0.);
     gl_FragColor=vec4(mix(underwater,paint*1.25,aboveWater),1.);
     #include <colorspace_fragment>
    }` }));
  this.root.name='tideline_refinery_horizon';this.root.renderOrder=-990;this.root.frustumCulled=false;
 }
 update(camera:THREE.Camera,waterLevel=0,time=0):void {
  this.root.position.copy(camera.position);this.aboveWater.value=THREE.MathUtils.smoothstep(camera.position.y-waterLevel,-3,2);this.time.value=time;
 }
}
