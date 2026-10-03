import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const maps=process.argv.slice(2).filter(v=>!v.startsWith('--'));
if(!maps.length)maps.push('greenwater','bitterpan','nightshift','polarity','tideline','ascension','dreamisland','afterglow','frostline');
const reduce=process.argv.includes('--reduce');
const audit=process.argv.includes('--sites');
const polish=process.argv.includes('--polish');
const surfaces=process.argv.includes('--surfaces'),beforeSurface=process.argv.includes('--before');
const pixel=process.argv.includes('--pixel');
const output=surfaces?`art/evidence/surface-finish/${beforeSurface?'before':'after'}`:polish?'art/evidence/circuit-polish-final':'art/evidence/circuit-signatures';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
const report=[];
try{
  for(const map of maps){
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[],warnings=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning'&&/circuit scene|surface finish/.test(m.text()))warnings.push(m.text());});
    await page.route('**/src/game/game.ts*',async route=>{
      const response=await route.fetch();const body=(await response.text()).replace('this.renderer.outputColorSpace = THREE.SRGBColorSpace;','this.renderer.outputColorSpace = THREE.SRGBColorSpace; window.__game = this;');
      await route.fulfill({response,body});
    });
    await page.goto(`http://127.0.0.1:5218/?map=${map}&quality=high&render=${pixel?'ps2':'agx'}&music=0&voice=0&diagnostics=1${reduce?'&motion=reduce':''}${process.argv.includes('--wide')?'&siteWide=1':''}${beforeSurface?'&surfaceFinish=0':''}`);
    await page.waitForFunction(()=>window.__game?.circuitRuntime&&document.body.dataset.phase==='intro',null,{timeout:60000});
    await page.waitForFunction(()=>!document.body.dataset.launch,{timeout:20000});
    await page.waitForFunction(()=>window.__game?.sceneAssets?.environmentReady,null,{timeout:60000});
    if(surfaces&&!beforeSurface)await page.waitForFunction(()=>window.__game.course.group.userData.surfaceFinish,null,{timeout:30000});
    if(surfaces&&!beforeSurface){
      const finish=await page.evaluate(()=>window.__game.course.group.userData.surfaceFinish);
      assert.ok(finish.materials>0,`${map}: road materials actually enhanced`);
      assert.ok(finish.drainInstances>0&&finish.drainInstances<=140);
    }
    const data=await page.evaluate(()=>window.__game.course.group.getObjectByName('circuit_signature')?.userData);
    if(!data){report.push({map,errors,warnings});await page.close();continue;}
    if(audit){
      await page.waitForFunction(()=>window.__game.sceneAssets.environmentReady,null,{timeout:60000});
      const sites=await page.evaluate(async()=>{
        const g=window.__game,root=g.course.group.getObjectByName('circuit_signature');
        const triangles=[];
        const {Vector3,Matrix4,Triangle}=await import('/node_modules/.vite/deps/three.js');
        const point=new Vector3(),world=new Matrix4(),instance=new Matrix4();
        const env=g.scene;
        env?.updateMatrixWorld(true);
        env?.traverse(mesh=>{
          if(!mesh.isMesh||/sky|panorama|reflection|halation|puddle/i.test(mesh.name))return;
          let parent=mesh;while(parent){if(parent===root||/totem_vehicle_root|totem_rival_fleet|ghost/i.test(parent.name))return;parent=parent.parent;}
          const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
          for(let instanceIndex=0;instanceIndex<(mesh.isInstancedMesh?mesh.count:1);instanceIndex++){
            if(mesh.isInstancedMesh){mesh.getMatrixAt(instanceIndex,instance);world.multiplyMatrices(mesh.matrixWorld,instance);}else world.copy(mesh.matrixWorld);
            const count=index?index.count:p.count;
            for(let i=0;i<count;i+=3){
              const vertices=[];
              for(let j=0;j<3;j++){point.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(world);vertices.push(point.clone());}
              const minY=Math.min(...vertices.map(v=>v.y)),maxY=Math.max(...vertices.map(v=>v.y));
              if(maxY-minY<.5)continue;
              const path=[];let owner=mesh;while(owner){path.push(owner.name||owner.type);owner=owner.parent;}
              triangles.push({name:path.reverse().join('/'),minY,maxY,triangle:new Triangle(...vertices.map(v=>v.setY(0)))});
            }
          }
        });
        const baseline=root.userData.progress,radius=root.userData.radius;
        const candidates=[],closest=new Vector3(),center=new Vector3();
        const route=Array.from({length:Math.ceil(g.course.length/4)},(_,i)=>g.course.sample(i/Math.ceil(g.course.length/4)));
        const steps=location.search.includes('siteWide=1')?75:8;
        for(const side of [root.userData.side,-root.userData.side])for(let step=-steps;step<=steps;step++){
          const progress=baseline+step*.006,s=g.course.sample(progress),apron=side<0?s.apronLeft:s.apronRight;
          const origin=s.position.clone().addScaledVector(s.right,side*(s.halfWidth+apron+radius+8));center.copy(origin).setY(0);
          const clearance=Math.min(...route.map(s=>Math.hypot(s.position.x-origin.x,s.position.z-origin.z)-s.halfWidth-Math.max(s.apronLeft,s.apronRight)-radius-2));
          if(clearance<5)continue;
          const collisions=new Map();
          for(const t of triangles){
            if(t.maxY<origin.y+.8||t.minY>origin.y+24)continue;
            t.triangle.closestPointToPoint(center,closest);
            if(closest.distanceTo(center)<radius+2)collisions.set(t.name,(collisions.get(t.name)||0)+1);
          }
          candidates.push({progress,side,origin:origin.toArray(),clearance,hits:[...collisions.values()].reduce((a,b)=>a+b,0),meshes:[...collisions.entries()]});
        }
        return candidates.sort((a,b)=>a.hits-b.hits||Math.abs(a.progress-baseline)-Math.abs(b.progress-baseline)).slice(0,12);
      });
      report.push({map,sites});console.log(map,JSON.stringify(sites.slice(0,5)));await page.close();continue;
    }
    assert.ok(data.clearanceMeters>=5,`${map}: clear racing envelope`);
    assert.ok(data.triangles<6500,`${map}: bounded triangles`);
    assert.ok(data.maxRenderedTriangles<6500,`${map}: bounded instanced triangles`);
    if(polish){
      const lighting=await page.evaluate(()=>{
        const root=window.__game.course.group.getObjectByName('circuit_signature');
        return {lighting:root.userData.contactLighting,contact:Boolean(root.getObjectByName('signature_contact_shade')),
          spill:Boolean(root.getObjectByName('signature_service_light_spill'))};
      });
      assert.equal(lighting.lighting.drawCalls,2);assert.ok(lighting.contact&&lighting.spill);
      if(map==='bitterpan'){
        const spans=await page.evaluate(async()=>{
          const {Matrix4,Vector3}=await import('/node_modules/.vite/deps/three.js');
          const mesh=window.__game.course.group.getObjectByName('map02_checkpoint_pylons'),matrix=new Matrix4();
          const rows=[];
          for(let gate=0;gate<mesh.count/3;gate++){
            mesh.getMatrixAt(gate*3,matrix);const left=new Vector3().setFromMatrixPosition(matrix);
            mesh.getMatrixAt(gate*3+1,matrix);const right=new Vector3().setFromMatrixPosition(matrix);
            mesh.getMatrixAt(gate*3+2,matrix);const beamWidth=new Vector3().setFromMatrixScale(matrix).x*mesh.geometry.parameters.width;
            rows.push({postSpan:left.distanceTo(right)+mesh.geometry.parameters.width,beamWidth});
          }
          return rows;
        });
        assert.ok(spans.length>0);for(const span of spans)assert.ok(Math.abs(span.postSpan-span.beamWidth)<.002,'Checkpoint beam meets both posts');
      }
      await page.screenshot({path:`${output}/${map}-menu.png`});
    }
    await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__game.phase==='running');
    await page.waitForTimeout(350);
    const before=await page.evaluate(()=>window.__game.course.group.getObjectByName('circuit_signature').userData.tick);
    await page.waitForTimeout(450);
    const after=await page.evaluate(()=>window.__game.course.group.getObjectByName('circuit_signature').userData.tick);
    assert.ok(after>before,'Running advances set piece');
    await page.keyboard.press('p');await page.waitForFunction(()=>window.__game.phase==='paused');
    const paused=await page.evaluate(()=>window.__game.course.group.getObjectByName('circuit_signature').userData.tick);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.__game.course.group.getObjectByName('circuit_signature').userData.tick),paused,'Pause freezes scene clock');
    await page.evaluate(()=>{
      const g=window.__game,root=g.course.group.getObjectByName('circuit_signature'),s=g.course.sample(root.userData.progress);
      const approach=g.course.sample(root.userData.progress-45/g.course.length);
      g.camera.position.copy(approach.position).addScaledVector(approach.tangent,-11.5).addScaledVector(approach.up,5.3);
      g.camera.up.copy(approach.up);g.camera.lookAt(s.position.clone().addScaledVector(s.up,2));g.camera.fov=62;g.camera.updateProjectionMatrix();
      document.querySelector('#pause-panel').style.display='none';document.querySelector('.hud').style.visibility='hidden';document.querySelector('#countdown').style.display='none';
      g.atmosphere.updateFog(2,root.userData.progress,g.lap,g.totalLaps,'running');
      g.sceneAssets.authoredEnvironment?.updateVisibility(g.camera);g.renderer.render(g.scene,g.camera);
    });
    await page.screenshot({path:`${output}/${map}-approach${reduce?'-reduced':''}.png`});
    await page.evaluate(()=>{
      const g=window.__game,root=g.course.group.getObjectByName('circuit_signature');
      const target=root.position.clone().add({x:0,y:6,z:0});
      const front={x:0,y:0,z:-1};const v=g.course.sample(root.userData.progress).position.clone().sub(root.position).setY(0).normalize();
      g.camera.position.copy(target).addScaledVector(v,43);g.camera.position.y+=8;
      g.camera.up.set(0,1,0);g.camera.lookAt(target);g.camera.fov=48;g.camera.updateProjectionMatrix();
      g.sceneAssets.authoredEnvironment?.updateVisibility(g.camera);g.renderer.render(g.scene,g.camera);
    });
    await page.screenshot({path:`${output}/${map}-site${reduce?'-reduced':''}.png`});
    if(surfaces){
      await page.evaluate(()=>{
        const g=window.__game;
        const sites={greenwater:.16,bitterpan:.26,nightshift:.75,polarity:.10,tideline:.19,ascension:.22,dreamisland:.16,afterglow:.17,frostline:.06};
        const progress=sites[g.course.kind],s=g.course.sample(progress),behind=g.course.sample(progress-9/g.course.length);
        g.camera.position.copy(behind.position).addScaledVector(behind.right,behind.halfWidth-2.3).addScaledVector(behind.up,2.2);
        g.camera.up.copy(s.up);g.camera.lookAt(s.position.clone().addScaledVector(s.right,s.halfWidth-2));g.camera.fov=65;g.camera.updateProjectionMatrix();
        g.atmosphere.updateFog(2,progress,g.lap,g.totalLaps,'running');
        g.sceneAssets.authoredEnvironment?.updateVisibility(g.camera);g.renderer.render(g.scene,g.camera);
      });
      await page.screenshot({path:`${output}/${map}-surface${reduce?'-reduced':''}.png`});
    }
    const state=await page.evaluate(()=>{
      const g=window.__game,c=g.course,r=g.circuitRuntime,root=c.group.getObjectByName('circuit_signature');
      // Use the actual map clocks and command APIs. Presentation observes them.
      if(c.kind==='tideline'){c.setLapBoard(3);c.advanceTide(6);}
      if(c.kind==='ascension'){c.schedule.advanceTicks(c.schedule.config.testTick-c.schedule.tick+1);}
      if(c.kind==='dreamisland'){c.advanceSchedule(c.schedule.config.strikeTick+c.schedule.config.nightRampTicks-c.schedule.tick);}
      if(c.kind==='afterglow'){for(let i=0;i<80&&c.relay.phase!=='strike';i++)c.relay.step(.05,root.userData.progress,0,3,3,c.length);}
      if(c.kind==='polarity'){
        const simulation=r.base.simulation,w=simulation.windows.find(w=>w.fromLane===0);
        if(!simulation.requestFlip((w.from+w.to)/2,0,true).ok)throw new Error('Transfer fixture failed');
        simulation.advanceTicks(150);
      }
      const sample=c.project(g.presentationPosition,g.progress,g.poseProjection);
      r.present(sample,g.presentationPosition,g.presentationForward,g.vehicleVisualState);
      g.atmosphere.updateFog(2,root.userData.progress,c.kind==='tideline'?3:g.lap,g.totalLaps,'running');
      g.sceneAssets.authoredEnvironment?.updateVisibility(g.camera);
      g.renderer.render(g.scene,g.camera);
      return {signals:root.userData.signals,pose:root.userData.pose,status:root.userData.status,surfaces:c.group.userData.surfaceFinish};
    });
    if(map==='tideline')assert.equal(state.status,'DRY DOCK');
    if(map==='ascension')assert.equal(state.pose.valveAngle,Math.PI/2);
    if(map==='dreamisland')assert.equal(state.pose.domeOpen,5.8);
    if(map==='afterglow')assert.equal(state.pose.alert,true);
    if(map==='polarity')assert.ok(state.pose.gravityTilt<0);
    if(['tideline','ascension','dreamisland','afterglow','polarity'].includes(map))await page.screenshot({path:`${output}/${map}-active${reduce?'-reduced':''}.png`});
    if(polish&&map==='afterglow'){
      const slope=await page.evaluate(async()=>{
        const g=window.__game,c=g.course,{Vector3}=await import('/node_modules/.vite/deps/three.js');
        let progress=0,grade=0;
        for(let i=0;i<1000;i++){const slope=Math.abs(c.sample(i/1000).tangent.y);if(slope>grade){grade=slope;progress=i/1000;}}
        // Controlled presentation fixture on the steepest sampled road, not a gameplay outcome.
        c.relay.targetProgress=progress;c.relay.targetLateral=0;
        const s=c.sample(progress),behind=c.sample(progress-24/c.length);
        g.camera.position.copy(behind.position).addScaledVector(behind.up,7);
        g.camera.up.copy(behind.up);g.camera.lookAt(s.position);g.camera.fov=62;g.camera.updateProjectionMatrix();
        g.sceneAssets.authoredEnvironment.updateVisibility(g.camera);
        const ring=g.scene.getObjectByName('relay_attack_effects').children.find(n=>n.geometry?.type==='RingGeometry');
        g.renderer.render(g.scene,g.camera);
        return {grade,progress,normalDot:new Vector3(0,0,1).applyQuaternion(ring.quaternion).dot(s.up),offset:ring.position.clone().sub(s.position).dot(s.up)};
      });
      assert.ok(slope.grade>.1);assert.ok(slope.normalDot>.99999);assert.ok(Math.abs(slope.offset-.16)<1e-5);
      state.slope=slope;
      await page.screenshot({path:`${output}/${map}-sloped-warning${reduce?'-reduced':''}.png`});
    }
    const clocks=await page.evaluate(()=>{
      const g=window.__game,r=g.circuitRuntime,root=g.course.group.getObjectByName('circuit_signature');
      r.reset();for(let i=0;i<4;i++)r.advanceClocks(1/480);
      r.present(g.course.project(g.presentationPosition,g.progress,g.poseProjection),g.presentationPosition,g.presentationForward,g.vehicleVisualState);
      const coast=root.userData.tick;r.reset();
      return {coast,reset:root.userData.tick};
    });
    assert.equal(clocks.coast,1,'Coast counts fractional ticks once');assert.equal(clocks.reset,0,'Retry resets animation clock');
    const meshes=await page.evaluate(()=>{const root=window.__game.course.group.getObjectByName('circuit_signature');const rows=[];root.traverse(n=>{if(n.isMesh)rows.push({name:n.name,position:n.getWorldPosition(window.__game.position.clone()).toArray()});});return rows;});
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
    const disposal=await page.evaluate(()=>{
      const g=window.__game,geometry=[];
      g.scene.traverse(n=>{if(n.isMesh&&n.name.endsWith('_jungle'))geometry.push({mesh:n,uuid:n.geometry.uuid});});
      const plants=g.course.group.getObjectByName('circuit_signature').userData.relocatedMarshPlants??0;
      g.circuitRuntime.dispose();
      if(plants&&!geometry.some(row=>row.mesh.geometry.uuid!==row.uuid))throw new Error('Marsh plant geometry was not restored');
      return !g.course.group.getObjectByName('circuit_signature');
    });
    assert.ok(disposal,'Disposed scene removed');
    if(surfaces&&!beforeSurface){
      const released=await page.evaluate(()=>{
        const g=window.__game,stats=g.course.group.userData.surfaceFinish;
        const drain=g.course.group.getObjectByName('circuit_service_drainage');
        let instanceDisposals=0;drain.addEventListener('dispose',()=>instanceDisposals++);
        g.dispose();return {texture:stats.disposed,instanceDisposals};
      });
      assert.equal(released.texture,true,'Shared surface texture released');
      assert.equal(released.instanceDisposals,1,'Drain instance buffers released exactly once');
      state.disposal=released;
    }
    report.push({map,data,meshes,state,clocks,pausedTick:paused,errors,warnings});await page.close();
  }
}finally{await browser.close();const name=audit?'site-audit':`${maps.length===9?'':maps.join('-')+'-'}${pixel?'pixel-':''}${reduce?'reduced':'report'}`;await writeFile(`${output}/${name}.json`,JSON.stringify(report,null,2));}
if(audit)process.exit(0);
console.log(JSON.stringify(report.map(r=>({map:r.map,clearance:r.data?.clearanceMeters,triangles:r.data?.triangles,draws:r.data?.drawCalls,warnings:r.warnings})),null,2));
assert.equal(report.filter(r=>r.data).length,maps.length,'Every circuit has its authored scene');
