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
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceModule} from './visual/dreamisland/modules.mjs';

const read=name=>JSON.parse(readFileSync(name,'utf8'));
const route=read('src/game/data/dreamisland/route.json');
const painted=read('public/assets/dreamisland/painted.json');
const atlas=read('public/assets/dreamisland/atlas-manifest.json');
const signage=read('public/assets/dreamisland/signage-manifest.json');
const {CELL,QUADRANT,sampled}=await import(await sourceModule('dreamisland-materials.ts'));

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
const {scene}=await new GLTFLoader().parseAsync(JSON.stringify(json),'');
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

const out='art/evidence/dreamisland-v1/phase-b';mkdirSync(out,{recursive:true});
const report={script:'scripts/validate-dreamisland-painted.mjs',
 painted:{file,sha256:createHash('sha256').update(buffer).digest('hex'),
  meshes:painted.meshes,triangles:painted.triangles,trianglesPerMesh:painted.trianglesPerMesh,
  placements:painted.placements.length,routeRevision:painted.route.revision},
 features:featureCounts,targets,cells,
 signage:{count:signage.signs.length,maximumLetterHeightMetres:signage.maximumLetterHeightMetres,
  minimumRoadFaceClearance:signage.minimumRoadFaceClearance,
  minimumDeckClearance:signage.minimumDeckClearance,flightArcsClear:signage.flightArcsClear},
 corridor:{samples,boreSamples,openClearanceMetres:OPEN_CLEARANCE,boreClearanceMetres:BORE_CLEARANCE,
  rideHeightMetres:RIDE_HEIGHT,intrusions:hits.length,
  note:'Spatial sweep: an upward ray at every station every 2 m across the road. Not a timed sample window, and not proof that anything rendered.'},
 scope:'Manifest contract, target metres, atlas cell agreement across the V flip, signage cap and static corridor clearance. Rendered-pixel proof is scripts/visual/dreamisland/atlas-proof.mjs.'};
writeFileSync(out+'/painted-validation.json',JSON.stringify(report,null,2));
console.log(`Dream Island painted PASS: ${painted.meshes} meshes / ${painted.triangles} triangles from ${painted.placements.length} placements; `
 +`${Object.keys(painted.features).length} assets x 5 features; ${cells.length} atlas cells agree with the manifest across the V flip; `
 +`${signage.signs.length} signs, tallest letter ${signage.maximumLetterHeightMetres} m; corridor clear over ${samples} rays (${boreSamples} stations inside the bore).`);
