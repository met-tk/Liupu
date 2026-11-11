import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlayer } from '../src/audio.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (start, end, pitch = 60, velocity) => ({start, end, pitch, ...(velocity === undefined ? {} : {velocity})});
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}
class Parameter {
  constructor() { this.value = 0; this.events = []; }
  setTargetAtTime(value, time, constant) { this.events.push({kind: 'target', value, time, constant}); }
}
class Source {
  constructor() { this.playbackRate = new Parameter(); this.starts = []; this.stops = []; }
  connect(target) { this.target = target; }
  disconnect() { this.disconnected = true; }
  start(...args) { this.starts.push(args); }
  stop(time) { this.stops.push(time); if (time === undefined) this.onended?.(); }
}
function setup(t) {
  const timers = new Map();
  let nextTimer = 0;
  t.mock.method(globalThis, 'setInterval', callback => { timers.set(++nextTimer, callback); return nextTimer; });
  t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
  const ctx = {
    currentTime: 10, state: 'running', sources: [], gains: [],
    createGain() {
      const gain = {gain: new Parameter(), connect() {}, disconnect() { this.disconnected = true; }};
      this.gains.push(gain);
      return gain;
    },
    createBufferSource() { const node = new Source(); this.sources.push(node); return node; }
  };
  const piano = {
    preparations: [], calls: [], active: new Set(), stops: 0,
    async prepare(events) { this.preparations.push(events); },
    schedule(event, start, length, elapsed) {
      const voice = {event, start, length, elapsed};
      this.calls.push(voice); this.active.add(voice);
      return voice;
    },
    stop() { this.stops++; this.active.clear(); }
  };
  const vst = {
    calls: [],
    async request(action, data) { this.calls.push({action, data}); return {ok: true, startDelay: .15}; }
  };
  const player = new AudioPlayer();
  player.ctx = ctx; player.master = ctx.createGain(); player.piano = piano; player.vst = vst;
  t.after(() => player.stop());
  return {player, ctx, timers, piano, vst};
}

test('sustained tied sound is scheduled once when seeking inside its visual continuation', async t => {
  const {player, ctx, piano} = setup(t);
  const score = {events: [event(0, 1), event(1, 2), event(2, 4)], audioEvents: [event(0, 4)]};
  await player.play(1.5, score, 1, 0);
  assert.equal(piano.calls.length, 1);
  assert.deepEqual(piano.preparations, [score.audioEvents]);
  assert.deepEqual(piano.calls[0], {event: score.audioEvents[0], start: 10, length: 2.5, elapsed: 1.5});
  ctx.currentTime = 10.5;
  player.schedule(score); player.schedule(score);
  assert.equal(piano.calls.length, 1, 'visual continuation does not retrigger the sounding event');
});

test('lookahead schedules future notes at their onset and never schedules ended notes', async t => {
  const {player, ctx, piano} = setup(t);
  const score = {events: [event(-1, 0), event(.1, .2), event(.3, .5)]};
  await player.play(0, score, 1, 0);
  assert.equal(piano.calls.length, 1);
  close(piano.calls[0].start, 10.1);
  close(piano.calls[0].length, .1);
  close(piano.calls[0].elapsed, 0);
  assert.ok(piano.calls[0].start > ctx.currentTime);
  player.schedule(score);
  assert.equal(piano.calls.length, 1);
  ctx.currentTime = 10.2; player.schedule(score);
  assert.equal(piano.calls.length, 2);
  close(piano.calls[1].start, 10.3);
});

test('playback rate scales onset, duration and sample age without changing the note pitch', async t => {
  const {player, ctx, piano} = setup(t);
  await player.play(0, {events: [event(.2, 1.2, 69, 104)]}, 2, 0);
  const voice = piano.calls[0];
  close(voice.start, 10.1); close(voice.length, .5); close(voice.elapsed, 0);
  assert.equal(voice.event.pitch, 69); assert.equal(voice.event.velocity, 104);
  ctx.currentTime = 10.25;
  close(player.time(), .5);
  await player.play(1, {events: [event(0, 3, 69)]}, 2, 0);
  close(piano.calls[1].elapsed, .5); close(piano.calls[1].length, 1);
});

test('stop freezes the clock, cancels scheduled notes and makes stale scheduler calls inert', async t => {
  const {player, ctx, timers, piano} = setup(t);
  const score = {events: [event(0, 2), event(.1, 2), event(.3, 2)]};
  await player.play(0, score, 1, 0);
  assert.equal(timers.size, 1);
  const staleCallback = [...timers.values()][0];
  ctx.currentTime = 10.1; player.stop();
  close(player.time(), .1);
  assert.equal(piano.active.size, 0); assert.equal(timers.size, 0);
  ctx.currentTime = 11; staleCallback();
  assert.equal(piano.calls.length, 2);
  close(player.time(), .1);
});

test('seek and loop restart replace old voices and reset deduplication once per playback', async t => {
  const {player, ctx, timers, piano} = setup(t);
  const score = {events: [event(0, 2)]};
  await player.play(0, score, 1, 0);
  ctx.currentTime = 10.5;
  await player.play(.5, score, 2, 0);
  assert.equal(piano.calls.length, 2); assert.equal(piano.active.size, 1);
  close(piano.calls[1].start, 10.5); close(piano.calls[1].length, .75); close(piano.calls[1].elapsed, .25);
  await player.play(0, score, 1, 0); player.schedule(score);
  assert.equal(piano.calls.length, 3); assert.equal(piano.active.size, 1); assert.equal(timers.size, 1);
});

test('an intentionally empty sounding event list does not fall back to visible noteheads', async t => {
  const {player, piano} = setup(t);
  await player.play(0, {events: [event(0, 1)], audioEvents: []}, 1, 0);
  assert.equal(piano.calls.length, 0);
  assert.deepEqual(piano.preparations, [[]]);
});

test('stop while audio context is resuming cancels pending playback', async t => {
  const {player, ctx, timers, piano} = setup(t);
  const resume = deferred();
  ctx.state = 'suspended'; ctx.resume = () => resume.promise;
  const pending = player.play(0, {events: [event(0, 1)]}, 1, 0);
  player.stop(); resume.resolve(); await pending;
  assert.equal(player.playing, false); assert.equal(piano.calls.length, 0); assert.equal(timers.size, 0);
});

test('a newer seek request wins over an older pending audio context resume', async t => {
  const {player, ctx, timers, piano} = setup(t), resumes = [];
  ctx.state = 'suspended'; ctx.resume = () => { const resume = deferred(); resumes.push(resume); return resume.promise; };
  const score = {events: [event(0, 2)]};
  const older = player.play(0, score, 1, 0), newer = player.play(.75, score, 2, 0);
  resumes[1].resolve(); await newer; resumes[0].resolve(); await older;
  close(player.time(), .75);
  assert.equal(player.rate, 2); assert.equal(piano.calls.length, 1); assert.equal(timers.size, 1);
});

test('sample preparation completes before the playback clock starts', async t => {
  const {player, ctx, piano, timers} = setup(t);
  const prepared = deferred(); piano.prepare = () => prepared.promise;
  const pending = player.play(2, {events: [event(0, 4)]}, 1, 0);
  await tick();
  ctx.currentTime = 13;
  assert.equal(player.playing, false); assert.equal(timers.size, 0); assert.equal(piano.calls.length, 0);
  prepared.resolve(); await pending;
  close(player.time(), 2); close(player.startClock, 13);
  close(piano.calls[0].start, 13); close(piano.calls[0].elapsed, 2);
});

test('stop while samples are loading cancels the eventual playback', async t => {
  const {player, piano, timers} = setup(t);
  const prepared = deferred(); piano.prepare = () => prepared.promise;
  const pending = player.play(0, {events: [event(0, 2)]}, 1, 0);
  await tick(); player.stop(); prepared.resolve(); await pending;
  assert.equal(player.playing, false); assert.equal(piano.calls.length, 0); assert.equal(timers.size, 0);
});

test('sample preparation errors leave playback stopped and propagate to the caller', async t => {
  const {player, piano, timers} = setup(t);
  piano.prepare = async () => { throw new Error('sample unavailable'); };
  await assert.rejects(player.play(0, {events: [event(0, 2)]}, 1, 0), /sample unavailable/);
  assert.equal(player.playing, false); assert.equal(piano.calls.length, 0); assert.equal(timers.size, 0);
});

test('external audio offset and rate align buffer playback with the score clock', async t => {
  const {player, ctx, piano} = setup(t);
  player.audioBuffer = {duration: 8};
  await player.play(1, {events: []}, 2, 3);
  assert.deepEqual(ctx.sources[0].starts, [[11, 0]]); assert.equal(ctx.sources[0].playbackRate.value, 2);
  await player.play(5, {events: []}, .5, 3);
  assert.deepEqual(ctx.sources[1].starts, [[10, 2]]);
  assert.equal(ctx.sources[0].stops.at(-1), undefined); assert.equal(ctx.sources[0].disconnected, true);
  assert.equal(piano.preparations.length, 0); assert.equal(piano.calls.length, 0);
});

test('external audio beyond its end creates no playing source or retained connection', async t => {
  const {player, ctx} = setup(t);
  player.audioBuffer = {duration: 1};
  await player.play(2, {events: []}, 1, 0);
  assert.equal(ctx.sources[0].starts.length, 0); assert.equal(ctx.sources[0].disconnected, true);
  assert.equal(player.nodes.size, 0);
});

test('VST playback sends timed sounding events and waits for the native start delay', async t => {
  const {player, ctx, piano, vst, timers} = setup(t);
  player.output = 'vst';
  const score = {events: [event(0, 9)], audioEvents: [event(0, 1), event(1, 3, 60, 100), event(2.5, 4, 64)]};
  await player.play(2, score, 2, 0);
  assert.deepEqual(vst.calls, [{action: 'play', data: {
    events: [{start: 0, end: .5, pitch: 60, velocity: 100}, {start: .25, end: 1, pitch: 64, velocity: 80}],
    startDelay: .15, volume: .5
  }}]);
  assert.equal(piano.preparations.length, 0); assert.equal(piano.calls.length, 0); assert.equal(timers.size, 0);
  assert.equal(player.nativeActive, true); assert.equal(player.playing, true);
  close(player.time(), 2);
  ctx.currentTime = 10.1; close(player.time(), 2);
  ctx.currentTime = 10.4; close(player.time(), 2.5);
});

test('pausing VST clears native sound and freezes the musical clock', async t => {
  const {player, ctx, vst} = setup(t);
  player.output = 'vst';
  await player.play(0, {events: [event(0, 2)]}, 1, 0);
  ctx.currentTime = 10.65;
  await player.stop();
  assert.equal(vst.calls.at(-1).action, 'stop');
  assert.equal(player.nativeActive, false); assert.equal(player.playing, false);
  close(player.time(), .5);
  ctx.currentTime = 12; close(player.time(), .5);
  player.stop();
  assert.equal(vst.calls.filter(call => call.action === 'stop').length, 1);
});

test('stopping while VST play is pending clears sound without resurrecting playback', async t => {
  const {player, vst} = setup(t), started = deferred();
  player.output = 'vst';
  vst.request = async (action, data) => {
    vst.calls.push({action, data});
    return action === 'play' ? started.promise : {ok: true};
  };
  const pending = player.play(0, {events: [event(0, 2)]}, 1, 0);
  await tick();
  assert.equal(player.nativeActive, true); assert.equal(player.playing, false);
  await player.stop(); started.resolve({ok: true, startDelay: .15}); await pending;
  assert.deepEqual(vst.calls.map(call => call.action), ['play', 'stop']);
  assert.equal(player.nativeActive, false); assert.equal(player.playing, false);
});

test('a VST restart waits for the preceding native stop before sending new notes', async t => {
  const {player, vst} = setup(t), stopped = deferred();
  player.output = 'vst';
  await player.play(0, {events: [event(0, 2)]}, 1, 0);
  vst.request = async (action, data) => {
    vst.calls.push({action, data});
    return action === 'stop' ? stopped.promise : {ok: true, startDelay: .15};
  };
  const pending = player.play(1, {events: [event(0, 2)]}, 2, 0);
  await tick();
  assert.deepEqual(vst.calls.map(call => call.action), ['play', 'stop']);
  stopped.resolve({ok: true}); await pending;
  assert.deepEqual(vst.calls.map(call => call.action), ['play', 'stop', 'play']);
  assert.equal(player.nativeActive, true); close(player.time(), 1);
});

test('VST errors leave transport stopped and propagate to the caller', async t => {
  const {player, vst} = setup(t);
  player.output = 'vst';
  vst.request = async () => { throw new Error('instrument missing'); };
  await assert.rejects(player.play(0, {events: [event(0, 2)]}, 1, 0), /instrument missing/);
  assert.equal(player.nativeActive, false); assert.equal(player.playing, false);
});

test('imported audio takes precedence over VST and never sends native notes', async t => {
  const {player, ctx, piano, vst} = setup(t);
  player.output = 'vst'; player.audioBuffer = {duration: 8};
  await player.play(1, {events: [event(0, 2)]}, 1, 0);
  assert.deepEqual(ctx.sources[0].starts, [[10, 1]]);
  assert.equal(vst.calls.length, 0); assert.equal(piano.preparations.length, 0); assert.equal(piano.calls.length, 0);
  assert.equal(player.nativeActive, undefined);
});

test('volume changes update the browser mix and active native instrument', async t => {
  const {player, vst} = setup(t);
  player.setVolume(2);
  assert.equal(player.volume, 1); assert.equal(player.master.gain.events.at(-1).value, 1);
  assert.equal(vst.calls.length, 0);
  player.output = 'vst'; await player.play(0, {events: [event(0, 1)]}, 1, 0);
  player.setVolume(.25);
  assert.deepEqual(vst.calls.at(-1), {action: 'volume', data: {volume: .25}});
});

test('invalid playback rates reject without preparing or scheduling audio', async t => {
  const {player, piano, vst} = setup(t);
  for (const rate of [0, -1, Infinity, NaN]) {
    await assert.rejects(player.play(0, {events: [event(0, 1)]}, rate, 0), /播放速度/);
  }
  assert.equal(piano.preparations.length, 0); assert.equal(vst.calls.length, 0); assert.equal(player.playing, false);
});

test('the scheduler orders future notes stably, skips expired notes after a delay, and releases its queue on stop', async t => {
  const {player, ctx, piano} = setup(t);
  const score = {events: [event(2, 3, 64), event(0, 4, 60), event(2, 3, 67), event(1, 1.1, 62)]};
  const original = [...score.events];
  await player.play(-.2, score, 1, 0);
  assert.equal(piano.calls.length, 0);
  ctx.currentTime = 10.2; player.schedule();
  assert.deepEqual(piano.calls.map(call => call.event.pitch), [60]);
  ctx.currentTime = 12.2; player.schedule(); player.schedule();
  assert.deepEqual(piano.calls.map(call => call.event.pitch), [60, 64, 67]);
  assert.deepEqual(score.events, original, 'sorting does not mutate the score');
  player.stop();
  assert.equal(player.pendingEvents.length, 0);
  await player.play(2.5, score, 2, 0);
  assert.deepEqual(piano.calls.slice(3).map(call => call.event.pitch), [60, 64, 67]);
  close(piano.calls[3].elapsed, 1.25);
  close(piano.calls[4].length, .25);
});

test('idle scheduler ticks inspect only the next future onset, regardless of score length', async t => {
  const {player, ctx, piano} = setup(t);
  let reads = 0;
  const events = Array.from({length: 3000}, (_, index) => ({
    get start() { reads++; return 100 + index; },
    get end() { reads++; return 101 + index; },
    pitch: 60,
  }));
  await player.play(0, {events}, 1, 0);
  reads = 0;
  for (let tick = 1; tick <= 100; tick++) { ctx.currentTime = 10 + tick * .025; player.schedule(); }
  assert.equal(piano.calls.length, 0);
  assert.ok(reads <= 100, `scheduler reread ${reads} event timings while no note was due`);
});

test('optional lead-in holds the musical clock and shifts the first audible onset', async t => {
  const {player, ctx, piano} = setup(t);
  await player.play(0, {events: [event(0, 1)]}, 1, 0, .35);
  assert.equal(player.playing, true);
  close(player.time(), 0);
  close(piano.calls[0].start, 10.35);
  ctx.currentTime = 10.2; close(player.time(), 0);
  ctx.currentTime = 10.85; close(player.time(), .5);
});
