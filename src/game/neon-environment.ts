import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { RaceEnvironment, RaceEnvironmentStats } from "./environment";
import { disposeObject3DResources } from "./graphics-resources";

export interface NeonLamp {
  p: [number, number, number];
  color: string;
  size: number;
  ground: number;
}

const LIGHT_COUNT = 4;
export interface NeonEnvironmentOptions {
  rootName: string;
  modelUrl: string;
  lightsUrl: string;
  colors: Record<string, number>;
  maximumDistance?: number;
  opticalEffects?: boolean;
  lightIntensity?: number;
  preferLightsAhead?: boolean;
}

export class NeonEnvironment implements RaceEnvironment {
  readonly root: THREE.Group;
  readonly stats: RaceEnvironmentStats;
  private readonly lamps: {position:THREE.Vector3;color:THREE.Color}[];
  private readonly lights = Array.from({length:LIGHT_COUNT},()=>new THREE.PointLight(0xffffff,100,38,2));
  private readonly distances = new Float64Array(LIGHT_COUNT);
  private readonly nearest = new Int32Array(LIGHT_COUNT);
  private readonly groups: {mesh:THREE.Mesh;sphere:THREE.Sphere;triangles:number}[]=[];
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly forward = new THREE.Vector3();
  private readonly lampOffset = new THREE.Vector3();

  private constructor(root:THREE.Group, lamps:NeonLamp[], private readonly options:NeonEnvironmentOptions) {
    this.root=root;
    this.root.name=options.rootName;
    const replacements=new Map<THREE.Material,THREE.MeshLambertMaterial>();
    const textures=new Set<THREE.Texture>();
    root.updateMatrixWorld(true);
    root.traverse(object=>{
      if(!(object instanceof THREE.Mesh)) return;
      const source=object.material as THREE.MeshStandardMaterial;
      let material=replacements.get(source);
      if(!material) {
        material=new THREE.MeshLambertMaterial({ name:source.name, color:source.color,
          map:source.map, emissive:source.emissive, emissiveMap:source.emissiveMap,
          vertexColors:source.vertexColors, emissiveIntensity:source.emissiveIntensity,
          side:source.side, alphaTest:source.alphaTest,
          transparent:source.transparent, opacity:source.opacity });
        if(source.map) {
          source.map.magFilter=THREE.LinearFilter;
          source.map.minFilter=THREE.LinearMipmapLinearFilter;
          source.map.anisotropy=2;
          textures.add(source.map);
        }
        replacements.set(source,material);
      }
      object.material=material;
      object.geometry.computeBoundingSphere();
      const sphere=object.geometry.boundingSphere!.clone().applyMatrix4(object.matrixWorld);
      const triangles=(object.geometry.index?.count??object.geometry.getAttribute("position").count)/3;
      this.groups.push({mesh:object,sphere,triangles});
    });
    for(const material of replacements.keys()) material.dispose();
    this.lamps=lamps.map(l=>({position:new THREE.Vector3(...l.p),color:new THREE.Color(this.options.colors[l.color]??0xb4e7cc)}));
    this.root.add(...this.lights);
    if(options.opticalEffects!==false)this.root.add(this.makeHalos(lamps),this.makeReflections(lamps));
    this.stats={meshes:this.groups.length,triangles:this.groups.reduce((n,g)=>n+g.triangles,0),
      materials:replacements.size,textures:textures.size,visibleGroups:0,visibleTriangles:0,
      shaderModel:"lambert",signageSource:"baked",contractDrift:[]};
  }
  static async load(options:NeonEnvironmentOptions):Promise<NeonEnvironment> {
    const [modelResult,lightResult]=await Promise.allSettled([
      new GLTFLoader().loadAsync(options.modelUrl),
      fetch(options.lightsUrl).then(async r=>{
        if(!r.ok)throw new Error(`${options.rootName} light map unavailable`);
        return await r.json() as NeonLamp[];
      }),
    ]);
    if(modelResult.status==="rejected"||lightResult.status==="rejected") {
      if(modelResult.status==="fulfilled")disposeObject3DResources(modelResult.value.scene);
      throw new Error(`${options.rootName} could not be loaded.`);
    }
    return new NeonEnvironment(modelResult.value.scene,lightResult.value,options);
  }
  updateVisibility(camera:THREE.Camera):void {
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.stats.visibleGroups=0;this.stats.visibleTriangles=0;
    for(const group of this.groups) {
      if(group.mesh.name.includes('MOTION_')) {
        group.mesh.updateWorldMatrix(true,false);
        group.sphere.copy(group.mesh.geometry.boundingSphere!).applyMatrix4(group.mesh.matrixWorld);
      }
      group.mesh.visible=this.frustum.intersectsSphere(group.sphere)
        && group.sphere.distanceToPoint(camera.position)<=(this.options.maximumDistance??Infinity);
      if(group.mesh.visible) {this.stats.visibleGroups++;this.stats.visibleTriangles+=group.triangles;}
    }
    this.distances.fill(Infinity);this.nearest.fill(-1);
    camera.getWorldDirection(this.forward);
    for(let index=0;index<this.lamps.length;index++) {
      let distance=camera.position.distanceToSquared(this.lamps[index].position);
      if(this.options.preferLightsAhead && this.lampOffset.copy(this.lamps[index].position).sub(camera.position).dot(this.forward)<-10) distance*=4;
      for(let slot=0;slot<LIGHT_COUNT;slot++) {
        if(distance>=this.distances[slot]) continue;
        for(let shift=LIGHT_COUNT-1;shift>slot;shift--) {
          this.distances[shift]=this.distances[shift-1];this.nearest[shift]=this.nearest[shift-1];
        }
        this.distances[slot]=distance;this.nearest[slot]=index;break;
      }
    }
    for(let i=0;i<LIGHT_COUNT;i++) {
      const lamp=this.lamps[this.nearest[i]];
      // Keep the shader's light count stable as the camera crosses districts.
      this.lights[i].intensity=lamp&&this.distances[i]<65**2?(this.options.lightIntensity??100):0;
      if(lamp) {this.lights[i].position.copy(lamp.position);this.lights[i].color.copy(lamp.color);}
    }
  }
  private makeHalos(lamps:NeonLamp[]):THREE.InstancedMesh {
    const material=new THREE.ShaderMaterial({vertexColors:true,
      vertexShader:`varying vec2 vUv;varying vec3 vTint;
        void main(){vUv=uv;vTint=instanceColor;vec4 p=modelViewMatrix*instanceMatrix*vec4(0,0,0,1);
        p.xy+=position.xy*length(instanceMatrix[0].xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader:`varying vec2 vUv;varying vec3 vTint;
        void main(){float r=length((vUv-.5)*2.0);float a=pow(max(0.0,1.0-r),3.0);
        gl_FragColor=vec4(vTint,a*.42);
        #include <colorspace_fragment>
        }`,
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),material,lamps.length);
    const transform=new THREE.Object3D();
    lamps.forEach((lamp,i)=>{transform.position.set(...lamp.p);transform.scale.setScalar(lamp.size*2);
      transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);mesh.setColorAt(i,new THREE.Color(this.options.colors[lamp.color]??0xb4e7cc));});
    mesh.frustumCulled=false;mesh.name=this.options.rootName+"_neon_halation";return mesh;
  }
  private makeReflections(lamps:NeonLamp[]):THREE.InstancedMesh {
    const material=new THREE.ShaderMaterial({vertexColors:true,
      vertexShader:`varying vec2 vUv;varying vec3 vTint;
        void main(){vUv=uv;vTint=instanceColor;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1);}`,
      fragmentShader:`varying vec2 vUv;varying vec3 vTint;
        void main(){float r=length((vUv-.5)*2.0);float a=pow(max(0.0,1.0-r),2.0);
        float streak=.55+.45*sin(vUv.y*240.0+sin(vUv.x*80.0));
        gl_FragColor=vec4(vTint,a*streak*.11);
        #include <colorspace_fragment>
        }`,
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
    const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),material,lamps.length);
    const transform=new THREE.Object3D();transform.rotation.x=-Math.PI/2;
    lamps.forEach((lamp,i)=>{transform.position.set(lamp.p[0],lamp.ground,lamp.p[2]);
      transform.scale.set(15,24,1);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
      mesh.setColorAt(i,new THREE.Color(this.options.colors[lamp.color]??0xb4e7cc));});
    mesh.name=this.options.rootName+"_neon_puddles";return mesh;
  }
}
