import {EngineAudio,publishAmbienceCue} from '../game/audio';
import {TidelineCourse} from '../game/tideline-course';
const course=new TidelineCourse();course.setLapBoard(3);course.advanceTide(8);
const audio=new EngineAudio();
document.getElementById('start')!.onclick=async()=>{
 publishAmbienceCue(course,.15);await audio.start();
 const tick=()=>{audio.update(0,0,0,false,1,0,publishAmbienceCue(course,.15),true);requestAnimationFrame(tick);};tick();
 document.getElementById('state')!.textContent=JSON.stringify({ready:true,mode:'stationary listening position',lap:3,progress:.15,water:course.tide.waterLevel,zone:course.audioZoneAt(.15)});
};
