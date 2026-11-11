import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoreRenderer, drawFlowHeaderBoundary, drawMovingRegions, headerFadeActivation, shouldKeepFlowHeaderSymbols } from '../src/render.mjs';
import { renderStaticScore } from '../src/static-render.mjs';
import { sweepGlowEnvelope } from '../src/timing.mjs';
import { visualDefaults } from '../src/visual-defaults.mjs';
import { layerConfig } from '../src/composition.mjs';
import { drawMeasureEffects, prepareMeasureEffects } from '../src/measure-effects.mjs';
import { drawMarks } from '../src/mark-render.mjs';
import { drawFragmented, drawFragmentedShape } from '../src/fragment-render.mjs';
import { defaultMotionProgram } from '../src/motion-program.mjs';

function mockCanvas(){
  const calls=[],stack=[],canvas={width:1920,height:1080};
  const context={canvas,globalAlpha:1,globalCompositeOperation:'source-over',
    save(){stack.push({globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation})},
    restore(){Object.assign(this,stack.pop())},
    drawImage(image,...args){calls.push(['image',image.id,...args,this.globalAlpha])},
    fill(){calls.push(['fill',this.globalAlpha])},
    createLinearGradient(){return {addColorStop(){}}},
  };
  for(const method of ['translate','rotate','scale','beginPath','moveTo','lineTo','closePath','clip','rect','clearRect','fillRect'])context[method]=(...args)=>calls.push([method,...args]);
  canvas.getContext=()=>context;
  return {canvas,context,calls};
}

function scoreFixture(count=128){
  let scannedNotes=0,scannedBeams=0;
  class Boxes extends Map{*[Symbol.iterator](){for(const entry of super[Symbol.iterator]()){scannedNotes++;yield entry}}}
  class Beams extends Array{*[Symbol.iterator](){for(const beam of super[Symbol.iterator]()){scannedBeams++;yield beam}}}
  const boxes=new Boxes(),occurrences=new Map(),events=[],beams=new Beams();
  const measureRegions=Array.from({length:count},(_,i)=>({id:`m${i}`,sourceIndex:i,x:i*200,endX:(i+1)*200}));
  const measureTimes=[...measureRegions.slice(0,count),measureRegions[0],measureRegions[1]].map((m,i)=>({id:m.id,time:i*2}));
  for(const [i,measure] of measureRegions.entries())for(let n=0;n<4;n++){
    const id=`n${i}:${n}`,x=measure.x+20+n*40,box={measureId:measure.id,x,y:20,w:10,h:20,sx:0,sy:0};
    boxes.set(id,box);
    const visits=measureTimes.filter(m=>m.id===measure.id).map(m=>({id,start:m.time+n*.4,end:m.time+n*.4+.3}));
    occurrences.set(id,visits);events.push(...visits);
    beams.push({noteId:id,points:[{x,y:20},{x:x+10,y:20},{x:x+10,y:22}],box:{...box,h:2}});
  }
  const score={width:count*200,height:80,duration:measureTimes.length*2,header:{width:0,states:[],lines:[]},boxes,occurrences,events,beams,measureRegions,measureTimes,stops:[{time:0,x:20},{time:measureTimes.length*2,x:count*200}],glowRegions:[]};
  return {score,counts:()=>({notes:scannedNotes,beams:scannedBeams}),reset(){scannedNotes=scannedBeams=0}};
}

test('note state remains seek-independent for overlapping and unordered occurrences',()=>{
  const occurrences=[{start:8,end:9},{start:1,end:5,visualEnd:6},{start:3,end:4},{start:10,end:11}];
  const renderer=Object.create(ScoreRenderer.prototype);renderer.score={occurrences:new Map([['n',occurrences]])};
  for(const time of [3.5,9.5,1,11,0,5.5,3.5]){
    const actual=renderer.state('n',time,0,1920,{});
    assert.equal(actual.active,occurrences.find(e=>time>=e.start&&time<e.end));
    assert.equal(actual.previous,occurrences.findLast(e=>e.start<=time));
    assert.equal(actual.next,occurrences.find(e=>e.start>time));
  }
});

test('opening header fade starts at zero and ramps only after the camera enters the pinned area',()=>{
  assert.equal(headerFadeActivation(100,100,1),0);
  assert.equal(headerFadeActivation(100,80,1),.5);
  assert.equal(headerFadeActivation(120,80,1),1);
  // The entrance buffer keeps a first note from being clipped while it is
  // still settling against the fixed header edge.
  assert.equal(headerFadeActivation(112,100,1,12),0);
  assert.equal(headerFadeActivation(132,100,1,12),.5);
  // A stationary camera must not dim the opening note merely because the
  // musical playhead has advanced in the source score.
  assert.equal(headerFadeActivation(100,100,2),0);
});

test('flow header symbol retention is explicit and independent of dock mode',()=>{
  assert.equal(shouldKeepFlowHeaderSymbols({layout:'strip',headerMode:'flow',headerFlowSymbols:true}),true);
  assert.equal(shouldKeepFlowHeaderSymbols({layout:'strip',headerMode:'flow',headerFlowSymbols:false}),false);
  assert.equal(shouldKeepFlowHeaderSymbols({layout:'strip',headerMode:'dock',headerFlowSymbols:true}),false);
  assert.equal(shouldKeepFlowHeaderSymbols({layout:'strip',headerMode:'flow',headerFlowSymbols:true},true,false),false);
  assert.equal(shouldKeepFlowHeaderSymbols({headerMode:'flow',headerFlowSymbols:true}),false);
});

test('note-attached regions are repainted into the spatial note fade group',()=>{
  const {canvas,context,calls}=mockCanvas();
  drawMovingRegions(context,{id:'sticky',rasterScale:2},[
    {fadeGroup:'marks',x:10,y:2,w:8,h:4},
    {fadeGroup:'notes',x:20,y:3,w:12,h:5}
  ],{left:100,top:50,scale:2,w:1920,rasterScale:1});
  assert.equal(calls.filter(call=>call[0]==='image').length,1);
  const image=calls.find(call=>call[0]==='image');
  assert.equal(image[1],'sticky');
  assert.deepEqual(image.slice(2,10),[40,6,24,10,140,56,24,10]);
});

test('flowing headers restore only clef/key/meter regions at the boundary',()=>{
  const {context,calls}=mockCanvas();
  const source={id:'structure',rasterScale:2};
  const restored=drawFlowHeaderBoundary(context,source,[
    {part:'header',kind:'clef',x:90,y:2,w:8,h:10},
    {part:'header',kind:'keySig',x:40,y:3,w:12,h:8},
    {part:'marks',kind:'dynam',x:30,y:4,w:12,h:8},
  ],{left:0,top:0,scale:1,cutoff:100,fadeWidth:20,rasterScale:2,alpha:.5});
  assert.equal(restored,true);
  assert.equal(calls.filter(call=>call[0]==='image').length,1);
  assert.equal(calls.find(call=>call[0]==='image')[1],'structure');
});

test('animated scrolling indexes visible notes and evaluates each note only once across paint passes',t=>{
  const oldDocument=globalThis.document;t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument});
  globalThis.document={createElement:()=>mockCanvas().canvas};
  const fixture=scoreFixture(1000),renderer=new ScoreRenderer(mockCanvas().canvas);
  fixture.score.noteAtlas={width:64,height:64};renderer.setScore(fixture.score);fixture.reset();
  renderer.updateColors=()=>{};renderer.backgroundFrame=()=>{};renderer.drawSparks=()=>{};
  const settings={...visualDefaults,...layerConfig(visualDefaults),motion:'flow',headerMode:'hidden',pageDecay:'none',glow:0,particles:10,trail:0,showTitle:false,parts:{notes:true,beams:false,effects:true,staff:false,marks:false,header:false,cursor:false}};
  const evaluations=new Map(),programmed=renderer.programmed;renderer.programmed=function(...args){evaluations.set(args[0],(evaluations.get(args[0])||0)+1);return programmed.apply(this,args)};
  for(const time of [1,300,1990,1]){
    evaluations.clear();renderer.render(time,settings);
    assert.ok(evaluations.size>0&&evaluations.size<100,`only nearby animated notes should be evaluated, saw ${evaluations.size} of 4000`);
    assert.ok([...evaluations.values()].every(count=>count===1),'notation and effects must share one animation evaluation per note');
  }
  assert.deepEqual(fixture.counts(),{notes:0,beams:0},'warm scroll frames must not enumerate full-score note or beam collections');
});

test('sweep preserves the maximum over repeated onsets, signed offsets and valley tails without argument limits',()=>{
  const events=[{start:10,end:12},{start:1,end:5},{start:4,end:4.2}],state={occurrences:events};
  for(const valley of [0,25,150])for(const offset of [-.4,0,.6])for(const time of [-2,1,3.5,5,11,2,30]){
    const settings={glowMode:'sweep',glowPeak:120,glowValley:valley,glowRange:1.4,glowOffset:offset};
    const expected=Math.max(0,...events.map(e=>sweepGlowEnvelope(time-offset,e.start,{peak:1.2,valley:valley/100,range:1.4})));
    assert.equal(ScoreRenderer.prototype.glowLevel(state,time,settings),expected);
  }
  const many=Array.from({length:150000},(_,i)=>({start:i,end:i+.1}));
  assert.equal(ScoreRenderer.prototype.glowLevel({occurrences:many},12345,{glowMode:'sweep'}),1);
});

test('pulse beam offsets use shifted events rather than the unshifted active note',()=>{
  const renderer=Object.create(ScoreRenderer.prototype),event={start:1,end:2},box={x:0,w:20};
  renderer.scorePositionAt=()=>200;renderer.spatialSpan=()=>({leadPx:20,trailPx:20});
  const settings={glow:100,glowMode:'pulse',glowOffset:1};
  assert.equal(renderer.beamGlowLevel({active:event,previous:event,occurrences:[event]},box,1.5,0,1,settings),0);
  assert.equal(renderer.beamGlowLevel({previous:event,occurrences:[event]},box,2.5,0,1,settings),1);
});

test('static frames reuse measure membership, preserve repeats and rebuild it for a new score',t=>{
  const oldDocument=globalThis.document;t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument});
  globalThis.document={createElement:()=>mockCanvas().canvas};
  const fixture=scoreFixture(),mock=mockCanvas(),renderer=Object.create(ScoreRenderer.prototype);
  Object.assign(renderer,{score:fixture.score,ctx:mock.context,canvas:mock.canvas,ink:{id:'notes'},atlasScale:1});
  const settings={layout:'page',camera:'page',headerMode:'hidden',outputLayer:'notation',showTitle:false,pageBars:4,pageRows:2,zoom:100,glow:0,particles:0,parts:{notes:true,beams:true,effects:false,staff:false,marks:false,header:false,cursor:false}};
  renderStaticScore(renderer,.5,settings);
  const original=mock.calls.slice();mock.calls.length=0;fixture.reset();
  renderStaticScore(renderer,.5,settings);
  assert.deepEqual(mock.calls,original);
  assert.deepEqual(fixture.counts(),{notes:0,beams:0},'warm frames must not scan full-score note or beam collections');
  const first=renderer.staticLayout.pages[0].rows[0].measures[0],last=renderer.staticLayout.pages.at(-1).rows[0].measures[0];
  assert.equal(first.id,last.id);assert.equal(first.noteEvents.get('n0:0').start,0);assert.equal(last.noteEvents.get('n0:0').start,256);
  renderStaticScore(renderer,257,settings);mock.calls.length=0;
  renderStaticScore(renderer,.5,settings);assert.deepEqual(mock.calls,original,'backward seeking must not reuse a later occurrence');
  renderer.score=scoreFixture(4).score;
  renderStaticScore(renderer,.5,settings);
  assert.notEqual(renderer.staticLayout.pages[0].rows[0].measures[0],first);
  assert.equal(renderer.staticLayout.pages.at(-1).rows.at(-1).measures.at(-1).noteEvents.get('n1:0').start,10);
});

function ledgerFragmentFrame(phase,zoom) {
  const fixture=scoreFixture(2),renderer=new ScoreRenderer(mockCanvas().canvas),note=mockCanvas();
  fixture.score.boxes=new Map([['n0:0',fixture.score.boxes.get('n0:0')]]);
  fixture.score.ledgerLines=new Map([['n0:0',[{x1:18,x2:32,y:44,width:1}]]]);
  fixture.score.noteAtlas={width:64,height:64};
  renderer.setScore(fixture.score);
  renderer.noteLayer=note.canvas;renderer.noteLayerCtx=note.context;note.context.stroke=()=>note.calls.push(['stroke']);
  renderer.updateColors=()=>{};renderer.backgroundFrame=()=>{};
  renderer.programmed=()=>({x:0,y:0,rotation:0,scale:1,opacity:1,phase,fragments:{amount:.5,strength:100,style:'classic'}});
  renderer.render(0,{...visualDefaults,...layerConfig(visualDefaults),zoom,motion:'flow',headerMode:'hidden',
    motionProgramActive:true,pageDecay:'none',glow:0,particles:0,trail:0,showTitle:false,ledgerMotion:true,
    parts:{notes:true,beams:false,effects:false,staff:true,marks:false,header:false,cursor:false}});
  const clip=note.calls.findIndex(call=>call[0]==='clip');
  assert.ok(clip>=0,'animated ledger strokes must be fragmented');
  assert.equal(note.calls.slice(clip).find(call=>call[0]==='stroke'||call[0]==='image')?.[0],'stroke','sample the ledger, not the note image');
  const translations=note.calls.slice(0,clip).filter(call=>call[0]==='translate').slice(-2);
  return {x:translations[0][1]+translations[1][1],y:translations[0][2]+translations[1][2]};
}

test('ledger fragments enter from the right and exit to the left with their note',t=>{
  const oldDocument=globalThis.document;
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument});
  globalThis.document={createElement:()=>mockCanvas().canvas};
  const enter=ledgerFragmentFrame('enter',100),exit=ledgerFragmentFrame('exit',100);
  assert.ok(enter.x>0,'ledger entry must use the note entry direction');
  assert.ok(exit.x<0,'ledger exit must use the note exit direction');
  assert.ok(Math.abs(enter.x+exit.x)<1e-9);
  assert.equal(enter.y,exit.y);
});

test('ledger fragment travel stays in score units as viewport zoom changes',t=>{
  const oldDocument=globalThis.document;
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument});
  globalThis.document={createElement:()=>mockCanvas().canvas};
  const reference=ledgerFragmentFrame('exit',100);
  for(const zoom of [25,50,200]){
    assert.deepEqual(ledgerFragmentFrame('exit',zoom),reference,'the surrounding canvas transform already applies zoom');
  }
});

test('dynamic measure tiles are built only when visible and alive, including camera and animation transforms',()=>{
  const {canvas,context}=mockCanvas(),renderer={canvas,ctx:context,score:{height:40}};
  let built=0;
  const tile=()=>{built++;return {id:'dynamic',width:100,height:40}};
  const measure={id:'mark',x:10,y:10,width:100,scale:1,start:1,end:2,decayEnd:2};
  const settings={pageDecay:'fade',decayTrigger:'measure',decayDelay:0,decayDuration:1};
  drawMeasureEffects(renderer,measure,4,settings,true,false,tile);
  assert.equal(built,0,'fully dissolved marks must not be rasterized');
  drawMeasureEffects(renderer,{...measure,x:10000},0,{...settings,pageDecay:'none'},true,false,tile);
  assert.equal(built,0,'offscreen marks must not be rasterized');
  context.getTransform=()=>({a:1,b:0,c:0,d:1,e:0,f:-10000});
  drawMeasureEffects(renderer,{...measure,y:10000},0,{...settings,pageDecay:'none'},true,false,tile);
  assert.equal(built,1,'follow camera translation brings a distant row into view');
  delete context.getTransform;
  const program=structuredClone(defaultMotionProgram);
  for(const frame of program.enter.frames)Object.assign(frame,{x:-10000,y:0,rotation:0,opacity:1,scale:1});
  drawMeasureEffects(renderer,{...measure,x:10000},.9,{...settings,pageDecay:'none',scoreProgramActive:true,scoreMotionProgram:program},true,false,tile);
  assert.equal(built,2,'an offscreen source can animate into the viewport');
  drawMeasureEffects(renderer,measure,-2,{...settings,pageDecay:'none',scoreProgramActive:true,scoreMotionProgram:program},true,false,tile);
  assert.equal(built,2,'waiting marks must not be rasterized');
});

test('animated mark canvases reuse backing stores, repaint live content and reset with their style scope',t=>{
  const oldDocument=globalThis.document;let allocations=0;
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument});
  globalThis.document={createElement:()=>{allocations++;return mockCanvas().canvas}};
  const region={id:'mark',measureId:'m',x:20,y:10,w:20,h:10,sx:0,sy:0};
  const visit={id:'m',occurrence:0,start:0,end:2,decayEnd:2,lastOccurrence:0};
  const {canvas,context}=mockCanvas(),renderer={canvas,ctx:context,score:{height:80,markRegions:[region]},
    markVisits:new Map([['mark',[visit]]]),markInk:{id:'marks'},haloRadius:()=>10};
  const settings={pageDecay:'none',markPageDecay:'fade',markDecayDuration:1,markDecayDelay:0,markDecayTrigger:'measure',parts:{marks:true}};
  prepareMeasureEffects(renderer,settings,'scope');
  const options={scale:1,w:1920,notation:true,effects:false};
  // Canvas resize resets its transform in a real browser; this mock records the explicit clear/reset calls.
  globalThis.document.createElement=()=>{allocations++;const m=mockCanvas();m.context.setTransform=()=>m.calls.push(['reset']);return m.canvas};
  drawMarks(renderer,.1,settings,options);
  const first=renderer.measureCache.marks.get('mark:20:40'),count=allocations;
  drawMarks(renderer,.2,settings,options);
  assert.equal(allocations,count);assert.equal(renderer.measureCache.marks.get('mark:20:40'),first);
  drawMarks(renderer,10,settings,options);assert.equal(allocations,count,'gone marks never allocate new tiles');
  prepareMeasureEffects(renderer,{...settings,markColor:'#123456'},'scope');
  assert.equal(renderer.measureCache.marks,undefined,'style changes release old mark backing stores');
});

test('fragment clipping culls transformed cells, not their untransformed glyph bounds',()=>{
  const mock=mockCanvas();mock.context.getTransform=()=>({a:1,b:0,c:0,d:1,e:0,f:0});
  let draws=0;
  const options={x:10000,y:10,width:100,height:100,amount:.5,strength:100,key:'viewport'};
  drawFragmentedShape(mock.context,()=>draws++,options);assert.equal(draws,0);
  mock.context.getTransform=()=>({a:1,b:0,c:0,d:1,e:-10000,f:0});
  drawFragmentedShape(mock.context,()=>draws++,options);assert.ok(draws>0,'camera transforms must be included');
  draws=0;mock.context.getTransform=()=>({a:0,b:1,c:-1,d:0,e:500,f:-10000});
  drawFragmentedShape(mock.context,()=>draws++,options);assert.ok(draws>0,'rotated groups must preserve visible cells');
});

test('fragment glyph cache is lazy, bounded and invalidated by recoloring',t=>{
  const oldDocument=globalThis.document;let allocations=0;
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument});
  globalThis.document={createElement:()=>{allocations++;return mockCanvas().canvas}};
  const source={id:'atlas',width:4096,height:4096,fragmentTiles:new Map()},mock=mockCanvas();
  mock.context.getTransform=()=>({a:1,b:0,c:0,d:1,e:0,f:0});
  const options={sx:100.25,sy:50.5,sw:20,sh:30,x:100,y:100,width:20,height:30,amount:.2,strength:100,key:'glyph'};
  drawFragmented(mock.context,source,{...options,x:10000});assert.equal(allocations,0,'culled cells must not populate the cache');
  drawFragmented(mock.context,source,options);drawFragmented(mock.context,source,options);
  assert.equal(allocations,1,'reuse the isolated source pixels on following frames');
  const tile=source.fragmentTiles.values().next().value;
  assert.equal(tile.left,99);assert.equal(tile.top,49);
  for(let i=0;i<540;i++)drawFragmented(mock.context,source,{...options,sx:200+i*2});
  assert.ok(source.fragmentTiles.size<=512);
  assert.ok([...source.fragmentTiles.values()].reduce((sum,t)=>sum+t.canvas.width*t.canvas.height,0)<=4_000_000);
  const renderer=Object.create(ScoreRenderer.prototype),target=mockCanvas().canvas;
  renderer.ink=target;target.fragmentTiles=source.fragmentTiles;
  renderer.tint(target,{id:'original',width:512,height:512},'#123456');
  assert.equal(target.fragmentTiles.size,0,'old-color glyphs must not survive tint changes');
});

test('score layers allocate only enabled rasters and create newly enabled colors without stale data',t=>{
  const oldDocument=globalThis.document;
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument});
  globalThis.document={createElement:()=>{const m=mockCanvas();m.context.createRadialGradient=m.context.createLinearGradient;return m.canvas}};
  const renderer=new ScoreRenderer(mockCanvas().canvas),fixture=scoreFixture(2).score;
  const image={id:'source',width:320,height:80};
  Object.assign(fixture,{noteAtlas:{width:320,height:80},noteImage:image,structureImage:image,stickyStructureImage:image,staffLineImage:image,
    markImage:image,markRegions:[],inlineHeaderImage:image});fixture.header.image=image;
  renderer.setScore(fixture);
  assert.equal(renderer.structGlow.width,1,'disabled full-score layers should not reserve their raster memory');
  const painted=[],tint=renderer.tint;
  renderer.tint=function(target,source,color){painted.push(target);return tint.call(this,target,source,color)};
  const parts={notes:true,beams:false,staff:false,marks:false,header:false,effects:false,cursor:false};
  renderer.updateColors({...visualDefaults,layout:'strip',parts});
  assert.deepEqual(painted,[renderer.ink]);assert.equal(renderer.markInk.width,1);
  painted.length=0;
  renderer.updateColors({...visualDefaults,layout:'strip',parts:{...parts,marks:true},markColor:'#123456'});
  assert.deepEqual(painted,[renderer.markInk]);
  assert.equal(renderer.markInk.width,320);
  painted.length=0;
  renderer.updateColors({...visualDefaults,layout:'strip',parts:{...parts,marks:true},markColor:'#654321'});
  assert.deepEqual(painted,[renderer.markInk],'enabled layers must refresh on recoloring');
});
