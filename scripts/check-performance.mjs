import assert from 'node:assert/strict';
import {app,BrowserWindow} from 'electron';
import {mkdirSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../server.mjs';

const output=path.resolve('artifacts','performance'),profile=path.join(output,'profile');
mkdirSync(profile,{recursive:true});
app.setPath('sessionData',profile);
app.commandLine.appendSwitch('user-data-dir',profile);
const baseline=process.argv.includes('--baseline');

async function benchmark(references,only){
  const {loadScore}=await import('/score.mjs'),{CompositionRenderer}=await import('/composition-render.mjs');
  const {visualDefaults}=await import('/visual-defaults.mjs');
  const {createStudioSettings,applyVisualPreset,builtinPresets,splitElements}=await import('/composition.mjs');
  const {presetPhase}=await import('/effect-library.mjs');
  const {nextFrameTime}=await import('/timing.mjs');
  const score=await loadScore(await(await fetch('/assets/Chopin_Nocturne_Op9_No2.musicxml')).text(),'Chopin.musicxml');
  const presets=builtinPresets(visualDefaults);
  const scenes=presets.map((preset,index)=>({name:`preset-${index+1}`,preset,width:960,height:540}));
  for(const size of [540,1080])for(const kind of ['marks','split','rows']){
    scenes.push({name:`${kind}-${size}`,preset:presets[6],width:size*16/9,height:size,kind});
  }
  scenes.push(
    {name:'classic-1080',preset:presets[4],width:1920,height:1080},
    {name:'edge-zoom',preset:presets[4],width:1920,height:1080,zoom:200,edge:true,time:20.3},
    {name:'portrait',preset:presets[6],width:608,height:1080,kind:'marks',time:145},
    {name:'marks-opening',preset:presets[6],width:960,height:540,kind:'marks',time:.1},
    {name:'marks-ending',preset:presets[6],width:960,height:540,kind:'marks',time:212},
  );
  const results=[],images={};
  for(const scene of scenes){
    if(only&&!scene.name.includes(only))continue;
    const canvas=document.createElement('canvas');
    canvas.width=scene.width;canvas.height=scene.height;
    const renderer=new CompositionRenderer(canvas),settings=createStudioSettings(visualDefaults);
    applyVisualPreset(settings,scene.preset);settings.showTitle=false;
    if(scene.zoom)settings.zoom=scene.zoom;
    if(scene.edge)settings.glowShape='edge';
    if(scene.kind==='marks'){
      settings.markProgramActive=true;settings.markMotionProgram={version:1,name:'QA',enter:presetPhase('rise','enter'),exit:presetPhase('fade','exit')};
    }
    if(scene.kind==='split')splitElements(settings);
    if(scene.kind==='rows'){settings.layout='rows';settings.camera='follow';settings.headerMode='row';settings.pageBars=3;settings.pageRows=3}
    renderer.setScore(score);
    let deadline=0;
    const frame=()=>new Promise(resolve=>{
      const tick=stamp=>{const next=nextFrameTime(stamp,deadline);if(next===null)requestAnimationFrame(tick);else{deadline=next;resolve(stamp)}};
      requestAnimationFrame(tick);
    });
    const time=scene.time??35,cold=performance.now();renderer.render(time,settings);canvas.toDataURL();const coldMs=performance.now()-cold;
    for(let i=0;i<12;i++){await frame();renderer.render(time+i/60,settings)}
    const submit=[],frames=[];
    let previous=await frame();
    for(let i=0;i<90;i++){
      const start=performance.now();renderer.render(time+i/60,settings);submit.push(performance.now()-start);
      const stamp=await frame();frames.push(stamp-previous);previous=stamp;
    }
    renderer.render(time+.25,settings);images[scene.name]=canvas.toDataURL();
    let pixels;
    if(references[scene.name]){
      const reference=new Image();reference.src=references[scene.name];await reference.decode();
      const before=document.createElement('canvas');before.width=canvas.width;before.height=canvas.height;
      const bc=before.getContext('2d',{willReadFrequently:true});bc.drawImage(reference,0,0);
      const a=bc.getImageData(0,0,canvas.width,canvas.height).data,b=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let changed=0,max=0;
      for(let i=0;i<a.length;i+=4){let delta=0;for(let j=0;j<4;j++)delta=Math.max(delta,Math.abs(a[i+j]-b[i+j]));if(delta)changed++;max=Math.max(max,delta)}
      pixels={changed,max};
    }
    const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {mean:values.reduce((a,b)=>a+b)/values.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)}};
    results.push({name:scene.name,width:canvas.width,height:canvas.height,coldMs,submit:stats(submit),frame:stats(frames),overBudget:submit.filter(t=>t>1000/60).length,pixels});
    // Drop score-layer atlases before the next scene, including split-layer renderers.
    renderer.pool.clear();renderer.fallback=null;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  return {results,images,environment:{userAgent:navigator.userAgent,dpr:devicePixelRatio,notes:score.boxes.size,marks:score.markRegions.length}};
}

async function check(){
  let service;
  try{
    await app.whenReady();
    service=await startServer({port:0,root:baseline?'release\\1.2.1\\win-unpacked\\resources\\web':'dist'});
    const window=new BrowserWindow({width:1440,height:960,show:true,webPreferences:{backgroundThrottling:false}});
    await window.loadURL(service.url);
    const deadline=Date.now()+90000;
    while(!await window.webContents.executeJavaScript(`Boolean(document.getElementById('play')&&!document.getElementById('play').disabled)`)){
      assert.ok(Date.now()<deadline,'Score startup timed out');await new Promise(r=>setTimeout(r,100));
    }
    const debug=window.webContents.debugger;debug.attach('1.3');
    await debug.sendCommand('Profiler.enable');await debug.sendCommand('Profiler.start');
    const references={};
    if(!baseline){
      const before=JSON.parse(await readFile(path.join(output,'before.json'),'utf8'));
      for(const scene of before.results)references[scene.name]='data:image/png;base64,'+(await readFile(path.join(output,`before-${scene.name}.png`))).toString('base64');
    }
    const only=process.argv.find(arg=>arg.startsWith('--scene='))?.slice(8);
    const report=await window.webContents.executeJavaScript(`(${benchmark.toString()})(${JSON.stringify(references)},${JSON.stringify(only??null)})`);
    const cpu=await debug.sendCommand('Profiler.stop');debug.detach();
    const label=(baseline?'before':'after')+(only?`-${only}`:'');
    await writeFile(path.join(output,`${label}.cpuprofile`),JSON.stringify(cpu.profile));
    for(const [name,data] of Object.entries(report.images))await writeFile(path.join(output,`${label}-${name}.png`),Buffer.from(data.split(',')[1],'base64'));
    delete report.images;
    report.gpu=app.getGPUFeatureStatus();
    await writeFile(path.join(output,`${label}.json`),JSON.stringify(report,null,2));
    console.table(report.results.map(r=>({scene:r.name,cold:r.coldMs.toFixed(1),submit:r.submit.p50.toFixed(1),p50:r.frame.p50.toFixed(1),p95:r.frame.p95.toFixed(1)})));
    if(!baseline){
      const before=JSON.parse(await readFile(path.join(output,'before.json'),'utf8'));
      console.table(report.results.map(r=>{const b=before.results.find(b=>b.name===r.name);return {scene:r.name,before:b.submit.p50.toFixed(1),after:r.submit.p50.toFixed(1),speedup:(b.submit.p50/r.submit.p50).toFixed(2)}}));
      for(const scene of report.results){
        assert.ok(scene.pixels&&scene.pixels.max<=3,`${scene.name} changed pixels beyond resampling tolerance: ${JSON.stringify(scene.pixels)}`);
        const old=before.results.find(r=>r.name===scene.name);
        if(['preset-5','preset-7','marks-540','split-540','marks-1080','split-1080','classic-1080','portrait'].includes(scene.name))
          assert.ok(scene.submit.p50<old.submit.p50*.75,`${scene.name} did not reduce the measured bottleneck by at least 25%`);
      }
    }
  }catch(error){console.error(error);process.exitCode=1}
  finally{await service?.close();app.exit(process.exitCode||0)}
}
void check();
