import * as THREE from "three";

export type TideUniforms = {time:{value:number};water:{value:number};effects:THREE.Texture|null};
const noise = `
float tideHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float tideNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(tideHash(i),tideHash(i+vec2(1,0)),f.x),mix(tideHash(i+vec2(0,1)),tideHash(i+vec2(1,1)),f.x),f.y);}
`;
const projection = `
varying vec3 vTideWorld; varying vec2 vTideUv;
uniform float tideTime; uniform float tideWater; uniform sampler2D tideEffects;
${noise}
float waterLight(vec3 p){
 vec2 flow=p.xz*.035+vec2(tideTime*.008,-tideTime*.006);
 vec3 a=texture2D(tideEffects,fract(flow)*.45+vec2(.025,.525)).rgb;
 vec3 b=texture2D(tideEffects,fract(flow*1.31+vec2(.17,tideTime*.009))*.45+vec2(.025,.525)).rgb;
 return (a.g*.7+b.g*.4)*smoothstep(-.5,3.,tideWater-p.y);
}
`;

/** Painted diffuse detail stays in Lambert's lighting path, including real lamps. */
export function tideRoadMaterial(atlas:THREE.Texture|null,uniforms:TideUniforms,gateDistances:number[],gantryDistances:number[]):THREE.MeshLambertMaterial {
 const material=new THREE.MeshLambertMaterial({map:atlas,side:THREE.DoubleSide,color:0xe3dfce});
 // Keep the auxiliary painted texture reachable by the shared resource disposer.
 Object.assign(material,{tideEffectsTexture:uniforms.effects});
 material.onBeforeCompile=shader=>{
  shader.uniforms.tideTime=uniforms.time;shader.uniforms.tideWater=uniforms.water;shader.uniforms.tideEffects={value:uniforms.effects};
  shader.vertexShader='varying vec3 vTideWorld;varying vec2 vTideUv;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTideWorld=(modelMatrix*vec4(transformed,1.)).xyz;vTideUv=uv;');
  shader.fragmentShader=projection+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
   float grain=tideNoise(vTideWorld.xz*2.1);
   float macro=tideNoise(vTideWorld.xz*.016)*.6+tideNoise(vTideWorld.xz*.053)*.4;
   vec2 uv=vec2(.512+fract(vTideUv.x*2.)*.476,.012+fract(vTideUv.y/15.)*.476);
   vec3 paint=texture2D(map,uv).rgb;
   paint*=.72+macro*.48;
   vec2 repairCell=floor(vec2(vTideUv.x*5.,vTideUv.y/13.));
   vec2 local=fract(vec2(vTideUv.x*5.,vTideUv.y/13.));
   float repair=step(.77,tideHash(repairCell))*step(.06,local.x)*step(local.x,.92)*step(.08,local.y)*step(local.y,.9);
   paint=mix(paint,texture2D(map,vec2(.015,.515)+local*.47).rgb*.75,repair*.6);
   float bend=sin(vTideUv.y*.014)*.10;
   float skids=exp(-pow((vTideUv.x-.37-bend)*160.,2.))+exp(-pow((vTideUv.x-.58-bend)*170.,2.));
   paint*=1.-skids*.48*smoothstep(.25,.6,tideNoise(vec2(vTideUv.y*.035,2.)));
   float edge=abs(vTideUv.x-.5);
   float damp=smoothstep(.3,.49,edge)*tideNoise(vTideWorld.xz*.15);
   paint=mix(paint,vec3(.03,.055,.026),damp*.4);
   float hazard=step(.447,edge)*(1.-step(.465,edge));
   float stripe=step(.5,fract(vTideUv.y*.65+vTideUv.x*14.));
   paint=mix(paint,mix(vec3(.015),vec3(.6,.37,.06),stripe),hazard*.88);
   float dash=(1.-smoothstep(.005,.012,edge))*step(.58,fract(vTideUv.y/18.));
   paint=mix(paint,vec3(.42,.43,.36),dash*.55);
   float gateDistance=${gateDistances.map(d=>`abs(vTideUv.y-(${(d-24).toFixed(2)}))`).reduce((a,b)=>`min(${a},${b})`)};
   float arrow=(1.-step(5.,gateDistance))*step(abs(vTideUv.x-.5)*24.,1.5+gateDistance*.48)*step(.15,abs(abs(vTideUv.x-.5)*24.-gateDistance*.48));
   paint=mix(paint,vec3(.53,.43,.2),arrow*.52*(.4+grain*.6));
   float approach=${gantryDistances.map(d=>`abs(vTideUv.y-${(d-22).toFixed(2)})`).reduce((a,b)=>`min(${a},${b})`)};
   float bars=(1.-step(14.,approach))*step(.62,fract(vTideUv.y/6.))*(1.-step(.32,edge))*step(.12,edge);
   paint=mix(paint,vec3(.47,.35,.15),bars*.55);
   diffuseColor.rgb*=paint;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(.02,.12,.14)*waterLight(vTideWorld);\ntotalEmissiveRadiance+=diffuseColor.rgb*vec3(.22,.17,.10)*step(vTideWorld.y,tideWater);');
 };
 material.customProgramCacheKey=()=>"tideline-lit-painted-road-v3";
 return material;
}

/** Projected caustics and historic waterlines on the actual exported geometry. */
export function installTideSurface(material:THREE.MeshLambertMaterial,uniforms:TideUniforms):void {
 const lamps=material.name.includes('emissive');
 material.onBeforeCompile=shader=>{
  shader.uniforms.tideTime=uniforms.time;shader.uniforms.tideWater=uniforms.water;shader.uniforms.tideEffects={value:uniforms.effects};
  shader.vertexShader='varying vec3 vTideWorld;varying vec2 vTideUv;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTideWorld=(modelMatrix*vec4(transformed,1.)).xyz;vTideUv=vec2(0.);');
  shader.fragmentShader=projection+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float streak=tideNoise(vTideWorld.xz*.8);
    float historic=min(abs(vTideWorld.y+15.+streak*.3),abs(vTideWorld.y+27.+streak*.3));
    float band=1.-smoothstep(.3,1.5,historic);
    float fringe=(1.-smoothstep(.08,.38,historic-.75))*step(.65,streak);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.014,.04,.026),band*.62);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.14,.034),fringe*.3);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
    ${lamps?'float exposed=smoothstep(-.4,.4,vTideWorld.y-tideWater);totalEmissiveRadiance*=mix(.28,1.5,exposed)*(1.-.12*sin(tideTime*8.+vTideWorld.y));':'totalEmissiveRadiance+=vec3(.055,.26,.3)*waterLight(vTideWorld);'}
  `);
 };
 material.customProgramCacheKey=()=>lamps?'tideline-waterline-lamps-v3':'tideline-waterline-surface-v3';
}
