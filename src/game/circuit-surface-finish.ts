import * as THREE from 'three';
import type {RaceCourse} from './course';
import {activeRenderMode} from './render-mode.js';

const ROAD_MESHES=new Set([
  'map02_route_deck_read_surface','nightshift_rain_polished_asphalt','polarity_rain_polished_asphalt',
  'tideline_rain_polished_asphalt','tideline_pump_hall_shortcut_road',
  'ascension_painted_concrete_road','ascension_trench_road',
]);
const ROAD_MATERIALS=new Set(['GW_MAT_concrete','DI_MAT_concrete','afterglow_road_surface','frostline_road_surface']);

/** World-scale aggregate preserves authored paint, wetness and snow shaders.
 * One selected-map texture; no fullscreen pass or added lights. */
export async function finishCircuitSurfaces(course:RaceCourse,environment:THREE.Object3D,cancelled:()=>boolean):Promise<void>{
  if(new URLSearchParams(location.search).get('surfaceFinish')==='0'||course.group.userData.surfaceFinish)return;
  const texture=await new THREE.TextureLoader().loadAsync('/assets/surface-finish/aggregate.jpg');
  if(cancelled()){texture.dispose();return;}
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=8;
  const pixelMode=activeRenderMode()==='ps2';
  if(pixelMode){texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.anisotropy=1;}
  // Sample as scalar variation, not replacement albedo; each map retains its palette.
  texture.colorSpace=THREE.NoColorSpace;texture.name='circuit_world_aggregate';
  const materials=new Set<THREE.Material>();let meshes=0,owners=0;
  const stats={meshes:0,materials:0,textures:1,drainInstances:0,disposed:false};
  const patch=(mesh:THREE.Mesh)=>{
    const material=mesh.material as THREE.Material;
    if(Array.isArray(mesh.material)||mesh instanceof THREE.InstancedMesh)return;
    if(!ROAD_MESHES.has(mesh.name)&&!ROAD_MATERIALS.has(material.name))return;
    meshes++;
    if(materials.has(material))return;
    if(mesh.name==='nightshift_rain_polished_asphalt'||mesh.name==='polarity_rain_polished_asphalt')finishCityRoad(mesh);
    materials.add(material);owners++;
    const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material);
    // Store the old key now: the default key reads onBeforeCompile dynamically.
    const oldKey=cache();
    material.onBeforeCompile=(shader,renderer)=>{
      previous.call(material,shader,renderer);
      // Keep our texture outside material.uniforms: its sole owner is the
      // ref-counted disposal below, not the generic scene-resource traversal.
      shader.uniforms={...shader.uniforms,surfaceAggregate:{value:texture}};
      const declarations='varying vec3 finishWorld;\n';
      shader.vertexShader=declarations+shader.vertexShader;
      if(shader.vertexShader.includes('#include <begin_vertex>')){
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfinishWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
      }else{
        shader.vertexShader=shader.vertexShader.replace(/void main\(\)\s*\{/, 'void main(){ finishWorld=(modelMatrix*vec4(position,1.)).xyz;');
      }
      shader.fragmentShader='uniform sampler2D surfaceAggregate;\n'+declarations+shader.fragmentShader;
      const detail=`
        float aggregate=texture2D(surfaceAggregate,finishWorld.xz*.25).r;
        float broadWear=texture2D(surfaceAggregate,finishWorld.zx*.053+vec2(.31,.17)).r;
        float nearDetail=1.-smoothstep(45.,180.,distance(cameraPosition,finishWorld));
        float surfaceGain=1.+((aggregate-.45)*.85+(broadWear-.45)*.35)*nearDetail;
      `;
      if(shader.fragmentShader.includes('#include <opaque_fragment>')){
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',detail+'\noutgoingLight*=surfaceGain;\n#include <opaque_fragment>');
      }else if(shader.fragmentShader.includes('#include <fog_fragment>')){
        shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',detail+'\ngl_FragColor.rgb*=surfaceGain;\n#include <fog_fragment>');
      }else throw new Error(`Unsupported road shader: ${material.name||mesh.name}`);
    };
    material.customProgramCacheKey=()=>oldKey+'|world-aggregate-v1';material.needsUpdate=true;
    const mapped=material as THREE.MeshStandardMaterial;
    if(mapped.map&&!pixelMode){mapped.map.anisotropy=Math.max(mapped.map.anisotropy,8);mapped.map.needsUpdate=true;}
    const release=()=>{material.removeEventListener('dispose',release);if(--owners===0){texture.dispose();stats.disposed=true;}};
    material.addEventListener('dispose',release);
  };
  for(const root of [course.group,environment])root.traverse(node=>{if(node instanceof THREE.Mesh)patch(node);});
  if(!owners){texture.dispose();stats.textures=0;stats.disposed=true;}
  stats.meshes=meshes;stats.materials=materials.size;
  course.group.userData.surfaceFinish=stats;
  const drains=buildServiceDrains(course);course.group.add(drains);
  stats.drainInstances=drains.count;
}

/** Keep district tint and road paint, but let overpasses/ships cast real shadows
 * and make the wet response depend on the viewing angle. */
function finishCityRoad(mesh:THREE.Mesh):void {
  const material=mesh.material as THREE.ShaderMaterial;
  material.lights=true;mesh.receiveShadow=true;
  Object.assign(material.uniforms,THREE.UniformsUtils.clone(THREE.UniformsLib.lights));
  material.vertexShader='#include <common>\n#include <shadowmap_pars_vertex>\n'+material.vertexShader;
  material.vertexShader=material.vertexShader.replace('#include <fog_vertex>',`vec4 worldPosition=vec4(vWorld,1.);
    vec3 transformedNormal=normalMatrix*normal;
    #include <shadowmap_vertex>
    #include <fog_vertex>`);
  material.fragmentShader='#include <common>\nuniform bool receiveShadow;\n#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>\n'+material.fragmentShader;
  material.fragmentShader=material.fragmentShader.replace('float reflection=', 'float wetFresnel=pow(1.-abs(normalize(cameraPosition-vWorld).y),3.);\nfloat reflection=');
  material.fragmentShader=material.fragmentShader.replace('(.03+reflection*.055)*(.25+side)','(.018+reflection*.035)*(.25+side)*(.35+wetFresnel)');
  material.fragmentShader=material.fragmentShader.replace('#include <fog_fragment>','gl_FragColor.rgb*=mix(.52,1.,getShadowMask());\n#include <fog_fragment>');
  material.userData.cityShadowReceiver=true;
}

// Low-profile service grates sit inside the existing road edge. Bitterpan's
// workshop sectors use a dust-muted metal finish; wet districts use dark steel.
const DRAIN_SITES:Record<RaceCourse['kind'],readonly number[]>={
  greenwater:[.08,.16,.23,.52,.69,.84],bitterpan:[.13,.26,.42,.64,.81,.93],
  nightshift:[.08,.2,.34,.49,.65,.75,.88],polarity:[.05,.10,.38,.52,.76,.89],
  tideline:[.08,.19,.42,.57,.72,.91],ascension:[.07,.22,.34,.58,.88,.96],
  dreamisland:[.07,.16,.29,.63,.78,.91],afterglow:[.06,.17,.32,.49,.66,.81,.94],
  frostline:[.02,.06,.11,.83,.91,.96],
};

function buildServiceDrains(course:RaceCourse):THREE.InstancedMesh{
  const positions=DRAIN_SITES[course.kind],geometry=new THREE.BoxGeometry(1,1,1);
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8,metalness:.25});
  const steel=new THREE.Color(course.kind==='bitterpan'?0x706658:0x35434a),recess=new THREE.Color(0x090d10);
  const edgeInset=course.kind==='greenwater'?.63:course.kind==='frostline'?1.8:1.2;
  const deckLift=course.kind==='bitterpan'?.05:.015;
  // Dark backing, two rails and seven crossbars (including closed end caps).
  // One geometry/material/draw for a whole circuit.
  const parts=10,mesh=new THREE.InstancedMesh(geometry,material,positions.length*2*parts);
  geometry.addEventListener('dispose',()=>mesh.dispose());
  mesh.name='circuit_service_drainage';mesh.receiveShadow=true;
  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),basis=new THREE.Matrix4();let cursor=0;
  for(const progress of positions){
    const sample=course.sample(progress);basis.makeBasis(sample.right,sample.up,sample.tangent.clone().negate());rotation.setFromRotationMatrix(basis);
    for(const side of [-1,1])for(let part=0;part<parts;part++){
      const backing=part===0,rail=part===1||part===2;
      const lateral=side*(sample.halfWidth-edgeInset)+(rail?(part===1?-.29:.29):0);
      const along=backing||rail?0:(part-6)*.325;
      const lift=deckLift+(backing?.006:.025);
      const p=sample.position.clone().addScaledVector(sample.right,lateral).addScaledVector(sample.tangent,along).addScaledVector(sample.up,lift);
      matrix.compose(p,rotation,new THREE.Vector3(backing?.67:rail?.065:.6,backing?.012:.02,backing||rail?2.08:.075));
      mesh.setMatrixAt(cursor,matrix);mesh.setColorAt(cursor++,backing?recess:steel);
    }
  }
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();return mesh;
}
