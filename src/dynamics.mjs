const children = (node, name) => [...(node?.children || [])].filter(item => !name || item.localName === name);
const child = (node, name) => children(node, name)[0];
const text = (node, name, fallback = '') => child(node, name)?.textContent?.trim() || fallback;
const levels = { pppppp:8, ppppp:12, pppp:16, ppp:24, pp:36, p:48, mp:64, mf:80, f:96, ff:112, fff:120, ffff:124, fffff:126, ffffff:127 };
const EPSILON = 1e-7;

// Read the prepared source IDs: Verovio's element and timemap APIs omit velocity.
export function extractMusicXMLDynamics(doc) {
  const velocities = new Map(), warnings = new Set();
  const numeric = raw => {
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    if (!String(raw).trim() || !Number.isFinite(value) || value < 0) {
      warnings.add('部分数字力度无效，已忽略并沿用有效力度。');
      return null;
    }
    // MusicXML expresses dynamics as a percentage of MIDI forte velocity 90.
    return Math.min(127, Math.round(value * 0.9));
  };
  for (const part of children(doc.documentElement || doc, 'part')) {
    let divisions = 1, meterDuration = 4;
    const active = [];
    for (const measure of children(part, 'measure')) {
      let cursor = 0, lastOnset = 0, furthest = 0;
      const entries = [];
      const durationOf = node => {
        const value = Number(text(node, 'duration')) / divisions;
        if (Number.isFinite(value) && value >= 0) return value;
        warnings.add('部分力度位置的音符时值无效，已按零时值处理。');
        return 0;
      };
      const addMark = (node, sound = null) => {
        const types = children(node, 'direction-type');
        if (types.some(type => child(type, 'wedge'))) warnings.add('渐强／渐弱发夹尚未转换为连续力度；目前执行明确的力度标记。');
        const signs = types.flatMap(type => children(type, 'dynamics')).flatMap(dynamic => children(dynamic));
        let velocity = numeric(sound?.getAttribute('dynamics'));
        if (velocity === null) {
          const supported = signs.filter(sign => Object.hasOwn(levels, sign.localName));
          if (supported.length === 1 && signs.length === 1) velocity = levels[supported[0].localName];
          if (supported.length > 1 || signs.some(sign => !Object.hasOwn(levels, sign.localName))) warnings.add('部分突强或复合力度标记尚未转换为演奏力度，请补充 sound dynamics 数值。');
        }
        if (velocity === null) return;
        if (sound?.getAttribute('time-only')) {
          warnings.add('带 time-only 反复次数限制的力度暂未应用，请核对重复段的力度。');
          return;
        }
        const soundOffset = child(sound, 'offset'), directionOffset = child(node, 'offset');
        const offset = soundOffset || (directionOffset?.getAttribute('sound') === 'yes' ? directionOffset : null);
        const quarter = cursor + (offset ? Number(offset.textContent) / divisions : 0);
        entries.push({ kind:'mark', quarter, velocity, staff:text(node, 'staff'), voice:text(node, 'voice') });
      };
      for (const node of children(measure)) {
        if (node.localName === 'attributes') {
          const raw = text(node, 'divisions'), value = Number(raw);
          if (raw && Number.isFinite(value) && value > 0) divisions = value;
          else if (raw) warnings.add('部分力度位置的 divisions 无效，已沿用前值。');
          const time = child(node, 'time');
          let beats = 0, duration = 0;
          for (const item of children(time)) {
            if (item.localName === 'beats') beats = item.textContent.split('+').reduce((sum, value) => sum + Number(value), 0);
            if (item.localName === 'beat-type') duration += beats * 4 / Number(item.textContent);
          }
          if (Number.isFinite(duration) && duration > 0) meterDuration = duration;
        } else if (node.localName === 'direction') addMark(node, child(node, 'sound'));
        else if (node.localName === 'sound') addMark(node, node);
        else if (node.localName === 'backup') {
          cursor -= durationOf(node);
          if (cursor < -EPSILON) warnings.add('部分力度位置的 backup 超出小节，已限制到小节起点。');
          cursor = Math.max(0, cursor);
        } else if (node.localName === 'forward') {
          cursor += durationOf(node);
          furthest = Math.max(furthest, cursor);
        } else if (node.localName === 'note') {
          const duration = child(node, 'grace') ? 0 : durationOf(node);
          const quarter = child(node, 'chord') ? lastOnset : cursor;
          if (!child(node, 'chord')) { lastOnset = cursor; cursor += duration; }
          furthest = Math.max(furthest, cursor, quarter + duration);
          if (!child(node, 'rest')) entries.push({ kind:'note', quarter, id:node.getAttribute('id') || node.getAttribute('xml:id'),
            staff:text(node, 'staff', '1'), voice:text(node, 'voice', '1'), velocity:numeric(node.getAttribute('dynamics')) });
        }
      }
      const duration = furthest || meterDuration;
      const valid = entries.filter(entry => {
        if (Number.isFinite(entry.quarter) && entry.quarter >= -EPSILON && entry.quarter <= duration + EPSILON) return true;
        warnings.add('部分力度偏移无效或超出小节，已忽略。');
        return false;
      });
      // Sort before assigning: XML stores voices sequentially with backup commands.
      valid.sort((a, b) => a.quarter - b.quarter || Number(a.kind === 'note') - Number(b.kind === 'note'));
      for (const entry of valid) {
        if (entry.kind === 'mark') { active.push(entry); continue; }
        let velocity = entry.velocity;
        if (velocity === null) for (let index = active.length - 1; index >= 0; index--) {
          const mark = active[index];
          if ((!mark.staff || mark.staff === entry.staff) && (!mark.voice || mark.voice === entry.voice)) {
            velocity = mark.velocity; break;
          }
        }
        if (entry.id) velocities.set(entry.id, velocity ?? 80);
      }
    }
  }
  return { velocities, warnings:[...warnings] };
}
