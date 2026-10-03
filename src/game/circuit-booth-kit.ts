import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {CourseKind} from './course';

const BOOTH_MAPS = new Set<CourseKind>(['greenwater', 'bitterpan', 'nightshift']);
const VARIANTS = ['cafe', 'market', 'service'] as const;
const ROLES = ['paint', 'metal', 'chrome', 'fabric', 'glow'] as const;

/** Original Blender meshes with shared geometry/materials for scenery batching.
 * The loaded kit owns GPU resources; clones only provide placement transforms. */
export class CircuitBoothKit {
  private readonly geometry = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private disposed = false;

  private constructor(private readonly scene: THREE.Group, kind: CourseKind) {
    // A small local reflection probe describes broad shop lights, independent
    // of scene-wide sky changes. Surface detail still comes from the atlas.
    const width=128,height=64,pixels=new Uint16Array(width*height*4);
    const warmDirection=new THREE.Vector3(.25,.7,-.65).normalize();
    const coolDirection=new THREE.Vector3(-.8,.45,.3).normalize();
    const direction=new THREE.Vector3();
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const latitude=(y/(height-1)-.5)*Math.PI,longitude=x/width*Math.PI*2;
      direction.set(Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),Math.cos(latitude)*Math.sin(longitude));
      const warm=10*Math.exp((direction.dot(warmDirection)-1)/.055)
        +5*Math.exp(-Math.pow((direction.y-.55)/.13,2));
      const cool=5*Math.exp((direction.dot(coolDirection)-1)/.1);
      const index=(y*width+x)*4;
      [.035+warm+cool*.55,.05+warm*.72+cool*.75,.08+warm*.48+cool,1]
        .forEach((value,channel)=>pixels[index+channel]=THREE.DataUtils.toHalfFloat(value));
    }
    const reflection=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat,THREE.HalfFloatType);
    reflection.mapping=THREE.EquirectangularReflectionMapping;reflection.colorSpace=THREE.LinearSRGBColorSpace;
    reflection.needsUpdate=true;this.textures.add(reflection);
    scene.updateMatrixWorld(true);
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      this.geometry.add(node.geometry);
      const material = node.material as THREE.MeshStandardMaterial;
      if (this.materials.has(material)) return;
      this.materials.add(material);
      if (material.map) {
        this.textures.add(material.map);
        material.map.anisotropy = 4;
      }
      if (material.emissiveMap) this.textures.add(material.emissiveMap);
      if (material.name === 'paint') {
        material.color.set(kind === 'greenwater' ? 0x639c89 : kind === 'bitterpan' ? 0xd1aa73 : 0x65778c);
        material.roughness = .58;
      }
      if (material.name === 'glow') {
        material.emissiveIntensity = 1.1;
        material.toneMapped = false;
        // glTF vertex colors tint base color, but not emission. The authored
        // peach lanterns, cyan screen and pink trim must tint both channels.
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb;');
        };
        material.customProgramCacheKey = () => 'booth-colored-emission';
      }
      if (material.name === 'metal') {
        material.metalness = .18;
        material.roughness = .5;
      }
      if (material.name === 'chrome') {
        material.color.set(0x8993a0);
        material.metalness = .85;
        material.roughness = .24;
        material.envMap=reflection;material.envMapIntensity=.8;
      }
      if (material.name === 'fabric' && kind === 'greenwater') material.color.set(0xa8d4a4);
    });
  }

  static async load(kind: CourseKind): Promise<CircuitBoothKit | null> {
    if (!BOOTH_MAPS.has(kind)) return null;
    const gltf = await new GLTFLoader().loadAsync('/assets/circuit-booths/booths.glb');
    const kit = new CircuitBoothKit(gltf.scene, kind);
    const required = [...VARIANTS.flatMap(variant => ROLES.map(role => `${variant}_${role}`)), 'rotor_metal'];
    if (required.some(name => !(gltf.scene.getObjectByName(name) instanceof THREE.Mesh))) {
      kit.dispose();
      throw new Error('Circuit booth asset is missing an authored mesh');
    }
    return kit;
  }

  create(variant: number): THREE.Group {
    const group = new THREE.Group();
    for (const role of ROLES) group.add(this.scene.getObjectByName(`${VARIANTS[variant]}_${role}`)!.clone());
    return group;
  }

  createRotor(): THREE.Object3D {
    return this.scene.getObjectByName('rotor_metal')!.clone();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometry) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.scene.clear();
  }
}
