import * as THREE from 'three';
import type {FrostlineCourse} from './frostline-course';
import {CIRCUIT_SIGNATURE_SITES,circuitSignatureOrigin} from './circuit-signature-sites';

/** Snow ground that follows the road's elevation and settles to the valley floor.
 * One heightfield mesh replaces the old flat -3 m slab and the per-segment bank
 * slabs, and every grounded prop asks it for the height at its own (x, z). */
export const SHOULDER=44;           // flat-ish shelf beside the road, metres from its centreline
const FALL=240;                     // shelf to valley floor
const BASE=-3;                      // valley floor (the old slab top)
const SHELF_DROP=.25;               // shelf sits just under the road, like the old banks
const UNDER_ROAD=.3;                // never closer than this under the road deck
const ROAD_CAP=30;                  // no vertex this close to a road rises above it (12 m cells span the road edge)
const STEP=12,MARGIN=SHOULDER+FALL+24;
const SKIRT_X:[number,number]=[-1550,1350],SKIRT_Z:[number,number]=[-1300,1600];
const PAD_EDGE=1.5,PAD_BLEND=14;    // level margin around a building, then the blend back to the slope
/** A building's base rectangle: centre, unit x axis in the ground plane, half extents. */
export type TerrainPad={x:number;z:number;ax:number;az:number;hx:number;hz:number};

export class FrostlineTerrain {
  readonly mesh:THREE.Mesh;
  private readonly xs:number[]=[];
  private readonly zs:number[]=[];
  private readonly heights:Float32Array;
  private readonly x0:number;private readonly z0:number;private readonly nx:number;private readonly nz:number;

  /** Snow height at each pad's centre before levelling (the level the building stands on). */
  readonly padLevels:number[];
  constructor(course:FrostlineCourse,material:THREE.Material|undefined,readonly pads:TerrainPad[]=[]){
    const points=course.points.filter((_,i)=>i%2===0),count=points.length;
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const p of points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
    this.x0=Math.floor((minX-MARGIN)/STEP)*STEP;this.z0=Math.floor((minZ-MARGIN)/STEP)*STEP;
    this.nx=Math.ceil((maxX+MARGIN-this.x0)/STEP);this.nz=Math.ceil((maxZ+MARGIN-this.z0)/STEP);
    this.xs.push(SKIRT_X[0]);for(let i=0;i<=this.nx;i++)this.xs.push(this.x0+i*STEP);this.xs.push(SKIRT_X[1]);
    this.zs.push(SKIRT_Z[0]);for(let j=0;j<=this.nz;j++)this.zs.push(this.z0+j*STEP);this.zs.push(SKIRT_Z[1]);
    // The signature service yard keeps a level parcel at its road's height.
    const site=CIRCUIT_SIGNATURE_SITES.frostline,origin=circuitSignatureOrigin(course),yard=site.radius+8;
    const ax=new Float64Array(count),az=new Float64Array(count),ay=new Float64Array(count),dx=new Float64Array(count),dz=new Float64Array(count),dy=new Float64Array(count),len=new Float64Array(count);
    for(let i=0;i<count;i++){const a=points[i],b=points[(i+1)%count];ax[i]=a.x;az[i]=a.z;ay[i]=a.y;dx[i]=b.x-a.x;dz[i]=b.z-a.z;dy[i]=b.y-a.y;len[i]=dx[i]*dx[i]+dz[i]*dz[i];}
    const W=this.xs.length,H=this.zs.length;this.heights=new Float32Array(W*H);
    const free=new Uint8Array(W*H); // vertices the smoothing passes may move
    const roadDistance=new Float32Array(W*H).fill(Infinity),roadHeight=new Float32Array(W*H);
    for(let j=0;j<H;j++)for(let i=0;i<W;i++){
      const x=this.xs[i],z=this.zs[j];
      if(i===0||j===0||i===W-1||j===H-1){this.heights[j*W+i]=BASE;continue;}
      // Two inverse-distance blends of road heights, both continuous: a sharp one
      // (~d^-24) keeps the shoulder level with its own road, a soft one (~d^-6)
      // spans the gaps between neighbouring sections (hairpins).
      let nearest=Infinity,nearestY=0,sum=0,weights=0,sharpSum=0,sharpWeights=0;
      for(let k=0;k<count;k++){
        const t=Math.min(1,Math.max(0,((x-ax[k])*dx[k]+(z-az[k])*dz[k])/len[k]));
        const ex=x-ax[k]-t*dx[k],ez=z-az[k]-t*dz[k],d2=ex*ex+ez*ez,y=ay[k]+t*dy[k];
        if(d2<nearest){nearest=d2;nearestY=y;}
        const w=1/((d2+16)*(d2+16)*(d2+16)),sharp=w*w*w*w;sum+=w*y;weights+=w;sharpSum+=sharp*y;sharpWeights+=sharp;
      }
      const distance=Math.sqrt(nearest);roadDistance[j*W+i]=distance;roadHeight[j*W+i]=nearestY;
      const road=THREE.MathUtils.lerp(sharpSum/sharpWeights,sum/weights,THREE.MathUtils.smoothstep(distance,36,76));
      let h=THREE.MathUtils.lerp(road-SHELF_DROP,BASE,THREE.MathUtils.smoothstep(distance,SHOULDER,SHOULDER+FALL));
      const toYard=Math.hypot(x-origin.x,z-origin.z),yardWeight=1-THREE.MathUtils.smoothstep(toYard,yard,yard+25);
      h=THREE.MathUtils.lerp(h,origin.y-SHELF_DROP,yardWeight);
      this.heights[j*W+i]=h;free[j*W+i]=distance>34&&yardWeight<.5?1:0;
    }
    // A few relaxation passes outside the shoulder soften the steps where two
    // road sections at different heights meet (between hairpin legs).
    const next=new Float32Array(this.heights);
    for(let pass=0;pass<6;pass++){
      for(let j=1;j<H-1;j++)for(let i=1;i<W-1;i++){const v=j*W+i;if(free[v])next[v]=(this.heights[v]*4+this.heights[v-1]+this.heights[v+1]+this.heights[v-W]+this.heights[v+W])/8;}
      this.heights.set(next);
    }
    const cap=()=>{for(let v=0;v<W*H;v++)if(roadDistance[v]<ROAD_CAP)this.heights[v]=Math.min(this.heights[v],roadHeight[v]-UNDER_ROAD);};
    cap();
    // Level a terrace under every building at the snow height of its centre,
    // never above what the road cap allows under its base (outside the corridor).
    const padVertices=(pad:TerrainPad,visit:(vertex:number,outside:number)=>void)=>{
      const reach=Math.hypot(pad.hx,pad.hz)+PAD_EDGE+PAD_BLEND;
      for(let j=1;j<H-1;j++){if(Math.abs(this.zs[j]-pad.z)>reach)continue;for(let i=1;i<W-1;i++){
        const dx=this.xs[i]-pad.x,dz=this.zs[j]-pad.z;if(Math.abs(dx)>reach)continue;
        const u=Math.max(Math.abs(dx*pad.ax+dz*pad.az)-pad.hx-PAD_EDGE,0),v=Math.max(Math.abs(-dx*pad.az+dz*pad.ax)-pad.hz-PAD_EDGE,0);
        visit(j*W+i,Math.hypot(u,v));
      }}
    };
    this.padLevels=pads.map(pad=>{let level=this.heightAt(pad.x,pad.z);padVertices(pad,(vertex,outside)=>{if(outside===0&&roadDistance[vertex]<ROAD_CAP)level=Math.min(level,roadHeight[vertex]-UNDER_ROAD);});return level;});
    // Neighbouring terraces blend continuously; a building's own base (weight 1) wins.
    const strength=new Float32Array(W*H),levelSum=new Float64Array(W*H),levelWeight=new Float64Array(W*H);
    for(const [k,pad] of pads.entries())padVertices(pad,(vertex,outside)=>{
      const weight=(1-THREE.MathUtils.smoothstep(outside,0,PAD_BLEND))*THREE.MathUtils.smoothstep(roadDistance[vertex],13.5,16);
      if(weight<=0)return;const sharp=weight**8;
      strength[vertex]=Math.max(strength[vertex],weight);levelSum[vertex]+=sharp*this.padLevels[k];levelWeight[vertex]+=sharp;
    });
    for(let v=0;v<W*H;v++)if(strength[v]>0)this.heights[v]=THREE.MathUtils.lerp(this.heights[v],levelSum[v]/levelWeight[v],strength[v]);
    cap();
    const positions=new Float32Array(W*H*3),uvs=new Float32Array(W*H*2),indices:number[]=[];
    for(let j=0;j<H;j++)for(let i=0;i<W;i++){const v=j*W+i;positions.set([this.xs[i],this.heights[v],this.zs[j]],v*3);uvs.set([this.xs[i]/24,this.zs[j]/24],v*2);}
    // Triangles a-c-b and b-c-d per cell (a=(i,j), b=(i+1,j), c=(i,j+1), d=(i+1,j+1)); heightAt() mirrors this split.
    for(let j=0;j<H-1;j++)for(let i=0;i<W-1;i++){const a=j*W+i,b=a+1,c=a+W,d=c+1;indices.push(a,c,b,b,c,d);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
    geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    this.mesh=new THREE.Mesh(geometry,material??new THREE.MeshBasicMaterial());this.mesh.name='frostline_ground';this.mesh.receiveShadow=true;
  }
  private cell(origin:number,count:number,v:number){return v<origin?0:Math.min(count+1,1+Math.floor((v-origin)/STEP));}
  /** Exact height of the rendered ground surface at (x, z). */
  heightAt(x:number,z:number){
    const W=this.xs.length;
    const i=Math.min(this.cell(this.x0,this.nx,x),W-2),j=Math.min(this.cell(this.z0,this.nz,z),this.zs.length-2);
    const u=THREE.MathUtils.clamp((x-this.xs[i])/(this.xs[i+1]-this.xs[i]),0,1),v=THREE.MathUtils.clamp((z-this.zs[j])/(this.zs[j+1]-this.zs[j]),0,1);
    const h=this.heights,a=h[j*W+i],b=h[j*W+i+1],c=h[(j+1)*W+i],d=h[(j+1)*W+i+1];
    return u+v<=1?a+u*(b-a)+v*(c-a):d+(1-u)*(c-d)+(1-v)*(b-d);
  }
  /** Lowest ground under a round footprint, so nothing overhangs a slope. */
  heightUnder(x:number,z:number,radius=0){
    let y=this.heightAt(x,z);
    if(radius>0)for(let k=0;k<8;k++){const a=k*Math.PI/4;y=Math.min(y,this.heightAt(x+Math.cos(a)*radius,z+Math.sin(a)*radius));}
    return y;
  }
}
