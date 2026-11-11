import { seed } from './timing.mjs';

const IDENTITY = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
const LIMITS = { x: [-10000, 10000], y: [-10000, 10000], rotation: [-7200, 7200], scale: [0, 20], opacity: [0, 1] };
const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) ** 2,
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
};

function object(value, path, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} 必须是 JSON 对象`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path} 含未知字段“${key}”`);
}

function number(value, min, max, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path} 必须是 ${min}～${max} 之间的有限数字`);
  }
  return value;
}

function normalizePhase(value, phase) {
  object(value, phase, phase === 'exit' ? ['enabled', 'delay', 'offset', 'duration', 'easing', 'frames', 'renderer', 'strength', 'strengthY'] : ['enabled', 'offset', 'duration', 'easing', 'frames', 'renderer', 'strength', 'strengthY']);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error(`${phase}.enabled 必须为布尔值`);
  const scattered = ['fragments','classic-fragments','flyin'].includes(value.renderer);
  if (value.renderer !== undefined && !scattered) throw new Error(`${phase}.renderer 仅支持 fragments、classic-fragments 或 flyin`);
  if (value.strength !== undefined && !scattered) throw new Error(`${phase}.strength 仅用于聚散效果`);
  if (value.strengthY !== undefined && value.renderer !== 'flyin') throw new Error(`${phase}.strengthY 仅用于音符聚散`);
  // strengthY 缺省时不写入，求值时继承 strength，旧动画外观保持不变。
  const strength = number(value.strength ?? (value.renderer === 'flyin' ? 100 : phase === 'enter' ? 75 : 65), 0, 5000, `${phase}.strength`);
  const fragment = scattered ? { renderer: value.renderer, strength, ...(value.renderer === 'flyin' && value.strengthY !== undefined ? { strengthY: number(value.strengthY, 0, 5000, `${phase}.strengthY`) } : {}) } : {};
  const duration = number(value.duration, 0.05, 60, `${phase}.duration`);
  const easing = value.easing ?? 'linear';
  if (typeof easing !== 'string' || !Object.hasOwn(EASINGS, easing)) throw new Error(`${phase}.easing 仅支持 linear、easeIn、easeOut、easeInOut`);
  if (!Array.isArray(value.frames) || value.frames.length < 2 || value.frames.length > 64) throw new Error(`${phase}.frames 必须包含 2～64 个关键帧`);
  let previous = { ...IDENTITY, at: -1 };
  const frames = value.frames.map((frame, index) => {
    const path = `${phase}.frames[${index}]`;
    object(frame, path, ['at', ...Object.keys(IDENTITY)]);
    const at = number(frame.at, 0, 1, `${path}.at`);
    if (at <= previous.at) throw new Error(`${path}.at 必须严格递增，不能重复`);
    const result = { at };
    for (const key of Object.keys(IDENTITY)) result[key] = Object.hasOwn(frame, key) ? number(frame[key], ...LIMITS[key], `${path}.${key}`) : previous[key];
    previous = result;
    return result;
  });
  if (frames[0].at !== 0 || frames.at(-1).at !== 1) throw new Error(`${phase}.frames 必须以 at: 0 开始、at: 1 结束`);
  return { ...(value.enabled === undefined ? {} : { enabled: value.enabled }), ...(phase === 'exit' ? { delay: number(value.delay ?? 0, 0, 60, 'exit.delay') } : {}), ...(value.offset === undefined ? {} : { offset: number(value.offset, -120, 120, `${phase}.offset`) }), duration, easing, frames, ...fragment };
}

export function parseMotionProgram(text) {
  if (typeof text !== 'string') throw new Error('动效程序必须是 JSON 文本');
  if (text.length > 32768 || new TextEncoder().encode(text).byteLength > 32768) throw new Error('动效程序不能超过 32 KB');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('JSON 格式不正确，请检查引号、逗号和括号'); }
  object(value, '动效程序', ['version', 'name', 'enter', 'exit']);
  if (value.version !== 1) throw new Error('动效程序 version 必须为 1');
  const name = value.name ?? '自定义动效';
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('name 必须是 1～80 个字符的名称');
  return { version: 1, name: name.trim(), enter: normalizePhase(value.enter, 'enter'), exit: normalizePhase(value.exit, 'exit') };
}

export const defaultMotionProgram = parseMotionProgram(JSON.stringify({
  version: 1,
  name: '轻盈飘散',
  enter: { duration: 0.6, easing: 'easeOut', frames: [{ at: 0, y: 22, opacity: 0 }, { at: 1, y: 0, opacity: 1 }] },
  exit: { delay: 0.1, duration: 1.8, easing: 'easeInOut', frames: [
    { at: 0 },
    { at: 0.45, x: 10, y: -28, rotation: 12, scale: 0.97, opacity: 0.8 },
    { at: 1, x: 34, y: -105, rotation: 48, scale: 0.55, opacity: 0 },
  ] },
}));

// seed is reserved for a future deterministic variation operator; v1 never uses runtime randomness.
export function evaluateMotion(program, phase, progress, seed = 0) {
  if (phase === 'hold') return { ...IDENTITY };
  if (phase !== 'enter' && phase !== 'exit') throw new Error('动效阶段必须是 enter、hold 或 exit');
  if (!Number.isFinite(progress)) throw new Error('动效进度必须是有限数字');
  const p = Math.max(0, Math.min(1, progress));
  const config = program[phase], { frames, easing } = config;
  let index = 0, high = frames.length - 1;
  while (index < high) {
    const middle = (index + high) >>> 1;
    if (frames[middle].at < p) index = middle + 1; else high = middle;
  }
  const right = frames[index];
  const left = frames[Math.max(0, index - 1)];
  const amount = right.at === left.at ? 0 : EASINGS[easing]((p - left.at) / (right.at - left.at));
  const transform = {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    rotation: left.rotation + (right.rotation - left.rotation) * amount,
    scale: left.scale + (right.scale - left.scale) * amount,
    opacity: left.opacity + (right.opacity - left.opacity) * amount,
  };
  if (['fragments','classic-fragments'].includes(config.renderer) && config.enabled !== false) {
    const progress = EASINGS[easing](p);
    transform.fragments = { amount: phase === 'enter' ? 1 - progress : progress, strength: config.strength, ...(config.renderer === 'classic-fragments' ? {style:'classic'} : {}) };
  }
  if (config.renderer === 'flyin' && config.enabled !== false) transform.flyin = { amount: phase === 'enter' ? 1 - p : p, strength: config.strength, strengthY: config.strengthY ?? config.strength };
  return transform;
}

export function motionAt(program, time, start, end, { enter = true, exit = true } = {}) {
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('音符起止时间必须是有限数字，且结束不能早于开始');
  const enterEnd = start + (program.enter.offset ?? 0), exitStart = end + program.exit.delay + (program.exit.offset ?? 0);
  // An early exit wins when the two shifted phases overlap, preventing reappearance.
  if (exit && program.exit.enabled !== false && time >= exitStart) {
    const progress = Math.max(0, Math.min(1, (time - exitStart) / program.exit.duration));
    const transform = evaluateMotion(program, 'exit', progress);
    if (progress >= 1) { delete transform.fragments; delete transform.flyin; }
    return { ...transform, opacity: progress >= 1 ? 0 : transform.opacity, phase: progress >= 1 ? 'gone' : 'exit', progress };
  }
  if (time < enterEnd && enter && program.enter.enabled !== false) {
    const progress = Math.max(0, Math.min(1, (time - enterEnd + program.enter.duration) / program.enter.duration));
    if (time < enterEnd - program.enter.duration) return { ...IDENTITY, opacity: 0, phase: 'waiting', progress: 0 };
    return { ...evaluateMotion(program, 'enter', progress), phase: 'enter', progress };
  }
  return { ...IDENTITY, phase: 'hold', progress: 1 };
}

// The original long-scroll effect is driven by screen position, not note duration.
export function edgeMotionAt(program,time,start,end,{enter=true,x,width,active=false,played=false,enterViewport,exitViewport}={}) {
  const classic=name=>['classic-fragments','flyin'].includes(program[name].renderer)&&program[name].enabled!==false;
  const value=motionAt(program,time,start,end,{enter:enter&&!classic('enter'),exit:!classic('exit')});
  let phase,progress;
  if(width>0){
    const entryState=enterViewport??{x,active,played},exitState=exitViewport??{x,active,played};
    const entry=enter&&!entryState.active&&classic('enter')&&program.enter.strength>0?Math.max(0,Math.min(1,(entryState.x/width-.7)/.3)):0;
    const exit=!exitState.active&&exitState.played&&classic('exit')&&program.exit.strength>0?Math.max(0,Math.min(1,(width*.22-exitState.x)/(width*.22))):0;
    if(exit>.015){phase='exit';progress=exit}
    else if(value.phase==='exit'||value.phase==='gone')return value;
    else if(entry>.015){phase='enter';progress=1-entry}
  }
  if(phase){const transform=evaluateMotion(program,phase,progress);return {...transform,phase,progress,classic:true,opacity:transform.opacity*(played?.65:1)}}
  if(value.phase==='hold'&&played&&(classic('enter')||classic('exit')))value.opacity*=.65;
  return value;
}

// 音符聚散（逆向自 score-scroll.cn）：每个元素持有稳定的随机座位偏移与错峰，
// 飘入距离（水平）50～450、散落范围（垂直）±100；strength/strengthY=100 对应原站 50% 档位，
// 两轴独立可调。入场从右侧聚拢：透明度随进度线性淡入、位移按三次缓出归位；出场向左散开。
export function applyFlyin(transform, key) {
  const fly = transform.flyin;
  if (!fly) return transform;
  const exit = transform.phase === 'exit', stagger = seed(key + 'd') * .4, full = 1 - stagger;
  // 入场：错峰音符在窗口前段保持透明，随后在剩余窗口内聚拢，全部于窗口末尾归位。
  // 出场：错峰音符先保持原位，随后在剩余窗口内散开，全部于窗口末尾消失。
  const t = exit ? Math.max(0, Math.min(1, (fly.amount - stagger) / full)) : Math.min(1, fly.amount / full);
  const travel = t * t * t / 100;
  transform.x += (exit ? -1 : 1) * (50 + seed(key) * 400) * fly.strength * travel;
  transform.y += (seed(key + 'v') - .5) * 200 * (fly.strengthY ?? fly.strength) * travel;
  transform.opacity *= 1 - t;
  delete transform.flyin;
  return transform;
}
