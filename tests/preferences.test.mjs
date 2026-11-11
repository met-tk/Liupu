import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, UI_THEMES, LANGUAGES, parsePreferences } from '../src/preferences.mjs';
import { translate, messages } from '../src/i18n.mjs';
import { builtinPresets, createStudioSettings, applyVisualPreset, parsePreset, makePreset, presetFingerprint } from '../src/composition.mjs';
import { visualDefaults } from '../src/visual-defaults.mjs';

test('preferences default to Chinese monochrome and accept only supported options',()=>{
  assert.deepEqual(DEFAULT_PREFERENCES,{language:'zh',theme:'mono'});
  for(const language of LANGUAGES)for(const theme of UI_THEMES)assert.deepEqual(parsePreferences({language,theme,extra:1}),{language,theme});
  for(const value of [null,[],{},true,{language:'fr',theme:'mono'},{language:'en',theme:'dark'}])assert.throws(()=>parsePreferences(value));
});

test('catalog has three translations with matching placeholders and no duplicate keys',()=>{
  const keys=new Set(),variables=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  for(const row of messages){
    assert.ok(!keys.has(row[0]),`Duplicate: ${row[0]}`);keys.add(row[0]);
    for(const text of row.slice(1)){assert.ok(text.trim(),row[0]);assert.deepEqual(variables(text),variables(row[0]),row[0])}
    assert.ok(!/\p{Script=Han}/u.test(row[2]),row[0]);
  }
});

test('dynamic messages translate nested errors but preserve user names',()=>{
  assert.equal(translate('正在编辑：音符与背景','en'),'Editing: 音符与背景');
  assert.equal(translate('保存失败：预设库大小超出限制','en'),'Save failed: Preset library size limit exceeded');
  assert.equal(translate('已检测 2 类常用标记的图形输出：调号、延音线。 需目视复核：琶音。','en'),'Detected 2 notation types: Key signature、Ties. Check visually: Arpeggios.');
  assert.match(translate('第 4 小节的数字速度无效，已忽略。','en'),/invalid tempo ignored/);
});

test('eight independent presets increase effect density and clean preset disables decorative effects',()=>{
  const presets=builtinPresets(visualDefaults);
  assert.equal(presets.length,8);
  const glow=presets.map(p=>{const s=createStudioSettings(visualDefaults);applyVisualPreset(s,p);return s.glow});
  assert.deepEqual(glow,[0,15,30,35,40,45,60,75]);
  const clean=createStudioSettings(visualDefaults);applyVisualPreset(clean,presets[0]);
  for(const key of ['glow','bloom','particles','trail','decayParticles','scanGlow','scanBloom'])assert.equal(clean[key],0,key);
  assert.equal(clean.pageDecay,'none');assert.equal(clean.motionProgram.enter.enabled,false);assert.equal(clean.motionProgram.exit.enabled,false);
  for(const p of presets)assert.deepEqual(parsePreset(JSON.stringify(p),visualDefaults),p);
  clean.composition.nodes[0].name='音符与背景';clean.composition.nodes[0].userNamed=true;
  assert.equal(parsePreset(JSON.stringify(makePreset(clean,'自定义')),visualDefaults).composition.nodes[0].userNamed,true);
  assert.equal(presetFingerprint(clean),presetFingerprint(parsePreset(JSON.stringify(makePreset(clean,'自定义')),visualDefaults)));
});
