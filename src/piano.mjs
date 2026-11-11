import { PIANO_SAMPLES, PIANO_LAYERS } from './assets/piano/manifest.mjs';

const RELEASE = .22;
const STOP_FADE = .018;
const velocityOf = velocity => Number.isFinite(velocity) ? Math.max(0, Math.min(127, velocity)) : 80;

// Sample selection happens for every scheduled note. Keep the immutable result for
// each pitch/velocity pair so the scheduler does not rescan the manifest per tick.
const samplesByLayer = new Map(PIANO_LAYERS.map(layer => [
  layer,
  PIANO_SAMPLES.filter(sample => sample.layer === layer)
]));
const selectionCache = new Map();
const rememberSelection = (key, value) => {
  // Scores normally contain a small MIDI pitch range. Keep a bounded cache for
  // imported files with arbitrary fractional pitches or velocity curves.
  if (selectionCache.size >= 4096) selectionCache.delete(selectionCache.keys().next().value);
  selectionCache.set(key, value);
  return value;
};
const nearestSample = (samples, pitch) => {
  let best = null;
  for (const sample of samples) {
    if (!best || Math.abs(sample.midi - pitch) < Math.abs(best.midi - pitch) ||
      (Math.abs(sample.midi - pitch) === Math.abs(best.midi - pitch) && sample.midi < best.midi)) best = sample;
  }
  return best;
};

export function selectPianoSamples(pitch, velocity = 80) {
  if (!Number.isFinite(pitch)) return [];
  velocity = velocityOf(velocity);
  if (velocity === 0) return [];
  const key = `${pitch}|${velocity}`;
  const cached = selectionCache.get(key);
  if (cached) return cached;
  // Blend recorded layers at velocity 24/64/104 to avoid sudden timbre and level jumps.
  const position = velocity / 8;
  const low = PIANO_LAYERS.findLast(layer => layer <= position) ?? PIANO_LAYERS[0];
  const high = PIANO_LAYERS.find(layer => layer >= position) ?? PIANO_LAYERS.at(-1);
  const result = [...new Set([low, high])].map(layer => {
    const sample = nearestSample(samplesByLayer.get(layer) ?? [], pitch);
    const weight = low === high ? 1 : layer === low ? (high - position) / (high - low) : (position - low) / (high - low);
    return {...sample, weight};
  });
  return rememberSelection(key, result);
}

export class PianoSampler {
  constructor(ctx, destination, onStatus) {
    this.ctx = ctx;
    this.destination = destination;
    this.onStatus = onStatus;
    this.buffers = new Map();
    this.pending = new Map();
    this.voices = new Set();
    this.voiceGains = new Map();
    this.voiceStarts = new Map();
    this.activeLoads = 0;
    this.waiting = [];
    this.preparation = 0;
  }

  async prepare(events) {
    const generation = ++this.preparation;
    const samples = [...new Map(events.flatMap(event => selectPianoSamples(event.pitch, event.velocity))
      .map(sample => [sample.file, sample])).values()];
    let loaded = samples.filter(sample => this.buffers.has(sample.file)).length;
    const total = samples.length;
    const report = (state, message) => {
      if (generation === this.preparation) this.onStatus?.({state, loaded, total, message});
    };
    if (loaded === total) {
      report('ready', '钢琴音源已就绪');
      return;
    }
    report('loading', `正在载入钢琴采样（${loaded}/${total}）`);
    // Wait for every request, including failures, so retrying never abandons an in-flight load.
    const results = await Promise.allSettled(samples.filter(sample => !this.buffers.has(sample.file))
      .map(sample => this.load(sample).then(() => {
        loaded++;
        report('loading', `正在载入钢琴采样（${loaded}/${total}）`);
      })));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
      report('error', `钢琴音源载入失败：${failed.reason.message}`);
      throw failed.reason;
    }
    report('ready', '钢琴音源已就绪');
  }

  load(sample) {
    if (this.buffers.has(sample.file)) return Promise.resolve(this.buffers.get(sample.file));
    if (!this.pending.has(sample.file)) {
      const promise = this.decode(sample).then(buffer => {
        this.buffers.set(sample.file, buffer);
        return buffer;
      }).finally(() => this.pending.delete(sample.file));
      this.pending.set(sample.file, promise);
    }
    return this.pending.get(sample.file);
  }

  async decode(sample) {
    if (this.activeLoads >= 4) await new Promise(resolve => this.waiting.push(resolve));
    else this.activeLoads++;
    try {
      const response = await fetch(new URL(`./assets/piano/${sample.file}`, import.meta.url));
      if (!response.ok) throw new Error(`${sample.file} (HTTP ${response.status})`);
      return await this.ctx.decodeAudioData(await response.arrayBuffer());
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.activeLoads--;
    }
  }

  // elapsed is wall-clock seconds already played, before transposition of the sample.
  schedule(event, start, length, elapsed = 0) {
    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) return [];
    const velocity = velocityOf(event.velocity);
    const edgeGain = velocity < 24 ? velocity / 24 : velocity > 104 ? velocity / 104 : 1;
    const sources = [];
    for (const sample of selectPianoSamples(event.pitch, velocity)) {
      const buffer = this.buffers.get(sample.file);
      if (!buffer) continue;
      const playbackRate = 2 ** ((event.pitch - sample.midi) / 12);
      const offset = Math.max(0, elapsed) * playbackRate;
      if (!Number.isFinite(offset) || offset >= buffer.duration) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      const gain = this.ctx.createGain();
      const level = .7 * edgeGain * Math.sqrt(sample.weight);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + Math.min(.004, length / 2));
      gain.gain.setValueAtTime(level, start + length);
      gain.gain.linearRampToValueAtTime(0, start + length + RELEASE);
      source.connect(gain);
      gain.connect(this.destination);
      source.onended = () => {
        this.voices.delete(source);
        this.voiceGains.delete(source);
        this.voiceStarts.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      this.voices.add(source);
      this.voiceGains.set(source, gain);
      this.voiceStarts.set(source, start);
      source.start(start, offset);
      source.stop(start + length + RELEASE);
      sources.push(source);
    }
    return sources;
  }

  stop() {
    const hasClock = Number.isFinite(this.ctx?.currentTime);
    const now = hasClock ? this.ctx.currentTime : 0;
    for (const source of this.voices) {
      const gain = this.voiceGains.get(source);
      // Real AudioParam objects support scheduled cancellation and ramps. The
      // fallback keeps lightweight test hosts and older WebAudio shims working.
      const parameter = gain?.gain;
      const canFade = hasClock && parameter && typeof parameter.cancelScheduledValues === 'function' &&
        typeof parameter.linearRampToValueAtTime === 'function';
      if (!canFade) {
        try { source.stop(); } catch {}
        source.onended?.();
        continue;
      }
      const onset = this.voiceStarts.get(source);
      const rampStart = Math.max(now, Number.isFinite(onset) ? onset : now);
      const stopAt = rampStart + STOP_FADE;
      try {
        // cancelAndHoldAtTime preserves the instantaneous gain of an already
        // sounding voice. Older WebAudio shims lack it, so retain the small
        // value-based fallback for those hosts and the lightweight test mock.
        if (rampStart <= now && typeof parameter.cancelAndHoldAtTime === 'function') {
          parameter.cancelAndHoldAtTime(now);
        } else {
          parameter.cancelScheduledValues(rampStart);
          const current = rampStart > now ? 0 : (Number.isFinite(parameter.value) ? parameter.value : 0);
          if (typeof parameter.setValueAtTime === 'function') parameter.setValueAtTime(current, rampStart);
        }
        parameter.linearRampToValueAtTime(0, stopAt);
        source.stop(stopAt);
      } catch {
        try { source.stop(); } catch {}
        source.onended?.();
      }
    }
    this.voices.clear();
  }
}
