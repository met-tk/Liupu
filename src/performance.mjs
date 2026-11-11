const EPSILON = 1e-7;
const children = (node, name) => [...(node?.children || [])].filter(child => !name || child.localName === name);
const child = (node, name) => children(node, name)[0];
const content = (node, name) => child(node, name)?.textContent?.trim() || '';
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const units = { maxima:32, long:16, breve:8, whole:4, half:2, quarter:1, eighth:.5, '16th':.25, '32nd':.125, '64th':.0625, '128th':.03125, '256th':.015625, '512th':.0078125, '1024th':.00390625 };

function metronomeTempo(node) {
  const unit = units[content(node, 'beat-unit')];
  const perMinute = content(node, 'per-minute');
  if (!unit || !positive(perMinute) || children(node, 'beat-unit').length !== 1 || child(node, 'beat-unit-tied')) return null;
  const dots = children(node, 'beat-unit-dot').length;
  return Number(perMinute) * unit * (2 - 2 ** -dots);
}

// Durations locate directions within a measure; Verovio supplies the actual playback measure order.
export function extractMusicXMLTempos(doc) {
  const root = doc.documentElement || doc;
  const parts = children(root, 'part');
  const measures = [], warnings = [];
  const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
  for (const [partIndex, part] of parts.entries()) {
    let divisions = 1, meterDuration = 4;
    for (const [index, measure] of children(part, 'measure').entries()) {
      let cursor = 0, furthest = 0, lastOnset = 0;
      const marks = [];
      const label = `第 ${index + 1} 小节`;
      const durationOf = node => {
        const value = Number(content(node, 'duration')) / divisions;
        if (!Number.isFinite(value) || value < 0) { warn(`${label}的时值无效，已忽略。`); return 0; }
        return value;
      };
      const addTempo = (node, sound = node) => {
        const raw = sound?.getAttribute('tempo');
        const types = children(node, 'direction-type');
        const metronomes = types.flatMap(type => children(type, 'metronome'));
        let bpm = positive(raw) ? Number(raw) : null;
        if (raw !== null && raw !== undefined && !bpm) warn(`${label}的数字速度无效，已忽略。`);
        if (!bpm) for (const metronome of metronomes) {
          bpm = metronomeTempo(metronome);
          if (bpm) break;
        }
        if (!bpm && metronomes.length) warn(`${label}含无法换算的节拍器标记，请补充明确的 sound tempo 数值。`);
        const words = types.flatMap(type => children(type, 'words')).map(word => word.textContent).join(' ');
        if (/\b(rit(?:ardando)?|rall(?:entando)?|accel(?:erando)?|rubato|stringendo)\b/i.test(words)) {
          warn('检测到 rit. / accel. 等文字速度指示；仅执行明确的数字速度，不推测渐变曲线。');
        }
        if (!bpm) return;
        const soundOffset = child(sound, 'offset');
        const directionOffset = child(node, 'offset');
        // MusicXML direction offsets affect sound only with sound="yes"; a sound offset overrides them.
        const offset = soundOffset || (directionOffset?.getAttribute('sound') === 'yes' ? directionOffset : null);
        const offsetValue = offset ? Number(offset.textContent) / divisions : 0;
        const quarter = cursor + offsetValue;
        if (!Number.isFinite(quarter) || quarter < -EPSILON) { warn(`${label}的速度偏移超出小节，已忽略。`); return; }
        const timeOnly = sound?.getAttribute('time-only');
        const passes = timeOnly ? timeOnly.split(',').map(value => Number(value.trim())) : undefined;
        if (passes?.some(value => !Number.isInteger(value) || value < 1)) { warn(`${label}的重复演奏速度条件无效，已忽略。`); return; }
        marks.push({quarter:Math.max(0, quarter), bpm, ...(passes ? {passes} : {})});
      };
      for (const node of children(measure)) {
        if (node.localName === 'attributes') {
          const nextDivisions = content(node, 'divisions');
          if (nextDivisions && positive(nextDivisions)) divisions = Number(nextDivisions);
          else if (nextDivisions) warn(`${label}的 divisions 无效，沿用前值。`);
          const time = child(node, 'time');
          if (time) {
            let beats = 0, total = 0;
            for (const value of children(time)) {
              if (value.localName === 'beats') beats = value.textContent.split('+').reduce((sum, n) => sum + Number(n), 0);
              if (value.localName === 'beat-type' && positive(value.textContent)) total += beats * 4 / Number(value.textContent);
            }
            if (positive(total)) meterDuration = total;
          }
        } else if (node.localName === 'note') {
          const duration = child(node, 'grace') ? 0 : durationOf(node);
          if (!child(node, 'chord')) { lastOnset = cursor; cursor += duration; }
          furthest = Math.max(furthest, cursor, lastOnset + duration);
        } else if (node.localName === 'backup') {
          cursor -= durationOf(node);
          if (cursor < -EPSILON) { warn(`${label}的 backup 超出小节，已限制到小节起点。`); cursor = 0; }
          cursor = Math.max(0, cursor);
        } else if (node.localName === 'forward') {
          cursor += durationOf(node); furthest = Math.max(furthest, cursor);
        } else if (node.localName === 'direction') addTempo(node, child(node, 'sound'));
        else if (node.localName === 'sound') addTempo(node);
      }
      const duration = furthest || meterDuration;
      const target = measures[index] ||= {duration:0, marks:[]};
      target.duration = Math.max(target.duration, duration);
      for (const mark of marks) {
        if (mark.quarter > duration + EPSILON) { warn(`${label}的速度偏移超出小节，已忽略。`); continue; }
        const existing = target.marks.find(item => Math.abs(item.quarter - mark.quarter) < EPSILON && JSON.stringify(item.passes) === JSON.stringify(mark.passes));
        if (existing && partIndex > 0) {
          if (Math.abs(existing.bpm - mark.bpm) > EPSILON) warn(`${label}的声部速度标记冲突，采用前一声部的速度。`);
        } else if (existing) Object.assign(existing, mark);
        else target.marks.push(mark);
      }
    }
  }
  for (const measure of measures) measure.marks.sort((a,b) => a.quarter - b.quarter);
  return {measures, warnings};
}

// A numeric tempo mark is a step change, so integrate each interval exactly.
export function createTempoTimeline(changes, defaultBpm = 120) {
  if (!positive(defaultBpm)) throw new RangeError('默认速度必须为有限正数。');
  const ordered = changes.map(change => {
    if (!Number.isFinite(change.quarter) || change.quarter < 0 || !Number.isFinite(change.bpm) || change.bpm <= 0) throw new RangeError('速度位置与 BPM 必须是有效数值。');
    return {...change};
  }).sort((a,b) => a.quarter - b.quarter);
  const distinct = [];
  for (const change of ordered) {
    if (distinct.length && Math.abs(change.quarter - distinct.at(-1).quarter) < EPSILON) distinct[distinct.length - 1] = change;
    else distinct.push(change);
  }
  const segments = [{quarter:0, time:0, bpm:Number(defaultBpm)}];
  for (const change of distinct) {
    const previous = segments.at(-1);
    if (Math.abs(change.quarter - previous.quarter) < EPSILON) previous.bpm = change.bpm;
    else if (change.bpm !== previous.bpm) segments.push({quarter:change.quarter, time:previous.time + (change.quarter - previous.quarter) * 60 / previous.bpm, bpm:change.bpm});
  }
  const segmentAt = (value, key) => {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('时间位置必须为非负有限数。');
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (segments[mid][key] <= value) lo = mid; else hi = mid - 1;
    }
    return segments[lo];
  };
  return {
    tempoChanges:segments,
    quarterToSeconds(quarter) { const segment = segmentAt(quarter, 'quarter'); return segment.time + (quarter - segment.quarter) * 60 / segment.bpm; },
    secondsToQuarter(time) { const segment = segmentAt(time, 'time'); return segment.quarter + (time - segment.time) * segment.bpm / 60; },
    tempoAt(time) { return segmentAt(time, 'time').bpm; }
  };
}

export function retimeTimemap(timemap, tempoData, measureIds) {
  if (!timemap.length) throw new RangeError('播放时间表为空。');
  let previousQuarter = -1;
  for (const entry of timemap) {
    if (!Number.isFinite(entry.qstamp) || entry.qstamp < 0 || entry.qstamp < previousQuarter) throw new RangeError('播放时间表必须包含单调递增的 qstamp。');
    previousQuarter = entry.qstamp;
  }
  const warnings = [...tempoData.warnings];
  // Verovio can move a mid-measure tempo to beat one; do not inherit that premature value.
  const hasNumericTempo = tempoData.measures.some(measure => measure.marks.length);
  const defaultBpm = hasNumericTempo ? 120 : Number(timemap.find(entry => positive(entry.tempo))?.tempo || 120);
  const sourceIndex = new Map(measureIds.map((id,index) => [id,index]));
  const occurrences = timemap.filter(entry => entry.measureOn);
  const changes = [];
  const passes = new Map();
  let sourceTempo = defaultBpm, previousIndex = -1;
  const initialTempos = tempoData.measures.map(measure => {
    const initial = sourceTempo;
    for (const mark of measure.marks) if (!mark.passes || mark.passes.includes(1)) sourceTempo = mark.bpm;
    return initial;
  });
  for (const [i, occurrence] of occurrences.entries()) {
    const sourceId = sourceIndex.has(occurrence.measureOn) ? occurrence.measureOn : occurrence.measureOn.replace(/-rend\d+$/, '');
    const index = sourceIndex.get(sourceId);
    const measure = tempoData.measures[index];
    const end = occurrences[i + 1]?.qstamp ?? timemap.at(-1).qstamp;
    if (!measure) {
      warnings.push('部分播放小节无法关联原谱，已保留这些位置的引擎速度。');
      for (const entry of timemap) if (entry.qstamp >= occurrence.qstamp && entry.qstamp < end && positive(entry.tempo)) changes.push({quarter:entry.qstamp,bpm:Number(entry.tempo)});
      previousIndex = -1;
      continue;
    }
    const pass = (passes.get(index) || 0) + 1;
    passes.set(index, pass);
    // Backward repeats restore the source tempo; skipped endings retain the tempo actually played.
    if (i === 0 || previousIndex < 0 || index <= previousIndex) changes.push({quarter:occurrence.qstamp, bpm:initialTempos[index]});
    for (const mark of measure.marks) {
      const quarter = occurrence.qstamp + mark.quarter;
      if (quarter <= end + EPSILON && (!mark.passes || mark.passes.includes(pass))) changes.push({quarter, bpm:mark.bpm});
    }
    previousIndex = index;
  }
  // Use engine tempos only if source mapping is unavailable, never on top of parsed intra-measure marks.
  if (!changes.length) for (const entry of timemap) if (positive(entry.tempo)) changes.push({quarter:entry.qstamp, bpm:Number(entry.tempo)});
  const timeline = createTempoTimeline(changes, Number(defaultBpm));
  const result = timemap.map(entry => ({...entry, tstamp:timeline.quarterToSeconds(entry.qstamp) * 1000}));
  return {...timeline, timemap:result, duration:timeline.quarterToSeconds(timemap.at(-1).qstamp), warnings:[...new Set(warnings)]};
}
