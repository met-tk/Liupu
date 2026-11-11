import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeAESetupScript, makeAEGuide } from '../src/ae-package.mjs';

const threeLayerRoles = [
  ['notation', '谱面', 'notation', 'normal'],
  ['effects', '演奏光效', 'effects', 'add'],
  ['cursor', '扫描线', 'cursor', 'screen'],
];

const nineLayerRoles = [
  ['staff', '五线谱线', 'staff', 'normal'],
  ['marks', '记谱标记', 'marks', 'normal'],
  ['beams', '符杠', 'beams', 'normal'],
  ['notes', '音符', 'notes', 'normal'],
  ['effects', '演奏光效', 'effects', 'add'],
  ['header', '谱头', 'header', 'normal'],
  ['cursor', '扫描线', 'cursor', 'screen'],
  ['background', '背景', 'background', 'normal'],
  ['title', '标题', 'title', 'normal'],
];

function manifestFor(roleRows) {
  const layers = roleRows.map(([id, name, role, blendMode]) => ({
    id,
    name,
    role,
    path: `${role}/frame_%06d.png`,
    firstFile: `${role}/frame_000001.png`,
    frameCount: 90,
    fps: 30,
    blendMode,
    enabled: true,
    alpha: role === 'background' ? 'opaque' : 'straight',
  }));
  return {
    schema: 'liupu-ae-package',
    version: 1,
    application: { name: '流谱 Studio', version: '0.7.7' },
    composition: {
      name: '测试作品', width: 1920, height: 1080, pixelAspect: 1,
      fps: 30, frameCount: 90, duration: 3,
    },
    source: {
      start: 1.25, endExclusive: 4.25, speed: 1.5,
      scoreDuration: 12, title: '测试作品',
    },
    color: { space: 'sRGB', bitDepth: 8 },
    audio: { included: false },
    layers,
    render: {
      transparent: roleRows.every(([id]) => id !== 'background'),
      title: roleRows.some(([id]) => id === 'title'),
      cursor: roleRows.some(([id]) => id === 'cursor'),
    },
  };
}

function embeddedManifest(script) {
  const match = script.match(/var manifest = (.*);\r?\n\s*var root =/);
  assert.ok(match, 'setup script should embed its manifest as one JSON expression');
  return JSON.parse(match[1]);
}

function fileForFromScript(script) {
  const match = script.match(/function fileFor\(relative\) \{[\s\S]*?\n    \}/);
  assert.ok(match, 'setup script should define fileFor');
  // ExtendScript's File constructor is stubbed so the generated guard can be
  // exercised in Node without opening After Effects.
  return vm.runInNewContext(`(() => {
    var root = { fsName: 'package-root' };
    ${match[0]}
    return fileFor;
  })()`, {
    File: function File(path) { this.path = path; },
  });
}

test('AE setup embeds the supported schema and each layer first-frame path', () => {
  const manifest = manifestFor(threeLayerRoles);
  const script = makeAESetupScript(manifest);
  const embedded = embeddedManifest(script);

  assert.equal(embedded.schema, 'liupu-ae-package');
  assert.equal(embedded.version, 1);
  assert.deepEqual(embedded.layers.map(layer => layer.firstFile), [
    'notation/frame_000001.png',
    'effects/frame_000001.png',
    'cursor/frame_000001.png',
  ]);
  assert.match(script, /options\.sequence = true/);
  assert.match(script, /forceAlphabetical = true/);
  assert.match(script, /AlphaMode\.STRAIGHT/);
});

test('AE setup rejects absolute, parent-directory and Windows drive paths', () => {
  const fileFor = fileForFromScript(makeAESetupScript(manifestFor(threeLayerRoles)));
  for (const unsafe of ['', '/outside.png', '\\outside.png', '../outside.png', 'a/../outside.png', 'C:/outside.png', 'a\\outside.png']) {
    assert.throws(() => fileFor(unsafe), /素材路径不安全/);
  }
  assert.equal(fileFor('notation/frame_000001.png').path, 'package-root/notation/frame_000001.png');
});

test('three-layer AE package preserves notation, effects and cursor order and blend modes', () => {
  const manifest = manifestFor(threeLayerRoles);
  const embedded = embeddedManifest(makeAESetupScript(manifest));
  assert.deepEqual(embedded.layers.map(layer => [layer.id, layer.role, layer.blendMode]), [
    ['notation', 'notation', 'normal'],
    ['effects', 'effects', 'add'],
    ['cursor', 'cursor', 'screen'],
  ]);
  assert.equal(embedded.layers.length, 3);
});

test('nine-layer AE package keeps every element role, path and alpha intent', () => {
  const manifest = manifestFor(nineLayerRoles);
  const embedded = embeddedManifest(makeAESetupScript(manifest));
  assert.equal(embedded.layers.length, 9);
  assert.deepEqual(embedded.layers.map(layer => layer.role), nineLayerRoles.map(([, , role]) => role));
  assert.deepEqual(embedded.layers.map(layer => layer.firstFile), nineLayerRoles.map(([, , role]) => `${role}/frame_000001.png`));
  assert.equal(embedded.layers.find(layer => layer.role === 'background').alpha, 'opaque');
  assert.ok(embedded.layers.filter(layer => layer.role !== 'background').every(layer => layer.alpha === 'straight'));
});

test('AE guide describes import steps, timing, transparency and all exported layer names', () => {
  const manifest = manifestFor(nineLayerRoles);
  const guide = makeAEGuide(manifest);
  assert.match(guide, /^流谱 Studio · After Effects 合成包/);
  assert.match(guide, /单向导出包/);
  assert.match(guide, /画布：1920 × 1080 · 30 fps · 90 帧/);
  assert.match(guide, /源时间：1\.250–4\.250 秒 · 播放倍率 1\.5/);
  for (const [, name] of nineLayerRoles) assert.match(guide, new RegExp(name));
  assert.match(guide, /完整解压此 ZIP/);
  assert.match(guide, /setup-ae\.jsx/);
  assert.match(guide, /时间标记/);
  assert.match(guide, /本包不包含音频/);
  assert.match(guide, /Straight \/ Unmatted Alpha/);
  assert.match(guide, /不会回写流谱工程/);
});

