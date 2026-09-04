import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import route from "./data/tideline/route.json";
import type { RaceEnvironment, RaceEnvironmentStats } from "./environment";
import { disposeObject3DResources } from "./graphics-resources";
import { NeonEnvironment } from "./neon-environment";
import { resolveReducedMotion } from "./query-probes";
import { isFoundryEdition } from "./tideline-style";

/** Marine scenery, with the transparent water and glass kept outside the GLB's opaque batches. */
export class TidelineEnvironment implements RaceEnvironment {
  readonly root: THREE.Group;
  readonly stats: RaceEnvironmentStats;
  private readonly clock = { value: 0 };
  private readonly reducedMotion = resolveReducedMotion();
  private lastTime = performance.now();
  private readonly ocean: THREE.Mesh;
  private readonly glass: THREE.Mesh;
  private readonly bubbles: THREE.Points;
  private readonly extraTriangles: number;
  private readonly signs: { mesh: THREE.Mesh; sphere: THREE.Sphere; triangles: number }[] = [];
  private readonly signFrustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();

  private constructor(private readonly scenery: NeonEnvironment, signage: THREE.Group,
    private readonly foundry = false) {
    this.root = scenery.root;
    this.root.add(signage);
    this.ocean = this.createOcean();
    this.root.add(this.ocean);
    this.glass = this.createAqueductGlass();
    this.root.add(this.glass);
    this.bubbles = this.createBubbles();
    this.root.add(this.bubbles);
    this.extraTriangles = (this.ocean.geometry.index!.count + this.glass.geometry.index!.count) / 3;
    this.stats = scenery.stats;
    this.stats.meshes += 3;
    this.stats.materials += 3;
    this.stats.triangles += this.extraTriangles;
    this.prepareSigns(signage);
  }

  static async load(): Promise<TidelineEnvironment> {
    const foundry = isFoundryEdition;
    const [sceneryResult, signageResult] = await Promise.allSettled([NeonEnvironment.load({
      rootName: foundry ? "tideline_foundry_seascape" : "tideline_blender_seascape",
      modelUrl: foundry ? "/assets/tideline-foundry/foundry_world.glb" : "/assets/tideline/tideline_world.glb",
      lightsUrl: foundry ? "/assets/tideline-foundry/lights.json" : "/assets/tideline/lights.json",
      maximumDistance: foundry ? 200 : undefined,
      opticalEffects: !foundry,
      lightIntensity: foundry ? 65 : 100,
      colors: {
        GW_MAT_emissive: 0xf0b45c,
        TL_aqueduct_cyan: 0x70dbe2,
        TL_port_amber: 0xffbe77,
        TL_navigation_white: 0xc0e5db,
        TL_living_teal: 0x61c6aa,
        TL_crown_violet: 0x9b7fff,
      },
    }), foundry ? Promise.resolve({ scene: new THREE.Group() })
      : new GLTFLoader().loadAsync("/assets/tideline/signage.glb")]);
    if (sceneryResult.status === "rejected" || signageResult.status === "rejected") {
      if (sceneryResult.status === "fulfilled") disposeObject3DResources(sceneryResult.value.root);
      if (signageResult.status === "fulfilled") disposeObject3DResources(signageResult.value.scene);
      throw new Error("Tideline scenery or environmental signage could not be loaded.");
    }
    try {
      return new TidelineEnvironment(sceneryResult.value, signageResult.value.scene, foundry);
    } catch (error) {
      disposeObject3DResources(sceneryResult.value.root);
      throw error;
    }
  }

  updateVisibility(camera: THREE.Camera): void {
    this.scenery.updateVisibility(camera);
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.signFrustum.setFromProjectionMatrix(this.projection);
    for (const sign of this.signs) {
      sign.mesh.visible = this.signFrustum.intersectsSphere(sign.sphere);
      if (sign.mesh.visible) {
        this.stats.visibleGroups++;
        this.stats.visibleTriangles += sign.triangles;
      }
    }
    const now = performance.now();
    const delta = Math.max(0, Math.min(.05, (now - this.lastTime) / 1000));
    this.lastTime = now;
    if (!this.reducedMotion) this.clock.value += delta;
    this.bubbles.visible = camera.position.y < -1 && !this.reducedMotion;
    this.bubbles.position.copy(camera.position);
    this.stats.visibleGroups += this.bubbles.visible ? 3 : 2;
    this.stats.visibleTriangles += this.extraTriangles;
  }

  private prepareSigns(signage: THREE.Group): void {
    signage.name = "tideline_pelagic_authority_signs";
    signage.updateMatrixWorld(true);
    const replacements = new Map<THREE.Material, THREE.MeshLambertMaterial>();
    const textures = new Set<THREE.Texture>();
    const replace = (source: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial => {
      let material = replacements.get(source);
      if (!material) {
        material = new THREE.MeshLambertMaterial({ name: source.name, color: source.color,
          map: source.map, emissive: source.emissive, emissiveMap: source.emissiveMap,
          emissiveIntensity: source.emissiveIntensity, side: source.side });
        replacements.set(source, material);
        for (const texture of [source.map, source.emissiveMap]) {
          if (!texture) continue;
          texture.anisotropy = 2;
          textures.add(texture);
        }
      }
      return material;
    };
    signage.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map(material => replace(material as THREE.MeshStandardMaterial))
        : replace(object.material as THREE.MeshStandardMaterial);
      object.geometry.computeBoundingSphere();
      const triangles = (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
      this.signs.push({ mesh: object, triangles,
        sphere: object.geometry.boundingSphere!.clone().applyMatrix4(object.matrixWorld) });
      this.stats.meshes++;
      this.stats.triangles += triangles;
    });
    for (const source of replacements.keys()) source.dispose();
    this.stats.materials += replacements.size;
    this.stats.textures += textures.size;
  }

  private createOcean(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(2200, 2200, 32, 32);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: { tidelineTime: this.clock, foundry: { value: this.foundry ? 1 : 0 } },
      vertexShader: `
        uniform float tidelineTime;
        varying vec3 vWorld;
        void main() {
          vec3 p=position;
          p.y += sin(p.x*.031+tidelineTime*.15)*.18+sin(p.z*.023-tidelineTime*.11)*.12;
          vWorld=(modelMatrix*vec4(p,1.0)).xyz;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
        }`,
      fragmentShader: `
        uniform float tidelineTime;
        uniform float foundry;
        varying vec3 vWorld;
        void main() {
          vec2 p=vWorld.xz*.075+vec2(tidelineTime*.025,-tidelineTime*.019);
          float ripple=sin(p.x+sin(p.y*.67))*sin(p.y+sin(p.x*.8));
          float light=pow(max(0.0,ripple),8.0);
          float below=1.0-step(0.0,cameraPosition.y);
          vec3 upper=mix(vec3(.013,.053,.074),vec3(.042,.12,.14),ripple*.5+.5);
          vec3 lower=vec3(.026,.14,.17)+light*vec3(.018,.10,.11);
          upper=mix(upper,mix(vec3(.035,.048,.023),vec3(.074,.10,.043),ripple*.5+.5),foundry);
          lower=mix(lower,vec3(.064,.11,.047)+light*vec3(.023,.027,.010),foundry);
          vec3 color=mix(upper,lower,below);
          float alpha=mix(.82,.48,below);
          gl_FragColor=vec4(color,alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "tideline_water_surface";
    mesh.renderOrder = 1;
    return mesh;
  }

  private createAqueductGlass(): THREE.Mesh {
    const positions: number[] = [], indices: number[] = [];
    const sections = 14;
    for (let i = 0; i < route.count; i++) {
      const a = route.stations[i], b = route.stations[(i + 1) % route.count];
      const progress = i / route.count;
      if (a.mode !== "submerged" && !(progress > .89 && progress < .95)) continue;
      const first = positions.length / 3;
      for (const station of [a, b]) {
        const tangent = new THREE.Vector3(...station.t as [number, number, number]);
        const right = new THREE.Vector3().crossVectors(tangent, THREE.Object3D.DEFAULT_UP).normalize();
        for (let ring = 0; ring <= sections; ring++) {
          const angle = Math.PI - ring / sections * Math.PI;
          const lateral = 16.8 * Math.cos(angle);
          const height = 4 + 14.8 * Math.sin(angle);
          positions.push(station.p[0] + right.x * lateral, station.p[1] + height,
            station.p[2] + right.z * lateral);
        }
      }
      for (let ring = 0; ring < sections; ring++) {
        const left = first + ring, right = left + sections + 1;
        indices.push(left, right, right + 1, left, right + 1, left + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.ShaderMaterial({
      uniforms: { glassTint: { value: new THREE.Vector3(...(this.foundry ? [.13,.17,.085] : [.075,.20,.22])) } },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vView;
        void main() {
          vec4 p=modelViewMatrix*vec4(position,1.0);
          vNormal=normalize(normalMatrix*normal); vView=-p.xyz;
          gl_Position=projectionMatrix*p;
        }`,
      fragmentShader: `
        uniform vec3 glassTint;
        varying vec3 vNormal; varying vec3 vView;
        void main() {
          float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),2.0);
          gl_FragColor=vec4(glassTint,.015+rim*.075);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "tideline_aqueduct_glazing";
    mesh.renderOrder = 2;
    return mesh;
  }

  private createBubbles(): THREE.Points {
    const positions = new Float32Array(210 * 3);
    let seed = 508;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (random() - .5) * 85;
      positions[i + 1] = (random() - .5) * 42;
      positions[i + 2] = (random() - .5) * 85;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: { tidelineTime: this.clock },
      vertexShader: `
        uniform float tidelineTime; varying float vFade;
        void main() {
          vec3 p=position;
          p.y=mod(p.y+21.0+tidelineTime*.8,42.0)-21.0;
          p.x+=sin(tidelineTime*.12+p.z*.25)*.4;
          vec4 mv=modelViewMatrix*vec4(p,1.0);
          vFade=smoothstep(2.0,7.0,-mv.z)*(1.0-smoothstep(26.0,44.0,-mv.z));
          gl_PointSize=clamp(95.0/max(1.0,-mv.z),1.0,4.0);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `
        varying float vFade;
        void main() {
          float r=length(gl_PointCoord-.5)*2.0;
          float ring=smoothstep(.38,.63,r)*(1.0-smoothstep(.72,1.0,r));
          gl_FragColor=vec4(.53,.86,.86,ring*vFade*.20);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = "tideline_suspended_bubbles";
    points.frustumCulled = false;
    return points;
  }
}
