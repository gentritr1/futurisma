import * as THREE from 'three';
import {CELL,applyDreamIslandAtlasFlow} from './dreamisland-materials';
import type {DreamIslandCourse} from './dreamisland-course';

/**
 * Sea, shallows, foam line and basin pool: three draws, one water atlas, one
 * emissive atlas, and the readability trade of section 2 of the brief.
 *
 * By day the water is lit from above and the track edges are read from the
 * long-range silhouette. At night the sea goes black, and the foam line along
 * the beach and the shallows either side of the reef pier take an emissive term
 * from the emissive atlas in proportion to `nightBlend` — so the two glowing
 * bands ARE the edge cue. That is why the emissive term is on a lit material
 * with `toneMapped` and `fog` left at their defaults rather than on an unlit
 * `toneMapped:false` overlay: an overlay would not fog, so it would stay bright
 * at the distance where the fog is meant to be taking the long-range cue away.
 *
 * UVs are authored in METRES divided by a tile size, and the fragment wraps them
 * inside a single atlas quadrant (`dreamisland-materials.ts`), because an atlas
 * cell has nowhere for `texture.repeat` to wrap to.
 */
const TILES={sea:42,shallows:9,foam:14};
export class DreamIslandWater {
 readonly root=new THREE.Group();
 readonly ready:Promise<void>;
 /** Zero if the module never built a surface, so a silent no-op is visible. */
 surfaces=0;
 private readonly time={value:0};
 private readonly seaBlend={value:0};
 private readonly sea:THREE.Mesh;
 private readonly shallows:THREE.Mesh;
 private readonly foam:THREE.Mesh;
 private readonly seaDay=new THREE.Color(0xffffff);
 private readonly seaNight=new THREE.Color(0x1a2230);
 constructor(course:DreamIslandCourse){
  this.root.name='dreamisland_water';
  const centre=new THREE.Vector3();
  for(let i=0;i<48;i++)centre.add(course.sample(i/48).position);
  centre.divideScalar(48);centre.y=0;
  const water=new THREE.TextureLoader(),textures:Promise<unknown>[]=[];
  const load=(url:string,apply:(t:THREE.Texture)=>void)=>{
   if(typeof Image==='undefined')return;
   textures.push(water.loadAsync(url).then(texture=>{texture.colorSpace=THREE.SRGBColorSpace;
    // `flipY = false` matches what GLTFLoader gives the painted world, so one V
    // convention holds for every atlas on this map; `CELL` is already in it.
    texture.flipY=false;
    // Same atlas/mip trap as the painted world: keep the mip low at grazing angles.
    texture.anisotropy=16;apply(texture);}));
  };
  // One sea draw: a far quad below a camera-centred, 30 x 30 swell grid.
  // Both surfaces sample the same cobalt cell. The near grid is 1,800 tris;
  // its world-space waves and UVs do not slide when the camera moves.
  const farSea=new THREE.PlaneGeometry(7200,7200).rotateX(-Math.PI/2)
   .translate(centre.x,-1.2,centre.z);
  const nearSea=new THREE.PlaneGeometry(480,480,30,30).rotateX(-Math.PI/2)
   .translate(0,-1.2,0);
  metreUv(farSea,TILES.sea,centre);metreUv(nearSea,TILES.sea,new THREE.Vector3());
  const farVertices=farSea.attributes.position.count;
  const nearTriangles=(nearSea.index?.count??nearSea.attributes.position.count)/3;
  const seaGeometry=merge([farSea,nearSea]);
  const patch=new Float32Array(seaGeometry.attributes.position.count);
  const fade=new Float32Array(patch.length),seaPositions=seaGeometry.attributes.position;
  for(let i=farVertices;i<patch.length;i++){
   patch[i]=1;
   const edge=Math.max(Math.abs(seaPositions.getX(i)),Math.abs(seaPositions.getZ(i)));
   fade[i]=1-THREE.MathUtils.smoothstep(edge,176,240);
  }
  seaGeometry.setAttribute('diPatch',new THREE.Float32BufferAttribute(patch,1));
  seaGeometry.setAttribute('diPatchFade',new THREE.Float32BufferAttribute(fade,1));
  const seaMaterial=new THREE.MeshLambertMaterial({name:'dreamisland_sea'});
  applyDreamIslandAtlasFlow(seaMaterial,{cell:CELL.cobaltFacets,tile:new THREE.Vector2(1,1),
   scroll:new THREE.Vector2(.004,.0026),time:this.time,key:'sea',swell:{night:this.seaBlend}});
  load('/assets/dreamisland/textures/water.jpg',t=>{seaMaterial.map=t;seaMaterial.needsUpdate=true;});
  this.sea=new THREE.Mesh(seaGeometry,seaMaterial);this.sea.name='dreamisland_sea';
  this.sea.frustumCulled=false;this.sea.renderOrder=-10;
  this.sea.userData.swell={nearTriangles,gridSegments:30,widthMetres:480,
   authoredUpperBoundMetres:-1.2+.32+.14+.10,farHeightMetres:-1.2};
  // 2. The shallows: the reef either side of the pier, the beach inshore band
  //    and the basin pool, merged into one draw.
  // Laterals are absolute metres from the road centre. The reef pier is 26 m
  // wide, so its shallows start 14 m out - right at the pier edge, which is what
  // makes the two glowing bands the pier's edge cue at night. The beach road has
  // a 17 m sand verge, so its shallows start beyond that.
  const shallows=[
   ribbon(course,.6583,.85,14,50,-.55,TILES.shallows),
   ribbon(course,.6583,.85,-14,-50,-.55,TILES.shallows),
   // -0.55, NOT -1.2. The far sea is at y = -1.2 and its near swell stays below -0.55; depth testing
   // does not care about renderOrder, so a band authored BELOW it is drawn and
   // then covered. Measured, not guessed: at the BEACH pose the glow isolation
   // frame had ZERO lit pixels at every one of the five crossfade blends, while
   // the reef bands - authored at -0.55 and -0.5, above the sea - had 90,041.
   // The beach foam rail is section 2's stated night cue for the start straight,
   // so it not drawing is the cue not existing.
   ribbon(course,.0,.125,34,96,-.55,TILES.shallows),
   pool(course,.4725,-46,110,150,TILES.shallows),
  ];
  const shallowsMaterial=new THREE.MeshLambertMaterial({name:'dreamisland_shallows',
   emissive:0x8ff4ec,emissiveIntensity:0});
  applyDreamIslandAtlasFlow(shallowsMaterial,{cell:CELL.causticShallows,tile:new THREE.Vector2(1,1),
   scroll:new THREE.Vector2(.0018,.0012),time:this.time,emissiveCell:CELL.shallowsGlow,key:'shallows'});
  load('/assets/dreamisland/textures/water.jpg',t=>{shallowsMaterial.map=t;shallowsMaterial.needsUpdate=true;});
  load('/assets/dreamisland/textures/emissive.jpg',t=>{shallowsMaterial.emissiveMap=t;shallowsMaterial.needsUpdate=true;});
  this.shallows=new THREE.Mesh(merge(shallows),shallowsMaterial);
  this.shallows.name='dreamisland_shallows';this.shallows.frustumCulled=false;this.shallows.renderOrder=-9;
  // 3. The foam: the beach shore line and the reef drop-off. V runs across the
  //    strip because the foam quadrant's V axis IS distance from shore.
  const foam=[
   ribbon(course,.0,.125,27,35,-.5,TILES.foam,true),   // above the sea, as the reef's are
   ribbon(course,.6583,.85,48,56,-.5,TILES.foam,true),
   ribbon(course,.6583,.85,-48,-56,-.5,TILES.foam,true),
  ];
  const foamMaterial=new THREE.MeshLambertMaterial({name:'dreamisland_foam',
   emissive:0x7ef0ff,emissiveIntensity:0});
  applyDreamIslandAtlasFlow(foamMaterial,{cell:CELL.foamGradient,tile:new THREE.Vector2(1,1),
   scroll:new THREE.Vector2(.006,0),time:this.time,emissiveCell:CELL.foamGlow,key:'foam'});
  load('/assets/dreamisland/textures/water.jpg',t=>{foamMaterial.map=t;foamMaterial.needsUpdate=true;});
  load('/assets/dreamisland/textures/emissive.jpg',t=>{foamMaterial.emissiveMap=t;foamMaterial.needsUpdate=true;});
  this.foam=new THREE.Mesh(merge(foam),foamMaterial);
  this.foam.name='dreamisland_foam';this.foam.frustumCulled=false;this.foam.renderOrder=-8;
  this.root.add(this.sea,this.shallows,this.foam);this.surfaces=3;
  this.ready=Promise.all(textures).then(()=>undefined);
 }
 get triangles(){return [this.sea,this.shallows,this.foam].reduce((total,mesh)=>
  total+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);}
 /** The night readability cue: the sea darkens, the two bands light up. */
 update(elapsed:number,nightBlend:number,reducedMotion:boolean){
  this.time.value=reducedMotion?0:elapsed;
  this.seaBlend.value=nightBlend;
  (this.sea.material as THREE.MeshLambertMaterial).color.lerpColors(this.seaDay,this.seaNight,nightBlend);
  (this.shallows.material as THREE.MeshLambertMaterial).emissiveIntensity=nightBlend*1.20;
  (this.foam.material as THREE.MeshLambertMaterial).emissiveIntensity=nightBlend*1.50;
 }
}

/** Metre-based UVs on a horizontal plane, so one atlas cell covers `tile` metres. */
function metreUv(geometry:THREE.BufferGeometry,tile:number,centre:THREE.Vector3){
 const position=geometry.attributes.position,uv=new Float32Array(position.count*2);
 for(let i=0;i<position.count;i++){
  uv[i*2]=(position.getX(i)-centre.x)/tile;uv[i*2+1]=(position.getZ(i)-centre.z)/tile;
 }
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
}

/**
 * A flat band following the road between two progress values, from `inner` to
 * `outer` metres of lateral offset. `across` puts V across the band instead of
 * along it, which is what the foam gradient needs: its V axis is the distance
 * from the shore, so it must cross the strip exactly once and never wrap.
 */
function ribbon(course:DreamIslandCourse,from:number,to:number,inner:number,outer:number,
 rise:number,tile:number,across=false):THREE.BufferGeometry{
 const steps=Math.max(8,Math.round((to-from)*course.length/12));
 const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(let i=0;i<=steps;i++){
  const progress=from+(to-from)*i/steps,sample=course.sample(progress);
  const along=progress*course.length;
  for(const [index,lateral] of [inner,outer].entries()){
   const point=sample.position.clone().addScaledVector(sample.right,lateral);
   positions.push(point.x,rise,point.z);
   // `.999` rather than 1: `fract(1.)` is 0, which would wrap the gradient back
   // to the open-water end exactly on the shore line.
   uvs.push(along/tile,across?index*.999:lateral/tile);
  }
  // WINDING. `inner` and `outer` are signed laterals, so a band on the left of
  // the road runs the opposite way round and the same index order gives it a
  // DOWNWARD normal. With backface culling on - which is three's default and
  // what these materials use - the reef's left-hand shallows and its left-hand
  // foam line drew nothing at all, and half the night state's edge cue was
  // simply missing from every frame phase B shot. Measured, not guessed: the
  // shallows carried 78 down-facing vertices of 233 and the foam 78 of 208,
  // exactly the two negative-lateral reef ribbons, and an isolation frame at the
  // REEF pose had 0 lit pixels in the left half of the screen.
  if(i<steps){
   const k=i*2;
   if(outer<inner)indices.push(k,k+3,k+1,k,k+2,k+3);
   else indices.push(k,k+1,k+3,k,k+3,k+2);
  }
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 geometry.setIndex(indices);geometry.computeVertexNormals();
 return geometry;
}

/** The basin pool the waterfall falls into, as a flat grid beside the causeway. */
function pool(course:DreamIslandCourse,progress:number,lateral:number,width:number,
 depth:number,tile:number):THREE.BufferGeometry{
 const sample=course.sample(progress);
 const centre=sample.position.clone().addScaledVector(sample.right,lateral);
 const geometry=new THREE.PlaneGeometry(width,depth,4,4).rotateX(-Math.PI/2)
   .translate(centre.x,sample.position.y-3,centre.z);
 metreUv(geometry,tile,new THREE.Vector3(0,0,0));
 return geometry;
}

/** Concatenate position/uv/index without pulling in BufferGeometryUtils. */
function merge(parts:THREE.BufferGeometry[]):THREE.BufferGeometry{
 const positions:number[]=[],uvs:number[]=[],normals:number[]=[],indices:number[]=[];
 for(const part of parts){
  const base=positions.length/3,position=part.attributes.position,uv=part.attributes.uv;
  const normal=part.attributes.normal;
  for(let i=0;i<position.count;i++){
   positions.push(position.getX(i),position.getY(i),position.getZ(i));
   uvs.push(uv.getX(i),uv.getY(i));
   normals.push(normal?normal.getX(i):0,normal?normal.getY(i):1,normal?normal.getZ(i):0);
  }
  const index=part.index;
  if(index)for(let i=0;i<index.count;i++)indices.push(base+index.getX(i));
  else for(let i=0;i<position.count;i++)indices.push(base+i);
  part.dispose();
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
 geometry.setIndex(indices);
 return geometry;
}
