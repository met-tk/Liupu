import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeMotionAt,motionAt,parseMotionProgram} from '../src/motion-program.mjs';
import {presetPhase} from '../src/effect-library.mjs';
import {builtinPresets,createStudioSettings,applyVisualPreset,compositionTail} from '../src/composition.mjs';
import {visualDefaults} from '../src/visual-defaults.mjs';
const program=()=>parseMotionProgram(JSON.stringify({version:1,enter:presetPhase('classic','enter'),exit:presetPhase('classic','exit')}));

test('classic phase offsets use independent sampled viewports without moving the current note',()=>{
  const p=program();p.enter.offset=2;p.exit.offset=-2;
  const view={x:500,width:1000,active:true,played:false,enterViewport:{x:850,active:false,played:false},exitViewport:{x:350,active:false,played:true}};
  const enter=edgeMotionAt(p,10,10,12,view);assert.equal(enter.phase,'enter');assert.ok(Math.abs(enter.fragments.amount-.5)<1e-10);assert.equal(enter.x,0);
  view.exitViewport.x=110;
  const exit=edgeMotionAt(p,10,10,12,view);assert.equal(exit.phase,'exit');assert.equal(exit.fragments.amount,.5);
  view.exitViewport.active=true;assert.equal(edgeMotionAt(p,10,10,12,view).phase,'enter');
  assert.equal(presetPhase('fade','enter',p.enter).offset,2);
  assert.equal(presetPhase('scatter','exit',p.exit).offset,-2);
});

test('original fragments enter at the right edge and persist after playback until the left edge',()=>{
  const p=program(),at=(time,x,played=false,active=false)=>edgeMotionAt(p,time,10,12,{x,width:1000,played,active});
  assert.equal(at(0,500).opacity,1,'future notes inside the page stay visible');
  assert.ok(Math.abs(at(0,850).fragments.amount-.5)<1e-10);
  assert.equal(at(0,850).fragments.style,'classic');
  assert.equal(at(11,850,false,true).phase,'hold','active notes stay assembled');
  assert.equal(at(30,350,true).phase,'hold','does not vanish after the timeline exit duration');
  assert.equal(at(30,350,true).opacity,.65);
  assert.equal(at(30,110,true).fragments.amount,.5);
  assert.deepEqual(at(30,110,true),at(30,110,true));
  assert.equal(at(30,110,false).phase,'hold','sustained/repeated notes do not leave prematurely');
  p.exit.strength=0;assert.equal(at(30,110,true).phase,'hold');
});

test('classic and timeline phases combine without changing the other trigger',()=>{
  const p=program();p.exit=presetPhase('fade','exit',{duration:2,delay:0});
  assert.equal(edgeMotionAt(p,0,10,12,{x:850,width:1000}).phase,'enter');
  assert.equal(edgeMotionAt(p,13,10,12,{x:400,width:1000,played:true}).opacity,.5);
  p.enter=presetPhase('fade','enter',{duration:2});p.exit=presetPhase('classic','exit');
  assert.equal(edgeMotionAt(p,0,10,12,{x:850,width:1000}).phase,'waiting');
  assert.equal(edgeMotionAt(p,30,10,12,{x:110,width:1000,played:true}).phase,'exit');
});

test('classic fragments use timeline timing outside the long-scroll note context and roundtrip',()=>{
  const p=program();
  assert.equal(motionAt(p,9.7,10,12).fragments.style,'classic');
  assert.equal(motionAt(p,13,10,12).fragments.style,'classic');
  assert.equal(motionAt(p,30,10,12).phase,'gone');
  assert.deepEqual(parseMotionProgram(JSON.stringify(p)),p);
  const preset=builtinPresets(visualDefaults).find(p=>p.name==='碎片聚散');assert.ok(preset);
  const s=createStudioSettings(visualDefaults);applyVisualPreset(s,preset);
  assert.equal(s.motionProgram.enter.renderer,'classic-fragments');assert.equal(s.particles,15);
  assert.equal(compositionTail(s,30),30.1,'edge exits do not add ineffective timeline padding');
  s.layout='rows';assert.ok(compositionTail(s,30)>31);
});
