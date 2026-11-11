import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMotionProgram, defaultMotionProgram, evaluateMotion, motionAt } from '../src/motion-program.mjs';

const plain = () => JSON.parse(JSON.stringify(defaultMotionProgram));
const parse = value => parseMotionProgram(JSON.stringify(value));
const identity = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };

test('signed phase offsets translate animation time independently and validate on import', () => {
  for (const name of ['enter','exit']) for (const offset of [-120,-2,0,3,120]) {
    const base = plain(), shifted = plain(); shifted[name].offset = offset;
    const options = name === 'enter' ? {exit:false} : {enter:false};
    for (const time of [0,1.5,1.8,2,3.2,3.5,4,5,10]) {
      const actual = motionAt(shifted,time+offset,2,3,options), expected = motionAt(base,time,2,3,options);
      assert.equal(actual.phase,expected.phase);
      for (const key of [...Object.keys(identity),'progress']) assert.ok(Math.abs(actual[key]-expected[key])<1e-10,`${name} ${offset}: ${key}`);
    }
    assert.deepEqual(parse(shifted),shifted);
  }
  for (const offset of [-121,121,Infinity,NaN,'2',null]) for (const name of ['enter','exit']) {
    const p=plain();p[name].offset=offset;assert.throws(()=>parse(p),/offset/);
  }
});

test('an advanced exit takes precedence over a delayed entrance, including seeking backwards', () => {
  const p=plain();p.enter.offset=6;p.exit.offset=-2;p.exit.delay=.25;p.exit.duration=1;
  assert.equal(motionAt(p,2,2,3).phase,'exit');
  assert.equal(motionAt(p,7,2,3).phase,'gone');
  assert.equal(motionAt(p,2,2,3).progress,.75);
  p.exit.enabled=false;assert.equal(motionAt(p,7.8,2,3).phase,'enter');
});

test('program parser normalizes omitted transforms with defaults and previous-frame inheritance', () => {
  const value = plain();
  delete value.name;
  delete value.enter.easing;
  value.enter.frames = [{ at: 0, y: 12, opacity: 0 }, { at: 0.5, opacity: 0.6 }, { at: 1, y: 0, opacity: 1 }];
  const program = parse(value);
  assert.equal(program.name, '自定义动效');
  assert.equal(program.enter.easing, 'linear');
  assert.deepEqual(program.enter.frames[1], { at: 0.5, ...identity, y: 12, opacity: 0.6 });
  assert.deepEqual(evaluateMotion(program, 'enter', 0.25), { ...identity, y: 12, opacity: 0.3 });
  assert.deepEqual(evaluateMotion(program, 'enter', -1), { ...identity, y: 12, opacity: 0 });
  assert.deepEqual(evaluateMotion(program, 'enter', 4), identity);
});

test('all supported easing curves interpolate each keyframe segment predictably', () => {
  const expected = { linear: 0.25, easeIn: 0.0625, easeOut: 0.4375, easeInOut: 0.125 };
  for (const [easing, amount] of Object.entries(expected)) {
    const value = plain();
    value.enter = { duration: 1, easing, frames: [{ at: 0, x: 0 }, { at: 1, x: 100 }] };
    assert.equal(evaluateMotion(parse(value), 'enter', 0.25).x, amount * 100);
  }
});

test('program validation rejects malformed, unknown, nonfinite and out-of-range input', () => {
  for (const text of ['', '{', 'null', '[]', '3', 'true']) assert.throws(() => parseMotionProgram(text));
  assert.throws(() => parseMotionProgram({}), /JSON 文本/);
  assert.throws(() => parseMotionProgram(' '.repeat(32769)), /32 KB/);
  assert.throws(() => parseMotionProgram('汉'.repeat(12000)), /32 KB/);
  const bad = [
    p => { p.version = 2; },
    p => { p.name = ''; },
    p => { p.name = 'x'.repeat(81); },
    p => { p.code = 'alert(1)'; },
    p => { p.enter = []; },
    p => { p.exit = null; },
    p => { p.enter.duration = 0; },
    p => { p.exit.duration = 61; },
    p => { p.exit.delay = -0.1; },
    p => { p.exit.delay = 61; },
    p => { p.enter.easing = 'constructor'; },
    p => { p.enter.frames = [{ at: 0 }]; },
    p => { p.enter.frames = Array.from({ length: 65 }, (_, i) => ({ at: i / 64 })); },
    p => { p.enter.frames[0].at = 0.1; },
    p => { p.enter.frames[1].at = 0.9; },
    p => { p.enter.frames = [{ at: 0 }, { at: 0.5 }, { at: 0.5 }, { at: 1 }]; },
    p => { p.enter.frames[0].opacity = 1.1; },
    p => { p.enter.frames[0].scale = -1; },
    p => { p.enter.frames[0].x = 10001; },
    p => { p.enter.frames[0].y = -10001; },
    p => { p.enter.frames[0].rotation = 7201; },
    p => { p.enter.frames[0].scale = 20.01; },
    p => { p.enter.frames[0].y = '12'; },
    p => { p.enter.frames[0].opacity = null; },
    p => { p.enter.frames[0].script = 'return 1'; },
    p => { p.enter.renderer = 'script'; },
    p => { p.exit.strength = 65; },
    p => { p.enter.renderer = 'fragments'; p.enter.strength = 5001; },
    p => { p.enter.renderer = 'fragments'; p.enter.strength = -1; },
    p => { p.enter.renderer = 'fragments'; p.enter.strength = '75'; },
    p => { p.exit.frames[0].fragments = { amount: .5, strength: 100 }; },
  ];
  for (const mutate of bad) {
    const value = plain(); mutate(value);
    assert.throws(() => parse(value));
  }
  assert.throws(() => parseMotionProgram(JSON.stringify(plain()).replace('"duration":0.6', '"duration":1e400')), /有限数字/);
  assert.throws(() => parseMotionProgram(JSON.stringify(plain()).replace('"version":1', '"version":1,"__proto__":{}')), /未知字段/);
});

test('expanded motion ranges survive parse, interpolation and preset serialization', () => {
  const value = plain();
  value.enter = { duration: 60, easing: 'linear', frames: [{ at: 0, x: -10000, y: 10000, rotation: -7200, scale: 20, opacity: 0 }, { at: 1, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }] };
  value.exit = { ...value.enter, delay: 60 };
  const p = parse(value);
  assert.deepEqual(evaluateMotion(p, 'enter', .5), { x: -5000, y: 5000, rotation: -3600, scale: 10.5, opacity: .5 });
  assert.equal(motionAt(p, 63.9, 2, 4).phase, 'hold');
  assert.equal(motionAt(p, 64, 2, 4).phase, 'exit');
  assert.equal(motionAt(p, 124, 2, 4).phase, 'gone');
  assert.deepEqual(parse(p), p);
});

test('fragment phases use the animation timeline and carry deterministic renderer metadata only while active', () => {
  const value = plain();
  value.enter = { duration: 2, easing: 'easeOut', renderer: 'fragments', frames: [{ at: 0 }, { at: 1 }] };
  value.exit = { duration: 4, delay: 1, easing: 'linear', renderer: 'fragments', strength: 5000, frames: [{ at: 0 }, { at: 1 }] };
  const p = parse(value);
  assert.equal(p.enter.strength, 75);
  assert.deepEqual(evaluateMotion(p, 'enter', .5), { ...identity, fragments: { amount: .25, strength: 75 } });
  assert.deepEqual(evaluateMotion(p, 'exit', .5), { ...identity, fragments: { amount: .5, strength: 5000 } });
  assert.deepEqual(motionAt(p, 3, 4, 6).fragments, { amount: .25, strength: 75 });
  assert.deepEqual(motionAt(p, 9, 4, 6).fragments, { amount: .5, strength: 5000 });
  for (const time of [0, 4, 6, 11, 30]) assert.equal(Object.hasOwn(motionAt(p, time, 4, 6), 'fragments'), false);
  p.exit.enabled = false;
  assert.equal(Object.hasOwn(evaluateMotion(p, 'exit', .5), 'fragments'), false);
  assert.deepEqual(motionAt(p, 9, 4, 6), { ...identity, phase: 'hold', progress: 1 });
  assert.deepEqual(parse(p), p);
});

test('absolute-time phase boundaries support both staged entrance and a fully visible static page', () => {
  const value = plain();
  value.enter.duration = 0.5;
  value.exit.duration = 2;
  value.exit.delay = 0.25;
  const p = parse(value);
  assert.equal(motionAt(p, 0, 2, 3).phase, 'waiting');
  assert.equal(motionAt(p, 0, 2, 3).opacity, 0);
  assert.equal(motionAt(p, 1.5, 2, 3).phase, 'enter');
  assert.equal(motionAt(p, 1.75, 2, 3).progress, 0.5);
  assert.deepEqual(motionAt(p, 2, 2, 3), { ...identity, phase: 'hold', progress: 1 });
  assert.equal(motionAt(p, 3, 2, 3).phase, 'hold');
  assert.equal(motionAt(p, 3.25, 2, 3).phase, 'exit');
  assert.equal(motionAt(p, 4.25, 2, 3).progress, 0.5);
  assert.equal(motionAt(p, 5.25, 2, 3).phase, 'gone');
  assert.equal(motionAt(p, 5.25, 2, 3).opacity, 0);
  assert.deepEqual(motionAt(p, 0, 2, 3, { enter: false }), { ...identity, phase: 'hold', progress: 1 });
  assert.deepEqual(motionAt(p, 99, 2, 3, { exit: false }), { ...identity, phase: 'hold', progress: 1 });
  const nonzeroLastFrame = plain();
  nonzeroLastFrame.exit.frames.at(-1).opacity = 0.5;
  assert.equal(motionAt(parse(nonzeroLastFrame), 20, 2, 3).opacity, 0);
});

test('seeking, reverse playback, seeds and preview/export sampling never accumulate state', () => {
  const program = plain();
  const original = JSON.stringify(program);
  const times = [0, 1.5, 1.8, 2, 3.2, 3.5, 4, 5, 10];
  const forward = new Map(times.map(time => [time, motionAt(program, time, 2, 3)]));
  for (const time of [...times].reverse()) assert.deepEqual(motionAt(program, time, 2, 3), forward.get(time));
  for (const time of [4, 0, 3.5, 1.8, 4]) assert.deepEqual(motionAt(program, time, 2, 3), forward.get(time));
  assert.deepEqual(evaluateMotion(program, 'exit', 0.4, 42), evaluateMotion(program, 'exit', 0.4, 9));
  assert.equal(JSON.stringify(program), original);
  assert.deepEqual(evaluateMotion(program, 'hold', 0), identity);
  assert.throws(() => evaluateMotion(program, 'unknown', 0));
  assert.throws(() => evaluateMotion(program, 'exit', Infinity));
  assert.throws(() => motionAt(program, Infinity, 2, 3));
  assert.throws(() => motionAt(program, 2, 3, 2));
});

test('keyframe lookup preserves every exact boundary and its neighboring samples through the 64-frame limit', () => {
  for (const count of [2, 3, 16, 63, 64]) {
    const value = plain();
    value.enter.easing = 'linear';
    value.enter.frames = Array.from({length: count}, (_, i) => ({
      at: i / (count - 1), x: i * i, y: i * -11, rotation: i * 7, scale: .5 + i / 100, opacity: i / (count - 1),
    }));
    const program = parse(value), frames = program.enter.frames;
    for (const frame of frames) for (const offset of [-1e-10, 0, 1e-10]) {
      const progress = Math.max(0, Math.min(1, frame.at + offset));
      const leftIndex = Math.min(count - 2, Math.floor(progress * (count - 1)));
      const left = frames[leftIndex], right = frames[leftIndex + 1];
      const amount = (progress - left.at) / (right.at - left.at);
      const actual = evaluateMotion(program, 'enter', progress);
      for (const key of Object.keys(identity)) {
        const expected = left[key] * (1 - amount) + right[key] * amount;
        assert.ok(Math.abs(actual[key] - expected) < 1e-8, `${count} frames at ${progress}: ${key}`);
      }
    }
  }
});
