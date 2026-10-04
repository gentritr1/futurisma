import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {Vector3} from 'three';

const source=readFileSync('src/game/circuit-signature-audio.ts','utf8');
const compiled=stripTypeScriptTypes(source,{mode:'transform'}).replace("from 'three'",`from '${import.meta.resolve('three')}'`);
const {CircuitSignatureAudio}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const parameter=()=>({value:0,setTargetAtTime(value){this.value=value;}});
const node=()=>({connections:[],disconnects:0,connect(destination){this.connections.push(destination);},disconnect(){this.disconnects++;}});
let unlocked=false;
const ambience=node(),sources=[],gains=[],panners=[];
const context={sampleRate:48000,currentTime:0,
  createBuffer(channels,length){const data=new Float32Array(length);return {getChannelData:()=>data};},
  createBufferSource(){const result={...node(),starts:0,stops:0,start(){this.starts++;},stop(){this.stops++;}};sources.push(result);return result;},
  createGain(){const result={...node(),gain:parameter()};gains.push(result);return result;},
  createStereoPanner(){const result={...node(),pan:parameter()};panners.push(result);return result;},
};
const audio={environmentAudio:()=>unlocked?{context,ambience}:null};
const origin=new Vector3(),forward=new Vector3(0,0,-1),up=new Vector3(0,1,0);
const sound=new CircuitSignatureAudio(audio,'ascension');
const update=(tick,position,active=true)=>sound.update(tick,origin,position,forward,up,active);
update(1,new Vector3());assert.equal(sources.length,0,'No source before existing user-unlocked audio');
unlocked=true;update(1,new Vector3());assert.equal(sources.length,1);assert.equal(sources[0].starts,1);
assert.equal(panners[0].connections[0],ambience,'Uses the existing paused/muted/ducked ambience bus');
const active=gains[0].gain.value;assert.ok(active>0&&active<.02,'Local bed stays quiet');
update(2,new Vector3(),false);assert.ok(gains[0].gain.value<active*.2,'Deluge standby is quieter');
update(3,new Vector3(100,0,0));assert.equal(gains[0].gain.value,0,'Out of hearing range is silent');
update(4,new Vector3(20,0,0));assert.equal(panners[0].pan.value,-.8,'Machinery is on the left');
update(5,new Vector3(-20,0,0));assert.equal(panners[0].pan.value,.8,'Machinery is on the right');
assert.ok(sources[0].buffer.getChannelData(0).every(Number.isFinite),'Procedural samples are finite');
sound.reset();update(5,new Vector3());assert.equal(sources.length,1,'Retry reuses the source');
sound.dispose();sound.dispose();update(6,new Vector3());assert.equal(sources[0].stops,1);assert.equal(sources.length,1);
assert.equal(gains[0].disconnects,1);assert.equal(panners[0].disconnects,1);
console.log('Signature audio PASS: user unlock, shared mix bus, quiet local falloff, stereo placement, state response, retry and idempotent disposal.');
