import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {connect} from './qa-cdp.mjs';
const qa=await connect(9336,{fresh:true}),out='artifacts/elements-qa';await mkdir(out,{recursive:true});
try{
  await qa.send('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  for(let i=0;i<150;i++){if(await qa.evaluate("!!document.getElementById('play')&&!document.getElementById('play').disabled"))break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(await qa.evaluate("document.getElementById('play').disabled"),false);
  await qa.evaluate(`(async()=>{
    const {visualDefaults}=await import('./visual-defaults.mjs'),{createStudioSettings,makePreset}=await import('./composition.mjs');
    const legacy=makePreset(createStudioSettings(visualDefaults),'QA 旧版预设');legacy.version=1;
    localStorage.setItem('liupu.visual-presets.v1',JSON.stringify([legacy]));for(const version of [2,3,4,5])localStorage.removeItem('liupu.visual-presets.v'+version);
  })()`);
  await qa.send('Page.reload');
  for(let i=0;i<150;i++){if(await qa.evaluate("!!document.getElementById('play')&&!document.getElementById('play').disabled"))break;await new Promise(r=>setTimeout(r,100))}
  const result=await qa.evaluate(`(async()=>{
    const $=id=>document.getElementById(id),visible=id=>!!$(id)&&!$(id).closest('[hidden]'),pick=name=>{const b=[...document.querySelectorAll('.node-pick')].find(b=>b.dataset.name===name);if(!b)throw Error('Missing element '+name);b.click()},set=(id,v)=>{$(id).value=v;$(id).dispatchEvent(new Event('change',{bubbles:true}))};
    const legacyBefore=localStorage.getItem('liupu.visual-presets.v1');$('browsePresets').click();const migratedLibrary=$('libraryItems').innerText.includes('QA 旧版预设');$('closeLibrary').click();
    $('resetStyle').click();$('splitElements').click();
    const names=[...document.querySelectorAll('.node-pick')].map(b=>b.dataset.name),capabilities={};
    for(const name of names){pick(name);capabilities[name]={sections:[...document.querySelectorAll('.studio-section')].filter(d=>!d.hidden).map(d=>d.id),fields:['noteColor','beamColor','staffColor','markColor','glow','scanLength','titleInput','backgroundColor','theme','enterStrength','exitStrength'].filter(visible),targets:[...$('effectTarget').options].filter(o=>!o.hidden).map(o=>o.value)}}
    pick('音符');const validCode=$('motionCode').value;$('motionCode').value='invalid note draft';$('motionCode').dispatchEvent(new Event('input',{bubbles:true}));pick('符杠');const draftIsolated=$('motionCode').value!=='invalid note draft';pick('音符');const draftRestored=$('motionCode').value==='invalid note draft';$('motionCode').value=validCode;$('applyMotion').click();
    set('enterPreset','scatter');set('exitPreset','scatter');set('enterStrength',2500);set('exitStrength',5000);set('enterDuration',30);set('exitDuration',60);set('exitDelay',60);
    $('addKeyframe').click();const fragments=JSON.parse($('motionCode').value),strengthVisible=visible('enterStrength')&&visible('exitStrength');
    set('enterPreset','fade');const changed=JSON.parse($('motionCode').value),strengthHidden=!visible('enterStrength')&&visible('exitStrength');
    pick('谱头');set('studio-headerMode','flow');const headerMode=$('studio-headerMode').value;set('studio-x',12);$('undoVisual').click();const undo=$('studio-x').value;$('redoVisual').click();const redo=$('studio-x').value;
    pick('乐谱组合');const fold=document.querySelector('.composition-node[data-active=true] .node-fold');fold.click();const collapsedCount=$('nodeList').children.length;document.querySelector('.composition-node[data-active=true] .node-fold').click();
    $('multiSelect').click();pick('音符');pick('演奏光效');const multi=$('selectionCount').textContent,canGroup=!$('groupSelected').disabled;$('groupSelected').click();const grouped=$('effectTarget').value==='group'&&$('multiActions').hidden;
    $('saveVisual').click();$('visualName').value='QA 元素动效';$('confirmVisualSave').click();for(let i=0;i<100&&$('confirmVisualSave').disabled;i++)await new Promise(r=>setTimeout(r,30));const newLibrary=JSON.parse(localStorage.getItem('liupu.visual-presets.v5')),saved=newLibrary.find(p=>p.name==='QA 元素动效'),legacyUnchanged=legacyBefore===localStorage.getItem('liupu.visual-presets.v1'),migrationSaved=newLibrary.some(p=>p.name==='QA 旧版预设'&&p.version===5);
    $('browsePresets').click();[...$('libraryItems').children].find(b=>b.innerText.startsWith('QA 元素动效')).click();$('applyLibrary').click();const restoredCount=$('nodeCount').textContent;
    pick('扫描线');set('scanBloomValue',225);const directValue=$('scanBloom').value;$('openEffectLibrary').click();const libraryCount=$('libraryItems').children.length;$('closeLibrary').click();
    $('exportBtn').click();set('exportType','png');set('resolution','720');$('doExport').click();for(let i=0;i<100&&$('exportResult').hidden;i++)await new Promise(r=>setTimeout(r,30));const exported=!$('exportResult').hidden;$('closeExport').click();
    return {names,capabilities,fragments,changed,strengthVisible,strengthHidden,draftIsolated,draftRestored,headerMode,undo,redo,collapsedCount,multi,canGroup,grouped,saved,restoredCount,libraryCount,exported,migratedLibrary,migrationSaved,legacyUnchanged,directValue,advancedRemoved:!$('advancedSection')&&!$('legacyMotionControls')};
  })()`);
  await writeFile(out+'/ui-results.json',JSON.stringify(result,null,2));
  assert.equal(result.names.length,10);for(const name of ['背景','标题与署名','乐谱组合','音符','符杠','五线谱线','记谱标记','演奏光效','谱头','扫描线'])assert.ok(result.names.includes(name));
  const caps=result.capabilities;
  assert.deepEqual(caps['乐谱组合'].sections,['transformSection','motionEditor']);
  assert.deepEqual(caps['扫描线'].sections,['transformSection','motionEditor','scanSection']);
  assert.deepEqual(caps['演奏光效'].sections,['transformSection','motionEditor','lightSection']);
  assert.ok(!caps['谱头'].sections.includes('lightSection')&&!caps['谱头'].sections.includes('scanSection')&&!caps['谱头'].sections.includes('layoutSection'));
  assert.deepEqual(caps['音符'].fields,['noteColor']);assert.deepEqual(caps['符杠'].fields,['beamColor']);assert.deepEqual(caps['背景'].fields,['backgroundColor']);assert.deepEqual(caps['标题与署名'].fields,['titleInput']);
  assert.ok(result.advancedRemoved&&result.strengthVisible&&result.strengthHidden&&result.draftIsolated&&result.draftRestored);assert.equal(result.fragments.enter.strength,2500);assert.equal(result.fragments.exit.strength,5000);assert.equal(result.fragments.exit.duration,60);assert.equal(result.fragments.exit.delay,60);assert.equal(result.fragments.exit.frames.length,3);assert.equal(result.changed.enter.renderer,undefined);
  assert.equal(result.headerMode,'flow');assert.equal(result.undo,'0');assert.equal(result.redo,'12');assert.equal(result.collapsedCount,3);assert.equal(result.multi,'已选 2 项');assert.ok(result.canGroup&&result.grouped&&result.exported);assert.ok(result.libraryCount>=19);assert.equal(result.saved.composition.nodes.length,11);
  assert.ok(result.migratedLibrary&&result.migrationSaved&&result.legacyUnchanged);assert.equal(result.saved.version,5);assert.equal(result.directValue,'225');
  await qa.evaluate("document.querySelectorAll('.studio-section').forEach(d=>d.open=false);document.getElementById('scanSection').open=true;document.querySelector('.inspector-content').scrollTop=0");await qa.screenshot(out+'/scan-inspector.png');
  await qa.evaluate("[...document.querySelectorAll('.node-pick')].find(b=>b.dataset.name==='音符').click();document.getElementById('motionEditor').open=true");await qa.screenshot(out+'/note-animation.png');
  await qa.evaluate("document.getElementById('openEffectLibrary').click()");await qa.screenshot(out+'/effects-library.png');await qa.evaluate("document.getElementById('closeLibrary').click()");
  for(const [width,height] of [[960,640],[390,844]]){await qa.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});assert.equal(await qa.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await qa.screenshot(out+'/responsive-'+width+'.png')}
  assert.deepEqual(qa.errors,[]);console.log('PASS: element capabilities, full split, grouping, phase strengths, extended ranges, history, preset restore, PNG export and responsive UI');
}finally{qa.close()}
