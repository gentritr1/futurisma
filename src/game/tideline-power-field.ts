import * as THREE from 'three';
import {refractingSurface,captureRefraction} from './tideline-refraction';
/** Same surfaced dome and refracting exhaust cone for player and rival powers. */
export class TidelinePowerField {
 readonly root=new THREE.Group();
 private readonly shield:THREE.Mesh;private readonly heat:THREE.Mesh;
 private readonly clock={value:0};
 private readonly domeMaterial:THREE.MeshLambertMaterial;
 constructor(){
  this.root.name='tideline_power_fields';
  this.domeMaterial=new THREE.MeshLambertMaterial({name:'sodium_hex_refund_dome',color:0xc7b586,emissive:0xdab776,emissiveIntensity:.65,transparent:true,opacity:.22,depthWrite:false,side:THREE.DoubleSide});
  this.domeMaterial.forceSinglePass=true;
  const geometry=new THREE.SphereGeometry(1,32,16);
  this.domeMaterial.onBeforeCompile=shader=>{
   shader.vertexShader='varying vec2 vFieldUv;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFieldUv=uv;');
   shader.fragmentShader='varying vec2 vFieldUv;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 grid=vFieldUv*vec2(16.,8.);grid.x+=mod(floor(grid.y),2.)*.5;
    vec2 cell=abs(fract(grid)-.5);
    float hex=max(cell.x*.866+cell.y*.5,cell.y);
    float edge=smoothstep(.36,.41,hex)*(1.-smoothstep(.45,.49,hex));
    diffuseColor.a*=.045+edge*.95;`);
  };
  this.shield=new THREE.Mesh(geometry,this.domeMaterial);this.shield.name='tideline_refund_hex_dome';this.shield.position.set(0,.1,-.55);this.shield.scale.set(1.9,1.3,3.8);this.root.add(this.shield);
  const haze=refractingSurface('surge_heat_refraction',this.clock,true);
  const cone=new THREE.CylinderGeometry(.26,1,4.5,12,4,true);cone.rotateX(-Math.PI/2);cone.translate(0,0,4.3);
  this.heat=new THREE.Mesh(cone,haze);this.heat.name='surge_trailing_heat_cone';this.heat.position.y=.2;this.root.add(this.heat);captureRefraction(this.heat);
  this.update(0,true,false,false,false);
 }
 update(time:number,reduced:boolean,surge:boolean,shield:boolean,refundWindow:boolean):void {
  this.clock.value=reduced?0:time;this.heat.visible=surge&&!reduced;this.shield.visible=shield;
  const pulse=refundWindow&&!reduced?.65+.35*Math.sin(time*7):1;
  this.domeMaterial.opacity=refundWindow?.22+pulse*.18:.13;
  this.domeMaterial.emissiveIntensity=refundWindow?.8+pulse*.45:.32;
 }
}
