import * as THREE from "three";
import type { TidelineCourse } from "./tideline-course";
import route from "./data/tideline/route.json";
import type { RaceEnvironment, RaceEnvironmentStats } from "./environment";
import { disposeObject3DResources } from "./graphics-resources";
import { NeonEnvironment } from "./neon-environment";
import { resolveReducedMotion } from "./query-probes";

/** Marine scenery, with the transparent water and glass kept outside the GLB's opaque batches. */
export class TidelineEnvironment implements RaceEnvironment {
  readonly root: THREE.Group;
  readonly stats: RaceEnvironmentStats;
  private readonly clock = { value: 0 };
  private readonly waterLevel = { value: 0 };
  private readonly steam: THREE.Points;
  private readonly reducedMotion = resolveReducedMotion();
  private lastTime = performance.now();
  private readonly ocean: THREE.Mesh;
  private readonly glass: THREE.Mesh;
  private readonly bubbles: THREE.Points;
  private readonly extraTriangles: number;
  private constructor(private readonly scenery: NeonEnvironment,
    private readonly waterTexture: THREE.Texture, private readonly course?: TidelineCourse) {
    this.root = scenery.root;
    this.ocean = this.createOcean();
    this.root.add(this.ocean);
    this.glass = this.createAqueductGlass();
    this.root.add(this.glass);
    this.steam = this.createSteam();
    this.root.add(this.steam);
    this.installLampResponse();
    this.bubbles = this.createBubbles();
    this.root.add(this.bubbles);
    this.extraTriangles = (this.ocean.geometry.index!.count + this.glass.geometry.index!.count) / 3;
    this.stats = scenery.stats;
    this.stats.meshes += 4;
    this.stats.materials += 4;
    this.stats.textures += 1;
    this.stats.triangles += this.extraTriangles;
  }

  static async load(course?: TidelineCourse): Promise<TidelineEnvironment> {
    const [sceneryResult, waterResult] = await Promise.allSettled([
      NeonEnvironment.load({
        rootName: "tideline_pump_works",
        modelUrl: "/assets/tideline-foundry/foundry_world.glb",
        lightsUrl: "/assets/tideline-foundry/lights.json",
        maximumDistance: 200,
        opticalEffects: false,
        lightIntensity: 65,
        colors: { GW_MAT_emissive: 0xf0b45c },
      }),
      new THREE.TextureLoader().loadAsync("/assets/tideline-foundry/textures/water.jpg"),
    ]);
    if (sceneryResult.status === "rejected" || waterResult.status === "rejected") {
      if (sceneryResult.status === "fulfilled") disposeObject3DResources(sceneryResult.value.root);
      if (waterResult.status === "fulfilled") waterResult.value.dispose();
      throw new Error("Tideline scenery or painted water could not be loaded.");
    }
    waterResult.value.colorSpace = THREE.SRGBColorSpace;
    waterResult.value.wrapS = waterResult.value.wrapT = THREE.RepeatWrapping;
    return new TidelineEnvironment(sceneryResult.value, waterResult.value, course);
  }

  updateVisibility(camera: THREE.Camera): void {
    this.scenery.updateVisibility(camera);
    const now = performance.now();
    const delta = Math.max(0, Math.min(.05, (now - this.lastTime) / 1000));
    this.lastTime = now;
    if (!this.reducedMotion) this.clock.value = this.course ? this.course.tide.elapsed : this.clock.value + delta;
    this.waterLevel.value = this.course?.tide.waterLevel ?? 0;
    this.ocean.position.y = this.waterLevel.value;
    this.steam.visible = !this.reducedMotion && this.waterLevel.value < -3;
    this.bubbles.visible = camera.position.y < this.waterLevel.value - 1 && !this.reducedMotion;
    this.bubbles.position.copy(camera.position);
    this.stats.visibleGroups += 2 + Number(this.bubbles.visible) + Number(this.steam.visible);
    this.stats.visibleTriangles += this.extraTriangles;
  }

  private installLampResponse(): void {
    const seen=new Set<THREE.Material>();
    this.root.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const material=object.material as THREE.MeshLambertMaterial;
      if(!material.name.includes("emissive")||seen.has(material))return;
      seen.add(material);
      material.onBeforeCompile=shader=>{
        shader.uniforms.tideWaterLevel=this.waterLevel;shader.uniforms.tideLampTime=this.clock;
        shader.vertexShader="varying float vTideLampHeight;\n"+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvTideLampHeight=(modelMatrix*vec4(transformed,1.)).y;");
        shader.fragmentShader="varying float vTideLampHeight; uniform float tideWaterLevel; uniform float tideLampTime;\n"+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace("#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\nfloat exposed=smoothstep(-.4,.4,vTideLampHeight-tideWaterLevel);\ntotalEmissiveRadiance*=mix(.18,1.,exposed)*(1.-.12*sin(tideLampTime*8.+vTideLampHeight));");
      };
      material.customProgramCacheKey=()=>"tideline-waterline-lamps";
    });
  }
  private createSteam(): THREE.Points {
    const positions:number[]=[];
    for(const progress of [.035,.325,.645]) {
      const s=route.stations[Math.floor(progress*route.count)];
      const t=new THREE.Vector3(...s.t as [number,number,number]);const right=t.cross(new THREE.Vector3(0,1,0)).normalize();
      for(let i=0;i<28;i++)positions.push(s.p[0]+right.x*25+(i%4)*.23,s.p[1]+10+(i/28)*8,s.p[2]+right.z*25+(i%3)*.21);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    const material=new THREE.ShaderMaterial({uniforms:{time:this.clock},transparent:true,depthWrite:false,
      vertexShader:`uniform float time;varying float fade;
        void main(){vec3 p=position;p.y+=mod(time*.7+position.y,6.);p.x+=sin(time*.2+position.y)*.7;
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(900./max(1.,-mv.z),2.,24.);fade=1.-mod(time*.7+position.y,6.)/6.;}`,
      fragmentShader:`varying float fade;void main(){float a=pow(max(0.,1.-length(gl_PointCoord-.5)*2.),2.);gl_FragColor=vec4(.48,.52,.43,a*fade*.12);}`});
    const steam=new THREE.Points(geometry,material);steam.name="tideline_pump_steam";steam.frustumCulled=false;return steam;
  }

  private createOcean(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(1800, 1800, 64, 64);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), tidelineTime: this.clock, foundry: { value: 1 }, waterAtlas: { value: this.waterTexture }, waterLevel: this.waterLevel }, fog:true,
      vertexShader: `
        uniform float tidelineTime;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec3 p=position;
          p.y += sin(p.x*.031+tidelineTime*.15)*.18+sin(p.z*.023-tidelineTime*.11)*.12;
          vWorld=(modelMatrix*vec4(p,1.0)).xyz;
          vec4 mvPosition=modelViewMatrix*vec4(p,1.0);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float tidelineTime;
        uniform float foundry; uniform sampler2D waterAtlas; uniform float waterLevel;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec2 p=vWorld.xz*.075+vec2(tidelineTime*.025,-tidelineTime*.019);
          float ripple=sin(p.x+sin(p.y*.67))*sin(p.y+sin(p.x*.8));
          float light=pow(max(0.0,ripple),8.0);
          float below=1.0-step(waterLevel,cameraPosition.y);
          vec3 upper=mix(vec3(.013,.053,.074),vec3(.042,.12,.14),ripple*.5+.5);
          vec3 lower=vec3(.026,.14,.17)+light*vec3(.018,.10,.11);
          upper=mix(upper,mix(vec3(.035,.048,.023),vec3(.074,.10,.043),ripple*.5+.5),foundry);
          lower=mix(lower,vec3(.064,.11,.047)+light*vec3(.023,.027,.010),foundry);
          vec2 aUv=fract(vWorld.xz*.012+vec2(tidelineTime*.003,-tidelineTime*.002));
          vec2 bUv=fract(vWorld.xz*.019+vec2(-tidelineTime*.002,tidelineTime*.0015));
          vec3 paint=mix(texture2D(waterAtlas,aUv*.48+.01).rgb,texture2D(waterAtlas,bUv*.48+vec2(.51,.01)).rgb,.35);
          vec3 color=paint*(.8+light*.16)+mix(upper,lower,below)*.28;
          float alpha=mix(.82,.48,below);
          gl_FragColor=vec4(color,alpha);
          #include <fog_fragment>
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
      if (a.mode !== "submerged") continue;
      if (progress > .035 && progress < .105 || progress > .215 && progress < .29) continue;
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
      uniforms: { glassTint: { value: new THREE.Vector3(.13,.17,.085) } },
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
