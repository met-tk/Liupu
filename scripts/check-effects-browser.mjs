import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const desktop = process.argv.includes('--desktop'), port = desktop ? 9334 : 9336;
const target = desktop ? (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:')) : await (await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:4173/`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let next = 0; const pending = new Map(), errors = [];
socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
const output = 'artifacts/composition-qa/effects-regression' + (desktop ? '/desktop' : ''); await mkdir(output, { recursive: true });
async function screenshot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${output}/${name}.png`, Buffer.from(r.data, 'base64')); }
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 150; i++) { if (await evaluate("!!document.getElementById('play')&&!document.getElementById('play').disabled")) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(await evaluate("document.getElementById('play').disabled"), false, JSON.stringify(errors));
  await screenshot('initial');
  const ui = await evaluate(`(() => {
    const $=id=>document.getElementById(id), set=(id,v)=>{$(id).value=v;$(id).dispatchEvent(new Event('change',{bubbles:true}))};
    set('enterPreset','spin');set('exitPreset','rise');
    const note=JSON.parse($('motionCode').value);
    set('effectPhase','exit');$('addKeyframe').click();set('frameX',88);set('effectEasing','easeOut');
    const edited=JSON.parse($('motionCode').value);
    $('motionCode').value='{ invalid';$('motionCode').dispatchEvent(new Event('input'));$('applyMotion').click();const rejected=$('motionCode').getAttribute('aria-invalid');
    set('effectTarget','score');set('enterPreset','fade');set('exitPreset','slide');set('exitDuration',3);set('decayTrigger','progress');
    const score=JSON.parse($('motionCode').value), liveDisabled=$('exitDuration').disabled&&$('decayTiming').hidden;
    set('effectTarget','note');const draftKept=$('motionCode').value==='{ invalid';
    $('resetMotion').click();set('noteExitTrigger','measure');set('exitDelay',.8);set('motion','static');set('decayTrigger','measure');
    return {note,edited,score,rejected,liveDisabled,draftKept,decay:[$('decayDelay').value,$('decayDuration').value],staticControls:!$('staticControls').hidden};
  })()`);
  assert.equal(ui.note.enter.frames[0].rotation, -160); assert.equal(ui.note.exit.frames.at(-1).y, -150);
  assert.equal(ui.edited.exit.frames.length, 3); assert.equal(ui.edited.exit.frames[1].x, 88); assert.equal(ui.edited.exit.easing, 'easeOut');
  assert.equal(ui.rejected, 'true'); assert.ok(ui.liveDisabled && ui.draftKept && ui.staticControls); assert.equal(ui.score.exit.duration, 3); assert.equal(ui.decay[1], '3');
  await evaluate("document.getElementById('motionEditor').open=true;document.getElementById('motionEditor').scrollIntoView({block:'start'})"); await screenshot('editor');
  await evaluate("document.querySelector('.keyframe-editor').open=true;document.querySelector('.keyframe-editor').scrollIntoView({block:'start'})");await screenshot('keyframes');
  await evaluate("document.getElementById('frameY').focus();document.getElementById('frameY').select()");
  await send('Input.insertText',{text:'-64'});await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await evaluate("JSON.parse(document.getElementById('motionCode').value).exit.frames[0].y"),-64,'keyboard edits apply keyframes');
  const render = await evaluate(`(async()=>{
    const {ScoreRenderer}=await import('/render.mjs'),{loadScore}=await import('/score.mjs'),{demoXML}=await import('/demo.mjs'),{defaultMotionProgram}=await import('/motion-program.mjs'),{defaultScoreProgram,presetPhase}=await import('/effect-library.mjs'),{drawScanline}=await import('/scanline.mjs');
    const score=await loadScore(demoXML,'demo.musicxml'),canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
    const c=canvas.getContext('2d',{willReadFrequently:true});const renderer=new ScoreRenderer(canvas);renderer.setScore(score);
    const base={fly:0,scatter:0,glow:0,bloom:0,particles:0,trail:0,anchor:65,zoom:100,showLine:false,showTitle:false,color:'#fff2d6',noteColor:'#ffffff',staffColor:'#ffffff',beamColor:'#ffffff',markColor:'#ffffff',backgroundColor:'#090c0e',transparent:true,outputLayer:'notation',noteOpacity:0,beamOpacity:0,markOpacity:0,staffOpacity:100,pageBars:4,pageRows:2,pageDecay:'burn',decayDelay:.45,decayDuration:2.4,noteArrival:'visible',motionProgramActive:true,motionProgram:defaultMotionProgram};
    const data=()=>new Uint8ClampedArray(c.getImageData(0,0,canvas.width,canvas.height).data),same=(a,b)=>a.every((v,i)=>v===b[i]),energy=()=>{let total=0;const d=data();for(let i=3;i<d.length;i+=4)total+=d[i];return total};
    const modes={};
    for(const motion of ['flow','sticky','page','static']){
      const options={...base,motion},m=renderer.measureTimeline[1],t=m.start+(m.end-m.start)*.65;
      renderer.render(t,{...options,pageDecay:'none'});const full=data(),fullEnergy=energy();
      renderer.render(t,{...options,decayTrigger:'progress'});const live=data(),liveEnergy=energy();
      renderer.render(t,{...options,decayTrigger:'measure'});const wait=data();
      renderer.render(t+1,options);renderer.render(t,{...options,decayTrigger:'progress'});const repeated=data(),deterministic=same(live,repeated);let maxError=0,differences=0;for(let i=3;i<live.length;i+=4){maxError=Math.max(maxError,Math.abs(live[i]-repeated[i]));if(live[i]!==repeated[i])differences++}
      const program={...defaultScoreProgram,exit:presetPhase('slide','exit')};
      renderer.render(t,{...options,decayTrigger:'progress',pageDecay:'none',scoreProgramActive:true,scoreMotionProgram:program});const transforms=!same(full,data());
      const start=performance.now();for(let i=0;i<12;i++)renderer.render(t+i*.005,{...options,decayTrigger:'progress'});const ms=(performance.now()-start)/12;
      const bar=renderer.measureTimeline[0],event=score.events.find(e=>e.start>=bar.start&&(e.visualEnd??e.soundEnd??e.end)<bar.end-.6);
      if(!event)throw Error('No short note available for note timing test');
      const at=(event.visualEnd??event.soundEnd??event.end)+.5,noteOptions={...options,staffOpacity:0,noteOpacity:100,beamOpacity:100,pageDecay:'none'};
      renderer.render(at,{...noteOptions,noteExitTrigger:'note'});const immediate=data();renderer.render(at,{...noteOptions,noteExitTrigger:'measure'});const noteTimingDifferent=!same(immediate,data());
      modes[motion]={fullEnergy,liveEnergy,differentFromWait:!same(wait,live),deterministic,maxError,differences,transforms,noteTimingDifferent,ms};
    }
    c.clearRect(0,0,canvas.width,canvas.height);drawScanline(c,{color:'#ffffff',scanLength:100,scanGlow:100,scanBloom:100},{x:640,centerY:360,baseLength:400,scale:1,resolution:1,width:2});
    const d=data(),row=y=>{let sum=0,left=1280,right=-1;for(let x=0;x<1280;x++){const a=d[(y*1280+x)*4+3];sum+=a;if(a>2){left=Math.min(left,x);right=Math.max(right,x)}}return {energy:sum,width:Math.max(0,right-left+1)}};
    const glow={tip:row(161),near:row(180),shoulder:row(260),center:row(360),outside:row(158)};
    window.effectsQA={canvas,renderer,score,base};
    c.globalCompositeOperation='destination-over';c.fillStyle='#090c0e';c.fillRect(0,0,1280,720);c.globalCompositeOperation='source-over';
    return {modes,glow,scanline:canvas.toDataURL()};
  })()`);
  console.log(JSON.stringify({modes:render.modes,glow:render.glow}));
  for(const [mode,result] of Object.entries(render.modes)){ assert.ok(result.liveEnergy<result.fullEnergy, mode+' live decay');assert.ok(result.differentFromWait&&result.deterministic&&result.transforms&&result.noteTimingDifferent,mode+' timing/transform'); }
  assert.ok(render.glow.center.width>render.glow.near.width*2); assert.ok(render.glow.center.energy>render.glow.near.energy*3);assert.equal(render.glow.outside.energy,0);assert.ok(render.glow.tip.energy<render.glow.near.energy);
  await writeFile(`${output}/scanline.png`,Buffer.from(render.scanline.split(',')[1],'base64'));delete render.scanline;
  const regressionSource=(await readFile('tests/static-browser-checks.mjs','utf8')).replace(/^import .*;\s*/,'').replace('export async function','async function');
  const regression=await evaluate(`(async()=>{const {defaultMotionProgram}=await import('/motion-program.mjs');${regressionSource}\nconst checks=[];const {renderer,score,base}=window.effectsQA;await checkStaticRendering(renderer,score,{...base,noteOpacity:100,beamOpacity:100,markOpacity:100},(ok,label)=>{if(!ok)throw Error(label);checks.push(label)});document.getElementById('layoutDiagnostics')?.remove();return checks})()`);
  const exported=await evaluate(`(async()=>{
    const $=id=>document.getElementById(id),set=(id,v,event='change')=>{$(id).value=v;$(id).dispatchEvent(new Event(event,{bubbles:true}))};
    set('effectTarget','score');set('enterPreset','none');set('exitPreset','none');set('effectTarget','note');set('noteArrival','visible');set('pageDecay','burn');set('seek',2,'input');
    $('exportBtn').click();set('exportType','png');set('exportLayer','notation');set('resolution','720');
    const images=[];for(const trigger of ['measure','progress']){set('decayTrigger',trigger);$('doExport').click();const deadline=Date.now()+15000;while($('exportResult').hidden){if(Date.now()>deadline)throw Error('Export timeout');await new Promise(r=>setTimeout(r,30))}
      const blob=await(await fetch($('exportDownload').href)).blob(),img=await createImageBitmap(blob),c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let energy=0;for(let i=3;i<d.length;i+=4)energy+=d[i];images.push({trigger,width:img.width,height:img.height,energy});img.close();}
    $('closeExport').click();return images;
  })()`);
  assert.equal(exported[0].width,1280);assert.equal(exported[0].height,720);assert.ok(exported[1].energy<exported[0].energy,'live sweep appears in actual PNG export');
  for(const width of (desktop?[1000]:[1000,390])){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await evaluate("document.getElementById('motionEditor').scrollIntoView({block:'start'})");assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));await screenshot('editor-'+width);}
  assert.deepEqual(errors,[]);const report={ui,render,regression,exported,errors};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({modes:render.modes,glow:render.glow,regression:regression.length,exported,errors},null,2));
} finally { socket.close(); }
