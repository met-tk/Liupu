import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeMotionAt, motionAt, parseMotionProgram, applyFlyin } from '../src/motion-program.mjs';
import { effectPresets, identifyPreset, presetPhase } from '../src/effect-library.mjs';
import { builtinPresets, createStudioSettings, applyVisualPreset, compositionTail } from '../src/composition.mjs';
import { visualDefaults } from '../src/visual-defaults.mjs';
const program = () => parseMotionProgram(JSON.stringify({ version: 1, enter: presetPhase('flyin', 'enter'), exit: presetPhase('flyin', 'exit') }));

test('音符聚散预设注册并可通过 JSON 往返', () => {
  assert.deepEqual(effectPresets.find(([id]) => id === 'flyin'), ['flyin', '音符聚散']);
  assert.equal(effectPresets.find(([id]) => id === 'classic')[1], '碎片聚散');
  assert.equal(effectPresets.find(([id]) => id === 'scatter')[1], '音符裂解');
  const p = program();
  assert.equal(p.enter.renderer, 'flyin');
  assert.equal(p.enter.strength, 100);
  assert.equal(p.enter.easing, 'linear');
  assert.deepEqual(parseMotionProgram(JSON.stringify(p)), p);
  assert.equal(identifyPreset(p.exit, 'exit'), 'flyin');
});

test('渲染器白名单仍然拒绝未知值', () => {
  const bad = { version: 1, enter: { duration: .6, frames: [{ at: 0 }, { at: 1 }] }, exit: presetPhase('flyin', 'exit') };
  bad.enter.renderer = 'rain';
  assert.throws(() => parseMotionProgram(JSON.stringify(bad)), /renderer/);
});

test('flyin 量随时间轴进度聚拢并在结束后清除', () => {
  const p = program();
  assert.ok(Math.abs(motionAt(p, 9.7, 10, 12).flyin.amount - .5) < 1e-10);
  assert.equal(motionAt(p, 10, 10, 12).phase, 'hold');
  assert.equal(motionAt(p, 10, 10, 12).flyin, undefined);
  const exiting = motionAt(p, 13, 10, 12);
  assert.equal(exiting.phase, 'exit');
  assert.ok(Math.abs(exiting.flyin.amount - .5) < 1e-10);
  assert.equal(motionAt(p, 15, 10, 12).phase, 'gone');
  assert.equal(motionAt(p, 15, 10, 12).flyin, undefined);
});

test('flyin 与碎片聚散一样由画面位置驱动', () => {
  const p = program(), at = (time, x, played = false, active = false) => edgeMotionAt(p, time, 10, 12, { x, width: 1000, played, active });
  assert.equal(at(0, 500).phase, 'hold', '画面中部的未来音符保持可见');
  const entering = at(0, 850);
  assert.equal(entering.phase, 'enter');
  assert.ok(Math.abs(entering.flyin.amount - .5) < 1e-10);
  assert.equal(at(11, 850, false, true).phase, 'hold', '演奏中的音符保持聚拢');
  const exiting = at(30, 110, true);
  assert.equal(exiting.phase, 'exit');
  assert.ok(Math.abs(exiting.flyin.amount - .5) < 1e-10);
  assert.deepEqual(at(30, 110, true), at(30, 110, true), '同一位置的求值保持稳定');
});

test('applyFlyin 使用稳定随机偏移：入场右侧聚拢、出场左侧散开、线性淡入', () => {
  const base = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, phase: 'enter' };
  const start = applyFlyin({ ...base, flyin: { amount: 1, strength: 100 } }, 'note-a');
  assert.deepEqual(start, applyFlyin({ ...base, flyin: { amount: 1, strength: 100 } }, 'note-a'), '同一元素的偏移保持稳定');
  assert.ok(start.x >= 50 && start.x <= 450, '飘入距离介于 50～450');
  assert.ok(Math.abs(start.y) <= 100, '散落范围不超过 ±100');
  assert.equal(start.opacity, 0, '起始完全透明');
  assert.equal(start.flyin, undefined);
  const settled = applyFlyin({ ...base, flyin: { amount: 0, strength: 100 } }, 'note-a');
  assert.equal(settled.x, 0);
  assert.equal(settled.opacity, 1, '归位后完全显示');
  const out = applyFlyin({ ...base, phase: 'exit', flyin: { amount: 1, strength: 100 } }, 'note-a');
  assert.ok(out.x <= -50, '出场向左侧散开');
  assert.equal(applyFlyin({ ...base }, 'note-a').x, 0, '无 flyin 时保持原样');
});

test('strengthY 解耦垂直与水平且缺省时继承强度', () => {
  const dual = presetPhase('flyin', 'enter', { strength: 200, strengthY: 50 });
  const dualExit = presetPhase('flyin', 'exit', { strength: 200, strengthY: 50 });
  assert.equal(dual.strength, 200);
  assert.equal(dual.strengthY, 50);
  assert.deepEqual(parseMotionProgram(JSON.stringify({ version: 1, enter: dual, exit: dualExit })), { version: 1, name: '自定义动效', enter: dual, exit: dualExit }, 'strengthY 可通过 JSON 往返');
  const inherited = presetPhase('flyin', 'enter');
  assert.equal(inherited.strengthY, undefined, '缺省时不写入 strengthY，旧动画外观不变');
  // evaluateMotion：无 strengthY 时垂直继承水平强度
  const fly = motionAt(parseMotionProgram(JSON.stringify({ version: 1, enter: inherited, exit: presetPhase('flyin', 'exit', { strengthY: 30 }) })), 9.7, 10, 12).flyin;
  assert.equal(fly.strengthY, fly.strength, '缺省继承水平强度');
  // applyFlyin：两轴独立
  const base = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, phase: 'enter' };
  const noVertical = applyFlyin({ ...base, flyin: { amount: 1, strength: 100, strengthY: 0 } }, 'note-a');
  assert.equal(noVertical.y, 0, '垂直为 0 时无纵向散落');
  assert.ok(noVertical.x >= 50, '水平位移保留');
  const noHorizontal = applyFlyin({ ...base, flyin: { amount: 1, strength: 0, strengthY: 100 } }, 'note-a');
  assert.equal(noHorizontal.x, 0, '水平为 0 时无横向位移');
  assert.notEqual(noHorizontal.y, 0, '垂直位移保留');
  // schema：strengthY 仅允许 flyin 渲染器
  const bad = { version: 1, enter: { duration: .6, easing: 'linear', frames: [{ at: 0 }, { at: 1 }], renderer: 'fragments', strength: 100, strengthY: 100 }, exit: presetPhase('none', 'exit') };
  assert.throws(() => parseMotionProgram(JSON.stringify(bad)), /strengthY/);
});

test('错峰音符在窗口末尾全部归位，不会中途跳变', () => {
  const base = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, phase: 'enter' };
  for (const key of ['n1', 'n2', 'n3', 'n4']) {
    const end = applyFlyin({ ...base, flyin: { amount: 0, strength: 100 } }, key);
    assert.equal(end.x, 0);
    assert.equal(end.opacity, 1);
    const full = applyFlyin({ ...base, flyin: { amount: 1, strength: 100 } }, key);
    assert.equal(full.opacity, 0);
    // 入场中途不透明度单调递增
    let previous = 0;
    for (let amount = 1; amount >= 0; amount -= .1) {
      const step = applyFlyin({ ...base, flyin: { amount, strength: 100 } }, key);
      assert.ok(step.opacity >= previous - 1e-9, '淡入不回退');
      previous = step.opacity;
    }
  }
  const exitBase = { ...base, phase: 'exit' };
  for (const key of ['n1', 'n2']) {
    let previous = 1;
    for (let amount = 0; amount <= 1; amount += .1) {
      const step = applyFlyin({ ...exitBase, flyin: { amount, strength: 100 } }, key);
      assert.ok(step.opacity <= previous + 1e-9, '淡出不回退');
      previous = step.opacity;
    }
  }
});

test('音符聚散风格预设可用且长卷时长不加无效延长', () => {
  const preset = builtinPresets(visualDefaults).find(p => p.name === '音符聚散');
  assert.ok(preset);
  const s = createStudioSettings(visualDefaults);
  applyVisualPreset(s, preset);
  assert.equal(s.motionProgram.enter.renderer, 'flyin');
  assert.equal(s.motionProgram.exit.renderer, 'flyin');
  assert.equal(s.noteArrival, 'assemble');
  assert.equal(compositionTail(s, 30), 30.1, '画面驱动的出场不延长总时长');
  s.layout = 'rows';
  assert.ok(compositionTail(s, 30) > 31, '多行排版按时间轴延长');
});
