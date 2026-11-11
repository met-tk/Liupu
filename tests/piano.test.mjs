import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoSampler, selectPianoSamples } from '../src/piano.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (pitch = 60, velocity = 80) => ({pitch, velocity});

function setup(t, fetcher) {
  const requests = [], statuses = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return fetcher ? fetcher(url) : {ok: true, arrayBuffer: async () => new ArrayBuffer(4)};
  });
  const ctx = {
    sources: [], gains: [], decodes: 0,
    async decodeAudioData() { this.decodes++; return {duration: 12}; },
    createBufferSource() {
      const source = {
        playbackRate: {}, starts: [], stops: [],
        connect(target) { this.target = target; },
        disconnect() { this.disconnected = true; },
        start(...args) { this.starts.push(args); },
        stop(...args) { this.stops.push(args); }
      };
      this.sources.push(source);
      return source;
    },
    createGain() {
      const gain = {
        gain: {
          events: [],
          setValueAtTime(value, time) { this.events.push({kind: 'set', value, time}); },
          linearRampToValueAtTime(value, time) { this.events.push({kind: 'linear', value, time}); }
        },
        connect(target) { this.target = target; },
        disconnect() { this.disconnected = true; }
      };
      this.gains.push(gain);
      return gain;
    }
  };
  const destination = {};
  const sampler = new PianoSampler(ctx, destination, status => statuses.push(status));
  t.after(() => sampler.stop());
  return {sampler, ctx, requests, statuses, destination};
}

test('sample selection follows pitch, bounds, and recorded velocity layers', () => {
  assert.ok(selectPianoSamples(61).every(sample => sample.midi === 60));
  assert.ok(selectPianoSamples(62).every(sample => sample.midi === 63));
  assert.equal(selectPianoSamples(0)[0].midi, 21);
  assert.equal(selectPianoSamples(127)[0].midi, 108);
  assert.equal(selectPianoSamples(60, 1)[0].layer, 3);
  assert.equal(selectPianoSamples(60, 127)[0].layer, 13);
  assert.deepEqual(selectPianoSamples(NaN), []);
  assert.deepEqual(selectPianoSamples(60).map(({layer, weight}) => [layer, weight]), [[8, .6], [13, .4]]);
});

test('velocity blending is continuous at former switch points and recorded anchors', () => {
  const weights = velocity => Object.fromEntries(selectPianoSamples(60, velocity).map(sample => [sample.layer, sample.weight]));
  assert.deepEqual(weights(24), {3: 1});
  assert.deepEqual(weights(64), {8: 1});
  assert.deepEqual(weights(104), {13: 1});
  for (const velocity of [44, 45, 63, 64, 65, 84, 85]) {
    const before = weights(velocity), after = weights(velocity + 1);
    close(Object.values(before).reduce((sum, weight) => sum + weight), 1);
    for (const layer of [3, 8, 13]) assert.ok(Math.abs((after[layer] ?? 0) - (before[layer] ?? 0)) <= .02500001);
  }
});

test('preparation loads only the required unique samples and reuses decoded audio', async t => {
  const {sampler, ctx, requests, statuses} = setup(t);
  await sampler.prepare([event(60), event(61), event(60), event(60, 120)]);
  assert.equal(requests.length, 2);
  assert.equal(ctx.decodes, 2);
  assert.ok(requests.every(url => url.pathname.includes('/assets/piano/')));
  assert.deepEqual(statuses.at(-1), {state: 'ready', loaded: 2, total: 2, message: '钢琴音源已就绪'});
  await sampler.prepare([event(61)]);
  assert.equal(requests.length, 2);
  assert.equal(statuses.at(-1).loaded, 2);
});

test('concurrent preparations share in-flight requests and keep the four-load limit', async t => {
  let release, active = 0, maximum = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const {sampler, requests, statuses} = setup(t, async () => {
    maximum = Math.max(maximum, ++active);
    await gate;
    active--;
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(4)};
  });
  const events = [36, 39, 42, 45, 48, 51, 54, 57].map(pitch => event(pitch));
  const first = sampler.prepare(events);
  const second = sampler.prepare(events.slice(2));
  await tick();
  assert.equal(requests.length, 4);
  release();
  await Promise.all([first, second]);
  assert.equal(requests.length, 16);
  assert.equal(maximum, 4);
  assert.equal(statuses.at(-1).state, 'ready');
  assert.equal(statuses.at(-1).total, 12, 'only the latest preparation reports completion');
});

test('failed preparation settles every load and retry retains successful samples', async t => {
  let release, fail = true;
  const gate = new Promise(resolve => { release = resolve; });
  const {sampler, requests, statuses} = setup(t, async url => {
    if (url.pathname.endsWith(selectPianoSamples(60)[0].file) && fail) {
      fail = false;
      return {ok: false, status: 503};
    }
    await gate;
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(4)};
  });
  let settled = false;
  const first = sampler.prepare([event(60), event(63)]).catch(error => {
    settled = true;
    return error;
  });
  await tick();
  assert.equal(settled, false, 'failure waits for the other outstanding load');
  release();
  assert.match((await first).message, /503/);
  assert.equal(statuses.at(-1).state, 'error');
  await sampler.prepare([event(60), event(63)]);
  assert.equal(requests.length, 5, 'only the failed sample is fetched again');
  assert.equal(sampler.pending.size, 0);
  assert.equal(statuses.at(-1).state, 'ready');
});

test('decode failures can be retried without retaining a rejected promise', async t => {
  const {sampler, ctx, requests} = setup(t);
  let fail = true;
  ctx.decodeAudioData = async () => {
    if (fail) { fail = false; throw new Error('Unsupported sample'); }
    return {duration: 12};
  };
  await assert.rejects(sampler.prepare([event()]), /Unsupported sample/);
  await sampler.prepare([event()]);
  assert.equal(requests.length, 3);
  assert.equal(sampler.buffers.size, 2);
});

test('playback transposes the nearest sample and seeks past its attack', async t => {
  const {sampler, ctx, destination} = setup(t);
  await sampler.prepare([event(61)]);
  const sources = sampler.schedule(event(61), 10, 2, 1.5);
  assert.equal(sources.length, 2);
  const source = sources[0];
  const pitchRatio = 2 ** (1 / 12);
  close(source.playbackRate.value, pitchRatio);
  close(source.starts[0][0], 10);
  close(source.starts[0][1], 1.5 * pitchRatio);
  close(source.stops[0][0], 12.22);
  assert.equal(source.loop, undefined, 'the recording finishes naturally, without a synthetic loop');
  assert.equal(source.target, ctx.gains[0]);
  assert.equal(ctx.gains[0].target, destination);
  assert.deepEqual(ctx.gains[0].gain.events.at(-1), {kind: 'linear', value: 0, time: 12.22});
  close(ctx.gains[0].gain.events[1].value, .7 * Math.sqrt(.6));
  close(ctx.gains[1].gain.events[1].value, .7 * Math.sqrt(.4));
  close(ctx.gains.reduce((power, gain) => power + gain.gain.events[1].value ** 2, 0), .7 ** 2);
  assert.deepEqual(sources[1].starts, source.starts, 'both layers use the same transposed sample age');
  assert.deepEqual(sources[1].stops, source.stops);
});

test('changing note length affects release time while preserving pitch', async t => {
  const {sampler} = setup(t);
  await sampler.prepare([event(60)]);
  const [normal] = sampler.schedule(event(60), 10, 2);
  const [faster] = sampler.schedule(event(60), 10, 1);
  assert.equal(normal.playbackRate.value, 1);
  assert.equal(faster.playbackRate.value, 1);
  close(normal.stops[0][0] - faster.stops[0][0], 1);
});

test('seeking beyond a recording does not restart its attack or create a voice', async t => {
  const {sampler, ctx} = setup(t);
  await sampler.prepare([event(60)]);
  assert.deepEqual(sampler.schedule(event(60), 10, 1, 12), []);
  assert.deepEqual(sampler.schedule(event(60), 10, 0), []);
  assert.equal(ctx.sources.length, 0);
});

test('natural endings and stop release every voice and gain connection', async t => {
  const {sampler, ctx} = setup(t);
  await sampler.prepare([event()]);
  const [first] = sampler.schedule(event(), 10, 1);
  const [second] = sampler.schedule(event(), 12, 1);
  assert.equal(sampler.voices.size, 4);
  first.onended();
  assert.equal(sampler.voices.size, 3);
  assert.equal(first.disconnected, true);
  sampler.stop();
  assert.equal(sampler.voices.size, 0);
  assert.deepEqual(second.stops.at(-1), []);
  assert.ok(ctx.gains.every(gain => gain.disconnected));
  assert.equal(second.disconnected, true);
  second.onended();
  sampler.stop();
});

test('an empty score is ready immediately and makes no network request', async t => {
  const {sampler, requests, statuses} = setup(t);
  await sampler.prepare([]);
  assert.equal(requests.length, 0);
  assert.equal(statuses.at(-1).state, 'ready');
  assert.equal(statuses.at(-1).total, 0);
});

test('zero velocity is silent and does not fetch or create a voice', async t => {
  const {sampler, ctx, requests} = setup(t);
  assert.deepEqual(selectPianoSamples(60, 0), []);
  await sampler.prepare([event(60, 0)]);
  assert.equal(requests.length, 0);
  await sampler.prepare([event(60, 80)]);
  assert.deepEqual(sampler.schedule(event(60, 0), 10, 1), []);
  assert.equal(ctx.sources.length, 0);
});

test('anchor velocities fetch one layer and extreme velocities keep expressive gain', async t => {
  const {sampler, ctx, requests} = setup(t);
  await sampler.prepare([event(60, 24)]);
  assert.equal(requests.length, 1);
  sampler.schedule(event(60, 1), 10, 1);
  sampler.schedule(event(60, 24), 10, 1);
  close(ctx.gains[0].gain.events[1].value, .7 / 24);
  close(ctx.gains[1].gain.events[1].value, .7);
  await sampler.prepare([event(60, 104)]);
  assert.equal(requests.length, 2);
  sampler.schedule(event(60, 127), 10, 1);
  close(ctx.gains[2].gain.events[1].value, .7 * 127 / 104);
});
