import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { transformWithOxc } from "vite";
import {parseGeometry} from "./lib/glb-geometry.mjs";
import { disposeObject3DResources } from "../src/game/graphics-resources.js";

const root = new URL("../", import.meta.url);
const route = JSON.parse(await readFile(new URL("src/game/data/tideline/route.json", root), "utf8"));
const manifest = JSON.parse(await readFile(new URL("public/assets/tideline-foundry/manifest.json", root), "utf8"));
const placements = JSON.parse(await readFile(new URL("public/assets/tideline-foundry/placements.json", root), "utf8"));
assert.equal(manifest.census.pelagicCrowns, 0);
assert.equal(manifest.census.flightLenses, 0);
assert.ok(manifest.census.aqueductRibs >= 35);
assert.ok(manifest.census.portHalls >= 12 && manifest.census.reactors >= 5);
const ribs = placements.filter(p => p.kind === "rib");
assert.deepEqual([...new Set(ribs.map(r => r.variant))].sort(), [0, 1, 2]);
assert.equal(ribs.filter(r => r.damaged).length, 2);
assert.ok(ribs.every(r => r.heavy === (r.index % 4 === 0)));

const file = new URL("src/game/tideline-environment.ts", root);
const source = await readFile(file, "utf8");
async function compileLeaf(relative) {
  const path = new URL(relative, root);
  let {code} = await transformWithOxc(await readFile(path,"utf8"),path.pathname);
  code=code.replaceAll('from "three"',`from ${JSON.stringify(import.meta.resolve("three"))}`);
  for(const match of [...code.matchAll(/import (\w+) from "([^"]+\.json)";/g)]) {
    code=code.replace(match[0],`const ${match[1]}=${await readFile(new URL(match[2],path),"utf8")};`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
let code = (await transformWithOxc(source, file.pathname)).code
  .replace('from "three"', `from ${JSON.stringify(import.meta.resolve("three"))}`)
  .replace('import route from "./data/tideline/route.json";', `const route = ${JSON.stringify(route)};`)
  .replaceAll(/new THREE.TextureLoader\(\).loadAsync\("([^"]+)"\)/g, (_,url)=>`globalThis.__tidelineAssetPorts.texture(${JSON.stringify(url)})`)
  .replace('import { NeonEnvironment } from "./neon-environment";', 'const NeonEnvironment = {load: options => globalThis.__tidelineAssetPorts.scenery(options)};')
  .replace('import { resolveReducedMotion } from "./query-probes";', 'const resolveReducedMotion = () => globalThis.__tidelineAssetPorts.reduced ?? false;')
  .replace('from "./graphics-resources"', `from ${JSON.stringify(new URL("src/game/graphics-resources.js", root).href)}`);
for(const name of ['tideline-materials','tideline-chamber','tideline-effects','tideline-motion']) {
  code=code.replace(`from "./${name}"`,`from ${JSON.stringify(await compileLeaf(`src/game/${name}.ts`))}`);
}
const { TidelineEnvironment } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
function fixture() {
  const texture = new THREE.Texture();
  const material = new THREE.MeshLambertMaterial({map: texture, emissiveMap: texture, emissive: 0x404040, name:"GW_MAT_emissive"});
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material));
  const basin=new THREE.Mesh(geometry,material);basin.name="GW_SECTOR_BASIN";root.add(basin);
  const disposed = {texture:0, material:0, geometry:0};
  for (const [name, resource] of Object.entries({texture, material, geometry})) resource.addEventListener("dispose", () => disposed[name]++);
  const stats = {meshes:2, materials:1, textures:1, triangles:24, visibleGroups:0, visibleTriangles:0,
    shaderModel:"lambert", signageSource:"baked", contractDrift:[]};
  return {root, texture, material, disposed, scenery:{root, stats, updateVisibility() {stats.visibleGroups=0;stats.visibleTriangles=0;}}};
}
// Exercise the actual exported pivots, not source-text descriptions of motion.
const {TidelineMotion}=await import(await compileLeaf('src/game/tideline-motion.ts'));
const exported=await parseGeometry(await readFile(new URL('public/assets/tideline-foundry/foundry_world.glb',root)));
const motion=new TidelineMotion(exported.scene,{time:{value:0},water:{value:0},effects:null});
const cranes=[];exported.scene.traverse(object=>{if(object.name.includes('MOTION_CRANE'))cranes.push(object);});
assert.equal(new Set(cranes.map(object=>object.name.match(/CRANE_(\d+)/)[1])).size,2);
motion.update(8,1,0,false);const before=cranes.map(object=>object.rotation.y);
motion.update(16,1,0,false);assert.ok(cranes.every((object,i)=>object.rotation.y!==before[i]));
for(const id of ['0','1'])assert.equal(new Set(cranes.filter(object=>object.name.includes('CRANE_'+id)).map(object=>object.rotation.y)).size,1,'All parts of each crane rotate together.');
const paused=cranes.map(object=>object.rotation.y);motion.update(16,1,0,false);assert.deepEqual(cranes.map(object=>object.rotation.y),paused);
motion.update(16,3,-27,true);const reduced=cranes.map(object=>object.rotation.y);motion.update(18,3,-27,true);assert.deepEqual(cranes.map(object=>object.rotation.y),reduced);
let ferryParts=0;exported.scene.traverse(object=>{if(object.name.includes('MOTION_FERRY')){object.visible=true;ferryParts++;}});
motion.applyVisibility(1);exported.scene.traverse(object=>{if(object.name.includes('MOTION_FERRY'))assert.equal(object.visible,false);});
assert.equal(ferryParts,3);exported.scene.add(motion.root);disposeObject3DResources(exported.scene);

const previous = globalThis.__tidelineAssetPorts;
const textureUrls=['/assets/tideline-foundry/textures/water.jpg','/assets/tideline-v3/waterlight.jpg','/assets/tideline-v3/basin.jpg'];
function textures() {
  const map=new Map(textureUrls.map(url=>[url,new THREE.Texture()])),disposed=new Map(textureUrls.map(url=>[url,0]));
  for(const [url,texture] of map)texture.addEventListener('dispose',()=>disposed.set(url,disposed.get(url)+1));
  return {map,disposed};
}
try {
  for (const reduced of [false, true]) {
    const world = fixture(),paint=textures();
    globalThis.__tidelineAssetPorts = {reduced,texture:async url=>paint.map.get(url), scenery:async options => {
      assert.equal(options.modelUrl, "/assets/tideline-foundry/foundry_world.glb");
      assert.equal(options.maximumDistance, 240); assert.equal(options.opticalEffects, false);
      assert.equal(options.preferLightsAhead,true);assert.equal(options.lightIntensity,500);
      return world.scenery;
    }};
    const course = {tide:{lap:1, elapsed:1, waterLevel:0}};
    const environment = await TidelineEnvironment.load(course);
    const ocean = environment.root.getObjectByName("tideline_water_surface");
    const steam = environment.root.getObjectByName("tideline_pump_steam");
    const particles = environment.root.getObjectByName("tideline_exterior_particulate");
    const drain = environment.root.getObjectByName("tideline_exterior_sluice_water");
    assert.equal(ocean.material.uniforms.waterAtlas.value, paint.map.get(textureUrls[0]));
    for(const texture of paint.map.values())assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.ok(manifest.triangles + environment.stats.triangles - 24 <= 100_000);
    const shader = {uniforms:{}, vertexShader:"#include <begin_vertex>", fragmentShader:"#include <emissivemap_fragment>"};
    world.material.onBeforeCompile(shader);
    const camera = new THREE.PerspectiveCamera(60, 1, .1, 500);
    camera.position.set(0, -10, 10); camera.updateMatrixWorld();
    environment.updateVisibility(camera);
    assert.equal(particles.visible, !reduced); assert.equal(steam.visible, false);
    assert.equal(shader.uniforms.tideWater.value, 0);
    course.tide = {lap:2, elapsed:2, waterLevel:-7}; environment.updateVisibility(camera);
    assert.equal(drain.visible,!reduced,"Sluice sheeting accompanies drainage, then stops.");
    course.tide = {lap:3, elapsed:8, waterLevel:-27}; environment.updateVisibility(camera);
    assert.equal(ocean.position.y, -27); assert.equal(steam.visible, !reduced); assert.equal(particles.visible, false);assert.equal(drain.visible,false);
    assert.equal(shader.uniforms.tideWater.value, -27);
    assert.equal(shader.uniforms.tideTime.value, reduced ? 0 : 8);
    const time = ocean.material.uniforms.time.value;
    for (let frame = 0; frame < 120; frame++) environment.updateVisibility(camera);
    assert.equal(ocean.material.uniforms.time.value, time, "Paused race clock freezes water, steam and lamp motion.");
    // Every underwater road centre has dry air in the water-surface clip mask.
    const mask=ocean.material.uniforms.chamberMask.value, {data,width,height}=mask.image;
    for(const station of [...route.stations,...route.shortcut.stations]) {
      if(station.p[1]>2)continue;
      const x=Math.floor((station.p[0]+900)/1800*width),z=Math.floor((station.p[2]+900)/1800*height),i=(z*width+x)*4;
      assert.equal(data[i],255,'Chamber mask must be continuous at the road centre and shared mouths.');
      assert.ok(data[i+1]/255*80-40<station.p[1]);
      assert.ok(data[i+2]/255*80-40>station.p[1]+10);
    }
    disposeObject3DResources(environment.root);
    assert.deepEqual(world.disposed, {texture:1, material:1, geometry:1});
    for(const count of paint.disposed.values())assert.equal(count,1,"Shared painted textures are released once.");
  }
  for (const failed of ["scenery",...textureUrls]) {
    const world = fixture(),paint=textures();
    globalThis.__tidelineAssetPorts = {
      scenery:async () => {if (failed === "scenery") throw Error("missing world"); return world.scenery;},
      texture:async url => {if (failed === url) throw Error("missing atlas"); return paint.map.get(url);},
    };
    await assert.rejects(TidelineEnvironment.load(), /could not be loaded/);
    if(failed!=='scenery')assert.deepEqual(world.disposed,{texture:1,material:1,geometry:1});
    for(const [url,count] of paint.disposed)assert.equal(count,failed===url?0:1);
  }
} finally {
  if (previous === undefined) delete globalThis.__tidelineAssetPorts;
  else globalThis.__tidelineAssetPorts = previous;
}
console.log("Tideline environment PASS: painted lit road, exterior water/particulate, continuous dry-chamber mask, timed drainage, pause/reduced motion, triangle budget and all four partial-load cleanup orders.");
