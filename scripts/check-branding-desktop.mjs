import assert from 'node:assert/strict';
import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const output=path.join(root,'artifacts','branding-qa',version);
const profile=path.join(output,'profile');
mkdirSync(profile,{recursive:true});
app.setPath('sessionData',profile);
app.commandLine.appendSwitch('user-data-dir',profile);
const opened=[],messages=[];
let failExternal=false;
shell.openExternal=async url=>{
  if(failExternal)throw Error('QA browser unavailable');
  opened.push(url);
};
dialog.showMessageBox=async(_window,options)=>{messages.push(options);return {response:0}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const waitFor=async predicate=>{
  const deadline=Date.now()+30000;
  while(!await predicate()){assert.ok(Date.now()<deadline,'Desktop branding check timed out');await delay(50)}
};
async function check(){
try{
  await mkdir(output,{recursive:true});
  await import('../desktop/main.mjs');
  await app.whenReady();
  await waitFor(()=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('http://127.0.0.1:')));
  const window=BrowserWindow.getAllWindows()[0],web=window.webContents;
  await waitFor(()=>web.executeJavaScript(`Boolean(document.getElementById('play')&&!document.getElementById('play').disabled)`));
  const state=await web.executeJavaScript(`(()=>{
    const link=document.querySelector('.statusbar>a'),mark=document.querySelector('.brand>img');
    const rect=link.getBoundingClientRect();
    return {text:link.textContent,url:link.href,target:link.target,rel:link.rel,
      visible:rect.width>0&&rect.height>0&&rect.right<=innerWidth,
      markLoaded:mark.complete&&mark.naturalWidth===256,
      version:document.querySelector('.inspector-footer>span').textContent};
  })()`);
  assert.equal(state.text,'AI-driven by Taketo');
  assert.equal(state.url,'https://space.bilibili.com/24340298');
  assert.equal(state.target,'_blank');assert.match(state.rel,/noopener/);
  assert.ok(state.visible&&state.markLoaded);assert.equal(state.version,'v'+version);
  await web.executeJavaScript(`document.querySelector('.statusbar>a').click()`,true);
  await waitFor(()=>opened.length===1);
  assert.deepEqual(opened,[state.url]);
  for(const url of ['https://example.com/','https://space.bilibili.com/24340298?redirect=1','file:///C:/Windows/win.ini']){
    await web.executeJavaScript(`window.open(${JSON.stringify(url)},'_blank')`,true);
  }
  await delay(200);assert.equal(opened.length,1);assert.equal(BrowserWindow.getAllWindows().length,1);
  failExternal=true;
  await web.executeJavaScript(`document.querySelector('.statusbar>a').click()`,true);
  await waitFor(()=>messages.length===1);
  assert.equal(messages[0].type,'error');assert.match(messages[0].detail,/QA browser unavailable/);
  const ico=await readFile(path.join(root,'desktop','icon.ico'));
  assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  assert.deepEqual(Array.from({length:7},(_,i)=>ico[6+i*16]||256),[16,24,32,48,64,128,256]);
  assert.deepEqual(nativeImage.createFromPath(path.join(root,'desktop','icon.png')).getSize(),{width:1024,height:1024});
  await writeFile(path.join(output,'desktop.png'),(await web.capturePage()).toPNG());
  await writeFile(path.join(output,'report.json'),JSON.stringify({state,opened,errorFeedback:messages[0],iconSizes:[16,24,32,48,64,128,256]},null,2));
  console.log('Desktop branding passed: images, version, creator link, external URL allowlist and browser failure feedback.');
}catch(error){
  console.error(error);process.exitCode=1;
}finally{
  app.quit();
}
}
void check();
