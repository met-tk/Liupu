// Chrome: --remote-debugging-port=9223 and npm start.
// Packaged desktop: --remote-debugging-port=9334; pass --desktop to this script.
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const desktopMode=process.argv.includes('--desktop');
const target=desktopMode
  ?(await(await fetch('http://127.0.0.1:9334/json/list')).json()).find(item=>item.type==='page'&&/^http:\/\/127\.0\.0\.1:\d+/.test(item.url))
  :await (await fetch('http://127.0.0.1:9223/json/new?http://127.0.0.1:4173',{method:'PUT'})).json();
assert.ok(target,'No running application page was found');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let nextId=0;const pending=new Map(),errors=[];
socket.onmessage=({data})=>{
  const message=JSON.parse(data);
  if(message.id){const entry=pending.get(message.id);pending.delete(message.id);message.error?entry.reject(new Error(JSON.stringify(message.error))):entry.resolve(message.result)}
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
};
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression,timeout=30000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Browser timeout: '+expression);
}
const output=desktopMode?'artifacts/desktop-qa':'artifacts/audio-qa';await mkdir(output,{recursive:true});
try{
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await until("document.getElementById('play')&&!document.getElementById('play').disabled");
  if(desktopMode){
    assert.equal(await evaluate('typeof process'),'undefined');
    assert.equal(await evaluate('typeof require'),'undefined');
    assert.notEqual(new URL(target.url).port,'4173');
    const status=await evaluate(`(async()=>{const {VstClient}=await import('/vst.mjs');return new VstClient().request('status')})()`);
    assert.equal(status.available,true,'Packaged native host must be found outside app.asar');
  }
  await evaluate("document.getElementById('audioTab').click()");
  const offline=await evaluate(`(async()=>{
    const {PianoSampler}=await import('/piano.mjs');
    const ctx=new OfflineAudioContext(2,44100*3,44100),gain=ctx.createGain();gain.gain.value=.5;gain.connect(ctx.destination);
    const piano=new PianoSampler(ctx,gain);
    const notes=[{pitch:21,velocity:24},{pitch:60,velocity:80},{pitch:64,velocity:80},{pitch:67,velocity:80},{pitch:108,velocity:104}];
    await piano.prepare(notes);for(const e of notes)piano.schedule(e,.1,.8);
    const audio=await ctx.startRendering(),left=audio.getChannelData(0),right=audio.getChannelData(1);
    let peak=0,energy=0,stereoDifference=0,tailPeak=0;
    for(let i=0;i<left.length;i++){peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));energy+=left[i]*left[i];stereoDifference+=Math.abs(left[i]-right[i]);if(i>44100*1.3)tailPeak=Math.max(tailPeak,Math.abs(left[i]))}
    return {peak,rms:Math.sqrt(energy/left.length),stereoDifference,tailPeak,decoded:piano.buffers.size};
  })()`);
  assert.ok(offline.peak>.01&&offline.peak<1,JSON.stringify(offline));
  assert.ok(offline.stereoDifference>1);assert.ok(offline.tailPeak<.000001);
  await evaluate("document.getElementById('play').click()");
  await until("document.getElementById('currentTime').textContent!=='00:00'");
  assert.match(await evaluate("document.getElementById('pianoStatus').textContent"),/已就绪/);
  await evaluate("document.getElementById('play').click()");
  const stoppedTime=await evaluate("document.getElementById('currentTime').textContent");
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(await evaluate("document.getElementById('currentTime').textContent"),stoppedTime);
  const desktop=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/desktop.png`,Buffer.from(desktop.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("document.querySelector('.inspector').scrollIntoView()");
  const width=await evaluate('({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})');
  assert.ok(width.scroll<=width.client+1,JSON.stringify(width));
  const mobile=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/mobile.png`,Buffer.from(mobile.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`(()=>{window.scrollTo(0,0);document.getElementById('exportBtn').click();const type=document.getElementById('exportType');type.value='webm';type.dispatchEvent(new Event('change'));document.getElementById('exportEnd').value='2';document.getElementById('resolution').value='720';document.getElementById('doExport').click()})()`);
  await until("!document.getElementById('exportResult').hidden",30000);
  const video=await evaluate(`(async()=>{const blob=await(await fetch(document.getElementById('exportDownload').href)).blob();return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.slice(reader.result.indexOf('base64,')+7));reader.readAsDataURL(blob)})})()`);
  const videoBytes=Buffer.from(video,'base64');
  assert.equal(videoBytes.subarray(0,4).toString('hex'),'1a45dfa3','Export must be a real WebM/EBML file');
  assert.ok(videoBytes.length>10000);
  await writeFile(`${output}/piano-preview.webm`,videoBytes);
  await evaluate("document.getElementById('closeExport').click();document.getElementById('soundSource').value='vst';document.getElementById('soundSource').dispatchEvent(new Event('change'))");
  await until("!document.getElementById('loadVst').disabled");
  const vstPanel=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/vst-panel.png`,Buffer.from(vstPanel.data,'base64'));
  await evaluate("document.getElementById('exportBtn').click();document.getElementById('doExport').click()");
  assert.match(await evaluate("document.getElementById('exportProgress').textContent"),/VST 声音暂不进入 WebM/);
  assert.deepEqual(errors,[]);
  const report={desktopMode,url:target.url,offline,pause:true,mobileOverflow:false,webmBytes:Buffer.from(video,'base64').length,vstWebmGuard:true,errors};
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{socket.close();if(!desktopMode)await fetch(`http://127.0.0.1:9223/json/close/${target.id}`)}
