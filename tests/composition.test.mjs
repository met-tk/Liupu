import test from 'node:test';
import assert from 'node:assert/strict';
import {visualDefaults as defaults} from '../src/visual-defaults.mjs';
import {createStudioSettings,selectedNode,selectNode,splitHeader,makeLayer,groupNodes,makePreset,parsePreset,applyVisualPreset,builtinPresets,presetFingerprint,resolveLayerConfig,compositionTail} from '../src/composition.mjs';

test('whole presets roundtrip layout, groups, animations and colors, excluding source and output settings',()=>{
  const s=createStudioSettings(defaults);s.aspect='9:16';s.title='Current music';splitHeader(s);s.groupProgramActive=true;s.groupMotionProgram.enter.enabled=true;selectedNode(s).transform.rotation=24;
  s.layout='rows';s.camera='follow';s.headerMode='row';s.pageBars=6;s.decayOffset=-2;
  const a=parsePreset(JSON.stringify(makePreset(s,'My scene')),defaults),before=presetFingerprint(s);
  for(const preset of builtinPresets(defaults)){
    applyVisualPreset(s,parsePreset(JSON.stringify(preset),defaults));applyVisualPreset(s,a);
    assert.equal(presetFingerprint(s),before);assert.equal(s.aspect,'9:16');assert.equal(s.title,'Current music');
  }
});
test('legacy header bridge field roundtrips for preset compatibility',()=>{
  const s=createStudioSettings(defaults);
  assert.equal(s.headerBridge,false);
  assert.equal(s.headerNoteFade,true);
  assert.equal(s.headerMarkFade,true);
  assert.equal(s.headerNoteFadeOffset,0);
  assert.equal(s.headerMarkFadeOffset,0);
  assert.equal(s.headerFlowSymbols,true);
  assert.equal(s.headerOpeningGap,64);
  assert.equal(s.ledgerMotion,true);
  s.ledgerMotion=true;
  s.headerBridge=true;
  s.headerNoteFade=false;
  s.headerMarkFade=false;
  s.headerNoteFadeOffset=1.5;
  s.headerMarkFadeOffset=-.75;
  s.headerFlowSymbols=false;
  s.headerOpeningGap=96;
  const preset=parsePreset(JSON.stringify(makePreset(s,'header bridge')),defaults);
  assert.equal(preset.composition.nodes[0].config.headerBridge,true);
  assert.equal(preset.composition.nodes[0].config.headerNoteFade,false);
  assert.equal(preset.composition.nodes[0].config.headerMarkFade,false);
  assert.equal(preset.composition.nodes[0].config.headerNoteFadeOffset,1.5);
  assert.equal(preset.composition.nodes[0].config.headerMarkFadeOffset,-.75);
  assert.equal(preset.composition.nodes[0].config.headerFlowSymbols,false);
  assert.equal(preset.composition.nodes[0].config.headerOpeningGap,96);
  assert.equal(preset.composition.nodes[0].config.ledgerMotion,true);
  const invalid=structuredClone(preset);
  invalid.composition.nodes[0].config.headerBridge='yes';
  assert.throws(()=>parsePreset(JSON.stringify(invalid),defaults));
});
test('selected layer parameters and group programs are independent; selecting cannot alter output fingerprint',()=>{
  const s=createStudioSettings(defaults),first=selectedNode(s),second=makeLayer(defaults);s.composition.nodes.push(second);first.config.zoom=150;
  selectNode(s,second.id);s.zoom=75;assert.equal(first.config.zoom,150);assert.equal(second.config.zoom,75);
  const before=presetFingerprint(s);selectNode(s,first.id);assert.equal(presetFingerprint(s),before);
  groupNodes(s,[first.id,second.id]);s.groupProgramActive=true;assert.equal(selectedNode(s).animationEnabled,true);assert.equal(first.animationEnabled,false);
});
test('splitting header preserves parent transforms and external layout links without self references',()=>{
  const s=createStudioSettings(defaults),first=selectedNode(s),dependent=makeLayer(defaults);s.composition.nodes.push(dependent);dependent.layoutLink=first.id;first.transform.x=12;first.timeOffset=2;
  splitHeader(s);const group=selectedNode(s),body=s.composition.nodes.find(n=>n.name==='谱面'),header=s.composition.nodes.find(n=>n.name==='谱头');
  assert.equal(group.transform.x,12);assert.equal(group.timeOffset,2);assert.equal(body.transform.x,0);assert.equal(header.layoutLink,body.id);assert.equal(dependent.layoutLink,body.id);
  body.config.zoom=130;body.config.headerBridge=true;
  body.config.headerNoteFade=false;
  body.config.headerMarkFade=false;
  body.config.headerNoteFadeOffset=2;
  body.config.headerMarkFadeOffset=-1;
  body.config.headerFlowSymbols=false;
  const headerConfig=resolveLayerConfig(header,s.composition);
  assert.equal(headerConfig.zoom,130);assert.equal(headerConfig.headerBridge,true);
  assert.equal(headerConfig.headerNoteFade,false);
  assert.equal(headerConfig.headerMarkFade,false);
  assert.equal(headerConfig.headerNoteFadeOffset,2);
  assert.equal(headerConfig.headerMarkFadeOffset,-1);
  assert.equal(headerConfig.headerFlowSymbols,false);
  assert.equal(body.parts.header,false);assert.equal(header.parts.notes,false);assert.doesNotThrow(()=>parsePreset(JSON.stringify(makePreset(s,'split')),defaults));
});
test('linked header bridge edits its layout owner',()=>{
  const s=createStudioSettings(defaults);splitHeader(s);
  const body=s.composition.nodes.find(n=>n.name==='谱面'),header=s.composition.nodes.find(n=>n.name==='谱头');
  selectNode(s,header.id);
  const owner=s.composition.nodes.find(n=>n.id===header.layoutLink);
  owner.config.headerBridge=true;
  owner.config.headerFlowSymbols=false;
  assert.equal(resolveLayerConfig(header,s.composition).headerBridge,true);
  assert.equal(header.config.headerBridge,false);
  assert.equal(body.config.headerBridge,true);
  assert.equal(body.config.headerFlowSymbols,false);
});
test('malformed compositions reject cycles, dangling layout links, noninteger row counts and limits',()=>{
  const s=createStudioSettings(defaults);splitHeader(s);const base=makePreset(s,'safe');
  for(const mutate of [p=>p.composition.nodes[0].parent=p.composition.nodes[0].id,p=>p.composition.nodes[2].layoutLink='missing',p=>p.composition.nodes[1].config.pageBars=1.5,p=>p.composition.nodes[1].transform.x=Infinity,p=>p.composition.nodes[1].parts.notes='yes',p=>p.composition.nodes[1].config.injected='x']){
    const p=structuredClone(base);mutate(p);assert.throws(()=>parsePreset(JSON.stringify(p),defaults));
  }
});
test('nonadjacent grouping cannot silently reorder overlapping siblings',()=>{
  const s=createStudioSettings(defaults),a=selectedNode(s),b=makeLayer(defaults),c=makeLayer(defaults);s.composition.nodes.push(b,c);assert.throws(()=>groupNodes(s,[a.id,c.id]),/相邻/);
});
test('composition tail accounts for nested visual offsets, disabled nodes and whole-group exits',()=>{
  const s=createStudioSettings(defaults);s.pageDecay='none';splitHeader(s);selectedNode(s).timeOffset=3;s.groupProgramActive=true;s.groupMotionProgram.exit.enabled=true;s.groupMotionProgram.exit.duration=2;
  assert.equal(compositionTail(s,10),15.1);selectedNode(s).enabled=false;assert.equal(compositionTail(s,10),10.1);
});
test('legacy waiting migrates into one signed offset without repeated accumulation',()=>{
  const p=makePreset(createStudioSettings(defaults),'migration');p.composition.nodes[0].config.decayOffset=-1;p.composition.nodes[0].config.decayDelay=.5;
  const next=parsePreset(JSON.stringify(p),defaults);assert.equal(next.composition.nodes[0].config.decayOffset,-.5);assert.equal(next.composition.nodes[0].config.decayDelay,0);assert.deepEqual(parsePreset(JSON.stringify(next),defaults),next);
});

test('v1 through v4 preset packages migrate to v5 and unsupported versions reject',()=>{
  const original=makePreset(createStudioSettings(defaults),'legacy');
  assert.equal(original.version,5);
  original.version=1;
  const migrated=parsePreset(JSON.stringify(original),defaults);
  assert.equal(migrated.version,5);
  assert.deepEqual(parsePreset(JSON.stringify(migrated),defaults),migrated);
  assert.equal(original.version,1);
  original.version=2;
  assert.equal(parsePreset(JSON.stringify(original),defaults).version,5);
  original.version=3;
  assert.equal(parsePreset(JSON.stringify(original),defaults).version,5);
  original.version=4;
  assert.equal(parsePreset(JSON.stringify(original),defaults).version,5);
  original.version=6;
  assert.throws(()=>parsePreset(JSON.stringify(original),defaults),/受支持/);
});

test('signed animation offsets survive presets and extend preview/export tails without shortening audio',()=>{
  const s=createStudioSettings(defaults);s.pageDecay='none';s.scoreProgramActive=false;s.motionProgramActive=true;
  delete s.motionProgram.exit.renderer;delete s.motionProgram.exit.strength;
  s.motionProgram.enter.enabled=false;s.motionProgram.exit.enabled=true;s.motionProgram.exit.offset=5;s.motionProgram.exit.delay=.5;s.motionProgram.exit.duration=2;
  assert.equal(compositionTail(s,10),17.6);
  assert.equal(parsePreset(JSON.stringify(makePreset(s,'offset')),defaults).composition.nodes[0].config.motionProgram.exit.offset,5);
  s.motionProgram.exit.offset=-120;assert.equal(compositionTail(s,10),10.1);
  s.motionProgram.exit.renderer='classic-fragments';s.motionProgram.exit.strength=65;s.motionProgram.exit.offset=3;
  assert.equal(compositionTail(s,10),13.1);
  s.motionProgram.exit.enabled=false;s.noteArrival='assemble';s.motionProgram.enter.enabled=true;s.motionProgram.enter.offset=120;
  assert.equal(compositionTail(s,10),130.1);
  s.motionProgram.enter.enabled=false;s.groupProgramActive=true;s.groupMotionProgram.enter.enabled=true;s.groupMotionProgram.enter.offset=120;
  assert.ok(Math.abs(compositionTail(s,10)-120.7)<1e-10);
  const n=selectedNode(s);n.timeOffset=5;assert.ok(Math.abs(compositionTail(s,10)-125.7)<1e-10);
});

test('score phase JSON offset folds once into the shared signed dissolve offset',()=>{
  const p=makePreset(createStudioSettings(defaults),'offset'),config=p.composition.nodes[0].config;
  config.scoreMotionProgram.enter.offset=2;config.scoreMotionProgram.exit.offset=-3;config.decayOffset=.5;
  const next=parsePreset(JSON.stringify(p),defaults),c=next.composition.nodes[0].config;
  assert.equal(c.scoreMotionProgram.enter.offset,2);assert.equal(c.decayOffset,-2.5);assert.equal(c.scoreMotionProgram.exit.offset,undefined);
  assert.deepEqual(parsePreset(JSON.stringify(next),defaults),next);
});
