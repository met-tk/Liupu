import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {connect} from './qa-cdp.mjs';

const qa=await connect(9336,{fresh:true});
await mkdir('artifacts/elements-qa',{recursive:true});
try{
  const result=await qa.evaluate(`(async()=>{
    const {ScoreRenderer}=await import('/render.mjs'),{loadScore}=await import('/score.mjs'),{demoXML}=await import('/demo.mjs'),{visualDefaults}=await import('/visual-defaults.mjs'),{presetPhase}=await import('/effect-library.mjs');
    const score=await loadScore(demoXML,'element-regression.musicxml'),canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    const renderer=new ScoreRenderer(canvas);renderer.setScore(score);
    const names=['staff','marks','beams','notes','effects','header','cursor'],all=Object.fromEntries(names.map(key=>[key,true])),none=Object.fromEntries(names.map(key=>[key,false]));
    const base={...structuredClone(visualDefaults),layout:'strip',camera:'follow',headerMode:'dock',motion:'sticky',transparent:true,showTitle:false,showLine:true,parts:all,pageDecay:'none',motionProgramActive:false,scoreProgramActive:false};
    const pixels=()=>new Uint8ClampedArray(canvas.getContext('2d').getImageData(0,0,960,540).data),energy=a=>{let n=0;for(let i=3;i<a.length;i+=4)n+=a[i];return n},difference=(a,b)=>{let n=0,total=0,max=0,premultiplied=0,alpha=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d>2)n++;total+=d;max=Math.max(max,d);if(i%4===3)alpha+=d;else{const k=i-i%4+3;premultiplied+=Math.abs(a[i]*a[k]/255-b[i]*b[k]/255)}}return {n,total,max,premultiplied,alpha}},draw=(time,settings)=>{renderer.render(time,settings);return pixels()};
    const results={isolation:[],split:[],fragments:[],disabled:[],exportLayers:[]};
    for(const layout of ['strip','rows']){
      const s={...base,layout,motion:layout==='rows'?'static':'sticky',headerMode:layout==='rows'?'row':'dock'};
      for(const part of names){const image=draw(.25,{...s,parts:{...none,[part]:true}});results.isolation.push({layout,part,energy:energy(image)})}
      results.isolation.push({layout,part:'empty',energy:energy(draw(.25,{...s,parts:none}))});
      for(const pageDecay of ['none','burn'])for(const time of [0,.25,3,8]){
        const settings={...s,pageDecay,decayOffset:0,decayDuration:1.5},whole=draw(time,settings),composite=document.createElement('canvas');composite.width=960;composite.height=540;
        for(const part of names){renderer.render(time,{...settings,parts:{...none,[part]:true}});composite.getContext('2d').drawImage(canvas,0,0)}
        const split=composite.getContext('2d').getImageData(0,0,960,540).data;results.split.push({layout,pageDecay,time,...difference(whole,split),energy:energy(whole)});
      }
      const disabled=draw(8,{...s,fly:5000,scatter:5000}),plain=draw(8,{...s,fly:0,scatter:0});results.disabled.push({layout,...difference(disabled,plain)});
      const migrated={...s};delete migrated.fly;delete migrated.scatter;results.disabled.push({layout,missingLegacy:true,...difference(draw(8,migrated),plain)});
      const program={version:1,name:'QA fragments',enter:presetPhase('scatter','enter',{strength:800}),exit:presetPhase('scatter','exit',{strength:800})};
      for(const part of ['notes','beams','staff','marks']){
        const settings={...s,parts:{...none,[part]:true},noteArrival:'assemble',motionProgramActive:['notes','beams'].includes(part),scoreProgramActive:['staff','marks'].includes(part),motionProgram:program,scoreMotionProgram:program};
        const a=draw(1.2,settings);draw(9,settings);const again=draw(1.2,settings),off=draw(1.2,{...settings,motionProgramActive:false,scoreProgramActive:false});
        results.fragments.push({layout,part,energy:energy(a),deterministic:difference(a,again),changed:difference(a,off)});
      }
      for(const outputLayer of ['notation','effects','cursor'])results.exportLayers.push({layout,outputLayer,energy:energy(draw(.25,{...s,parts:{...none,effects:true},outputLayer}))});
      const high=draw(.25,{...s,glow:500,bloom:500,particles:300,trail:300});results.isolation.push({layout,part:'high-intensity',energy:energy(high)});
    }
    const C=await import('/composition.mjs'),{CompositionRenderer}=await import('/composition-render.mjs');
    const composition=new CompositionRenderer(canvas);composition.setScore(score);results.fullSplit=[];
    for(const layout of ['strip','rows']){
      const s=C.createStudioSettings(visualDefaults);C.applyVisualPreset(s,C.builtinPresets(visualDefaults)[0]);Object.assign(s,{layout,headerMode:layout==='rows'?'row':'dock',showTitle:true,transparent:false});C.selectedNode(s).transform.rotation=4;
      composition.render(3,s);const before=pixels();C.splitElements(s);composition.render(3,s);results.fullSplit.push({layout,...difference(before,pixels()),energy:energy(before)});
      const group=C.selectedNode(s);group.animationEnabled=true;group.program.enter=presetPhase('scatter','enter',{duration:2,strength:400});composition.render(1,s);const fragmented=pixels();composition.render(5,s);composition.render(1,s);results.groupFragments={deterministic:difference(fragmented,pixels()),changed:difference(before,fragmented)};
      const pack=C.parsePreset(JSON.stringify(C.makePreset(s,'All elements')),visualDefaults);C.applyVisualPreset(s,pack);composition.render(1,s);results.groupFragments.roundtrip=difference(fragmented,pixels());
      for(const node of s.composition.nodes)node.enabled=node.kind==='background';s.transparent=true;composition.render(3,s);results.transparentBackground=energy(pixels());
    }
    window.elementsQA={canvas,renderer,score};return results;
  })()`);
  await writeFile('artifacts/elements-qa/render-results.json',JSON.stringify(result,null,2));
  for(const r of result.isolation)assert.ok(r.part==='empty'?r.energy===0:r.energy>0,JSON.stringify(r));
  // Separate transparent layers resample antialiased edges and apply their masks
  // independently. Compare visible premultiplied channels, not RGB in near-zero alpha.
  for(const r of result.split){assert.ok(r.alpha/r.energy<.02,JSON.stringify(r));assert.ok(r.premultiplied/(3*r.energy)<.02,JSON.stringify(r))}
  for(const r of result.disabled)assert.equal(r.total,0,JSON.stringify(r));
  for(const r of result.fragments){assert.equal(r.deterministic.total,0,JSON.stringify(r));assert.ok(r.changed.total>0,JSON.stringify(r))}
  for(const r of result.exportLayers)assert.ok(r.outputLayer==='effects'?r.energy>0:r.energy===0,JSON.stringify(r));
  for(const r of result.fullSplit)assert.ok(r.total<Math.max(25000,r.energy*.04),JSON.stringify(r));
  assert.equal(result.groupFragments.deterministic.total,0);assert.equal(result.groupFragments.roundtrip.total,0);assert.ok(result.groupFragments.changed.total>0);assert.equal(result.transparentBackground,0);
  assert.deepEqual(qa.errors,[]);console.log('PASS: seven elements, split composition, fragments, modern animation disable, exports and expanded intensity');
}finally{qa.close()}
