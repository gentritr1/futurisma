import * as THREE from 'three';
import route from './data/ascension/route.json';

/** Painted land and the Tideline wave/flow equations, under the course lighting. */
export class AscensionTerrain {
 readonly root=new THREE.Group();
 readonly ready:Promise<void>;
 private readonly time={value:0};
 constructor(){
  this.root.name='ascension_estuary_terrain';
  const atlas=new THREE.Texture();
  this.ready=new THREE.TextureLoader().loadAsync('/assets/ascension/textures/water.jpg').then(t=>{atlas.copy(t);atlas.colorSpace=THREE.SRGBColorSpace;atlas.needsUpdate=true;});
  const land=new THREE.MeshLambertMaterial({map:atlas,side:THREE.DoubleSide});
  land.name='AP_terrain_water_atlas';
  land.onBeforeCompile=shader=>{
   shader.vertexShader='attribute vec3 terrainWeights; varying vec3 groundWeights; varying vec3 groundPosition;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ngroundWeights=terrainWeights; groundPosition=position;');
   shader.fragmentShader='varying vec3 groundWeights; varying vec3 groundPosition;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`vec2 continuousGroundUV=groundPosition.xz*.25;
    vec2 groundUV=fract(continuousGroundUV)*.46+.02;
    vec2 dx=dFdx(continuousGroundUV)*.46,dy=dFdy(continuousGroundUV)*.46;
    vec3 mud=textureGrad(map,groundUV,dx,dy).rgb;
    vec3 grass=textureGrad(map,groundUV+vec2(.5,.5),dx,dy).rgb;
    vec3 gravel=textureGrad(map,groundUV+vec2(.5,0.),dx,dy).rgb;
    diffuseColor.rgb*=mud*groundWeights.x*2.4+grass*vec3(2.6,3.8,2.2)*groundWeights.y+gravel*groundWeights.z*3.2;`);
  };
  const positions:number[]=[],weights:number[]=[],indices:number[]=[];
  const inland=route.stations.filter((_,i)=>i/route.count<.65||i/route.count>.9).filter((_,i)=>i%4===0);
  const trench=route.shortcut.stations.filter((_,i)=>i%3===0);
  const nearest=(x:number,z:number,stations:{p:number[]}[])=>{
   let distance=Infinity,height=4;
   for(const s of stations){const d=Math.hypot(x-s.p[0],z-s.p[2]);if(d<distance){distance=d;height=s.p[1];}}
   return {distance,height};
  };
  const smooth=(a:number,b:number,x:number)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const steps=100,spacing=16;
  for(let j=0;j<=steps;j++)for(let i=0;i<=steps;i++){
   const x=-800+i*spacing,z=-800+j*spacing,n=nearest(x,z,inland),cut=nearest(x,z,trench);
   const shore=1-smooth(95,170,n.distance);
   let y=-6.5+shore*(8+.45*Math.sin(x*.029)*Math.cos(z*.034));
   y=Math.min(y,THREE.MathUtils.lerp(cut.height-1.3,10,smooth(21,49,cut.distance)));
   positions.push(x,y,z);
   const grass=shore*smooth(18,38,n.distance),gravel=shore*(1-smooth(18,38,n.distance));
   weights.push(1-shore,grass,gravel);
   if(i<steps&&j<steps){const a=j*(steps+1)+i,b=a+steps+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  // The apron meets each road edge, with a sloped outer shoulder into the land.
  for(const [stations,isTrench] of [[route.stations,false],[route.shortcut.stations,true]] as const){
   for(let i=0;i<stations.length-1;i++){
    if(!isTrench&&i/route.count>=.65&&i/route.count<=.9)continue;
    if(!isTrench){const cut=nearest(stations[i].p[0],stations[i].p[2],trench);if(cut.distance<50&&cut.height<2.5)continue;}
    for(const side of [-1,1]){
     const base=positions.length/3;
     for(const s of [stations[i],stations[i+1]]){
      const right=new THREE.Vector3(...s.t).cross(new THREE.Vector3(0,1,0)).normalize();
      for(const extra of [0,5,12]){
       const offset=side*(('width' in s?s.width:20)/2+extra);
       positions.push(s.p[0]+right.x*offset,s.p[1]-(extra===12?2.8:.16),s.p[2]+right.z*offset);weights.push(0,extra===12?1:0,extra===12?0:1);
      }
     }
     indices.push(base,base+3,base+1,base+1,base+3,base+4,base+1,base+4,base+2,base+2,base+4,base+5);
    }
   }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('terrainWeights',new THREE.Float32BufferAttribute(weights,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const ground=new THREE.Mesh(geometry,land);ground.name='ascension_mud_grass_gravel_apron';this.root.add(ground);
  // A mask keeps baseline sea water out of the excavated trench, like Tideline's chamber mask.
  const size=256,data=new Uint8Array(size*size*4);
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
   const x=(i+.5)/size*1600-800,z=(j+.5)/size*1600-800,cut=nearest(x,z,trench);
   data[(j*size+i)*4]=cut.distance<48&&cut.height<0?255:0;data[(j*size+i)*4+3]=255;
  }
  const mask=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);mask.needsUpdate=true;
  const water=new THREE.MeshLambertMaterial({map:atlas,transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide});water.name='AP_tideline_estuary_water';
  water.onBeforeCompile=shader=>{
   shader.uniforms.waterTime=this.time;shader.uniforms.trenchMask={value:mask};
   shader.vertexShader='uniform float waterTime; varying vec3 waterWorld;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    transformed.y+=sin(position.x*.031+waterTime*.3)*.14+sin(position.z*.041-waterTime*.24)*.10;
    waterWorld=(modelMatrix*vec4(transformed,1.)).xyz;`);
   shader.fragmentShader='uniform float waterTime; uniform sampler2D trenchMask; varying vec3 waterWorld;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`if(texture2D(trenchMask,(waterWorld.xz+800.)/1600.).r>.5)discard;
    vec2 waterUV=fract(waterWorld.xz*.014+vec2(waterTime*.002,-waterTime*.003));
    vec3 paint=texture2D(map,waterUV*.47+vec2(.015,.515)).rgb;
    float wave=pow(max(0.,sin(waterWorld.x*.13+waterTime*.4)*cos(waterWorld.z*.16-waterTime*.3)),8.);
    diffuseColor.rgb*=paint*vec3(.3,.7,.75)+vec3(.02,.12,.13)*wave*.18;`);
  };
  const seaGeometry=new THREE.PlaneGeometry(6000,6000,48,48);seaGeometry.rotateX(-Math.PI/2);
  const sea=new THREE.Mesh(seaGeometry,water);sea.position.y=-4.3;sea.name='ascension_tideline_water_horizon';sea.renderOrder=1;this.root.add(sea);
 }
 update(){this.time.value=performance.now()/1000;}
}
