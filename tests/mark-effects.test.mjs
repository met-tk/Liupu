import test from 'node:test';
import assert from 'node:assert/strict';
import { markEffectSettings, markTimeline } from '../src/effect-timing.mjs';
import { createStudioSettings, makePreset, parsePreset, compositionTail, selectedNode } from '../src/composition.mjs';
import { visualDefaults } from '../src/visual-defaults.mjs';
import { presetPhase } from '../src/effect-library.mjs';

test('mark lifetimes include all bars of a spanning glyph and restart for each repeat',()=>{
  const timeline=[0,1,2,0,1,2].map((sourceIndex,occurrence)=>({id:`m${sourceIndex}`,sourceIndex,occurrence,
    x:sourceIndex*100,endX:(sourceIndex+1)*100,start:occurrence*2,end:(occurrence+1)*2,decayEnd:(occurrence+1)*2+.2}));
  const visits=markTimeline({measureId:'m0',x:80,w:160},timeline);
  assert.deepEqual(visits.map(v=>[v.start,v.end,v.decayEnd,v.occurrence,v.lastOccurrence]),[[0,6,6.2,0,2],[6,12,12.2,3,5]]);
  assert.equal(markTimeline({measureId:'m2',x:240,w:90},timeline)[0].end,6,'a backwards repeat must not extend an old mark');
});

test('staff and marks retain independent programs, dissolve settings and preview/export tails',()=>{
  const settings=createStudioSettings(visualDefaults);
  settings.pageDecay='none';settings.markPageDecay='fade';settings.markDecayOffset=3;settings.markDecayDuration=4;
  settings.markProgramActive=true;settings.markMotionProgram.enter=presetPhase('scatter','enter');
  settings.markMotionProgram.exit=presetPhase('none','exit',{delay:0});
  const style=markEffectSettings(settings);
  assert.equal(style.pageDecay,'fade');assert.equal(style.decayOffset,3);assert.equal(style.scoreProgramActive,true);
  assert.equal(style.parts.staff,false);assert.equal(settings.pageDecay,'none');
  assert.equal(settings.scoreMotionProgram.enter.enabled,false);
  assert.equal(compositionTail(settings,10),17.1);
  const roundtrip=parsePreset(JSON.stringify(makePreset(settings,'Marks')),visualDefaults);
  assert.deepEqual(roundtrip.composition.nodes[0].config.markMotionProgram,settings.markMotionProgram);
  selectedNode(settings).parts.marks=false;
  assert.equal(compositionTail(settings,10),10.1);
});

test('mark glow follows each performed visit, including different repeat tempos and boundary jumps',()=>{
  const timeline=[0,1,0,1].map((sourceIndex,occurrence)=>({id:`m${sourceIndex}`,sourceIndex,occurrence,
    x:sourceIndex*100,endX:(sourceIndex+1)*100,start:[0,2,4,8][occurrence],end:[2,4,8,12][occurrence],decayEnd:[2,4,8,12][occurrence]}));
  const stops=[{time:0,x:0},{time:2,x:100},{time:4,x:0,arrivalX:200},{time:8,x:100},{time:12,x:200}];
  const visits=markTimeline({measureId:'m0',x:50,w:100},timeline,stops);
  assert.deepEqual(visits.map(v=>[v.glowStart,v.glowEnd]),[[1,3],[6,10]]);
  const compact=markTimeline({measureId:'m1',x:130,w:10},timeline,stops);
  assert.deepEqual(compact.map(v=>[v.glowStart,v.glowEnd]),[[2.6,2.8000000000000003],[9.2,9.6]]);
});

test('legacy combined structure effects migrate once into separate mark settings without changing the original',()=>{
  const original=makePreset(createStudioSettings(visualDefaults),'Old preset');original.version=4;
  const config=original.composition.nodes[0].config;
  for(const key of Object.keys(config).filter(k=>k.startsWith('mark')&&!['markColor','markOpacity'].includes(k)))delete config[key];
  config.pageDecay='dissolve';config.decayOffset=1;config.decayDelay=.4;
  config.scoreMotionProgram.enter=presetPhase('rise','enter');config.scoreProgramActive=true;
  const migrated=parsePreset(JSON.stringify(original),visualDefaults),next=migrated.composition.nodes[0].config;
  assert.equal(migrated.version,5);assert.equal(next.markPageDecay,'dissolve');assert.equal(next.markDecayOffset,1.4);
  assert.deepEqual(next.markMotionProgram,next.scoreMotionProgram);
  assert.equal(config.markMotionProgram,undefined);
  assert.deepEqual(parsePreset(JSON.stringify(migrated),visualDefaults),migrated);
  for(const [key,value] of [['markDecayDuration',0],['markDecayOffset',Infinity],['markProgramActive','yes'],['markPageDecay','unknown']]){
    const invalid=structuredClone(migrated);invalid.composition.nodes[0].config[key]=value;
    assert.throws(()=>parsePreset(JSON.stringify(invalid),visualDefaults),key);
  }
});
