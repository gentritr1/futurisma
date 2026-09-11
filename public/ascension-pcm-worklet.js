// Six synchronous channels: post-master stereo, music-bus stereo, event-bus stereo.
// Integer conversion is the only sample conversion: no codec or resampling.
class AscensionPcm extends AudioWorkletProcessor {
 constructor(){super();this.start=null;this.end=null;this.cursor=0;this.buffer=null;this.port.onmessage=({data})=>{this.start=data.startFrame;this.end=this.start+data.frames;this.buffer=new Int16Array(data.frames*6);};}
 process(inputs,outputs){
  outputs[0]?.forEach(c=>c.fill(0));
  if(this.start===null)return true;
  const count=outputs[0][0].length;
  for(let i=0;i<count;i++){
   const frame=currentFrame+i;if(frame<this.start||frame>=this.end)continue;
   for(let bus=0;bus<3;bus++)for(let channel=0;channel<2;channel++){
    const v=inputs[bus]?.[channel]?.[i]??inputs[bus]?.[0]?.[i]??0;
    this.buffer[this.cursor++]=Math.round(Math.max(-1,Math.min(1,v))*(v<0?32768:32767));
   }
  }
  if(currentFrame+count>=this.end){this.port.postMessage({startFrame:this.start,endFrame:this.end,capturedFrames:this.cursor/6,sampleRate,pcm:this.buffer},[this.buffer.buffer]);this.start=null;this.buffer=null;}
  return true;
 }
}
registerProcessor('ascension-pcm',AscensionPcm);
