import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const output='artifacts/motion-qa';await mkdir(output,{recursive:true});
let target;
for(let i=0;i<100&&!target;i++){
  try{target=(await(await fetch('http://127.0.0.1:9334/json/list')).json()).find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:'))}catch{}
  if(!target)await new Promise(r=>setTimeout(r,100));
}
assert.ok(target,'Desktop test instance did not become ready');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let next=0;const pending=new Map(),errors=[];
socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
  await send('Runtime.enable');await send('Page.enable');
  for(let i=0;i<100&&!(await evaluate("!document.getElementById('play').disabled"));i++)await new Promise(r=>setTimeout(r,100));
  const chrome=await evaluate(`({desktop:document.documentElement.classList.contains('desktop-app'),api:Object.keys(window.liupuDesktop||{}),node:typeof require,drag:getComputedStyle(document.querySelector('.topbar')).webkitAppRegion,buttonDrag:getComputedStyle(document.getElementById('exportBtn')).webkitAppRegion,overlay:navigator.windowControlsOverlay?.visible,overlayRect:navigator.windowControlsOverlay?.getTitlebarAreaRect().toJSON(),exportRight:document.getElementById('exportBtn').getBoundingClientRect().right,width:innerWidth})`);
  assert.equal(chrome.desktop,true);assert.equal(chrome.node,'undefined');assert.equal(chrome.drag,'drag');assert.equal(chrome.buttonDrag,'no-drag');assert.equal(chrome.overlay,true);
  assert.ok(chrome.exportRight<=chrome.overlayRect.width,'Export button must not overlap native caption buttons');
  const ui=await evaluate(`(()=>{
    const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
    document.getElementById('effectsTab').click();set('fly',1000);set('scatter',1000);set('scanLength',160);set('scanGlow',0);set('scanBloom',200);
    const result={fly:document.getElementById('flyOut').textContent,scatter:document.getElementById('scatterOut').textContent,length:document.getElementById('scanLengthOut').textContent,glow:document.getElementById('scanGlowOut').textContent};
    document.getElementById('showLine').click();result.disabled=document.getElementById('scanLength').matches(':disabled');document.getElementById('showLine').click();
    document.getElementById('scanLength').scrollIntoView({block:'center'});return result;
  })()`);
  assert.deepEqual(ui,{fly:'1000%',scatter:'1000%',length:'160%',glow:'0%',disabled:true});
  await screenshot('desktop-controls');
  const render=await evaluate(`(async()=>{
    const {ScoreRenderer}=await import('/render.mjs'),{loadScore}=await import('/score.mjs'),{demoXML}=await import('/demo.mjs');
    const score=await loadScore(demoXML,'demo.musicxml'),canvas=document.createElement('canvas');canvas.width=1440;canvas.height=900;
    const renderer=new ScoreRenderer(canvas);renderer.setScore(score);
    const base={fly:0,scatter:0,glow:60,bloom:45,particles:0,trail:0,anchor:42,zoom:100,showLine:true,showTitle:false,color:'#fff2d6',noteColor:'#ffffff',staffColor:'#cccccc',beamColor:'#ffffff',markColor:'#ffffff',backgroundColor:'#090c0e',motion:'sticky',transparent:true,outputLayer:'cursor',scanLength:100,scanGlow:0,scanBloom:100};
    const data=()=>new Uint8ClampedArray(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
    const bounds=()=>{const d=data();let left=canvas.width,top=canvas.height,right=-1,bottom=-1,energy=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const a=d[(y*canvas.width+x)*4+3];energy+=a;if(a>2){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}return {width:right-left+1,height:bottom-top+1,energy}};
    const same=(a,b)=>a.every((v,i)=>v===b[i]);const result={modes:{}};
    for(const motion of ['flow','sticky','page','static']){
      renderer.render(.6,{...base,motion,scanLength:10});const short=bounds();renderer.render(.6,{...base,motion});const long=bounds(),plain=data();
      renderer.render(.6,{...base,motion,glow:0});const independent=same(plain,data());
      renderer.render(.6,{...base,motion,scanGlow:100,scanBloom:40});const narrow=bounds();renderer.render(.6,{...base,motion,scanGlow:100,scanBloom:200});const broad=bounds();
      renderer.render(.6,{...base,motion,scanGlow:100,scanBloom:0});const zeroSpread=same(plain,data());
      result.modes[motion]={short,long,independent,narrow,broad,zeroSpread};
    }
    renderer.render(.6,{...base,outputLayer:'effects',showLine:false});const noCursor=data();renderer.render(.6,{...base,outputLayer:'effects',scanLength:300,scanGlow:100,scanBloom:300});result.effectsUnaffected=same(noCursor,data());
    const motionStyle={...base,outputLayer:'notation',showLine:false,fly:100,scatter:100};renderer.render(12,motionStyle);const regular=data();renderer.render(12,{...motionStyle,fly:1000,scatter:1000});result.extendedMotionChangesPixels=!same(regular,data());
    renderer.render(.6,{...base,scanLength:70,scanGlow:0});const blob=await new Promise(resolve=>canvas.toBlob(resolve));const image=await createImageBitmap(blob);const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;c.getContext('2d').drawImage(image,0,0);const original=data(),decoded=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let alphaError=0,colorError=0;for(let i=0;i<original.length;i+=4){alphaError=Math.max(alphaError,Math.abs(original[i+3]-decoded[i+3]));for(let k=0;k<3;k++)colorError=Math.max(colorError,Math.abs(original[i+k]*original[i+3]-decoded[i+k]*decoded[i+3])/255)}
    result.png={alphaError,colorError};image.close();
    return result;
  })()`);
  for(const [mode,r] of Object.entries(render.modes)){
    assert.ok(r.long.height>r.short.height*8,mode+' length');assert.ok(r.long.width<4,mode+' glow off');assert.ok(r.broad.width>r.narrow.width*2,mode+' glow spread');assert.ok(r.independent&&r.zeroSpread,mode+' glow independence');
  }
  assert.equal(render.effectsUnaffected,true);assert.equal(render.extendedMotionChangesPixels,true);assert.ok(render.png.alphaError<=1&&render.png.colorError<=1,JSON.stringify(render.png));
  const exports=await evaluate(`(async()=>{
    document.getElementById('exportBtn').click();
    const set=(id,value,event='change')=>{const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event(event,{bubbles:true}))};
    set('exportType','png');set('exportLayer','cursor');set('resolution','720');set('scanGlow',0,'input');
    const results=[];
    for(const length of [20,80]){
      set('scanLength',length,'input');document.getElementById('doExport').click();
      const deadline=Date.now()+15000;
      while(document.getElementById('exportResult').hidden){if(Date.now()>deadline)throw Error('PNG export timed out');await new Promise(r=>setTimeout(r,50))}
      const blob=await(await fetch(document.getElementById('exportDownload').href)).blob(),image=await createImageBitmap(blob),c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let left=c.width,right=-1,top=c.height,bottom=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]>2){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
      results.push({length,width:right-left+1,height:bottom-top+1,canvas:[c.width,c.height],type:blob.type});image.close();
    }
    document.getElementById('closeExport').click();return results;
  })()`);
  assert.ok(exports[1].height>exports[0].height*3.8&&exports[1].height<exports[0].height*4.2);
  assert.ok(exports.every(e=>e.width<=3&&e.type==='image/png'&&e.canvas[1]===720));
  await evaluate("document.getElementById('resetStyle').click();document.getElementById('scanLength').scrollIntoView({block:'center'})");
  const reset=await evaluate("['scanLength','scanGlow','scanBloom'].map(id=>document.getElementById(id).value)");assert.deepEqual(reset,['100','60','100']);
  await send('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});await screenshot('compact-desktop');
  const fit=await evaluate("({scroll:document.documentElement.scrollWidth,width:innerWidth,exportRight:document.getElementById('exportBtn').getBoundingClientRect().right})");assert.ok(fit.scroll<=fit.width);assert.ok(fit.exportRight<=fit.width-140);
  await send('Emulation.clearDeviceMetricsOverride');
  // Native F11/caption controls are checked separately: CDP bypasses Electron before-input-event.
  assert.deepEqual(errors,[]);const report={chrome,ui,render,exports,reset,fit,errors};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{socket.close()}
