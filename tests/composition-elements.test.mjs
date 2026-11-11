import test from 'node:test';
import assert from 'node:assert/strict';
import { visualDefaults as defaults } from '../src/visual-defaults.mjs';
import { defaultMotionProgram } from '../src/motion-program.mjs';
import { presetPhase } from '../src/effect-library.mjs';
import {
  PARTS, CONFIG_LIMITS, MAX_LAYERS, MAX_NODES, allParts, createStudioSettings,
  selectedNode, selectNode, makeLayer, makeSurface, groupNodes, splitElements,
  identityTransform, makePreset, parsePreset, resolveLayerConfig,
} from '../src/composition.mjs';

const preset = () => makePreset(createStudioSettings(defaults), '元素测试');
const parse = p => parsePreset(JSON.stringify(p), defaults);
const score = p => p.composition.nodes.find(n => n.kind === 'score');

test('legacy fly and scatter migrate once to the matching animation phases without losing timing', () => {
  const p = preset(), c = score(p).config;
  delete c.animationModel;
  c.fly = 450; c.scatter = 1200; c.motionProgramActive = false;
  c.motionProgram = structuredClone(defaultMotionProgram);
  c.motionProgram.enter.duration = 3;
  c.motionProgram.exit.duration = 5;
  c.motionProgram.exit.delay = 2;
  const migrated = parse(p), result = score(migrated).config;
  assert.equal(result.animationModel, 2);
  assert.equal(result.motionProgramActive, true);
  assert.equal(result.noteArrival, 'assemble');
  for (const [phase, strength, duration] of [['enter', 450, 3], ['exit', 1200, 5]]) {
    assert.equal(result.motionProgram[phase].renderer, 'classic-fragments');
    assert.equal(result.motionProgram[phase].strength, strength);
    assert.equal(result.motionProgram[phase].duration, duration);
  }
  assert.equal(result.motionProgram.exit.delay, 2);
  assert.equal(Object.hasOwn(result, 'fly'), false);
  assert.equal(Object.hasOwn(result, 'scatter'), false);
  assert.deepEqual(parse(migrated), migrated);
  assert.equal(c.fly, 450, 'parsing must not mutate the input');
});

test('a zero legacy phase remains disabled and an already active legacy program is preserved', () => {
  const p = preset(), c = score(p).config;
  delete c.animationModel; c.fly = 0; c.scatter = 85; c.motionProgramActive = false;
  const migrated = score(parse(p)).config;
  assert.equal(migrated.motionProgram.enter.enabled, false);
  assert.equal(migrated.motionProgram.exit.renderer, 'classic-fragments');
  assert.equal(migrated.motionProgram.exit.strength, 85);
  c.motionProgramActive = true;
  c.motionProgram = structuredClone(defaultMotionProgram);
  assert.deepEqual(score(parse(p)).config.motionProgram, defaultMotionProgram);
});

test('modern animationModel 2 preserves disabled animation and its saved phase data', () => {
  const p = preset(), c = score(p).config;
  c.animationModel = 2; c.motionProgramActive = false;
  c.motionProgram.enter = presetPhase('spiral', 'enter', { duration: 18 });
  c.motionProgram.exit = presetPhase('scatter', 'exit', { duration: 27, strength: 2400 });
  c.fly = 990; c.scatter = 880;
  const result = parse(p), config = score(result).config;
  assert.equal(config.motionProgramActive, false);
  assert.deepEqual(config.motionProgram, c.motionProgram);
  assert.equal(Object.hasOwn(config, 'fly'), false);
  assert.equal(Object.hasOwn(config, 'scatter'), false);
  assert.deepEqual(parse(result), result);
});

test('old parts inherit beams and performance effects from notes only when the fields are absent', () => {
  for (const visible of [false, true]) {
    const p = preset(), n = score(p);
    n.parts.notes = visible; delete n.parts.beams; delete n.parts.effects;
    const result = score(parse(p));
    assert.equal(result.parts.beams, visible); assert.equal(result.parts.effects, visible);
    assert.equal(Object.keys(result.parts).length, PARTS.length);
    n.parts.notes = true; n.parts.beams = false; n.parts.effects = false;
    assert.equal(score(parse(p)).parts.beams, false); assert.equal(score(parse(p)).parts.effects, false);
  }
  for (const key of ['beams', 'effects']) {
    const p = preset(); score(p).parts[key] = null;
    assert.throws(() => parse(p), /元素开关/);
  }
});

test('splitting every component preserves the original group transform and redirects layout dependents', () => {
  const s = createStudioSettings(defaults), original = selectedNode(s), sibling = makeLayer(defaults, '旁层'), dependent = makeLayer(defaults, '关联层');
  s.composition.nodes.push(sibling, dependent);
  dependent.layoutLink = original.id;
  const parent = groupNodes(s, [original.id, sibling.id]);
  selectNode(s, original.id);
  Object.assign(original.transform, { x: 14, y: -9, scaleX: 1.8, scaleY: .7, rotation: 125, opacity: .4, blend: 'multiply' });
  original.timeOffset = 3; original.animationEnabled = true; original.enabled = false;
  original.program.enter = presetPhase('spring', 'enter');
  original.config.layout = 'rows'; original.config.headerMode = 'row'; original.config.zoom = 180;
  const previous = structuredClone(original);
  const group = splitElements(s), children = s.composition.nodes.filter(n => n.parent === group.id);
  assert.equal(group.id, previous.id); assert.equal(group.parent, parent.id);
  assert.deepEqual(group.transform, previous.transform); assert.equal(group.timeOffset, 3);
  assert.equal(group.animationEnabled, true); assert.equal(group.enabled, false);
  assert.deepEqual(group.program, previous.program);
  assert.equal(children.length, PARTS.length);
  assert.deepEqual(children.map(n => Object.keys(n.parts).find(k => n.parts[k])), PARTS.map(([key]) => key));
  const owner = children.find(n => n.parts.staff);
  assert.equal(owner.layoutLink, null); assert.equal(dependent.layoutLink, owner.id);
  for (const child of children) {
    assert.equal(Object.values(child.parts).filter(Boolean).length, 1);
    assert.deepEqual(child.transform, identityTransform());
    assert.equal(child.timeOffset, 0); assert.equal(child.animationEnabled, false);
    assert.equal(child.layoutLink, child === owner ? null : owner.id);
    assert.equal(resolveLayerConfig(child, s.composition).zoom, 180);
  }
  owner.config.zoom = 310;
  for (const child of children) assert.equal(resolveLayerConfig(child, s.composition).zoom, 310);
  const note = children.find(n => n.parts.notes), beam = children.find(n => n.parts.beams);
  note.config.motionProgram.exit.duration = 31;
  assert.notEqual(beam.config.motionProgram.exit.duration, 31, 'component programs must not share mutable objects');
  assert.equal(s.composition.activeId, group.id); assert.equal(s.composition.editLayerId, owner.id);
  assert.doesNotThrow(() => parse(makePreset(s, '拆分')));
});

test('splitting a linked partial layer freezes resolved layout and introduces only its actual parts', () => {
  const s = createStudioSettings(defaults), owner = selectedNode(s), linked = makeLayer(defaults, '关联的音符与光效');
  owner.config.layout = 'rows'; owner.config.zoom = 215; owner.config.pageBars = 5;
  linked.layoutLink = owner.id; linked.parts = Object.fromEntries(PARTS.map(([key]) => [key, ['notes', 'effects'].includes(key)]));
  s.composition.nodes.push(linked); selectNode(s, linked.id);
  const group = splitElements(s), children = s.composition.nodes.filter(n => n.parent === group.id);
  assert.equal(children.length, 2);
  const note = children.find(n => n.parts.notes), effects = children.find(n => n.parts.effects);
  assert.equal(note.layoutLink, null); assert.equal(effects.layoutLink, note.id);
  for (const child of children) {
    assert.equal(child.config.layout, 'rows'); assert.equal(child.config.zoom, 215); assert.equal(child.config.pageBars, 5);
  }
  owner.config.zoom = 80;
  assert.equal(resolveLayerConfig(effects, s.composition).zoom, 215);
  selectNode(s, effects.id);
  const before = structuredClone(s.composition);
  assert.throws(() => splitElements(s), /独立元素/);
  assert.deepEqual(s.composition, before);
});

test('background and title are unique roots and repeated splitting preserves existing surface settings', () => {
  const s = createStudioSettings(defaults);
  const background = makeSurface('background'), title = makeSurface('title');
  background.transform.x = 33; title.animationEnabled = true;
  title.program.enter = presetPhase('fade', 'enter');
  s.composition.nodes.unshift(background); s.composition.nodes.push(title);
  splitElements(s);
  const another = makeLayer(defaults); s.composition.nodes.push(another); selectNode(s, another.id); splitElements(s);
  for (const kind of ['background', 'title']) {
    const surfaces = s.composition.nodes.filter(n => n.kind === kind);
    assert.equal(surfaces.length, 1); assert.equal(surfaces[0].parent, null);
    const p = makePreset(s, '重复背景');
    p.composition.nodes.push(makeSurface(kind));
    assert.throws(() => parse(p), /分别只能有一个/);
  }
  assert.equal(s.composition.nodes.find(n => n.kind === 'background').transform.x, 33);
  assert.equal(s.composition.nodes.find(n => n.kind === 'title').animationEnabled, true);
  assert.doesNotThrow(() => parse(makePreset(s, '表层保留')));
});

test('splitting refuses layer and node limits before mutating the scene', () => {
  const layers = createStudioSettings(defaults);
  while (layers.composition.nodes.filter(n => n.kind === 'score').length < MAX_LAYERS) layers.composition.nodes.push(makeLayer(defaults));
  const beforeLayers = structuredClone(layers.composition);
  assert.throws(() => splitElements(layers), /数量已达上限/);
  assert.deepEqual(layers.composition, beforeLayers);
  const nodes = createStudioSettings(defaults);
  while (nodes.composition.nodes.length < MAX_NODES - PARTS.length - 1) {
    const group = makeSurface('title'); group.kind = 'group'; nodes.composition.nodes.push(group);
  }
  const beforeNodes = structuredClone(nodes.composition);
  assert.throws(() => splitElements(nodes), /数量已达上限/);
  assert.deepEqual(nodes.composition, beforeNodes);
});

test('all declared configuration limits reject out-of-range values and explicit null', () => {
  for (const [key, [min, max]] of Object.entries(CONFIG_LIMITS)) {
    for (const value of [min - 1, max + 1, null]) {
      const p = preset(); score(p).config[key] = value;
      assert.throws(() => parse(p), undefined, `${key} accepted ${value}`);
    }
  }
  for (const [key, value] of [['motionProgramActive', null], ['scoreProgramActive', null], ['pageBars', 1.5], ['pageRows', 2.5]]) {
    const p = preset(); score(p).config[key] = value;
    assert.throws(() => parse(p), undefined, `${key} accepted ${value}`);
  }
  for (const key of ['fly', 'scatter']) {
    for (const value of [-1, 5001, null]) {
      const p = preset(); delete score(p).config.animationModel; score(p).config[key] = value;
      assert.throws(() => parse(p), undefined, `legacy ${key} accepted ${value}`);
    }
  }
});

test('expanded transform and configuration endpoints remain valid without clamping visual values', () => {
  const p = preset(), n = score(p);
  Object.assign(n.transform, { x: -1000, y: 1000, scaleX: .01, scaleY: 20, rotation: -7200, opacity: 0 });
  n.timeOffset = -120;
  Object.assign(n.config, { zoom: 1000, scanLength: 1000, scanWidth: 3000, scanBloom: 1000, scanGlow: 300, scanOffsetX: -300, scanOffsetY: 300, scanAngle: 720, glow: 500, bloom: 500, particles: 300, trail: 300, decayParticles: 300, decayOffset: 120, decayDuration: 60, layoutY: 200, cameraAmount: 500, pageSpan: 500, rowGap: 100, pageMargin: 40, cameraTransition: 60 });
  const result = score(parse(p));
  assert.deepEqual(result.transform, n.transform); assert.equal(result.timeOffset, n.timeOffset);
  for (const key of ['zoom', 'scanLength', 'scanWidth', 'scanBloom', 'scanGlow', 'scanOffsetX', 'scanOffsetY', 'scanAngle', 'glow', 'bloom', 'particles', 'trail', 'decayParticles', 'decayOffset', 'decayDuration', 'layoutY', 'cameraAmount', 'pageSpan', 'rowGap', 'pageMargin', 'cameraTransition']) assert.equal(result.config[key], n.config[key]);
  for (const [key, value] of [['x', -1001], ['y', 1001], ['scaleX', 0], ['scaleY', 21], ['rotation', 7201], ['opacity', 1.1]]) {
    const invalid = structuredClone(p); score(invalid).transform[key] = value;
    assert.throws(() => parse(invalid), undefined, `${key} accepted ${value}`);
  }
  n.timeOffset = 121; assert.throws(() => parse(p), /视觉时间偏移/);
});
