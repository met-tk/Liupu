import test from 'node:test';
import assert from 'node:assert/strict';
import { measureEffectProgress, noteExitTime, performedMeasure } from '../src/effect-timing.mjs';
import { effectPresets, presetPhase, identifyPreset, defaultScoreProgram } from '../src/effect-library.mjs';
import { defaultMotionProgram, parseMotionProgram, motionAt } from '../src/motion-program.mjs';
import { ScoreRenderer } from '../src/render.mjs';

test('live score decay follows tempo-aware playhead position rather than wall-clock fraction', () => {
  const measure = { start: 0, end: 4, decayEnd: 6, sourceX: 100, sourceWidth: 200 };
  const score = { quarterStops: [{ time: 0, x: 100 }, { time: 4, x: 300 }], secondsToQuarter: t => t < 2 ? t / 2 : 1 + (t - 2) * 1.5 };
  assert.equal(measureEffectProgress(score, measure, 2, { decayTrigger: 'progress' }), .25);
  assert.equal(measureEffectProgress(score, measure, 4, { decayTrigger: 'progress' }), 1);
  assert.equal(measureEffectProgress(score, measure, -1, { decayTrigger: 'progress' }), 0);
  assert.equal(measureEffectProgress(score, measure, 6.4, { decayTrigger: 'measure', decayDelay: .5, decayDuration: 2 }), 0);
  assert.equal(measureEffectProgress(score, measure, 7.5, { decayTrigger: 'measure', decayDelay: .5, decayDuration: 2 }), .5);
});

test('note and whole-bar exits preserve chord/tie lifetimes and use independent wait settings', () => {
  const e = { start: 0, end: 1, soundEnd: 3, visualEnd: 4 }, m = { end: 3, decayEnd: 5 };
  assert.equal(noteExitTime(e, m, { noteExitTrigger: 'note' }), 4);
  assert.equal(noteExitTime(e, m, { noteExitTrigger: 'measure' }), 5);
  const p = structuredClone(defaultMotionProgram); p.exit.delay = .5;
  assert.equal(motionAt(p, 5.4, e.start, noteExitTime(e, m, { noteExitTrigger: 'measure' })).phase, 'hold');
  assert.equal(motionAt(p, 5.5, e.start, noteExitTime(e, m, { noteExitTrigger: 'measure' })).phase, 'exit');
});

test('signed score offsets shift live and delayed decay through real musical time', () => {
  const measure = { start: 0, end: 4, decayEnd: 6, sourceX: 100, sourceWidth: 200 };
  const score = { quarterStops: [{ time: 0, x: 100 }, { time: 4, x: 300 }], secondsToQuarter: t => t < 2 ? t / 2 : 1 + (t - 2) * 1.5 };
  const live = { decayTrigger: 'progress', decayOffset: 1 };
  assert.equal(measureEffectProgress(score, measure, .5, live), 0);
  assert.equal(measureEffectProgress(score, measure, 3, live), .25);
  assert.equal(measureEffectProgress(score, measure, 4, live), .625);
  assert.equal(measureEffectProgress(score, measure, 5, live), 1);
  assert.equal(measureEffectProgress(score, measure, 1, { ...live, decayOffset: -1 }), .25);
  const waiting = { decayTrigger: 'measure', decayOffset: 1, decayDelay: .5, decayDuration: 2 };
  assert.equal(measureEffectProgress(score, measure, 7.5, waiting), 0);
  assert.equal(measureEffectProgress(score, measure, 8.5, waiting), .5);
  assert.equal(measureEffectProgress(score, measure, 6.5, { ...waiting, decayOffset: -1 }), .5);
});

test('repeats reset future bars only at entrance or a backwards jump, and seeking is stateless', () => {
  const visits = [{ start: 2, end: 4, occurrence: 1, sourceIndex: 1 }, { start: 8, end: 10, occurrence: 4, sourceIndex: 1 }];
  assert.equal(performedMeasure(visits, 5, .5, { occurrence: 2, sourceIndex: 2 }), visits[0]);
  assert.equal(performedMeasure(visits, 7, .5, { occurrence: 3, sourceIndex: 0 }), visits[1]);
  assert.equal(performedMeasure(visits, 7.6, .5), visits[1]);
  assert.equal(performedMeasure(visits, 8.3), visits[1]);
  assert.equal(performedMeasure(visits, 3), visits[0]);
});

test('all library phases are valid reusable JSON and disabling either phase retains a visible hold', () => {
  for (const [id] of effectPresets) {
    const p = parseMotionProgram(JSON.stringify({ version: 1, enter: presetPhase(id, 'enter'), exit: presetPhase(id, 'exit') }));
    assert.equal(motionAt(p, 3, 2, 4).opacity, 1);
    assert.equal(motionAt(p, 20, 2, 4).opacity, id === 'none' ? 1 : 0);
    assert.deepEqual(parseMotionProgram(JSON.stringify(p)), p);
  }
  assert.equal(motionAt(defaultScoreProgram, -20, 2, 4).opacity, 1);
  assert.equal(motionAt(defaultScoreProgram, 20, 2, 4).opacity, 1);
  assert.equal(defaultMotionProgram.enter.enabled, undefined);
  const invalid = structuredClone(defaultScoreProgram); invalid.exit.enabled = 'false';
  assert.throws(() => parseMotionProgram(JSON.stringify(invalid)), /布尔/);
});

test('expanded library phases are distinct, finish entrance at identity, and retain independent fragment strengths', () => {
  assert.ok(effectPresets.length >= 19);
  const identity = { at: 1, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
  for (const name of ['enter', 'exit']) {
    const signatures = new Set();
    for (const [id] of effectPresets) {
      const phase = presetPhase(id, name);
      assert.equal(identifyPreset(phase, name), id);
      const signature = JSON.stringify({ enabled: phase.enabled, frames: phase.frames, renderer: phase.renderer });
      assert.equal(signatures.has(signature), false, `${name}:${id} duplicates another preset`);
      signatures.add(signature);
      if (name === 'enter') assert.deepEqual(phase.frames.at(-1), identity, id);
    }
  }
  assert.equal(presetPhase('scatter', 'enter').strength, 75);
  assert.equal(presetPhase('scatter', 'exit').strength, 65);
  const heavy = presetPhase('scatter', 'exit', { duration: 60, delay: 60, strength: 5000 });
  assert.equal(identifyPreset(heavy, 'exit'), 'scatter');
  assert.equal(heavy.renderer, 'fragments');
  assert.equal(heavy.strength, 5000);
  assert.equal(heavy.duration, 60);
  assert.equal(heavy.delay, 60);
  const fade = presetPhase('fade', 'exit', heavy);
  assert.equal(Object.hasOwn(fade, 'renderer'), false);
  assert.equal(Object.hasOwn(fade, 'strength'), false);
  assert.equal(identifyPreset(fade, 'exit'), 'fade');
});

test('future visible notes reappear on a backwards repeat along with their structure', () => {
  const visits = [{ start: 2, end: 4, occurrence: 1, sourceIndex: 1 }, { start: 10, end: 12, occurrence: 4, sourceIndex: 1 }];
  const events = [{ start: 2, end: 3 }, { start: 10, end: 11 }];
  const renderer = { score: { boxes: new Map([['n', { measureId: 'm' }]]), occurrences: new Map([['n', events]]) }, measureVisits: new Map([['m', visits]]), eventMeasures: new Map(events.map((event, i) => [event, visits[i]])) };
  const settings = { motionProgramActive: true, motionProgram: defaultMotionProgram, noteArrival: 'visible' };
  renderer.currentVisit = { occurrence: 2, sourceIndex: 2 };
  assert.equal(ScoreRenderer.prototype.programmed.call(renderer, 'n', 6, settings).phase, 'gone');
  renderer.currentVisit = { occurrence: 3, sourceIndex: 0 };
  assert.equal(ScoreRenderer.prototype.programmed.call(renderer, 'n', 8, settings).phase, 'hold');
  assert.equal(ScoreRenderer.prototype.programmed.call(renderer, 'n', 8, { ...settings, noteArrival: 'assemble' }).phase, 'waiting');
});
