import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {CourseKind} from './course';

type Footprint = readonly [x:number,z:number,width:number,depth:number];
type LightingLayout = {width:number;depth:number;contact:readonly Footprint[]};

// Contact patches sit beneath actual supports and machinery, on the service
// deck. They complement the existing sun shadow when it leaves the chase box.
const LAYOUTS:Record<CourseKind,LightingLayout>={
  greenwater:{width:30,depth:25,contact:[[-2.5,.7,2.3,13],[2.5,.7,2.3,13]]},
  bitterpan:{width:28,depth:22,contact:[[-8,2,2.8,11],[8,2,2.8,11],[-9,-5,5,4],[9,-5,5,4],[0,7,7,7]]},
  nightshift:{width:26,depth:16,contact:[[0,1,25,13],[-8,-7,4,1.6],[8,-7,4,1.6]]},
  polarity:{width:24,depth:20,contact:[[-9,0,3.4,5],[9,0,3.4,5],[-5.5,-6,4.2,4.2],[5.5,-6,4.2,4.2]]},
  tideline:{width:23,depth:20,contact:[[-5,0,2.8,10],[5,0,2.8,10],[-9.4,-4,3.2,4],[9.4,-4,3.2,4]]},
  ascension:{width:28,depth:21,contact:[[-7,0,10,11],[7,0,10,11]]},
  dreamisland:{width:25,depth:22,contact:[[0,1,17,17],[-9.5,-1,3.4,8.8],[9.5,-1,3.4,8.8]]},
  afterglow:{width:26,depth:20,contact:[[-9.5,1,4.4,12],[9.5,1,4.4,12],[0,1,15,5],[-5,-4,5,5],[5,-4,5,5]]},
  frostline:{width:28,depth:23,contact:[[0,-1,11,12],[-8.5,5,4.4,5],[8.5,5,4.4,5]]},
};

/** Two bounded, merged decal draws. No new light or shadow-map passes. */
export function addSignatureLighting(root:THREE.Group,kind:CourseKind):void {
  const layout=LAYOUTS[kind];
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d')!;
  const fade=ctx.createRadialGradient(64,64,0,64,64,64);
  fade.addColorStop(0,'rgba(255,255,255,1)');
  fade.addColorStop(.35,'rgba(255,255,255,.7)');
  fade.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=fade;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);
  const add=(name:string,patches:readonly Footprint[],y:number,color:number,opacity:number)=>{
    const planes=patches.map(([x,z,w,d])=>new THREE.PlaneGeometry(w,d).rotateX(-Math.PI/2).translate(x,y,z));
    const geometry=mergeGeometries(planes)!;planes.forEach(plane=>plane.dispose());
    const material=new THREE.MeshBasicMaterial({map:texture,color,transparent:true,opacity,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-1,toneMapped:false});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;root.add(mesh);
  };
  add('signature_contact_shade',layout.contact,kind==='greenwater'?-.17:.018,0x101b1f,kind==='greenwater'?.3:.38);
  const lampX=layout.width/2-2,lampZ=-(layout.depth/2-.5);
  const poolWidth=kind==='greenwater'?2.2:3.6;
  const pools:Footprint[]=[[-lampX,lampZ+2,poolWidth,4],[lampX,lampZ+2,poolWidth,4]];
  if(kind==='nightshift')for(const x of [-7,0,7])pools.push([x,-6,5,3.4]);
  // The light falls inward from the authored service lamps, never onto the road.
  add('signature_service_light_spill',pools,.064,kind==='frostline'?0xffd5a1:0xffcc86,
    ['nightshift','polarity','afterglow','frostline'].includes(kind)?.22:.13);
  root.userData.contactLighting={patches:layout.contact.length,lightPools:pools.length,drawCalls:2};
}
