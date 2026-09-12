/**
 * Phase B contract check for the Dream Island painted world.
 *
 * Read-only. Run from the repo root:
 *
 *   node scripts/validate-dreamisland-painted.mjs
 *
 * It asserts, and writes the numbers it asserted into
 * `art/evidence/dreamisland-v1/phase-b/painted-validation.json`:
 *
 *  1. Every focal asset records EXACTLY five named silhouette features, and
 *     every asset that named a target metre lands on it.
 *  2. The runtime's atlas cells and the atlas manifest agree, INCLUDING the V
 *     flip between Blender's bottom-origin V and a `flipY = false` sampler.
 *     That disagreement is a real defect this map already shipped once in a
 *     working tree: the sand road sampled the cyan kerb quadrant and came back
 *     teal at speed, and reading either the manifest or the UV code alone would
 *     never have shown it.
 *  3. No environmental letter exceeds 0.59 m, and every sign carries a measured
 *     clearance.
 *  4. The drivable corridor is clear: an upward ray at every station across the
 *     whole road hits no authored geometry below the vehicle's height. That
 *     covers the watchtower bore, whose 8 m lintel the road passes under, so
 *     the bore is checked with its own taller probe.
 *
 * It does NOT prove the art loaded, drew, or sampled the cell it names. That is
 * `scripts/visual/dreamisland/atlas-proof.mjs` and the soak frames.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceModule} from './visual/dreamisland/modules.mjs';
import {DREAMISLAND_ABILITY_CONFIG} from '../src/game/dreamisland-powers-config.js';
import {dreamIslandHardwareLateral,dreamIslandHardwareYaw,dreamIslandHardwareFoot,dreamIslandHardwareSupport} from '../src/game/dreamisland-hardware-layout.js';

const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const read=name=>JSON.parse(readFileSync(name,'utf8'));
const route=read('src/game/data/dreamisland/route.json');
const painted=read('public/assets/dreamisland/painted.json');
const atlas=read('public/assets/dreamisland/atlas-manifest.json');
const signage=read('public/assets/dreamisland/signage-manifest.json');
const {CELL,QUADRANT,sampled}=await import(await sourceModule('dreamisland-materials.ts'));
const audioPositions=spawnSync(process.execPath,['scripts/prepare-dreamisland-audio-positions.mjs','--check'],{encoding:'utf8'});
assert.equal(audioPositions.status,0,audioPositions.stderr||audioPositions.error?.message||'Dream Island audio anchors do not match painted geometry.');

// --- 1. Five named silhouette features per asset, and the target metres.
const FOCAL=['clock-tower','watchtower-ruin','waterfall-cliff','palm-upright','palm-lean','palm-tall',
 'undergrowth-card-set','goldfish-orange','goldfish-white','goldfish-red','goldfish-gold',
 'stone-causeway-module','reef-pier-module','sea-stack','mossy-block-wall-module','gate-furniture'];
for(const asset of FOCAL)assert.ok(painted.features[asset],`${asset} is missing from painted.json features`);
const featureCounts={};
for(const [asset,features] of Object.entries(painted.features)){
 assert.equal(features.length,5,`${asset} records ${features.length} silhouette features, not five`);
 assert.equal(new Set(features).size,5,`${asset} repeats a feature name`);
 for(const feature of features)assert.ok(feature.trim().length>3,`${asset} has an empty feature name`);
 featureCounts[asset]=features.length;
}
const targets=[];
for(const [asset,record] of Object.entries(painted.assets)){
 const {target,measured}=record;
 if(!target||!measured)continue;
 const rows={heightMetres:measured.heightMetres,widthMetres:measured.widthMetres,
  lengthMetres:measured.depthMetres,roadLengthMetres:measured.depthMetres,dropMetres:measured.heightMetres};
 for(const [key,wanted] of Object.entries(target)){
  if(typeof wanted!=='number'||rows[key]===undefined)continue;
  const got=rows[key];
  assert.ok(Math.abs(got-wanted)<=Math.max(.05,wanted*.01),
   `${asset} ${key}: target ${wanted} m, measured ${got} m`);
  targets.push({asset,key,target:wanted,measured:got});
 }
 if(target.maximumTriangles)assert.ok(record.triangles<=target.maximumTriangles,
  `${asset} is ${record.triangles} triangles against a ${target.maximumTriangles} ceiling`);
}

// --- 2. The runtime cells and the manifest agree, flip included.
const manifestQuadrants=atlas.uvConvention.rects;
const asRect=([u0,v0,u1,v1])=>[u0,v0,u1-u0,v1-v0];
const near=(a,b,label)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-6),`${label}: ${a} versus ${b}`);
for(const name of ['TL','TR','BL','BR'])near([...QUADRANT[name]],asRect(manifestQuadrants[name]),'quadrant '+name);
const NAMED={roadSand:['concrete','road-sand'],causewayPaving:['concrete','causeway-paving'],
 kerbCyan:['concrete','kerb-cyan'],wallBlock:['concrete','wall-block'],rail:['metal','rail'],
 causticShallows:['water','caustic-shallows'],cobaltFacets:['water','cobalt-facets'],
 foamGradient:['water','foam-gradient'],foamGlow:['emissive','foam-glow'],shallowsGlow:['emissive','shallows-glow']};
const cells=[];
for(const [key,[role,cell]] of Object.entries(NAMED)){
 const entry=atlas.roles[role][cell];
 assert.ok(entry,`atlas-manifest.json has no ${role}/${cell}`);
 // The manifest is Blender's bottom-origin V; every sampler on this map runs
 // flipY = false, which is top-origin. `sampled` is the single place that flip
 // is applied, and this is the assertion that keeps it applied.
 near([...CELL[key]],[...sampled(asRect(entry.uv))],`cell ${key} (${role}/${cell})`);
 cells.push({key,role,cell,is:entry.is,manifestUv:entry.uv,sampledRect:[...CELL[key]]});
}
assert.deepEqual(painted.roles,['concrete','metal','jungle','water','signage','emissive'],
 'The six role names are load-bearing in the manifests and must not be renamed.');
assert.deepEqual(painted.maquettes,[]);
assert.equal(painted.maquettesRemovedBeforeWorldExport,true);
assert.equal(painted.route.revision,route.revision,'painted.glb was laid out on a different route revision');

// --- 3. Signage: the 0.59 m environmental letter cap.
assert.ok(signage.signs.length>0,'The signage manifest lists no signs');
for(const sign of signage.signs){
 assert.ok(sign.letterHeightMetres<=.59||sign.gameplaySizeException,
  `${sign.id} ships ${sign.letterHeightMetres} m letters`);
 for(const key of ['progress','side','tile','position','sector','roadFaceClearanceMetres','deckClearanceMetres'])
  assert.ok(sign[key]!==undefined,`${sign.id} is missing ${key}`);
 assert.ok(sign.deckClearanceMetres>0,`${sign.id} stands inside the drivable deck`);
}
assert.equal(signage.flightArcsClear,true);
assert.ok(signage.maximumLetterHeightMetres<=.59);

// --- 4. The drivable corridor, including the watchtower bore.
const file='public/assets/dreamisland/painted.glb',buffer=readFileSync(file);
const jsonLength=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+jsonLength));
// Texture decoding cannot affect a geometric ray; strip it rather than invent a
// browser image decoder in node. Same treatment as the Ascension corridor check.
const binary=buffer.subarray(20+jsonLength+8);
json.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
json.materials=[{doubleSided:true}];delete json.images;delete json.textures;delete json.samplers;
for(const mesh of json.meshes)for(const primitive of mesh.primitives)primitive.material=0;
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,values){this.type=type;Object.assign(this,values);}};
const loadGeometry=async path=>{
 const bytes=readFileSync(path);
 const length=bytes.readUInt32LE(12),document=JSON.parse(bytes.subarray(20,20+length));
 document.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(20+length+8).toString('base64');
 document.materials=[{doubleSided:true}];delete document.images;delete document.textures;delete document.samplers;
 for(const mesh of document.meshes)for(const primitive of mesh.primitives)primitive.material=0;
 return (await new GLTFLoader().parseAsync(JSON.stringify(document),'')).scene;
};
const {scene}=await new GLTFLoader().parseAsync(JSON.stringify(json),'');
// Phase C: the four hero assets left `painted.glb`, and the watchtower is the
// one whose bore the road drives THROUGH. A corridor check against the batched
// island alone would now pass by having nothing there to hit, which is worse
// than failing. Every HERO placement is instanced into the same scene, from the
// same placement list the runtime uses, before a single ray is cast.
const heroFiles=new Map(),heroPlacements=[];
for(const placement of painted.placements){
 if(placement.batch!=='HERO'||!placement.hero?.glb)continue;
 if(!heroFiles.has(placement.hero.glb)){
  heroFiles.set(placement.hero.glb,await loadGeometry('public/assets/dreamisland/'+placement.hero.glb));
 }
 const source=heroFiles.get(placement.hero.glb);
 const subtree=placement.hero.child?source.getObjectByName(placement.hero.child):source;
 assert.ok(subtree,`${placement.asset}: ${placement.hero.glb} has no node named ${placement.hero.child}`);
 const instance=subtree.clone(true);
 if(placement.hero.child){
  // The set's own display translation spreads its four stacks along X; a placed
  // stack stands on its placement instead. Same rule as dreamisland-heroes.ts.
  instance.updateMatrixWorld(true);
  const centre=new THREE.Box3().setFromObject(instance).getCenter(new THREE.Vector3());
  instance.position.sub(new THREE.Vector3(centre.x,0,centre.z));
 }
 const holder=new THREE.Group();
 holder.add(instance);
 holder.position.set(...placement.position);
 holder.rotation.y=placement.yaw;
 const scale=placement.hero.heroScale??placement.scale??1;
 holder.scale.set(scale,scale,scale);
 holder.name='HERO_'+placement.asset;
 scene.add(holder);
 heroPlacements.push({asset:placement.asset,glb:placement.hero.glb,child:placement.hero.child??null,
  position:placement.position,yaw:placement.yaw,scale});
}
assert.ok(heroPlacements.length>0,'painted.json records no HERO placements; the hero swap did not happen.');
// POLISH-3: add the actual verge hardware, closed AND fully open, and the deck
// plates to the same corridor scene before casting its unchanged rays.
const {DreamIslandCourse}=await import(await sourceModule('dreamisland-course.ts'));
const hardwareCourse=new DreamIslandCourse();
const kit=await loadGeometry('public/assets/dreamisland/power-kit.glb');
const hardwarePlacements=[];
for(const pickup of DREAMISLAND_ABILITY_CONFIG.pickups){
 const sample=hardwareCourse.sample(pickup.progress),lateral=dreamIslandHardwareLateral(sample.halfWidth,pickup.lateral??0,hardwareCourse.sectorLabelAt(pickup.progress));
 const {position,groundY}=dreamIslandHardwareFoot(sample,lateral,scene);
 const template=kit.getObjectByName('PK_'+pickup.kind);
 assert.ok(template,'Power kit is missing PK_'+pickup.kind);
 let triangles=0;
 template.traverse(object=>{if(object.isMesh)triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;});
 assert.ok(triangles<=1200,`${pickup.kind} has ${triangles} triangles`);
 for(const open of [false,true]){
  const instance=template.clone(true),holder=new THREE.Group();
  if(open)instance.traverse(object=>{if(object.name.startsWith('PK_shield_hinge_'))object.rotateZ(.70);});
  holder.add(instance);
  const core=template.getObjectByName('PK_'+pickup.kind+'_core');
  assert.ok(core?.isMesh,'Power kit core is missing');
  const lamp=new THREE.Mesh(core.geometry,core.material);
  lamp.matrixAutoUpdate=false;lamp.matrix.makeTranslation(0,.30,-.43).multiply(new THREE.Matrix4().makeScale(.22,.22,.22));
  holder.add(lamp);holder.matrixAutoUpdate=false;
  holder.matrix.makeBasis(sample.right,sample.up,sample.tangent.clone().negate())
   .multiply(new THREE.Matrix4().makeRotationY(dreamIslandHardwareYaw(lateral))).setPosition(position);
  holder.name='POWER_'+pickup.id+(open?'_open':'_closed');scene.add(holder);
 }
 if(groundY===null){
  const support=dreamIslandHardwareSupport(sample,lateral);
  const mesh=new THREE.Mesh(support.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.name='POWER_SUPPORT_'+pickup.id;mesh.matrixAutoUpdate=false;mesh.matrix.copy(support.matrix);scene.add(mesh);
 }
 const plate=new THREE.Mesh(new THREE.BoxGeometry(2.8,.08,3.6),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
 plate.matrixAutoUpdate=false;plate.matrix.makeBasis(sample.right,sample.up,sample.tangent.clone().negate())
  .setPosition(sample.position.clone().addScaledVector(sample.right,pickup.lateral??0).addScaledVector(sample.up,.045));
 plate.name='POWER_PLATE_'+pickup.id;scene.add(plate);
 plate.updateMatrixWorld(true);
 const vertices=plate.geometry.attributes.position,point=new THREE.Vector3();
 let plateTopMetres=-Infinity;
 for(let i=0;i<vertices.count;i++){
  point.fromBufferAttribute(vertices,i).applyMatrix4(plate.matrixWorld).sub(sample.position);
  plateTopMetres=Math.max(plateTopMetres,point.dot(sample.up));
 }
 assert.ok(plateTopMetres<=.3,'Pickup plate must remain below 0.3 m');
 hardwarePlacements.push({id:pickup.id,progress:pickup.progress,triggerLateral:pickup.lateral,
  position:position.toArray(),groundY,hardwareLateral:lateral,lateralOffset:lateral-pickup.lateral,triangles,plateTopMetres});
}
// --- 4a. Phase F ALIVE: the props layer, in the same corridor scene.
//
// `dreamisland-props.ts` builds these at runtime from `props.glb` and throws if
// anything is over the deck below 8.85 m. That check reads the placement data
// and the geometry's own bounding box; this one puts the real meshes into the
// scene the rays are about to sweep, so a prop that reaches over the road is
// caught by the same probe the watchtower is.
const propsData=read('src/game/data/dreamisland/props.json');
const propsGlb=await loadGeometry('public/assets/dreamisland/props.glb');
const propGround=scene.getObjectByName('DI_STATIC_DI_MAT_jungle');
assert.ok(propGround,'Missing painted ground for prop placement');
propGround.updateWorldMatrix(true,false);
const propGroundTop=new THREE.Box3().setFromObject(propGround).max.y+1;
const propRay=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
const propCounts={},propKinds=new Set();
for(const prop of propsData.props){
  const template=propsGlb.getObjectByName(prop.kind);
  assert.ok(template,`props.glb has no node named ${prop.kind}; dreamisland-props.ts instances by name`);
  propKinds.add(prop.kind);
  propCounts[prop.kind]=(propCounts[prop.kind]??0)+1;
  const sample=hardwareCourse.sample(((prop.progress%1)+1)%1);
  const position=sample.position.clone().addScaledVector(sample.right,prop.lateral);
  if(prop.anchor==='water')position.y=propsData.seaLevelMetres+prop.rise;
  else if(prop.anchor==='ground'){
    propRay.set(new THREE.Vector3(position.x,propGroundTop,position.z),new THREE.Vector3(0,-1,0));
    const hit=propRay.intersectObject(propGround,false)[0];
    position.y=(hit?hit.point.y:position.y)+prop.rise;
  }else position.y+=prop.rise;
  const instance=template.clone(true),holder=new THREE.Group();
  holder.add(instance);
  holder.position.copy(position);holder.rotation.y=prop.yaw;
  holder.scale.setScalar(prop.scale);
  holder.name='PROP_'+prop.kind;
  scene.add(holder);
}
// The bollard's lit core rides on every bollard placement, which is a runtime
// rule and not a row of the data; it is instanced here for the same reason.
for(const prop of propsData.props.filter(row=>row.kind==='PR_bollard')){
  const template=propsGlb.getObjectByName('PR_bollard_core');
  assert.ok(template,'props.glb has no node named PR_bollard_core');
  const sample=hardwareCourse.sample(((prop.progress%1)+1)%1);
  const position=sample.position.clone().addScaledVector(sample.right,prop.lateral);
  position.y+=prop.rise;
  const holder=new THREE.Group();holder.add(template.clone(true));
  holder.position.copy(position);holder.rotation.y=prop.yaw;holder.scale.setScalar(prop.scale);
  holder.name='PROP_PR_bollard_core';scene.add(holder);
}
propCounts.PR_bollard_core=propCounts.PR_bollard??0;
assert.deepEqual(propCounts,propsData.counts.PR_bollard_core===undefined
  ?{...propsData.counts,PR_bollard_core:propsData.counts.PR_bollard}:propsData.counts,
  'props.json counts do not match the rows it carries');

scene.updateMatrixWorld(true);
const ray=new THREE.Raycaster(),up=new THREE.Vector3(0,1,0),hits=[];
// The bore's lintel is at 8 m and the road runs under it, so the probe there is
// the bore height rather than the open-air clearance.
const BORE_FROM=.325,BORE_TO=.350,OPEN_CLEARANCE=8.85,BORE_CLEARANCE=7.4,RIDE_HEIGHT=.15;
let samples=0,boreSamples=0;
for(let index=0;index<route.count;index++){
 const station=route.stations[index],progress=index/route.count;
 const point=new THREE.Vector3(...station.p);
 const tangent=new THREE.Vector3(...station.t);
 const right=tangent.clone().cross(up).normalize();
 const inBore=progress>=BORE_FROM&&progress<=BORE_TO;
 if(inBore)boreSamples++;
 for(let lateral=-station.width/2;lateral<=station.width/2;lateral+=2){
  const origin=point.clone().addScaledVector(right,lateral);origin.y+=RIDE_HEIGHT;
  ray.set(origin,up);ray.near=0;ray.far=inBore?BORE_CLEARANCE:OPEN_CLEARANCE;
  const hit=ray.intersectObject(scene,true)[0];samples++;
  if(hit)hits.push({station:index,progress,sector:station.sector,lateral,
   object:hit.object.name,clearance:hit.distance+RIDE_HEIGHT});
 }
}
assert.equal(hits.length,0,'Authored geometry intrudes into the drivable corridor: '
 +JSON.stringify(hits.slice(0,6)));

// --- 4b. LATERAL containment through the watchtower bore.
//
// The upward ray above cannot see this failure at all. Inside solid masonry
// there is no floor and no ceiling: a vertical ray started on a road that runs
// through a wall exits the top of its 7.4 m probe having hit nothing, and the
// check reports a clear corridor. That was verified rather than assumed - the
// hero drum moved 2.6 m sideways over the road still produced zero ray hits.
//
// So the bore is checked as a CONTAINMENT instead: both road edges, over the
// bore's own depth, expressed in the bore's local frame, must lie inside its
// clear half-width. The bore geometry is not guessed either; it is read from
// the hero build's own record.
const heroesRecord=read('public/assets/dreamisland/heroes/heroes.json');
// `heroes.json` is the shipped contract; the hero build's own
// `art/evidence/dreamisland-v1/heroes/loader-check.json` is what proved the
// 14 x 8 x full-depth rectangle is empty of triangles, so this width is a
// verified clear width and not a wish.
const boreRecord=heroesRecord.assets.watchtower.targetMetres;
const borePlacement=painted.placements.find(placement=>placement.asset==='watchtower-ruin');
assert.ok(borePlacement?.hero,'The watchtower is not a hero placement; the bore containment check has nothing to check.');
const boreScale=borePlacement.hero.heroScale??borePlacement.scale??1;
const boreHalfWidth=boreRecord.boreWidth/2*boreScale;
const boreHalfDepth=heroesRecord.assets.watchtower.bounds.size[2]/2*boreScale;
const boreOrigin=new THREE.Vector3(...borePlacement.position);
const boreCos=Math.cos(borePlacement.yaw),boreSin=Math.sin(borePlacement.yaw);
// The bore's local Z band is a slab, not a box, so a station on the far side of
// the island can satisfy |z| <= halfDepth. The run is taken along the ROUTE
// instead: the stations either side of the placement, out to the bore's depth
// plus a station of slack.
let boreStation=0,boreNearest=Infinity;
for(let index=0;index<route.count;index++){
 const distance=new THREE.Vector3(...route.stations[index].p).distanceTo(boreOrigin);
 if(distance<boreNearest){boreNearest=distance;boreStation=index;}
}
const boreSpan=Math.ceil(boreHalfDepth/(route.length/route.count))+1;
let boreMinX=Infinity,boreMaxX=-Infinity,boreEdgeSamples=0;
for(let step=-boreSpan;step<=boreSpan;step++){
 const index=(boreStation+step+route.count)%route.count;
 const station=route.stations[index];
 const point=new THREE.Vector3(...station.p);
 const right=new THREE.Vector3(...station.t).cross(up).normalize();
 for(const lateral of [-station.width/2,station.width/2]){
  const world=point.clone().addScaledVector(right,lateral);
  const dx=world.x-boreOrigin.x,dz=world.z-boreOrigin.z;
  const local={x:dx*boreCos-dz*boreSin,z:dx*boreSin+dz*boreCos};
  if(Math.abs(local.z)>boreHalfDepth)continue;
  boreEdgeSamples++;
  boreMinX=Math.min(boreMinX,local.x);boreMaxX=Math.max(boreMaxX,local.x);
 }
}
assert.ok(boreEdgeSamples>0,'No road edge sample fell inside the bore depth; the bore is not over the road.');
const boreClearance=Math.min(boreHalfWidth-boreMaxX,boreHalfWidth+boreMinX);
assert.ok(boreClearance>0,`The road runs into the bore wall: the swept edge envelope is `
 +`${(boreMaxX-boreMinX).toFixed(3)} m wide against a ${(boreHalfWidth*2).toFixed(3)} m bore, `
 +`clearance ${boreClearance.toFixed(3)} m.`);

// --- 5. Both panoramas pass the still-image gate. `sky-profile.py` is the only
// instrument for this and it decides its own acceptance clause from the picture
// (bright skies on the luma ratio, a near-black sky on absolute spread), so the
// assertion is on the script's exit code and its own `accepted`, not on a
// threshold restated here.
const skyProfiles={};
for(const state of ['day','night']){
 const image='public/assets/dreamisland/sky-'+state+'.jpg';
 const record=flag('sky-out')??'art/evidence/dreamisland-v1/phase-c/skies';
 mkdirSync(record,{recursive:true});
 const finished=spawnSync('python3',['scripts/visual/tideline-v4/sky-profile.py',image,record+'/sky-profile-'+state+'.json'],{encoding:'utf8'});
 assert.ok(!finished.error,`sky-profile.py could not be run (${finished.error?.message}); this validator needs python3 with Pillow on PATH`);
 assert.equal(finished.status,0,`${image} fails scripts/visual/tideline-v4/sky-profile.py: ${finished.stdout||finished.stderr}`);
 skyProfiles[state]=JSON.parse(finished.stdout);
 assert.equal(skyProfiles[state].accepted,true,`${image} is not accepted by the sky gate`);
}

// Phase C: the evidence directory is a parameter, so re-running this validator
// after a later revision cannot overwrite the record of an earlier phase.
const out=flag('out')??'art/evidence/dreamisland-v1/phase-b';mkdirSync(out,{recursive:true});
const report={script:'scripts/validate-dreamisland-painted.mjs',
 painted:{file,sha256:createHash('sha256').update(buffer).digest('hex'),
  meshes:painted.meshes,triangles:painted.triangles,trianglesPerMesh:painted.trianglesPerMesh,
  placements:painted.placements.length,routeRevision:painted.route.revision},
 features:featureCounts,targets,cells,
 skies:Object.fromEntries(Object.entries(skyProfiles).map(([state,profile])=>[state,
  {image:profile.image,size:profile.size,maximumTenDegreeWarmthDelta:profile.maximumTenDegreeWarmthDelta,
   skyLumaMaxMinRatio:profile.skyLumaMaxMinRatio,acceptanceClause:profile.acceptanceClause,accepted:profile.accepted}])),
 signage:{count:signage.signs.length,maximumLetterHeightMetres:signage.maximumLetterHeightMetres,
  minimumRoadFaceClearance:signage.minimumRoadFaceClearance,
  minimumDeckClearance:signage.minimumDeckClearance,flightArcsClear:signage.flightArcsClear},
 heroes:{placements:heroPlacements,files:[...heroFiles.keys()],
  note:'Instanced into the corridor scene from painted.json, so the bore probe hits the hero watchtower rather than nothing.'},
 bore:{placement:borePlacement.position,yaw:borePlacement.yaw,scale:boreScale,
  nearestStation:boreStation,stationsScanned:boreSpan*2+1,
  boreWidthMetres:boreHalfWidth*2,boreDepthMetres:boreHalfDepth*2,
  roadEdgeSamplesInsideBore:boreEdgeSamples,
  sweptEdgeEnvelopeMetres:[boreMinX,boreMaxX],sweptEdgeWidthMetres:boreMaxX-boreMinX,
  lateralClearanceMetres:boreClearance,
  note:'Road edges in the bore local frame. This is the check the upward ray cannot make: a road buried in solid masonry has nothing above it to hit.'},
 audioSources:{instrument:'scripts/prepare-dreamisland-audio-positions.mjs --check',anchors:painted.audioSources.sources.length,matched:true},
 props:{source:'public/assets/dreamisland/props.glb',data:'src/game/data/dreamisland/props.json',
  kinds:[...propKinds].sort(),counts:propCounts,
  corridorClearanceMetres:propsData.corridorClearanceMetres,
  note:'Every authored prop, plus the bollard cores the runtime rides on the bollard placements, instanced into the corridor scene before the rays are cast.'},
 powerKit:{placements:hardwarePlacements,plateAtlasCell:'concrete/road-sand',hingeSweep:'closed and open at 0.70 rad, with matching lamps and deck plates included in corridor rays'},
 corridor:{samples,boreSamples,openClearanceMetres:OPEN_CLEARANCE,boreClearanceMetres:BORE_CLEARANCE,
  rideHeightMetres:RIDE_HEIGHT,intrusions:hits.length,heroPlacementsInScene:heroPlacements.length,
  note:'Spatial sweep: an upward ray at every station every 2 m across the road. Not a timed sample window, and not proof that anything rendered.'},
 scope:'Manifest contract, target metres, atlas cell agreement across the V flip, signage cap and static corridor clearance. Rendered-pixel proof is scripts/visual/dreamisland/atlas-proof.mjs.'};
writeFileSync(out+'/painted-validation.json',JSON.stringify(report,null,2));
console.log(`Dream Island painted PASS: ${painted.meshes} meshes / ${painted.triangles} triangles from ${painted.placements.length} placements; `
 +`${Object.keys(painted.features).length} assets x 5 features; ${cells.length} atlas cells agree with the manifest across the V flip; `
 +`${signage.signs.length} signs, tallest letter ${signage.maximumLetterHeightMetres} m; corridor clear over ${samples} rays (${boreSamples} stations inside the bore) with ${heroPlacements.length} hero placements in the scene; `
 +`bore contains the road with ${boreClearance.toFixed(3)} m of lateral clearance over ${boreEdgeSamples} edge samples; `
 +`both panoramas accepted by sky-profile.py (day on the ${skyProfiles.day.acceptanceClause}, night on the ${skyProfiles.night.acceptanceClause}).`);
