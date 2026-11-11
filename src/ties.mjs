const children = (node, name) => [...(node?.children || [])].filter(child => child.localName === name);
const child = (node, name) => children(node, name)[0];
const text = (node, name, fallback = '') => child(node, name)?.textContent?.trim() || fallback;
const walk = function* (node) { yield node; for (const next of node.children || []) yield* walk(next); };
const validId = value => /^[_\p{L}][-._\p{L}\p{N}\u00b7\u0300-\u036f\u203f-\u2040]*$/u.test(value || '');

// Source ties describe sound; the engine timemap describes individual visible noteheads.
export function prepareTieSource(doc) {
  const warnings = new Set(), links = [], root = doc.documentElement;
  const ids = new Map();
  for (const node of walk(root)) for (const value of [node.getAttribute?.('id'), node.getAttribute?.('xml:id')].filter(Boolean)) ids.set(value, (ids.get(value) || 0) + 1);
  let nextId = 1;
  for (const note of [...walk(root)].filter(node => node.localName === 'note')) {
    const existing = note.getAttribute('id') || note.getAttribute('xml:id');
    if (validId(existing) && ids.get(existing) === 1) { note.setAttribute('id', existing); continue; }
    let id; do { id = `liupu-note-${nextId++}`; } while (ids.has(id));
    note.setAttribute('id', id); ids.set(id, 1);
    if (note.getAttribute('xml:id')) note.removeAttribute('xml:id');
    if (existing) warnings.add('部分音符 ID 重复或不符合 XML 标识符要求，已分配唯一 ID。');
  }
  children(root, 'part').forEach((part, partIndex) => {
    const pending = new Map();
    for (const measure of children(part, 'measure')) for (const note of children(measure, 'note')) {
      const sound = children(note, 'tie'), notations = children(note, 'notations');
      const visible = notations.flatMap(node => children(node, 'tied'));
      const hasExplicit = sound.length > 0, source = hasExplicit ? sound : visible;
      if (!source.length) continue;
      const id = note.getAttribute('id'), voice = text(note, 'voice', '1'), pitch = child(note, 'pitch');
      const step = text(pitch, 'step'), octave = Number(text(pitch, 'octave', 'NaN')), alter = Number(text(pitch, 'alter', '0'));
      const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
      if (!pitch || semitone === undefined || !Number.isFinite(octave) || !Number.isFinite(alter)) {
        warnings.add('休止符、无音高或无效音高上的延音线未合并。'); continue;
      }
      const soundingPitch = (octave + 1) * 12 + semitone + alter;
      if (source.some(marker => marker.getAttribute('time-only'))) {
        warnings.add('包含 time-only 反复次数限定的延音线暂未合并，请核对该处声音。'); continue;
      }
      if (!hasExplicit) {
        if (visible.some(marker => ['continue', 'let-ring'].includes(marker.getAttribute('type')))) warnings.add('仅含视觉 continue 或 let-ring 的延音标记不推断持续音，请补充明确的声音 tie。');
        const types = visible.map(marker => marker.getAttribute('type'));
        if (types.indexOf('start') >= 0 && types.indexOf('stop') > types.indexOf('start')) {
          warnings.add('同一音符上的 start→stop 开放式视觉延音线不推断声音连接。'); continue;
        }
        if (types.some(type => type === 'start' || type === 'stop')) warnings.add('部分延音线仅有 tied 记谱标记，已按明确的起止连接兼容推断持续音。');
      }
      const markers = [];
      for (const marker of source) {
        const type = marker.getAttribute('type');
        if (type !== 'start' && type !== 'stop') { if (hasExplicit) warnings.add('无法识别的声音 tie 类型未合并。'); continue; }
        const drawn = hasExplicit ? visible.filter(item => item.getAttribute('type') === type) : [marker];
        const numbers = [...new Set(drawn.map(item => item.getAttribute('number') || '1'))];
        if (numbers.length > 1) { warnings.add('同一音符有多条无法唯一对应的延音线，未推断连接。'); continue; }
        const number = numbers[0] || '1', key = JSON.stringify([partIndex, voice, soundingPitch, number]);
        if (!markers.some(item => item.type === type && item.key === key)) markers.push({ type, key });
        if (hasExplicit && !drawn.length) {
          let notation = notations[0];
          if (!notation) { notation = doc.createElementNS(note.namespaceURI || null, 'notations'); note.appendChild(notation); notations.push(notation); }
          const tied = doc.createElementNS(note.namespaceURI || null, 'tied'); tied.setAttribute('type', type); notation.appendChild(tied); visible.push(tied);
        }
      }
      for (const marker of markers.filter(item => item.type === 'stop')) {
        const candidates = pending.get(marker.key) || [];
        if (candidates.length === 1) links.push({ from: candidates[0], to: id });
        else if (candidates.length > 1) warnings.add('同声部同音高的延音线对应不唯一，未合并；请在 tied 中添加明确 number。');
        else warnings.add('存在未配对或音高不匹配的延音终点，已保留独立起音。');
        pending.delete(marker.key);
      }
      for (const marker of markers.filter(item => item.type === 'start')) pending.set(marker.key, [...(pending.get(marker.key) || []), id]);
    }
    if (pending.size) warnings.add('存在未配对的延音起点，已保留原音符时值。');
  });
  return { links, warnings: [...warnings] };
}

export function mergeTiedEvents(sourceEvents, links) {
  const events = sourceEvents.map(event => ({ ...event, attack: true, soundStart: event.start, soundEnd: event.end }));
  const warnings = new Set(), byId = new Map(), candidates = new Map();
  events.forEach((event, index) => { if (!byId.has(event.id)) byId.set(event.id, []); byId.get(event.id).push(index); });
  for (const link of links) {
    let matched = false;
    if (link.from === link.to) { warnings.add('延音线不能将音符连接到自身，已保留独立起音。'); continue; }
    for (const from of byId.get(link.from) || []) for (const to of byId.get(link.to) || []) {
      const a = events[from], b = events[to];
      if (Math.abs(a.end - b.start) > 1e-5 || Math.abs(a.pitch - b.pitch) > 1e-7 || b.end <= a.end) continue;
      if (![a.start, a.end, b.start, b.end, a.pitch, b.pitch].every(Number.isFinite)) continue;
      candidates.set(`${from}:${to}`, { from, to }); matched = true;
    }
    if (!matched) warnings.add('部分延音线在实际演奏顺序中不连续或音高不匹配，已保留独立起音。');
  }
  const inCounts = new Map(), outCounts = new Map();
  for (const { from, to } of candidates.values()) { outCounts.set(from, (outCounts.get(from) || 0) + 1); inCounts.set(to, (inCounts.get(to) || 0) + 1); }
  const outgoing = new Map(), incoming = new Set();
  for (const { from, to } of candidates.values()) {
    if (outCounts.get(from) > 1 || inCounts.get(to) > 1) { warnings.add('延音事件对应不唯一，已保留独立起音。'); continue; }
    outgoing.set(from, to); incoming.add(to);
  }
  const audioEvents = [];
  events.forEach((event, index) => {
    if (incoming.has(index)) return;
    const chain = [index]; let cursor = index;
    while (outgoing.has(cursor)) { cursor = outgoing.get(cursor); chain.push(cursor); }
    const end = events[chain.at(-1)].end;
    for (const [position, member] of chain.entries()) Object.assign(events[member], { attack: position === 0, soundStart: event.start, soundEnd: end });
    audioEvents.push({ ...event, end, soundEnd: end, noteIds: chain.map(member => events[member].id) });
  });
  audioEvents.sort((a, b) => a.start - b.start);
  return { events, audioEvents, warnings: [...warnings] };
}

// Shared chord stems stay attached until every member in this occurrence releases.
// Only the visual lifetime changes; sounding durations and attack flags stay intact.
export function alignChordVisualEnds(sourceEvents, chords) {
  const events = sourceEvents.map(event => ({ ...event, visualEnd: event.soundEnd ?? event.end }));
  const byId = new Map();
  events.forEach(event => { if (!byId.has(event.id)) byId.set(event.id, []); byId.get(event.id).push(event); });
  for (const ids of chords) {
    const members = ids.flatMap(id => byId.get(id) || []).sort((a, b) => a.start - b.start);
    let occurrence = [];
    const finish = () => {
      const end = Math.max(...occurrence.map(event => event.soundEnd ?? event.end));
      for (const event of occurrence) event.visualEnd = end;
    };
    for (const event of members) {
      if (occurrence.length && Math.abs(event.start - occurrence[0].start) > 1e-6) { finish(); occurrence = []; }
      occurrence.push(event);
    }
    if (occurrence.length) finish();
  }
  return events;
}
