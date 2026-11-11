import test from 'node:test';
import assert from 'node:assert/strict';
import { alignChordVisualEnds, mergeTiedEvents } from '../src/ties.mjs';
import { ScoreRenderer } from '../src/render.mjs';
import { defaultMotionProgram } from '../src/motion-program.mjs';
import { staticMeasureTimeline } from '../src/static-layout.mjs';

const source = [
  { id: 'stem-owner', start: 0, end: 1, pitch: 60 },
  { id: 'held', start: 0, end: 1, pitch: 64 },
  { id: 'continuation', start: 1, end: 4, pitch: 64 },
];

test('a short stem owner waits for a tied chord member without changing sound, attacks or visual notehead spans', () => {
  const playback = mergeTiedEvents(source, [{ from: 'held', to: 'continuation' }]);
  const before = structuredClone(playback);
  const events = alignChordVisualEnds(playback.events, [['stem-owner', 'held']]);
  assert.deepEqual(events.map(event => event.visualEnd), [4, 4, 4]);
  assert.deepEqual(playback, before);
  assert.equal(events[0].end, 1); assert.equal(events[0].soundEnd, 1);
  assert.equal(events[2].attack, false); assert.equal(events[2].start, 1);
  assert.deepEqual(events.map(({ visualEnd, ...event }) => event), playback.events);
  assert.deepEqual(playback.audioEvents.map(event => [event.id, event.start, event.end]), [['stem-owner', 0, 1], ['held', 0, 4]]);
});

test('repeated chord visits and different chords with simultaneous attacks keep independent visual release times', () => {
  const events = alignChordVisualEnds([
    { id: 'owner', start: 0, end: 1, soundEnd: 1 }, { id: 'held', start: 0, end: 1, soundEnd: 4 },
    { id: 'owner', start: 8, end: 9, soundEnd: 9 }, { id: 'held', start: 8, end: 9, soundEnd: 10 },
    { id: 'other-owner', start: 0, end: 1, soundEnd: 1 }, { id: 'other', start: 0, end: 1, soundEnd: 2 },
    { id: 'solo', start: 0, end: 1, soundEnd: 1 },
  ], [['owner', 'held'], ['other-owner', 'other']]);
  assert.deepEqual(events.map(event => event.visualEnd), [4, 4, 10, 10, 2, 2, 1]);
});

test('scrolling fragments and programmed exits retain a chord stem through its shared visual lifetime', () => {
  const event = alignChordVisualEnds(mergeTiedEvents(source, [{ from: 'held', to: 'continuation' }]).events, [['stem-owner', 'held']])[0];
  const renderer = Object.create(ScoreRenderer.prototype);
  renderer.score = { occurrences: new Map([['stem-owner', [event]]]) };
  const settings = { fly: 0, scatter: 100, motionProgramActive: true, motionProgram: defaultMotionProgram, noteArrival: 'visible' };
  const waiting = renderer.state('stem-owner', 2, 0, 1920, settings);
  assert.equal(waiting.active, undefined); assert.equal(waiting.played, false); assert.equal(waiting.exit, 0);
  assert.equal(renderer.programmed('stem-owner', 2, settings).phase, 'hold');
  assert.equal(renderer.state('stem-owner', 4.2, 0, 1920, settings).played, true);
  assert.equal(renderer.programmed('stem-owner', 4.2, settings).phase, 'exit');
});

test('static staff decay respects the shared visual release when the visible stem owner outlives its own sound', () => {
  const score = { duration: 6, boxes: new Map([['owner', { measureId: 'm0' }]]), measureRegions: [{ id: 'm0', sourceIndex: 0, x: 0, endX: 100 }],
    measureTimes: [{ id: 'm0', time: 0 }, { id: 'next', time: 3 }], events: [{ id: 'owner', start: 0, end: 1, soundEnd: 1, visualEnd: 4 }] };
  const [measure] = staticMeasureTimeline(score);
  assert.equal(measure.end, 3); assert.equal(measure.decayEnd, 4);
});
