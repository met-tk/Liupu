import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {connect} from './qa-cdp.mjs';
const desktop=process.argv.includes('--desktop'),qa=await connect(desktop?9334:9336,{fresh:!desktop});
const output='artifacts/composition-qa'+(desktop?'/desktop':'');await mkdir(output,{recursive:true});
try{
  await qa.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  for(let i=0;i<150;i++){if(await qa.evaluate("!!document.getElementById('play')&&!document.getElementById('play').disabled"))break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(await qa.evaluate("document.getElementById('play').disabled"),false);
  await qa.screenshot(output+'/workbench.png');
  const rendering=await qa.evaluate(`(async()=>{
    const {CompositionRenderer}=await import('/composition-render.mjs'),{loadScore}=await import('/score.mjs'),{demoXML}=await import('/demo.mjs'),{visualDefaults}=await import('/visual-defaults.mjs'),C=await import('/composition.mjs');
    const score=await loadScore(demoXML,'composition.musicxml'),canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const renderer=new CompositionRenderer(canvas);renderer.setScore(score);const s=C.createStudioSettings(visualDefaults);C.applyVisualPreset(s,C.builtinPresets(visualDefaults)[0]);Object.assign(s,{transparent:true,showTitle:false,showLine:false,glow:0,particles:0,trail:0,staffOpacity:100});
    const pixels=()=>new Uint8ClampedArray(canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,960,540).data),sum=a=>a.reduce((n,v,i)=>n+(i%4===3?v:0),0),diff=(a,b)=>{let n=0,max=0,total=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d>1)n++;max=Math.max(max,d);total+=d}return {n,max,total}};
    const results={split:[],combinations:[]};
    for(const mode of ['sticky','flow','static','page']){
      s.composition=C.makeComposition(visualDefaults);Object.assign(s,{motion:mode,showLine:false,glow:0,particles:0,trail:0,fly:0,scatter:0,pageDecay:'none',motionProgramActive:true});s.motionProgram.enter.enabled=s.motionProgram.exit.enabled=false;
      for(const t of [0,3,10]){
        const snapshot=C.makePreset(s,'before');renderer.render(t,s);const a=pixels();C.splitHeader(s);renderer.render(t,s);results.split.push({mode,time:t,...diff(a,pixels())});C.applyVisualPreset(s,snapshot);
      }
    }
    s.composition=C.makeComposition(visualDefaults);Object.assign(s,{pageDecay:'none',showLine:false,glow:0,particles:0,trail:0,fly:0,scatter:0});C.splitHeader(s);const group=C.selectedNode(s);
    renderer.render(3,s);const combined=pixels();group.transform.opacity=.5;renderer.render(3,s);const half=pixels();results.groupAlphaError=0;for(let i=3;i<half.length;i+=4)results.groupAlphaError=Math.max(results.groupAlphaError,Math.abs(half[i]-Math.round(combined[i]*.5)));
    group.transform.opacity=1;group.animationEnabled=true;group.program.enter.enabled=true;renderer.render(0,s);results.enterStart=sum(pixels());renderer.render(.6,s);results.enterEnd=sum(pixels());group.animationEnabled=false;
    const body=s.composition.nodes.find(n=>n.name==='谱面'),header=s.composition.nodes.find(n=>n.name==='谱头');header.enabled=false;renderer.render(3,s);const bodyOnly=pixels();header.transform.x=14;renderer.render(3,s);results.headerIsolation=diff(bodyOnly,pixels());header.enabled=true;
    const snapshot=C.makePreset(s,'restore');renderer.render(3,s);const before=pixels();C.applyVisualPreset(s,C.builtinPresets(visualDefaults)[3]);renderer.render(3,s);C.applyVisualPreset(s,C.parsePreset(JSON.stringify(snapshot),visualDefaults));renderer.render(3,s);results.roundtrip=diff(before,pixels());
    for(const layout of ['strip','rows'])for(const camera of ['follow','stationary','page']){
      s.composition=C.makeComposition(visualDefaults);Object.assign(s,{layout,camera,headerMode:layout==='rows'?'row':'dock',pageDecay:'none',showLine:false,glow:0,particles:0,trail:0,fly:0,scatter:0});renderer.render(6,s);results.combinations.push({layout,camera,energy:sum(pixels())});
    }
    s.composition=C.makeComposition(visualDefaults);s.pageDecay='none';s.transparent=true;s.showTitle=false;s.exportCursor=false;s.outputLayer='cursor';renderer.render(2,s);results.cursorSuppressed=sum(pixels());s.exportCursor=true;renderer.render(2,s);results.cursorVisible=sum(pixels());
    window.compositionQA={renderer,score,settings:s};return results;
  })()`);
  await writeFile(output+'/render-results.json',JSON.stringify(rendering,null,2));
  for(const r of rendering.split)assert.ok(r.n<200,JSON.stringify(r));
  assert.ok(rendering.groupAlphaError<=1);assert.equal(rendering.enterStart,0);assert.ok(rendering.enterEnd>1000);assert.equal(rendering.headerIsolation.n,0);assert.equal(rendering.roundtrip.n,0);assert.equal(rendering.cursorSuppressed,0);assert.ok(rendering.cursorVisible>0);for(const r of rendering.combinations)assert.ok(r.energy>1000,JSON.stringify(r));
  const ui=await qa.evaluate(`(async()=>{
    const $=id=>document.getElementById(id),set=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('change',{bubbles:true}))},save=async name=>{$('saveVisual').click();$('visualName').value=name;$('confirmVisualSave').click();for(let i=0;i<100&&$('confirmVisualSave').disabled;i++)await new Promise(r=>setTimeout(r,30));return JSON.parse(localStorage.getItem('liupu.visual-presets.v1')).find(p=>p.name===name)};
    $('browsePresets').click();const count=$('libraryItems').children.length;[...$('libraryItems').children].find(b=>b.innerText.includes('纵向行进')).click();$('applyLibrary').click();
    const template=[$('studio-layout').value,$('studio-camera').value,$('studio-headerMode').value];
    set('pageBars',6);set('studio-rotation',12);const before=await save('QA 编组前');
    [...$('headerSection').querySelectorAll('button')].find(b=>b.textContent==='拆分谱头与谱面').click();
    const split=await save('QA 拆分组合');const groupTarget=$('effectTarget').value;
    [...document.querySelectorAll('.node-pick')].find(b=>b.textContent==='谱头').click();const linked=$('studio-layout').disabled&&$('studio-headerMode').disabled;
    set('studio-x',15);[...document.querySelectorAll('.node-pick')].find(b=>b.textContent==='谱面').click();const bodyX=$('studio-x').value;
    const saved=await save('QA 完整预设');const label=$('presetName').textContent;[...document.querySelectorAll('.node-pick')].find(b=>b.textContent==='谱头').click();const selectionClean=$('presetName').textContent===label;
    const headerTarget=$('effectTarget').value,notesDisabled=$('effectTarget').querySelector('[value="note"]').disabled;
    const focused=[...document.querySelectorAll('.node-pick')].find(b=>b.textContent==='谱头');focused.focus();focused.click();const pickFocus=document.activeElement.classList.contains('node-pick');const eye=document.activeElement.closest('.composition-node').querySelector('.node-visible');eye.focus();eye.click();const toggleFocus=document.activeElement.classList.contains('node-visible');document.activeElement.click();
    set('studio-x',20);$('undoVisual').click();const undone=$('studio-x').value;$('redoVisual').click();const redone=$('studio-x').value;
    $('exportBtn').click();set('exportType','png');set('resolution','720');$('doExport').click();await new Promise(r=>setTimeout(r,1000));const exported=!$('exportResult').hidden;$('closeExport').click();
    return {count,template,before,split,groupTarget,headerTarget,notesDisabled,pickFocus,toggleFocus,linked,bodyX,saved,selectionClean,undone,redone,exported};
  })()`);
  await writeFile(output+'/ui-results.json',JSON.stringify(ui,null,2));
  assert.ok(ui.count>=6);assert.deepEqual(ui.template,['rows','follow','row']);assert.equal(ui.split.composition.nodes.length,3);assert.equal(ui.split.composition.nodes[0].transform.rotation,12);assert.equal(ui.groupTarget,'group');assert.ok(ui.linked);assert.equal(ui.bodyX,'0');assert.ok(ui.selectionClean);assert.equal(ui.undone,'15');assert.equal(ui.redone,'20');assert.ok(ui.exported);
  assert.equal(ui.headerTarget,'group');assert.ok(ui.notesDisabled&&ui.pickFocus&&ui.toggleFocus);
  await qa.evaluate("document.getElementById('transformSection').open=false;document.getElementById('motionEditor').open=true;document.querySelector('.inspector-content').scrollTop=0");await qa.screenshot(output+'/header-layer.png');
  await qa.evaluate("document.getElementById('browsePresets').click()");await qa.screenshot(output+'/preset-library.png');
  await qa.evaluate("document.getElementById('closeLibrary').click()");
  for(const [width,height] of [[960,640],[390,844]]){await qa.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,150));assert.equal(await qa.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await qa.screenshot(output+'/responsive-'+width+'.png')}
  assert.deepEqual(qa.errors,[]);console.log('PASS: composition render isolation, split consistency, alpha, presets, editor history, export and responsive checks');
}finally{qa.close()}
