import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Box3, Vector3, Triangle} from 'three';
import {checkWatchtower} from './watchtower-check.mjs';

const atlas = JSON.parse(readFileSync('public/assets/dreamisland/atlas-manifest.json', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const close = (value, target, label) => assert.ok(Math.abs(value-target) <= target*.02, `${label}: ${value} differs from target ${target} by more than 2%`);
const bounds = root => {
  const box = new Box3().setFromObject(root, true);
  return {min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new Vector3()).toArray()};
};
const census = root => {
  let meshes = 0, triangles = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    meshes++;
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count)/3;
  });
  return {meshes, triangles};
};
const requiredNode = (scene, name) => {
  const node = scene.getObjectByName(name);
  assert.ok(node, `Missing required feature/anchor: ${name}`);
  return node;
};

export function verifyAtlasInputs(manifest) {
  assert.equal(hash(readFileSync('public/assets/dreamisland/atlas-manifest.json')), manifest.atlasManifestSha256, 'Shared atlas manifest changed: rebuild/review heroes');
  const files = {};
  for (const [file, spec] of Object.entries(manifest.atlasFiles)) {
    const actual = hash(readFileSync(file));
    assert.equal(actual, spec.sha256, `Shared atlas changed: ${file}`);
    files[file] = actual;
  }
  return files;
}

function checkMesh(mesh) {
  const {position, normal, uv, color} = mesh.geometry.attributes;
  assert.ok(position && normal && uv && color, `${mesh.name}: position, normal, UV and vertex colour required`);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  assert.equal(materials.length, 1, `${mesh.name}: expected a single glTF primitive per mesh`);
  const role = materials[0].name.replace(/^DI_MAT_/, '');
  assert.ok(materials[0].name === 'DI_MAT_' + role && atlas.roles[role], `Invalid material ${materials[0].name}`);
  assert.equal(materials[0].map, null, 'The loader must see no embedded texture');
  const cells = Object.values(atlas.roles[role]).map(cell => cell.sprite?.uv ?? cell.uv);
  let tintedVertices = 0;
  for (let i=0; i<position.count; i++) {
    assert.ok([position.getX(i),position.getY(i),position.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i),uv.getX(i),uv.getY(i),color.getX(i),color.getY(i),color.getZ(i)].every(Number.isFinite), `${mesh.name}: non-finite vertex data`);
    const u=uv.getX(i), v=1-uv.getY(i); // glTF V -> manifest bottom-origin V.
    assert.ok(cells.some(([u0,v0,u1,v1]) => u>=u0-1e-5 && u<=u1+1e-5 && v>=v0-1e-5 && v<=v1+1e-5), `${mesh.name}: UV outside ${role} cells`);
    if (Math.min(color.getX(i),color.getY(i),color.getZ(i)) < .98) tintedVertices++;
  }
  return {name: mesh.name, material: materials[0].name, triangles: census(mesh).triangles, tintedVertices};
}

export function inspectAsset(name, spec, buffer, scene) {
  const document = JSON.parse(buffer.subarray(20, 20+buffer.readUInt32LE(12)).toString());
  assert.equal(document.images?.length ?? 0, 0, 'No glTF image references permitted');
  assert.equal(document.textures?.length ?? 0, 0, 'No glTF textures permitted');
  assert.equal(hash(buffer), spec.sha256, `${name}: manifest refers to another export`);
  scene.updateMatrixWorld(true);
  const result = {...census(scene), bounds: bounds(scene), bytes: buffer.byteLength, sha256: hash(buffer), embeddedTextures: 0, meshDetails: []};
  scene.traverse(mesh => { if (mesh.isMesh) result.meshDetails.push(checkMesh(mesh)); });
  result.materials = [...new Set(result.meshDetails.map(mesh => mesh.material))].sort();
  assert.equal(result.triangles, spec.triangles, `${name}: exported GLB triangle count differs`);
  assert.ok(result.triangles <= spec.budget, `${name}: over triangle budget`);
  assert.ok(buffer.byteLength < 1_000_000, `${name}: over 1 MB`);
  for (const key of ['min','max','size']) for (let axis=0; axis<3; axis++) {
    assert.ok(Math.abs(result.bounds[key][axis]-spec.bounds[key][axis])<1e-4, `${name}: bounds parser disagrees with GLTFLoader`);
  }
  assert.equal(spec.features.length,5);
  for (const anchor of spec.anchors) requiredNode(scene,anchor);
  const target=spec.targetMetres;
  if (target.height) close(result.bounds.size[1],target.height,name+' height');
  if (target.width) close(result.bounds.size[0],target.width,name+' width');
  if (target.depth) close(result.bounds.size[2],target.depth,name+' depth');
  if (name === 'clock-tower') {
    const plinth = requiredNode(scene,'clock_plinth_three_tiers');
    const face = bounds(requiredNode(scene,'clock_face_3_2m'));
    close(bounds(plinth).size[0],8,'plinth width'); close(bounds(plinth).size[2],8,'plinth depth');
    close(face.size[0],3.2,'face diameter X'); close(face.size[1],3.2,'face diameter Y');
    const pivot=requiredNode(scene,'clock_hand_pivot');
    assert.equal(pivot.children.filter(child => child.isMesh).length,2,'Exactly two geometry hands required');
    assert.equal(plinth.userData.tiers,3);
    assert.equal(requiredNode(scene,'clock_winding_stair_treads').userData.stepCount,25);
    result.targetMeasurements={height:result.bounds.size[1],plinth:bounds(plinth).size,faceDiameter:face.size.slice(0,2),hands:2,steps:25};
  }
  if (name === 'watchtower') {
    const crown=requiredNode(scene,'watchtower_crenellations_nine_of_twelve');
    assert.equal(crown.userData.nominalSlots,12); assert.equal(crown.userData.existingMerlons,9);
    assert.deepEqual(crown.userData.missingSlots,[1,5,8]);
    const merlonPositions=crown.geometry.attributes.position, occupiedSlots=new Set();
    for(let i=0;i<merlonPositions.count;i++){
      const angle=Math.atan2(merlonPositions.getZ(i),merlonPositions.getX(i));
      occupiedSlots.add((Math.round(angle/(Math.PI*2/12))+12)%12);
    }
    assert.deepEqual([...occupiedSlots].sort((a,b)=>a-b),[0,2,3,4,6,7,9,10,11],'Exported vertices must occupy exactly nine merlon slots');
    result.merlons={occupiedSlots:[...occupiedSlots].sort((a,b)=>a-b),missingSlots:[1,5,8]};
    for (const side of ['front','back']) {
      requiredNode(scene,`watchtower_${side}_arch_keystone`);
      requiredNode(scene,`watchtower_${side}_arched_window`);
    }
    assert.ok(result.meshDetails.some(mesh => mesh.material==='DI_MAT_jungle' && mesh.tintedVertices>0), 'Moss must have exported vertex tint');
    Object.assign(result,checkWatchtower(scene,result.bounds));
  }
  if (name === 'waterfall-cliff') {
    const lip=requiredNode(scene,'waterfall_sheet_anchor'), pool=requiredNode(scene,'waterfall_pool_datum');
    const top=lip.getWorldPosition(new Vector3()), bottom=pool.getWorldPosition(new Vector3());
    result.targetMeasurements={drop:top.y-bottom.y,lip:top.toArray(),poolDatum:bottom.toArray(),blossomClumps:2};
    close(top.y-bottom.y,16,'waterfall drop');
    for (const side of ['left','right']) requiredNode(scene,'waterfall_blossom_clump_'+side);
    const cards=result.meshDetails.filter(mesh=>mesh.material==='DI_MAT_jungle-card');
    result.cardTriangles=cards.reduce((sum,mesh)=>sum+mesh.triangles,0);
    result.solidTriangles=result.triangles-result.cardTriangles;
    assert.ok(result.solidTriangles<=5000);
  }
  if (name === 'sea-stack-set') {
    result.stacks={};
    for (const height of [18,26,32,40]) {
      const node=requiredNode(scene,`sea_stack_${height}m`), item={...census(node),bounds:bounds(node)};
      close(item.bounds.size[1],height,'stack '+height+' height');
      assert.ok(item.triangles<=1500,'stack '+height+' over budget');
      result.stacks[height]=item;
    }
    assert.equal(requiredNode(scene,'stack_32_tapered_block_courses').userData.naturalArch,true);
    const arch=requiredNode(scene,'sea_stack_32m'), origin=arch.getWorldPosition(new Vector3());
    const clearance=new Box3(new Vector3(origin.x-2.9,.1,-15),new Vector3(origin.x+.1,7.8,15));
    const triangle=new Triangle();let hits=0,tested=0;
    arch.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
      for(let i=0;i<(index?.count??p.count);i+=3){
        [triangle.a,triangle.b,triangle.c].forEach((v,k)=>v.fromBufferAttribute(p,index?index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));
        tested++;if(clearance.intersectsTriangle(triangle))hits++;
      }
    });
    assert.equal(hits,0,'Natural stack arch must be a true opening');
    result.naturalArch={boxMin:clearance.min.toArray(),boxMax:clearance.max.toArray(),testedTriangles:tested,intersectingTriangles:hits};
  }
  return result;
}
