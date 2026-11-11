import { defaultMotionProgram, evaluateMotion, parseMotionProgram } from './motion-program.mjs';
import { defaultScoreProgram, effectPresets, identifyPreset, presetPhase } from './effect-library.mjs';
import { emptyProgram } from './composition.mjs';
import { t } from './i18n.mjs';

export function bindEffectEditor(settings, { changed, download, locked }) {
  const $ = id => document.getElementById(id);
  let target = 'note', frameIndex = 0;
  const drafts = new Map();
  const draftKey = () => (settings.composition?.activeId || 'score') + ':' + target;
  const key = () => target === 'note' ? 'motionProgram' : target==='group'?'groupMotionProgram':target==='mark'?'markMotionProgram':'scoreMotionProgram';
  const activeKey = () => target === 'note' ? 'motionProgramActive' : target==='group'?'groupProgramActive':target==='mark'?'markProgramActive':'scoreProgramActive';
  const decayKey = key => target==='mark'?'mark'+key[0].toUpperCase()+key.slice(1):key;
  const program = () => settings[key()];
  const phase = () => $('effectPhase').value;
  const message = (text, error = false) => { $('motionMessage').textContent = text; $('motionMessage').dataset.error = error; $('motionCode').setAttribute('aria-invalid', String(error)); };
  const fields = { frameAt: ['at', 100], frameX: ['x', 1], frameY: ['y', 1], frameRotation: ['rotation', 1], frameScale: ['scale', 100], frameOpacity: ['opacity', 100] };
  for (const name of ['enter', 'exit']) {
    for (const [id, label] of [...effectPresets, ['custom', '自定义关键帧']]) {
      const option = new Option(label.replace(' / 淡出', '').replace('淡入', name === 'enter' ? '淡入' : '淡出'), id);
      option.disabled = id === 'custom'; $(name + 'Preset').add(option);
    }
  }
  const fragmentControls = document.createElement('div');
  fragmentControls.id = 'fragmentStrengthControls'; fragmentControls.className = 'compact-pair';
  for (const [name, text, prop, suffix, title] of [
    ['enter', '飘入距离（%）', 'strength', 'Strength', '100% 为标准强度，最高 50 倍；设为 0 可关闭水平位移。'],
    ['exit', '消散强度（%）', 'strength', 'Strength', '100% 为标准强度，最高 50 倍；设为 0 可关闭水平位移。'],
    ['enter', '垂直散落（%）', 'strengthY', 'StrengthY', '音符聚散专属：独立控制垂直散落幅度，100% 为标准；设为 0 关闭垂直位移。未单独设置时跟随强度。'],
    ['exit', '垂直散落（%）', 'strengthY', 'StrengthY', '音符聚散专属：独立控制垂直散落幅度，100% 为标准；设为 0 关闭垂直位移。未单独设置时跟随强度。'],
  ]) {
    const label = document.createElement('label'), heading = document.createElement('span'), input = document.createElement('input');
    label.id = name + suffix + 'Field'; label.className = 'field'; label.hidden = true; heading.textContent = text;
    input.id = name + suffix; input.type = 'number'; input.min = '0'; input.max = '5000'; input.step = '5';
    input.title = title;
    input.onchange = () => updateNumber(input, p => { p[name][prop] = input.valueAsNumber; });
    label.append(heading, input); fragmentControls.append(label);
  }
  $('enterDuration').closest('.compact-pair').after(fragmentControls);
  function syncFrames() {
    const value = program()[phase()], frames = value.frames;
    frameIndex = Math.min(frameIndex, frames.length - 1);
    $('effectEasing').value = value.easing;
    $('keyframeTrack').replaceChildren(...frames.map((frame, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `${Math.round(frame.at * 1000) / 10}%`;
      button.setAttribute('aria-label', `关键帧 ${index + 1}，进度 ${button.textContent}`); button.setAttribute('aria-pressed', String(index === frameIndex));
      button.onclick = () => { frameIndex = index; syncFrames(); }; return button;
    }));
    for (const [id, [prop, factor]] of Object.entries(fields)) { $(id).value = Math.round(frames[frameIndex][prop] * factor * 1000) / 1000; $(id).setCustomValidity(''); }
    $('frameAt').disabled = frameIndex === 0 || frameIndex === frames.length - 1;
    $('removeKeyframe').disabled = $('frameAt').disabled;
    $('addKeyframe').disabled = frames.length >= 64;
  }
  function sync() {
    const p = program(), note = target === 'note',group=target==='group',structure=target==='score'||target==='mark';
    for(const id of ['pageDecay','decayTrigger','decayOffset','decayDelay','decayDuration'])$(id).value=settings[decayKey(id)];
    $('decayTiming').hidden=settings[decayKey('decayTrigger')]==='progress';
    $('ledgerMotionField').hidden=!note;
    const edge=name=>note&&settings.layout==='strip'&&['classic-fragments','flyin'].includes(p[name].renderer)&&p[name].enabled!==false;
    $('motionProgramActive').checked = settings[activeKey()]; $('noteTimingControls').hidden = !note;
    $('effectEnabledLabel').textContent = '启用当前对象动画';
    for (const name of ['enter', 'exit']) {
      $(name + 'Preset').value = identifyPreset(p[name], name); $(name + 'Duration').value = p[name].duration; $(name + 'Duration').disabled = p[name].enabled === false;
      $(name + 'StrengthField').hidden = !['fragments','classic-fragments','flyin'].includes(p[name].renderer) || p[name].enabled === false;
      $(name + 'StrengthYField').hidden = p[name].renderer !== 'flyin' || p[name].enabled === false;
      $(name + 'Strength').value = p[name].strength ?? (name === 'enter' ? 75 : 65);
      $(name + 'StrengthY').value = p[name].strengthY ?? $(name + 'Strength').value;
      $(name + 'Duration').closest('label').hidden = edge(name) || name==='exit'&&structure;
      $(name + 'Offset').value = p[name].offset ?? 0;
      $(name + 'Offset').closest('label').hidden = p[name].enabled === false || name === 'exit' && structure || name === 'enter' && note && settings.noteArrival !== 'assemble';
    }
    $('animationOffsetControls').hidden = ['enter','exit'].every(name => $(name+'Offset').closest('label').hidden);
    $('animationOffsetHelp').hidden = $('animationOffsetControls').hidden;
    $('animationOffsetHelp').textContent = structure
      ? '负值提前，正值延后，范围 −120～120 秒。出场时间请在下方「出场 / 消解偏移」调整。'
      : '负值提前，正值延后，范围 −120～120 秒。只调整动画时机；' + (edge('exit') ? '画面聚散按偏移后的画面进度计算。' : '出场偏移与等待时间相加。');
    fragmentControls.hidden = ['enterStrengthField', 'exitStrengthField', 'enterStrengthYField', 'exitStrengthYField'].every(id => $(id).hidden);
    $('exitDelay').value = p.exit.delay; $('exitDelayField').hidden = !note&&!group||edge('exit');
    $('noteExitTrigger').closest('label').hidden=edge('exit');
    $('noteArrival').querySelector('[value="assemble"]').textContent=edge('enter')?'从画面右侧聚拢':'临近演奏时入场';
    if (structure) $('exitDuration').disabled = settings[decayKey('decayTrigger')] === 'progress' || p.exit.enabled === false;
    $('effectHint').textContent = note
      ? (settings.motionProgramActive ? edge('enter')||edge('exit')?'画面聚散：入场在画面右侧聚拢，奏完后移至左侧再散开。由画面位置驱动；多行排版改用演奏时序。其他阶段按所选效果执行。':'按每个音符的演奏时刻播放；选择入场效果会开启临近演奏时入场。' : '音符动画已关闭。选择效果即可启用入场与出场。')
      : group?'整组或整个图层统一变换；入场从曲首开始，出场从曲终开始。子元素动画保留。':target==='mark'?'标记独立动画，连线、文字与符号的全部图形一起生效。':'仅影响五线谱线；与标记动画独立。';
    $('motionCode').value = drafts.get(draftKey()) ?? JSON.stringify(p, null, 2);
    syncFrames();
  }
  function commit(p, text = '效果已应用，预览已更新。') {
    if (locked()) return;
    const value = parseMotionProgram(JSON.stringify(p));
    settings[key()] = value; settings[activeKey()] = true;
    if (target === 'score'||target==='mark') { settings[decayKey('decayDuration')] = value.exit.duration;settings[decayKey('decayOffset')]=Math.max(-120,Math.min(120,settings[decayKey('decayOffset')]+value.exit.delay+(value.exit.offset??0)));settings[decayKey('decayDelay')]=0;value.exit.delay=0;delete value.exit.offset; }
    drafts.delete(draftKey()); message(text); changed(); sync();
  }
  $('effectTarget').onchange = e => { if (drafts.has(draftKey())) drafts.set(draftKey(), $('motionCode').value); target = e.target.value; frameIndex = 0; sync(); message(drafts.has(draftKey()) ? '此对象有未应用的 JSON 修改。' : '正在编辑' + (target === 'note' ? '音符与符杠。' : target==='group'?'当前组或图层。':target==='mark'?'记谱标记。':'五线谱线。')); };
  $('effectPhase').onchange = () => { frameIndex = 0; syncFrames(); };
  $('motionProgramActive').onchange = e => { settings[activeKey()] = e.target.checked; changed(); sync(); };
  for (const name of ['enter', 'exit']) {
    $(name + 'Preset').onchange = e => {
      const p = structuredClone(program()); p[name] = presetPhase(e.target.value, name, p[name]);
      p.name = target === 'note' ? '自定义音符动画' : '自定义谱面动画';
      if (target === 'note' && name === 'enter') settings.noteArrival = e.target.value === 'none' ? 'visible' : 'assemble';
      commit(p); frameIndex = 0; syncFrames();
    };
    $(name + 'Duration').onchange = e => updateNumber(e.target, p => { p[name].duration = e.target.valueAsNumber; });
    $(name + 'Offset').onchange = e => updateNumber(e.target, p => { p[name].offset = e.target.valueAsNumber; });
  }
  function updateNumber(input, mutate) {
    if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) { input.reportValidity(); sync(); return; }
    try { const p = structuredClone(program()); mutate(p); commit(p); } catch (error) { message(error.message, true); input.setCustomValidity(t(error.message)); input.reportValidity(); }
  }
  $('exitDelay').onchange = e => updateNumber(e.target, p => { p.exit.delay = e.target.valueAsNumber; });
  $('effectEasing').onchange = e => { const p = structuredClone(program()); p[phase()].easing = e.target.value; commit(p); };
  for (const [id, [prop, factor]] of Object.entries(fields)) {
    $(id).oninput = () => $(id).setCustomValidity('');
    $(id).onchange = e => updateNumber(e.target, p => { p[phase()].frames[frameIndex][prop] = e.target.valueAsNumber / factor; p[phase()].enabled = true; });
  }
  $('addKeyframe').onclick = () => {
    const p = structuredClone(program()), frames = p[phase()].frames;
    if (frames.length >= 64) return;
    const i = Math.min(frameIndex, frames.length - 2), at = (frames[i].at + frames[i + 1].at) / 2;
    const evaluated = evaluateMotion(program(), phase(), at);
    const transform = Object.fromEntries(['x', 'y', 'rotation', 'scale', 'opacity'].map(key => [key, evaluated[key]]));
    frames.splice(i + 1, 0, { at, ...transform }); frameIndex = i + 1; commit(p);
  };
  $('removeKeyframe').onclick = () => { const p = structuredClone(program()); if (frameIndex <= 0 || frameIndex >= p[phase()].frames.length - 1) return; p[phase()].frames.splice(frameIndex, 1); frameIndex--; commit(p); };
  $('motionCode').oninput = () => { drafts.set(draftKey(), $('motionCode').value); message('JSON 尚未应用；当前预览保留上次有效效果。'); };
  $('applyMotion').onclick = () => { try { commit(parseMotionProgram($('motionCode').value)); } catch (error) { message(error.message, true); } };
  $('resetMotion').onclick = () => commit(structuredClone(target === 'note' ? defaultMotionProgram : target==='group'?emptyProgram():defaultScoreProgram), '当前对象的关键帧已恢复默认。');
  $('importMotion').onclick = () => $('motionFile').click();
  $('motionFile').onchange = async e => {
    const file = e.target.files[0], destination = draftKey(); e.target.value = ''; if (!file || locked()) return;
    try { if (file.size > 32768) throw new Error('效果 JSON 最多 32 KB。'); const text = await file.text(); if (destination !== draftKey() || locked()) return; commit(parseMotionProgram(text), '已导入效果，可继续编辑关键帧。'); } catch (error) { message(error.message, true); }
  };
  $('exportMotion').onclick = () => { try { const p = parseMotionProgram($('motionCode').value); download(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), `流谱-${target === 'note' ? '音符' : '谱面'}效果.json`); message('已保存当前对象的效果 JSON。'); } catch (error) { message(error.message, true); } };
  sync();
  return { sync,decayKey,selectTarget(value){target=value;$('effectTarget').value=value;frameIndex=0;sync()},applyPhase(value,name){const p=structuredClone(program());p[name]=value;if(target==='note'&&name==='enter')settings.noteArrival='assemble';commit(p)},reset() { drafts.clear(); frameIndex = 0; sync(); message('效果已重置。'); } };
}
