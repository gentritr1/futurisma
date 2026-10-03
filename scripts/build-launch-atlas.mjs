import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import { buildCourseOutline, fitOutlineTransform } from '../src/game/minimap-projection.js';

// Menu previews never import circuit runtimes. This small atlas comes
// from their real geometry; run again when a centreline or gate moves.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const entries = [['greenwater','course','GreenwaterCourse'],['bitterpan','bitterpan-course','BitterpanCourse'],['nightshift','nightshift-course','NightshiftCourse'],['polarity','polarity-course','PolarityCourse'],['tideline','tideline-course','TidelineCourse'],['ascension','ascension-course','AscensionCourse'],['dreamisland','dreamisland-course','DreamIslandCourse'],['afterglow','afterglow-course','AfterglowCourse'],['frostline','frostline-course','FrostlineCourse']];
// Course constructors also author sign textures. They are not rendered here.
globalThis.document = {createElement: () => ({width:1,height:1,getContext:()=>new Proxy({measureText:t=>({width:t.length*10}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k] ?? (()=>{})})})};
const atlas = {};
try {
  for (const [key, file, name] of entries) {
    const module = await server.ssrLoadModule(`/src/game/${file}.ts`);
    const course = new module[name]();
    const outline = buildCourseOutline(course);
    const fit = fitOutlineTransform(outline.bounds, 240, 230, 30);
    const point = p => [+(p.x * fit.scale + fit.offsetX).toFixed(2), +(p.z * fit.scale + fit.offsetY).toFixed(2)];
    const sample = t => point(course.sample(t).position);
    const points = Array.from({length:129}, (_,i)=>sample((course.startProgress+i/128)%1));
    const gates = Array.from({length:course.checkpointCount},(_,i)=>sample(course.checkpointProgress(i+1)));
    const scratch = course.createSampleScratch();
    const branches = (course.shortcuts ?? (course.shortcut ? [course.shortcut] : [])).map(b=>({from:b.from,to:b.to,points:b.stations?.map(s=>point({x:s.p[0],z:s.p[2]})) ?? (key==='polarity' ? Array.from({length:33},(_,i)=>point(course.sampleLane(b.from+(b.to-b.from)*i/32,1,scratch).position)) : [])}));
    atlas[key] = {length:course.length,laps:course.defaultLapCount,minLaps:course.minimumLapCount,maxLaps:course.maximumLapCount,finish:course.finishName,startProgress:course.startProgress,points,gates,branches};
    course.group.traverse(o=>{o.geometry?.dispose();});
  }
  await writeFile('src/game/launch-atlas.json', JSON.stringify(atlas));
  console.log(`Launch atlas: ${entries.length} real outlines, gate stations and branch paths.`);
} finally { await server.close(); }
