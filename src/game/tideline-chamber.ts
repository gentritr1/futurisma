import * as THREE from "three";
import route from "./data/tideline/route.json";

type Station={p:number[];t:number[]};
const main=route.stations;
const branch=route.shortcut.stations;
const up=new THREE.Vector3(0,1,0);
const chamberWidth=16.8;
function heightAt(lateral:number):number {return 4+10*Math.sqrt(Math.max(0,1-(lateral/chamberWidth)**2));}
function inside(point:THREE.Vector3,stations:Station[]):boolean {
 for(const s of stations) {
  const dx=point.x-s.p[0],dz=point.z-s.p[2];
  if(dx*dx+dz*dz>chamberWidth**2)continue;
  const along=dx*s.t[0]+dz*s.t[2];if(Math.abs(along)>2.4)continue;
  const side=Math.abs(-dx*s.t[2]+dz*s.t[0]);
  if(point.y>s.p[1]-.5 && point.y<s.p[1]+heightAt(side)-.15)return true;
 }
 return false;
}

/** Outer shell of the main chamber and branch hall, joined at the two mouths. */
export function chamberGeometry():THREE.BufferGeometry {
 const vertices:number[]=[],indices:number[]=[];
 const cross:Array<[number,number]>=[[-chamberWidth,-.4]];
 for(let i=0;i<=10;i++){const a=Math.PI-i*Math.PI/10;cross.push([chamberWidth*Math.cos(a),4+10*Math.sin(a)]);}
 cross.push([chamberWidth,-.4]);
 for(const [stations,other] of [[main,branch],[branch,main]] as [Station[],Station[]][]) {
  const closed=stations===main;
  for(let i=0;i<(closed?stations.length:stations.length-1);i++) {
   const a=stations[i],b=stations[(i+1)%stations.length];
   if(a.p[1]>3 && b.p[1]>3)continue;
   for(let k=0;k<cross.length-1;k++) {
    const corners:THREE.Vector3[]=[];
    for(const st of [a,b]) {
     const right=new THREE.Vector3(...st.t as [number,number,number]).cross(up).normalize();
     for(const c of [cross[k],cross[k+1]])corners.push(new THREE.Vector3(...st.p as [number,number,number]).addScaledVector(right,c[0]).addScaledVector(up,c[1]));
    }
    const middle=corners.reduce((v,p)=>v.add(p),new THREE.Vector3()).multiplyScalar(.25);
    if(inside(middle,other))continue;
    const first=vertices.length/3;for(const p of corners)vertices.push(...p);
    indices.push(first,first+2,first+3,first,first+3,first+1);
   }
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

/** Height mask clips the outside water surface where it would enter dry air. */
export function chamberWaterMask():THREE.DataTexture {
 const size=1024,span=1800,pixels=new Uint8Array(size*size*4),ceilings=new Float32Array(size*size).fill(-100),floors=new Float32Array(size*size).fill(100);
 for(const s of [...main,...branch]) {
  if(s.p[1]>3)continue;
  const cx=(s.p[0]+span/2)/span*size,cy=(s.p[2]+span/2)/span*size,r=chamberWidth/span*size;
  for(let y=Math.max(0,Math.floor(cy-r));y<=Math.min(size-1,Math.ceil(cy+r));y++)for(let x=Math.max(0,Math.floor(cx-r));x<=Math.min(size-1,Math.ceil(cx+r));x++) {
   const dx=(x+.5-cx)*span/size,dz=(y+.5-cy)*span/size;
   if(dx*dx+dz*dz>chamberWidth**2)continue;
   const along=dx*s.t[0]+dz*s.t[2];if(Math.abs(along)>3.8)continue;
   const side=Math.abs(-dx*s.t[2]+dz*s.t[0]),ceiling=s.p[1]+heightAt(side),index=y*size+x;
   ceilings[index]=Math.max(ceilings[index],ceiling);floors[index]=Math.min(floors[index],s.p[1]-.75);
   pixels[index*4]=255;pixels[index*4+1]=Math.floor((floors[index]+40)/80*255);pixels[index*4+2]=Math.ceil((ceilings[index]+40)/80*255);pixels[index*4+3]=255;
  }
 }
 const texture=new THREE.DataTexture(pixels,size,size);texture.needsUpdate=true;texture.minFilter=texture.magFilter=THREE.NearestFilter;return texture;
}

/** Narrow painted gasket rails make each pressure-glass panel visibly enclosed. */
export function chamberFrames():THREE.BufferGeometry {
 const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
 function strip(a:THREE.Vector3,b:THREE.Vector3,offset:THREE.Vector3,other:Station[]):void {
  if(inside(a.clone().add(b).multiplyScalar(.5),other))return;
  const first=positions.length/3;
  for(const p of [a.clone().sub(offset),a.clone().add(offset),b.clone().sub(offset),b.clone().add(offset)])positions.push(...p);
  uvs.push(.02,.52,.12,.52,.02,.97,.12,.97);indices.push(first,first+2,first+1,first+1,first+2,first+3);
 }
 const ring:Array<[number,number]>=[[-16.7,-.3]];
 for(let i=0;i<=10;i++){const angle=Math.PI-i*Math.PI/10;ring.push([16.7*Math.cos(angle),3.96+9.94*Math.sin(angle)]);}
 ring.push([16.7,-.3]);
 for(const [stations,other] of [[main,branch],[branch,main]] as [Station[],Station[]][]) {
  const point=(s:Station,c:[number,number])=>new THREE.Vector3(...s.p as [number,number,number]).addScaledVector(new THREE.Vector3(...s.t as [number,number,number]).cross(up).normalize(),c[0]).addScaledVector(up,c[1]);
  for(let i=0;i<stations.length-4;i+=4) {
   const a=stations[i],b=stations[i+4];if(a.p[1]>3&&b.p[1]>3)continue;
   const depth=new THREE.Vector3(...a.t as [number,number,number]).multiplyScalar(.10);
   for(let k=0;k<ring.length-1;k++)strip(point(a,ring[k]),point(a,ring[k+1]),depth,other);
   for(const k of [1,3,6,9,11]) {
    const width=k===1||k===11?up.clone().multiplyScalar(.14):new THREE.Vector3(...a.t as [number,number,number]).cross(up).normalize().multiplyScalar(.14);
    strip(point(a,ring[k]),point(b,ring[k]),width,other);
   }
  }
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
