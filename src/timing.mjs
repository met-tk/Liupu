export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

export function lastTimeIndex(entries, time, key = 'time') {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid][key] <= time) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}

// Accumulate the deadline instead of resetting it after every RAF: small clock
// jitter on a 60 Hz display must not accidentally reduce playback to 30 Hz.
export function nextFrameTime(now, deadline = 0) {
  if (now + .5 < deadline) return null;
  const next = deadline + 1000 / 60;
  return deadline && next > now ? next : now + 1000 / 60;
}

// Keep every occurrence: a repeated notation ID can have several playback times.
export function noteEvents(timemap, midiForId) {
  const open = new Map(), result = [];
  for (const entry of timemap) {
    const time = entry.tstamp / 1000;
    for (const id of entry.off || []) {
      const pending = open.get(id);
      if (pending) { pending.end = time; open.delete(id); }
    }
    for (const id of entry.on || []) {
      const midi = midiForId(id);
      const event = { id, start: time, end: time + 0.15, pitch: Number(midi?.pitch ?? 60) };
      result.push(event);
      open.set(id, event);
    }
  }
  return result;
}

export function cameraStops(events, boxes, duration, measures = []) {
  const stops = [];
  for (const e of events) {
    const box = boxes.get(e.id);
    if (!box) continue;
    const last = stops.at(-1);
    if (!last || Math.abs(e.start - last.time) > 0.001) stops.push({ time: e.start, x: box.x });
  }
  for (const measure of measures) {
    if (!stops.some(stop => Math.abs(stop.time - measure.time) < 1e-7)) stops.push({time:measure.time, x:measure.x});
  }
  stops.sort((a,b) => a.time - b.time);
  for (let index = 1; index < measures.length; index++) {
    const previous = measures[index - 1], current = measures[index];
    if (current.sourceIndex !== previous.sourceIndex + 1) {
      const boundary = stops.find(stop => Math.abs(stop.time - current.time) < 1e-7);
      // Approach the outgoing barline before cutting to the next playback measure.
      boundary.arrivalX = previous.endX;
    }
  }
  if (stops.length) stops.push({ time: duration, x: measures.at(-1)?.endX ?? stops.at(-1).x + 90 });
  return stops;
}

export function positionAt(stops, time) {
  if (!stops.length) return 0;
  if (time <= stops[0].time) return stops[0].x;
  let lo = 0, hi = stops.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (stops[mid].time <= time) lo = mid; else hi = mid - 1;
  }
  const a = stops[lo], b = stops[lo + 1];
  if (!b) return a.x;
  const destination = b.arrivalX ?? b.x;
  // Legacy maps without a barline anchor still cut rather than sweep backwards.
  if (destination < a.x) return a.x;
  return a.x + (destination - a.x) * clamp((time - a.time) / (b.time - a.time), 0, 1);
}

// Inverse of positionAt: the playback time when the playhead reaches a given
// x position on the staff. Structure-element glow regions use it to light up
// clefs, rests and marks as the performance sweeps across them.
export function timeAtX(stops, x) {
  if (!stops.length) return 0;
  if (x <= stops[0].x) return stops[0].time;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1], destination = b.arrivalX ?? b.x;
    if (x <= a.x) return a.time;
    if (destination > a.x && x <= destination) return a.time + (b.time - a.time) * clamp((x - a.x) / (destination - a.x), 0, 1);
  }
  return stops.at(-1).time;
}

export function seed(id) {
  let v = 2166136261;
  for (const c of id) v = Math.imul(v ^ c.charCodeAt(0), 16777619);
  return (v >>> 0) / 4294967295;
}

// Rasterization scale for score layers: sharper glyph sampling without unbounded memory.
// A larger canvas never falls below 1; the pixel budget caps each full-size layer.
export function pickRasterScale(width, height, { max = 2.2, budget = 16_000_000, limit = 32000 } = {}) {
  if (!(width > 0) || !(height > 0)) return 1;
  return clamp(Math.min(max, Math.sqrt(budget / (width * height)), limit / width, limit / height), 1, max);
}

// Symmetric Hermite smoothstep pulse centered on the playhead/event (score-scroll
// style: raw = max(0, 1 - d / range), smooth = raw^2 * (3 - 2 * raw)).
// Expands both forward (upcoming notes brighten) and backward (played notes dim).
export function sweepGlowEnvelope(time, start, endOrOptions = {}, maybeOptions = {}) {
  const hasEnd = typeof endOrOptions === 'number';
  const end = hasEnd ? Math.max(start, endOrOptions) : start;
  const { peak = 1, valley = 0, range = 1.4 } = (hasEnd ? maybeOptions : endOrOptions) || {};
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const span = Math.max(0.1, range);
  if (time < start) {
    const raw = Math.max(0, 1 - (start - time) / span);
    return peak * raw * raw * (3 - 2 * raw);
  }
  if (time <= end) return peak;
  const progress = (time - end) / span;
  if (progress <= 1) {
    const raw = 1 - progress, smooth = raw * raw * (3 - 2 * raw);
    return valley + (peak - valley) * smooth;
  }
  return valley === 0 ? 0 : valley * Math.exp(-(progress - 1) * 4);
}

// Spatial smoothstep attenuation around the playhead X position for progressive
// illumination of ties, slurs, hairpins and beams along the playback locus.
export function spatialGlowWeight(x, playheadX, leadSpan, trailSpan = leadSpan, valley = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(playheadX)) return 0;
  if (x >= playheadX) {
    const span = Math.max(1e-3, leadSpan), raw = clamp(1 - (x - playheadX) / span, 0, 1);
    return raw * raw * (3 - 2 * raw);
  }
  const span = Math.max(1e-3, trailSpan), raw = clamp(1 - (playheadX - x) / span, 0, 1);
  const smooth = raw * raw * (3 - 2 * raw), floor = clamp(valley, 0, 1);
  return floor + (1 - floor) * smooth;
}
