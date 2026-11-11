import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connect } from './qa-cdp.mjs';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const output=path.resolve('artifacts',`ui-${pkg.version}-qa`),profile=path.join(output,'packaged-profile');
await mkdir(profile,{recursive:true});
await writeFile(path.join(profile,'ui-preferences.json'),JSON.stringify({language:'en',theme:'blue'}));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const executable=path.resolve(process.argv[2]||path.join('release',pkg.version,'win-unpacked','Liupu Studio.exe'));
const child=spawn(executable,[`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`],{stdio:'ignore',windowsHide:false});
let client,launchError,exited=false;child.on('error',error=>{launchError=error});child.on('exit',()=>{exited=true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label){
  const deadline=Date.now()+90000;
  while(!await predicate()){if(launchError)throw launchError;assert.ok(!exited,'Packaged app exited early');assert.ok(Date.now()<deadline,`Timed out: ${label}`);await delay(100)}
}
try{
  await waitFor(async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).some(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:'))}catch{return false}},'debug endpoint');
  client=await connect(port);
  await waitFor(()=>client.evaluate(`Boolean(document.getElementById('play')&&!document.getElementById('play').disabled)`),'packaged default score');
  assert.deepEqual(await client.evaluate(`({version:document.querySelector('.inspector-footer>span').textContent,lang:document.documentElement.lang,theme:document.documentElement.dataset.uiTheme,file:document.getElementById('scoreFilename').textContent})`),
    {version:'v'+pkg.version,lang:'en',theme:'blue',file:'Chopin_Nocturne_Op9_No2.musicxml'});
  const original=await client.evaluate(`document.getElementById('canvas').toDataURL()`);
  assert.deepEqual(await client.evaluate(`[...document.getElementById('effectTarget').options].filter(o=>!o.hidden&&!o.disabled).map(o=>o.value)`),['note','score','mark']);
  const change=async(id,value)=>client.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await change('effectTarget','mark');await change('pageDecay','fade');await change('decayOffset','3');
  await change('effectTarget','score');assert.equal(await client.evaluate(`document.getElementById('pageDecay').value`),'none');
  await change('effectTarget','mark');
  assert.deepEqual(await client.evaluate(`['pageDecay','decayOffset'].map(id=>document.getElementById(id).value)`),['fade','3']);
  await client.evaluate(`document.getElementById('resetStyle').click()`);
  assert.equal(await client.evaluate(`document.getElementById('canvas').toDataURL()`),original);
  await client.evaluate(`document.getElementById('appSettings').click()`);
  await client.evaluate(`(()=>{const e=document.getElementById('uiLanguage');e.value='ja';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(()=>client.evaluate(`document.documentElement.lang==='ja'&&document.getElementById('preferencesStatus').textContent==='保存済み'`),'packaged preferences');
  assert.equal(await client.evaluate(`document.getElementById('canvas').toDataURL()`),original);
  await client.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
  await client.screenshot(path.join(output,'packaged-ja-settings.png'));
  await client.evaluate(`document.getElementById('closeAppSettings').click()`);
  await client.evaluate(`document.getElementById('browsePresets').click()`);
  assert.equal(await client.evaluate(`document.querySelectorAll('.library-entry').length`),8);
  await client.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
  await client.screenshot(path.join(output,'packaged-ja-presets.png'));
  assert.deepEqual(client.errors,[]);
  await writeFile(path.join(output,'packaged-report.json'),JSON.stringify({version:pkg.version,defaultScore:true,languages:['en','ja'],preferencesPersisted:JSON.parse(await readFile(path.join(profile,'ui-preferences.json'),'utf8')),unchangedCanvas:true,independentMarkControls:true,presets:8,errors:client.errors},null,2));
  console.log(`Packaged ${pkg.version} passed: default score, independent mark controls, settings, localization, unchanged canvas and eight presets.`);
}finally{
  if(client){await client.send('Runtime.evaluate',{expression:'setTimeout(()=>window.close(),50)'}).catch(()=>{});client.close()}
  const deadline=Date.now()+10000;
  while(!exited&&!launchError&&Date.now()<deadline)await delay(100);
  if(!exited&&!launchError)child.kill();
}
