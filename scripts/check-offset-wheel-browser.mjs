import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {connect} from './qa-cdp.mjs';
const out='artifacts/offset-wheel-qa',qa=await connect(9336,{fresh:true});await mkdir(out,{recursive:true});
try{
  await qa.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  for(let i=0;i<150;i++){if(await qa.evaluate("!!document.getElementById('play')&&!document.getElementById('play').disabled"))break;await new Promise(r=>setTimeout(r,100))}
  const result=await qa.evaluate(`(async()=>{
    const $=id=>document.getElementById(id),set=(id,v)=>{$(id).value=v;$(id).dispatchEvent(new Event('change',{bubbles:true}))},visible=id=>!$(id).closest('[hidden]'),program=()=>JSON.parse($('motionCode').value);
    $('resetStyle').click();set('effectTarget','note');set('enterPreset','fade');set('exitPreset','fade');set('enterOffset',-1.5);set('exitOffset',3);
    const note=program();set('enterPreset','scatter');const preserved=program().enter.offset;
    $('undoVisual').click();const undo=$('enterPreset').value;$('redoVisual').click();const redo=$('enterPreset').value;
    set('effectTarget','score');set('enterPreset','rise');set('enterOffset',-2);set('exitPreset','fade');set('decayOffset',-1.5);
    const score={enter:program().enter.offset,exitHidden:!visible('exitOffset'),decay:Number($('decayOffset').value)};
    const imported=program();imported.exit.offset=-2;imported.exit.delay=.5;$('motionCode').value=JSON.stringify(imported);$('applyMotion').click();score.merged=Number($('decayOffset').value);set('enterDuration',2);score.stable=Number($('decayOffset').value);
    $('splitElements').click();const pick=name=>[...document.querySelectorAll('.node-pick')].find(e=>e.dataset.name===name).click();pick('乐谱组合');
    set('enterPreset','fade');set('exitPreset','fade');set('enterOffset',2);set('exitOffset',-1);const group=program();
    pick('音符');const restored=program();set('enterPreset','classic');set('exitPreset','classic');const classicOffsets=visible('enterOffset')&&visible('exitOffset');
    set('noteArrival','visible');const ineffectiveHidden=!visible('enterOffset');set('noteArrival','assemble');
    $('saveVisual').click();$('visualName').value='QA 时间偏移';$('confirmVisualSave').click();for(let i=0;i<100&&$('confirmVisualSave').disabled;i++)await new Promise(r=>setTimeout(r,30));
    const saved=JSON.parse(localStorage.getItem('liupu.visual-presets.v5')).find(p=>p.name==='QA 时间偏移');
    // Controls created after binding, including disabled optgroups and fieldsets.
    const fixture=document.createElement('fieldset');fixture.innerHTML='<select id="wheelFixture"><option value="a">A</option><option disabled value="b">B</option><option hidden value="c">C</option><optgroup disabled label="disabled"><option value="d">D</option></optgroup><optgroup hidden label="hidden"><option value="e">E</option></optgroup><option value="f">F</option></select>';document.body.append(fixture);
    const select=$('wheelFixture'),counts={input:0,change:0};select.oninput=()=>counts.input++;select.onchange=()=>counts.change++;
    const wheel=(deltaY,extra={})=>{const e=new WheelEvent('wheel',{deltaY,bubbles:true,cancelable:true,...extra});select.dispatchEvent(e);return e.defaultPrevented};
    wheel(120);const skipped=select.value;wheel(-120);const reversed=select.value;wheel(-120);const boundary=select.value;
    fixture.disabled=true;const disabledDefault=wheel(120),disabledValue=select.value;fixture.disabled=false;
    const ctrlDefault=wheel(120,{ctrlKey:true}),ctrlValue=select.value,horizontalDefault=wheel(3,{deltaX:120});
    // A new burst accumulates small touchpad deltas without jumping multiple options.
    await new Promise(r=>setTimeout(r,270));wheel(10);wheel(10);wheel(10);const beforeThreshold=select.value;wheel(10);const threshold=select.value;
    const wheelChecks={skipped,reversed,boundary,disabledDefault,disabledValue,ctrlDefault,ctrlValue,horizontalDefault,beforeThreshold,threshold,counts};fixture.remove();
    set('enterPreset','fade');$('motionEditor').open=true;$('enterPreset').scrollIntoView({block:'center'});
    window.wheelEvents={input:0,change:0};$('enterPreset').addEventListener('input',()=>window.wheelEvents.input++);$('enterPreset').addEventListener('change',()=>window.wheelEvents.change++);
    return {note,preserved,undo,redo,score,group,restored,classicOffsets,ineffectiveHidden,saved,wheelChecks};
  })()`);
  assert.equal(result.note.enter.offset,-1.5);assert.equal(result.note.exit.offset,3);assert.equal(result.preserved,-1.5);
  assert.equal(result.undo,'fade');assert.equal(result.redo,'scatter');assert.deepEqual(result.score,{enter:-2,exitHidden:true,decay:-1.5,merged:-3,stable:-3});
  assert.equal(result.group.enter.offset,2);assert.equal(result.group.exit.offset,-1);assert.equal(result.restored.enter.offset,-1.5);assert.equal(result.restored.exit.offset,3);assert.ok(result.classicOffsets&&result.ineffectiveHidden);
  assert.equal(result.saved.version,5);assert.equal(result.saved.composition.nodes.find(n=>n.parts?.notes).config.motionProgram.exit.offset,3);assert.equal(result.saved.composition.nodes.find(n=>n.kind==='group').program.enter.offset,2);
  assert.deepEqual(result.wheelChecks,{skipped:'f',reversed:'a',boundary:'a',disabledDefault:false,disabledValue:'a',ctrlDefault:false,ctrlValue:'a',horizontalDefault:false,beforeThreshold:'a',threshold:'f',counts:{input:3,change:3}});
  const position=await qa.evaluate("(()=>{const r=document.getElementById('enterPreset').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,scroll:document.querySelector('.inspector-content').scrollTop}})()");
  await qa.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:position.x,y:position.y,deltaX:0,deltaY:120});
  await new Promise(r=>setTimeout(r,150));
  result.nativeWheel=await qa.evaluate("({value:document.getElementById('enterPreset').value,renderer:JSON.parse(document.getElementById('motionCode').value).enter.renderer,scroll:document.querySelector('.inspector-content').scrollTop,events:window.wheelEvents})");
  assert.equal(result.nativeWheel.value,'scatter');assert.equal(result.nativeWheel.renderer,'fragments');assert.equal(result.nativeWheel.scroll,position.scroll);assert.deepEqual(result.nativeWheel.events,{input:1,change:1});
  await qa.screenshot(out+'/animation-offsets.png');
  result.render=await qa.evaluate(`(async()=>{
    const {ScoreRenderer}=await import('./render.mjs'),{loadScore}=await import('./score.mjs'),{demoXML}=await import('./demo.mjs'),{visualDefaults}=await import('./visual-defaults.mjs'),{presetPhase}=await import('./effect-library.mjs');
    const score=await loadScore(demoXML,'offset-regression.musicxml'),canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const renderer=new ScoreRenderer(canvas);renderer.setScore(score);const parts=Object.fromEntries(['notes','beams','effects','staff','marks','header','cursor'].map(k=>[k,['notes','beams'].includes(k)]));
    const base={...structuredClone(visualDefaults),layout:'strip',motion:'sticky',camera:'follow',headerMode:'dock',transparent:true,showTitle:false,showLine:false,pageDecay:'none',scoreProgramActive:false,outputLayer:'notation',parts,motionProgramActive:true,noteArrival:'assemble'};
    const original=renderer.programmed.bind(renderer);let samples=[];renderer.programmed=(...args)=>{const value=original(...args);samples.push({id:args[0],phase:value.phase,progress:value.progress});return value};
    const sample=(time,settings)=>{samples=[];renderer.render(time,settings);return samples};let checked=0,maxError=0;
    for(const phase of ['enter','exit'])for(const offset of [-.75,.75])for(const mode of ['sticky','page'])for(const time of [0,1,4,8]){
      const p={version:1,enter:presetPhase(phase==='enter'?'classic':'none','enter'),exit:presetPhase(phase==='exit'?'classic':'none','exit')};
      const settings={...base,motion:mode,headerMode:mode==='sticky'?'dock':'flow',camera:mode==='sticky'?'follow':'page',motionProgram:p};
      const expected=sample(time-offset,settings);p[phase].offset=offset;const actual=sample(time,settings);
      if(actual.length!==expected.length)throw Error('Sample count changed');
      actual.forEach((v,i)=>{if(v.id!==expected[i].id||v.phase!==expected[i].phase)throw Error('Offset phase mismatch '+JSON.stringify({phase,offset,mode,time,v,expected:expected[i]}));maxError=Math.max(maxError,Math.abs(v.progress-expected[i].progress));checked++});
    }
    const draw=(time,settings)=>{renderer.render(time,settings);return canvas.getContext('2d').getImageData(0,0,960,540).data},diff=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0),images=[];
    for(const layout of ['strip','rows'])for(const offset of [-1,1]){
      const p={version:1,enter:presetPhase('fade','enter',{duration:2}),exit:presetPhase('fade','exit',{duration:2,delay:0})};const settings={...base,layout,motion:layout==='rows'?'static':'flow',headerMode:layout==='rows'?'row':'flow',motionProgram:p};
      const before=draw(3,settings);p.enter.offset=offset;p.exit.offset=offset;const after=draw(3,settings);draw(8,settings);const seek=diff(after,draw(3,settings));images.push({layout,offset,difference:diff(before,after),seek});
    }
    return {checked,maxError,images};
  })()`);
  assert.ok(result.render.checked>0);assert.ok(result.render.maxError<1e-10);for(const row of result.render.images){assert.ok(row.difference>0);assert.equal(row.seek,0)}
  for(const [width,height] of [[960,640],[390,844]]){await qa.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});assert.equal(await qa.evaluate('document.documentElement.scrollWidth>innerWidth'),false)}
  await writeFile(out+'/results.json',JSON.stringify(result,null,2));assert.deepEqual(qa.errors,[]);
  console.log('PASS: native wheel, touchpad accumulation, disabled controls, phase offsets, shared decay timing, history, persistence, classic viewport timing, deterministic renders and responsive UI');
}finally{qa.close()}
