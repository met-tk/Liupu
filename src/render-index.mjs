// Keep paint order while limiting scroll frames to objects whose source bounds
// can reach the viewport. The score geometry is immutable after loading.
export function horizontalIndex(items, boxOf = item => item.box) {
  let maxWidth = 0;
  const entries = Array.from(items, (item, order) => {
    const box = boxOf(item);
    maxWidth = Math.max(maxWidth, box.w);
    return {item, order, x:box.x, end:box.x + box.w};
  });
  entries.sort((a,b) => a.x - b.x);
  return {entries, maxWidth};
}

export function horizontalSlice(index, left, right) {
  const {entries, maxWidth} = index;
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].x < left - maxWidth) lo = mid + 1; else hi = mid;
  }
  const visible = [];
  for (let i = lo; i < entries.length && entries[i].x <= right; i++) {
    if (entries[i].end >= left) visible.push(entries[i]);
  }
  visible.sort((a,b) => a.order - b.order);
  return visible.map(entry => entry.item);
}

export function motionPadding(settings, glyphSize, halo) {
  if (!settings.motionProgramActive) return 220;
  const effects = Math.max(halo * 4, (settings.trail ?? 0) * 1.65, 240);
  let padding = Math.max(220, glyphSize + effects);
  for (const phase of ['enter','exit']) {
    const config = settings.motionProgram?.[phase];
    if (!config || config.enabled === false) continue;
    // Edge motion evaluates a second camera for temporal offsets. An object
    // outside this frame can enter through that camera, so preserve the old
    // full traversal for this uncommon configuration.
    if (config.offset && ['classic-fragments','flyin'].includes(config.renderer)) return Infinity;
    // All supported easings stay between their keyframes. Fall back to full
    // traversal for future renderers/easings whose reach is not known here.
    if (!['linear','easeIn','easeOut','easeInOut'].includes(config.easing) ||
        config.renderer && !['fragments','classic-fragments','flyin'].includes(config.renderer)) return Infinity;
    let shift = 0, zoom = 1;
    for (const frame of config.frames) {
      shift = Math.max(shift, Math.abs(frame.x ?? 0));
      zoom = Math.max(zoom, frame.scale ?? 1);
    }
    // 500 covers the diagonal travel of every fragment and the full 450-unit
    // fly-in displacement. The glyph diagonal also bounds any rotation.
    const travel = config.renderer ? 500 * (config.strength ?? 100) / 100 : 0;
    padding = Math.max(padding, shift + zoom * (glyphSize + travel + effects));
  }
  return padding;
}
