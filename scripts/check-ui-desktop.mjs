import assert from 'node:assert/strict';
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualStorage } from '../desktop/visual-storage.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const output=path.join(root,'artifacts',`ui-${version}-qa`),profile=path.join(output,'profile');
mkdirSync(profile,{recursive:true});
app.setPath('sessionData',profile);
app.commandLine.appendSwitch('user-data-dir',profile);
const restart=process.argv.includes('--restart-check');
const errors=[],opened=[];
let failPreferences=false,failLibrary=false,window;
const register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>register(channel,(...args)=>{
  if(channel==='desktop:write-preferences'&&failPreferences)return {error:'QA preferences unavailable'};
  if(channel==='desktop:write-visual-library'&&failLibrary)return {error:'QA library unavailable'};
  return handler(...args);
});
shell.openExternal=async url=>opened.push(url);
dialog.showMessageBox=async()=>({response:0});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label){
  const end=Date.now()+90000;
  while(!await predicate()){assert.ok(Date.now()<end,`Timed out: ${label}`);await delay(100)}
}
const run=code=>window.webContents.executeJavaScript(code,true);
const click=async id=>{await run(`document.getElementById(${JSON.stringify(id)}).click()`);await delay(50)};
async function change(id,value){
  await run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await delay(120);
}
async function ready(){
  await waitFor(()=>run(`Boolean(document.getElementById('play')&&!document.getElementById('play').disabled)`),'default score');
  await delay(200);
  await run(`(()=>{window.qaDownloads=[];const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){const name=this.download;window.qaDownloads.push(fetch(this.href).then(async r=>({name,text:await r.text()})))}else original.call(this)}})()`);
}
async function exported(){
  await click('exportVisual');
  return JSON.parse(await run(`Promise.all(window.qaDownloads).then(a=>a.at(-1).text)`));
}
async function screenshot(name){await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);await writeFile(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG())}
async function untranslated(){
  return run(`(()=>{
    const result=[],skip=e=>e.closest('script,style,textarea,#engraving,[translate="no"],[data-user-content]');
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
    while(walker.nextNode()){const n=walker.currentNode,e=n.nodeType===3?n.parentElement:n;if(skip(e))continue;
      if(n.nodeType===3&&/\\p{Script=Han}/u.test(n.data))result.push({id:e.id,text:n.data});
      if(n.nodeType===1&&!n.hasAttribute('data-user-attributes'))for(const key of ['aria-label','title','alt','placeholder']){const text=n.getAttribute(key);if(text&&/\\p{Script=Han}/u.test(text))result.push({id:n.id,key,text})}
    }return result;
  })()`);
}
async function check(){
  try{
    await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
    if(!restart){
      await writeFile(path.join(profile,'ui-preferences.json'),JSON.stringify({language:'zh',theme:'mono'}));
      await visualStorage(path.join(profile,'visual-library')).write('liupu.visual-presets.v5','[]');
    }
    await import('../desktop/main.mjs');await app.whenReady();
    await waitFor(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('http://127.0.0.1:')),'window');
    window=BrowserWindow.getAllWindows()[0];
    window.webContents.on('console-message',(event,level,message)=>{if(event.level==='error'||level===3)errors.push(event.message||message)});
    await ready();
    assert.match(await run(`document.getElementById('scoreFilename').textContent`),/^Chopin_Nocturne_Op9_No2.musicxml$/);
    assert.match(await run(`document.getElementById('projectName').textContent`),/Nocturne/);
    if(restart){
      assert.deepEqual(await run(`({language:document.documentElement.lang,theme:document.documentElement.dataset.uiTheme})`),{language:'en',theme:'blue'});
      await click('browsePresets');
      assert.equal(await run(`document.querySelectorAll('.library-delete').length`),0);
      console.log('Restart: language, theme and preset deletion persisted.');return;
    }
    assert.equal(await run(`document.documentElement.dataset.uiTheme`),'mono');
    const baseline=await exported(),pixels=await run(`document.getElementById('canvas').toDataURL()`);
    const config=baseline.composition.nodes[0].config;
    assert.equal(config.glow,0);assert.equal(config.particles,0);assert.equal(config.pageDecay,'none');
    await screenshot('zh-default');
    await click('appSettings');
    assert.equal(await run(`document.getElementById('appSettingsDialog').open`),true);
    await change('uiTheme','sage');assert.equal(await run(`document.getElementById('canvas').toDataURL()`),pixels,'UI palette cannot alter output pixels');
    await change('uiLanguage','ja');await screenshot('ja-settings');
    assert.match(await run(`document.getElementById('appSettingsTitle').textContent`),/設定/);
    await change('uiLanguage','en');await change('uiTheme','blue');await screenshot('en-settings');
    assert.equal(await run(`document.getElementById('appSettingsTitle').textContent`),'App settings');
    failPreferences=true;await change('uiTheme','coral');
    assert.equal(await run(`document.documentElement.dataset.uiTheme`),'blue');
    assert.match(await run(`document.getElementById('preferencesStatus').textContent`),/QA preferences unavailable/);
    failPreferences=false;await change('uiTheme','blue');
    await click('closeAppSettings');assert.equal(await run(`document.activeElement.id`),'appSettings');
    const same=await exported();assert.deepEqual(same,baseline,'UI preferences cannot alter visual preset data');
    assert.deepEqual(await run(`[...document.getElementById('effectTarget').options].filter(o=>!o.hidden&&!o.disabled).map(o=>o.value)`),['note','score','mark']);
    await change('effectTarget','score');await change('pageDecay','fade');await change('decayOffset','-1.5');await change('decayDuration','2');
    await change('effectTarget','mark');await change('enterPreset','scatter');await change('pageDecay','dissolve');await change('decayOffset','3');await change('decayDuration','4');
    await change('effectTarget','score');
    assert.deepEqual(await run(`['pageDecay','decayOffset','decayDuration'].map(id=>document.getElementById(id).value)`),['fade','-1.5','2']);
    await change('effectTarget','mark');
    assert.deepEqual(await run(`['pageDecay','decayOffset','decayDuration','enterPreset'].map(id=>document.getElementById(id).value)`),['dissolve','3','4','scatter']);
    const independent=(await exported()).composition.nodes[0].config;
    assert.equal(independent.decayOffset,-1.5);assert.equal(independent.markDecayOffset,3);
    assert.equal(independent.scoreProgramActive,false);assert.equal(independent.markProgramActive,true);
    await click('appSettings');await change('uiLanguage','ja');await click('closeAppSettings');
    assert.equal(await run(`document.getElementById('effectHint').textContent`),'記号の線・文字・符号をまとめて動かします。');
    await change('effectTarget','score');
    assert.equal(await run(`document.getElementById('effectHint').textContent`),'譜線のみ。記号のアニメーションとは独立しています。');
    await click('appSettings');await change('uiLanguage','en');await click('closeAppSettings');
    await click('resetStyle');
    await click('selectCanvas');
    await click('audioTab');await click('effectsTab');await click('nodeList');
    await click('browsePresets');
    assert.equal(await run(`document.querySelectorAll('.library-entry').length`),8);
    assert.equal(await run(`document.querySelectorAll('.library-delete').length`),0);
    await screenshot('en-library');
    const configurations=[];
    for(let i=0;i<8;i++){
      if(i)await click('browsePresets');
      await run(`document.querySelectorAll('.library-item')[${i}].click()`);await click('applyLibrary');
      configurations.push((await exported()).composition.nodes[0].config);
      assert.ok(await run(`document.getElementById('canvas').toDataURL().length>1000`));
    }
    assert.deepEqual(configurations.map(c=>c.glow),[0,15,30,35,40,45,60,75]);
    await click('resetStyle');
    await change('nodeName','音符与背景 · user');
    await click('saveVisual');await run(`document.getElementById('visualName').value='音符与背景 · QA'`);await click('confirmVisualSave');
    await waitFor(()=>run(`document.getElementById('saveVisualForm').hidden`),'preset save');
    assert.equal(await run(`document.getElementById('presetName').textContent`),'音符与背景 · QA');
    await click('appSettings');await change('uiLanguage','zh');await change('uiLanguage','ja');await change('uiLanguage','en');await click('closeAppSettings');
    assert.equal(await run(`document.getElementById('presetName').textContent`),'音符与背景 · QA');
    assert.equal(await run(`document.getElementById('nodeName').value`),'音符与背景 · user');
    await click('browsePresets');assert.equal(await run(`document.querySelectorAll('.library-delete').length`),1);
    const beforeDelete=await exported();
    failLibrary=true;await run(`document.querySelector('.library-delete').click()`);await delay(200);
    assert.match(await run(`document.getElementById('libraryStatus').textContent`),/QA library unavailable/);
    assert.equal(await run(`document.querySelectorAll('.library-delete').length`),1);
    failLibrary=false;await run(`document.querySelector('.library-delete').click()`);await delay(200);
    assert.equal(await run(`document.querySelectorAll('.library-delete').length`),0);
    assert.equal(await run(`document.getElementById('applyLibrary').disabled`),true);
    assert.deepEqual(await exported(),beforeDelete,'Deleting a preset must preserve current design');
    for(const name of ['QA import A','QA import B']){
      const preset={...beforeDelete,name};
      await run(`(()=>{const input=document.getElementById('presetPackFile'),transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(preset))}],'qa.liupu-preset',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await waitFor(()=>run(`document.querySelectorAll('.library-delete').length===${name.endsWith('A')?1:2}`),'preset import');
    }
    assert.equal(await run(`document.querySelectorAll('.library-delete').length`),2);
    await run(`document.querySelectorAll('.library-delete').forEach(button=>button.click())`);
    await waitFor(()=>run(`document.querySelectorAll('.library-delete').length===0`),'concurrent preset deletion');
    await click('closeLibrary');
    await click('exportBtn');await screenshot('en-export');
    await change('exportType','png');await click('doExport');
    await waitFor(()=>run(`!document.getElementById('exportResult').hidden&&document.getElementById('exportImage').naturalWidth>0`),'PNG export');
    assert.ok(await run(`document.getElementById('exportImage').naturalWidth>=1280`));
    await click('closeExport');
    await run(`document.querySelector('.node-pick').click()`);await click('splitElements');
    const nodeIds=await run(`[...document.querySelectorAll('.composition-node')].map(e=>e.dataset.nodeId)`);
    for(const id of nodeIds){
      await run(`document.querySelector('[data-node-id="${id}"] .node-pick').click()`);
      await delay(50);assert.deepEqual(await untranslated(),[],`Split element ${id}`);
    }
    await click('openEffectLibrary');
    assert.equal(await run(`document.getElementById('effectLibrary').open`),true);
    assert.deepEqual(await untranslated(),[],'Motion library');
    await screenshot('en-motion-library');await click('closeLibrary');
    await click('selectCanvas');
    await run(`for(const e of document.querySelectorAll('details'))e.open=true`);
    const missing=await untranslated();await writeFile(path.join(output,'untranslated.json'),JSON.stringify(missing,null,2));
    assert.deepEqual(missing,[],'English UI contains untranslated descriptions');
    await screenshot('en-workspace');
    window.setSize(960,640);await delay(400);await screenshot('en-960');
    assert.ok(await run(`document.documentElement.scrollWidth<=innerWidth`),'No horizontal overflow');
    await click('appSettings');await screenshot('en-960-settings');
    await click('closeAppSettings');
    window.setSize(1440,960);
    await click('downloadDemo');
    const sample=await run(`Promise.all(window.qaDownloads).then(a=>a.at(-1))`);
    assert.equal(sample.text,await readFile(path.join(root,'Chopin_Nocturne_Op9_No2.musicxml'),'utf8'));
    await run(`document.querySelector('.statusbar>a').click()`);
    await waitFor(()=>opened.length===1,'creator link');
    assert.deepEqual(opened,['https://space.bilibili.com/24340298']);
    await writeFile(path.join(output,'report.json'),JSON.stringify({version:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,runtimeVersion:app.getVersion(),glowLevels:configurations.map(c=>c.glow),defaultScore:sample.name,missing,errors,opened},null,2));
    assert.deepEqual(errors,[]);
    console.log(`UI ${version} passed: default score, three languages, UI themes, unchanged output, eight presets, deletion, errors, persistence and responsive layout.`);
  }catch(error){console.error(error);if(window)await screenshot('failure');process.exitCode=1}
  finally{app.exit(process.exitCode||0)}
}
void check();
