import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {connect} from './qa-cdp.mjs';
const out='artifacts/classic-qa',qa=await connect(9336,{fresh:true});await mkdir(out,{recursive:true});
try{
  await qa.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  for(let i=0;i<150;i++){if(await qa.evaluate("!!document.getElementById('play')&&!document.getElementById('play').disabled"))break;await new Promise(r=>setTimeout(r,100))}
  const result=await qa.evaluate(`(async()=>{
    const {ScoreRenderer}=await import('./render.mjs'),{loadScore}=await import('./score.mjs'),{demoXML}=await import('./demo.mjs'),{visualDefaults}=await import('./visual-defaults.mjs'),{presetPhase}=await import('./effect-library.mjs');
    const score=await loadScore(demoXML,'classic-regression.musicxml'),canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const renderer=new ScoreRenderer(canvas);renderer.setScore(score);
    const none=Object.fromEntries(['notes','beams','effects','staff','marks','header','cursor'].map(k=>[k,false]));
    const p={version:1,enter:presetPhase('classic','enter'),exit:presetPhase('classic','exit')};
    const base={...structuredClone(visualDefaults),motion:'flow',transparent:true,showTitle:false,showLine:false,pageDecay:'none',color:visualDefaults.noteColor,outputLayer:'notation',glow:0,motionProgramActive:false};
    const draw=(time,s)=>{renderer.render(time,s);return new Uint8ClampedArray(canvas.getContext('2d').getImageData(0,0,960,540).data)};
    const diff=(a,b)=>{let alpha=0,color=0,energy=0,total=0;for(let i=0;i<a.length;i+=4){alpha+=Math.abs(a[i+3]-b[i+3]);energy+=a[i+3];for(let j=0;j<4;j++)total+=Math.abs(a[i+j]-b[i+j]);for(let j=0;j<3;j++)color+=Math.abs(a[i+j]*a[i+3]/255-b[i+j]*b[i+3]/255)}return{alpha,color,energy,total}};
    const comparisons=[],determination=[],rows=[];
    for(const part of ['notes','beams'])for(const time of [0,.25,3,8,18]){
      const legacy={...base,parts:{...none,[part]:true}},modern={...legacy,layout:'strip',camera:'follow',headerMode:'flow',motionProgramActive:true,motionProgram:p,noteArrival:'assemble'};
      const original=draw(time,legacy),restored=draw(time,modern);comparisons.push({part,time,...diff(original,restored)});
      draw(time+4,modern);determination.push(diff(restored,draw(time,modern)).total);
    }
    const staticSettings={...base,layout:'rows',motion:'static',camera:'page',headerMode:'row',parts:{...none,notes:true,beams:true},motionProgramActive:true,motionProgram:p,noteArrival:'assemble'};
    for(const time of [.25,3,8])rows.push({time,...diff(draw(time,staticSettings),draw(time,{...staticSettings,motionProgramActive:false}))});
    const $=id=>document.getElementById(id),visible=id=>!$(id).closest('[hidden]'),set=(id,v)=>{$(id).value=v;$(id).dispatchEvent(new Event('change',{bubbles:true}))};
    $('browsePresets').click();const card=[...$('libraryItems').children].find(b=>b.querySelector('b').textContent==='原版音符聚散');if(!card)throw Error('Original preset is missing');card.click();$('applyLibrary').click();set('effectTarget','note');$('motionEditor').open=true;
    const edgeUI={enter:$('enterPreset').value,exit:$('exitPreset').value,strength:visible('enterStrength')&&visible('exitStrength'),duration:visible('enterDuration')||visible('exitDuration'),delay:visible('exitDelay'),exitTrigger:visible('noteExitTrigger'),hint:$('effectHint').textContent};
    $('openEffectLibrary').click();const effectFound=[...$('libraryItems').children].some(b=>b.querySelector('b').textContent==='原版音符聚散');$('closeLibrary').click();
    set('studio-layout','rows');const rowsUI={duration:visible('enterDuration')&&visible('exitDuration'),delay:visible('exitDelay'),exitTrigger:visible('noteExitTrigger')};
    set('studio-layout','strip');
    $('exportBtn').click();set('exportType','png');set('resolution','720');$('doExport').click();for(let i=0;i<100&&$('exportResult').hidden;i++)await new Promise(r=>setTimeout(r,30));const exported=!$('exportResult').hidden;$('closeExport').click();
    return {comparisons,determination,rows,edgeUI,rowsUI,effectFound,exported};
  })()`);
  await writeFile(out+'/results.json',JSON.stringify(result,null,2));
  for(const r of result.comparisons){assert.ok(r.energy>0);assert.ok(r.alpha/r.energy<.025&&r.color/(3*r.energy)<.025,JSON.stringify(r))}
  assert.ok(result.determination.every(n=>n===0));assert.ok(result.rows.every(r=>r.total>0));
  assert.equal(result.edgeUI.enter,'classic');assert.equal(result.edgeUI.exit,'classic');assert.ok(result.edgeUI.strength&&!result.edgeUI.duration&&!result.edgeUI.delay&&!result.edgeUI.exitTrigger);
  assert.ok(result.rowsUI.duration&&result.rowsUI.delay&&result.rowsUI.exitTrigger&&result.effectFound&&result.exported);
  await qa.screenshot(out+'/original-effect.png');assert.deepEqual(qa.errors,[]);
  console.log('PASS: original edge animation reference, deterministic seek, rows timing, discoverable preset, contextual controls, PNG export');
}finally{qa.close()}
