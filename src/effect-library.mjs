import { parseMotionProgram, defaultMotionProgram } from './motion-program.mjs';

// Reusable data, never executable plug-in code. Both targets share these phases.
export const effectPresets = [
  ['none', '保持原样'], ['classic', '碎片聚散'], ['flyin', '音符聚散'], ['fade', '淡入 / 淡出'], ['scatter', '音符裂解'], ['float', '轻盈飘移'],
  ['slide', '横向滑动'], ['rise', '上升漂移'], ['zoom', '缩放聚散'],
  ['spin', '旋转聚散'], ['bounce', '弹性缩放'],
  ['slide-right', '向右滑动'], ['drop', '下落漂移'], ['diagonal', '斜向飞掠'],
  ['swing', '摇摆归位'], ['spring', '弹簧滑移'], ['spiral', '螺旋聚散'],
  ['pulse', '呼吸脉冲'], ['flicker', '闪烁渐变'], ['arc', '弧线飞行'], ['shrink', '收拢缩放'],
];

export function presetPhase(id, phase, { duration = phase === 'enter' ? .6 : 1.8, delay = .1, offset, easing = phase === 'enter' ? 'easeOut' : 'easeInOut', strength, strengthY } = {}) {
  if (!effectPresets.some(([key]) => key === id)) throw new Error('未知动画预设');
  if (!['enter', 'exit'].includes(phase)) throw new Error('未知动画阶段');
  const entrance = phase === 'enter';
  const settled = { at: 1, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
  let frames;
  switch (id) {
    case 'classic': case 'scatter': case 'flyin': frames = [{ at: 0 }, { at: 1 }]; break;
    case 'float': frames = structuredClone(defaultMotionProgram[phase].frames); break;
    case 'slide': frames = entrance ? [{ at: 0, x: 130, opacity: 0 }, { at: 1, x: 0, opacity: 1 }] : [{ at: 0 }, { at: 1, x: -180, opacity: 0 }]; break;
    case 'rise': frames = entrance ? [{ at: 0, y: 90, opacity: 0 }, { at: 1, y: 0, opacity: 1 }] : [{ at: 0 }, { at: 1, y: -150, opacity: 0 }]; break;
    case 'zoom': frames = entrance ? [{ at: 0, scale: .15, opacity: 0 }, { at: 1, scale: 1, opacity: 1 }] : [{ at: 0 }, { at: 1, scale: 1.8, opacity: 0 }]; break;
    case 'spin': frames = entrance ? [{ at: 0, rotation: -160, scale: .2, opacity: 0 }, { at: 1, rotation: 0, scale: 1, opacity: 1 }] : [{ at: 0 }, { at: 1, rotation: 200, scale: .1, opacity: 0 }]; break;
    case 'bounce': frames = entrance ? [{ at: 0, scale: .2, opacity: 0 }, { at: .65, scale: 1.2, opacity: 1 }, { at: 1, scale: 1 }] : [{ at: 0 }, { at: .25, scale: 1.15 }, { at: 1, scale: .1, opacity: 0 }]; break;
    case 'slide-right': frames = entrance ? [{ at: 0, x: -180, opacity: 0 }, settled] : [{ at: 0 }, { at: 1, x: 220, opacity: 0 }]; break;
    case 'drop': frames = entrance ? [{ at: 0, y: -130, opacity: 0 }, settled] : [{ at: 0 }, { at: 1, y: 180, opacity: 0 }]; break;
    case 'diagonal': frames = entrance ? [{ at: 0, x: 150, y: -100, rotation: -18, opacity: 0 }, settled] : [{ at: 0 }, { at: 1, x: -200, y: 140, rotation: 28, opacity: 0 }]; break;
    case 'swing': frames = entrance ? [{ at: 0, rotation: -65, y: -24, opacity: 0 }, { at: .5, rotation: 18, y: 0, opacity: 1 }, { at: .78, rotation: -7 }, settled] : [{ at: 0 }, { at: .22, rotation: -14 }, { at: .48, rotation: 24 }, { at: 1, rotation: -90, y: 80, opacity: 0 }]; break;
    case 'spring': frames = entrance ? [{ at: 0, x: 210, opacity: 0 }, { at: .52, x: -28, opacity: 1 }, { at: .76, x: 12 }, settled] : [{ at: 0 }, { at: .22, x: 18 }, { at: .42, x: -30 }, { at: 1, x: 240, opacity: 0 }]; break;
    case 'spiral': frames = entrance ? [{ at: 0, x: 70, y: -80, rotation: -540, scale: .1, opacity: 0 }, { at: .5, x: -30, y: 30, rotation: -160, scale: .7, opacity: .85 }, settled] : [{ at: 0 }, { at: .5, x: 30, y: -30, rotation: 180, scale: .75, opacity: .8 }, { at: 1, x: -80, y: -110, rotation: 540, scale: .05, opacity: 0 }]; break;
    case 'pulse': frames = entrance ? [{ at: 0, scale: .6, opacity: 0 }, { at: .35, scale: 1.15, opacity: .75 }, { at: .6, scale: .9, opacity: 1 }, { at: .82, scale: 1.05 }, settled] : [{ at: 0 }, { at: .25, scale: 1.1 }, { at: .5, scale: .85, opacity: .8 }, { at: .72, scale: 1.15, opacity: .5 }, { at: 1, scale: .6, opacity: 0 }]; break;
    case 'flicker': frames = entrance ? [{ at: 0, opacity: 0 }, { at: .22, opacity: .7 }, { at: .36, opacity: .15 }, { at: .57, opacity: .9 }, { at: .7, opacity: .45 }, settled] : [{ at: 0 }, { at: .2, opacity: .3 }, { at: .38, opacity: .85 }, { at: .6, opacity: .15 }, { at: .76, opacity: .55 }, { at: 1, opacity: 0 }]; break;
    case 'arc': frames = entrance ? [{ at: 0, x: 200, y: 55, rotation: 25, opacity: 0 }, { at: .5, x: 80, y: -65, rotation: -12, opacity: .85 }, settled] : [{ at: 0 }, { at: .5, x: -80, y: -85, rotation: -16, opacity: .8 }, { at: 1, x: -220, y: 55, rotation: -45, opacity: 0 }]; break;
    case 'shrink': frames = entrance ? [{ at: 0, scale: 2.5, opacity: 0 }, settled] : [{ at: 0 }, { at: 1, scale: 0, opacity: 0 }]; break;
    default: frames = [{ at: 0, opacity: entrance ? 0 : 1 }, { at: 1, opacity: entrance ? 1 : 0 }];
  }
  const resolvedStrength = strength ?? (id === 'flyin' ? 100 : phase === 'enter' ? 75 : 65);
  const program = structuredClone(defaultMotionProgram);
  program[phase] = { enabled: id !== 'none', duration, ...(offset === undefined ? {} : { offset }), easing: ['classic', 'flyin'].includes(id) ? 'linear' : easing, ...(entrance ? {} : { delay }), frames, ...(id === 'flyin' ? { renderer: 'flyin', strength: resolvedStrength, ...(strengthY === undefined ? {} : { strengthY }) } : ['classic', 'scatter'].includes(id) ? { renderer: id === 'classic' ? 'classic-fragments' : 'fragments', strength: resolvedStrength } : {}) };
  return parseMotionProgram(JSON.stringify(program))[phase];
}

export const defaultScoreProgram = parseMotionProgram(JSON.stringify({ version: 1, name: '谱面动画', enter: presetPhase('none', 'enter'), exit: presetPhase('none', 'exit', { duration: 2.4, delay: .45 }) }));

export function identifyPreset(phase, name) {
  if (phase.enabled === false) return 'none';
  return effectPresets.find(([id]) => {
    if (id === 'none') return false;
    const candidate = presetPhase(id, name);
    return candidate.renderer === phase.renderer && JSON.stringify(candidate.frames) === JSON.stringify(phase.frames);
  })?.[0] || 'custom';
}
