import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const desktop = process.argv.includes('--desktop'), port = desktop ? 9334 : 9336;
const target = desktop ? (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:')) : await (await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:4173/`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let next = 0; const pending = new Map(), errors = [];
socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
const output = 'artifacts/composition-qa/header-regression' + (desktop ? '/desktop' : ''); await mkdir(output, { recursive: true });
async function screenshot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${output}/${name}.png`, Buffer.from(r.data, 'base64')); }

try {
  await send('Runtime.enable');
  const result=await evaluate(`(async()=>{
    const {ScoreRenderer}=await import('/render.mjs'),{loadScore}=await import('/score.mjs'),{demoXML}=await import('/demo.mjs'),{stickyGeometry,stickyFrame}=await import('/header.mjs'),{positionAt}=await import('/timing.mjs');
    const score=await loadScore(demoXML,'demo.musicxml'),canvas=document.createElement('canvas'),c=canvas.getContext('2d',{willReadFrequently:true}),renderer=new ScoreRenderer(canvas);renderer.setScore(score);
    const base={motion:'sticky',anchor:34,zoom:100,fly:0,scatter:0,glow:0,bloom:0,particles:0,trail:0,noteOpacity:0,beamOpacity:0,markOpacity:0,staffOpacity:100,staffColor:'#ffffff',noteColor:'#ffffff',color:'#fff2d6',backgroundColor:'#090c0e',showTitle:false,showLine:false,transparent:true,outputLayer:'notation',pageDecay:'burn',decayTrigger:'measure',decayDelay:.45,decayDuration:2.4};
    const cases=[];let beforeImage;
    for(const [w,h,anchor,zoom,time] of [[1280,720,34,100,0],[1280,720,34,100,.25],[1280,720,70,100,0],[1920,1080,34,160,.1],[720,1280,34,100,0],[1080,1080,20,60,0]]){
      canvas.width=w;canvas.height=h;const style={...base,anchor,zoom};renderer.render(time,style);
      const scale=h/1080*Math.min(1080*.48/score.height,2.2)*zoom/100,position=positionAt(score.quarterStops,score.secondsToQuarter(time)),{cutoff,left}=stickyFrame(score.header,w,scale,w*anchor/100,position,score.quarterStops[0].x);
      const firstX=left+Math.min(...score.measureRegions.map(m=>m.x))*scale,top=h*.54-score.height*scale/2;
      const d=c.getImageData(0,0,w,h).data;let blank=0,samples=0,minAlpha=255;
      for(const line of score.header.lines.flat()){
        const y=Math.round(top+line.y*scale);if(y<2||y>=h-2)continue;
        for(let x=Math.ceil(cutoff+3);x<Math.min(w-1,Math.floor(Math.max(firstX-2,cutoff+w*.025)));x++){
          let alpha=0;for(let dy=-2;dy<=2;dy++)alpha=Math.max(alpha,d[((y+dy)*w+x)*4+3]);
          if(alpha===0)blank++;minAlpha=Math.min(minAlpha,alpha);samples++;
        }
      }
      cases.push({w,h,anchor,zoom,time,cutoff,firstX,blank,samples,minAlpha});
      if(!beforeImage){renderer.render(time,{...style,noteOpacity:100,beamOpacity:100,markOpacity:100,transparent:false});beforeImage=canvas.toDataURL()}
    }
    canvas.width=1280;canvas.height=720;
    const travel=[],story=document.createElement('canvas');story.width=1280;story.height=720*3;const sc=story.getContext('2d');
    const scale=720/1080*Math.min(1080*.48/score.height,2.2),fixed=stickyGeometry(score.header,1280,scale);
    let openingPixels;
    for(const [index,time] of [0,.25,4,5,0].entries()){
      const position=positionAt(score.quarterStops,score.secondsToQuarter(time)),geometry=stickyFrame(score.header,1280,scale,1280*.34,position,score.quarterStops[0].x);
      renderer.render(time,{...base,noteOpacity:100,beamOpacity:100,markOpacity:100,transparent:false});
      if(index===0)openingPixels=new Uint8ClampedArray(c.getImageData(0,0,1280,720).data);
      if([0,1,2].includes(index)){sc.drawImage(canvas,0,index*720);sc.fillStyle='#ffffff';sc.font='24px sans-serif';sc.fillText(time+' s',24,index*720+40)}
      travel.push({time,x:geometry.x,left:geometry.left,cutoff:geometry.cutoff,anchor:geometry.anchor});
    }
    const restoredPixels=c.getImageData(0,0,1280,720).data,seekRestored=openingPixels.every((v,i)=>v===restoredPixels[i]);
    renderer.render(0,{...base,staffOpacity:0});const hidden=c.getImageData(0,0,1280,720).data.every((a,i)=>i%4!==3||a===0);
    renderer.render(0,{...base,outputLayer:'effects'});const effects=c.getImageData(0,0,1280,720).data.every((a,i)=>i%4!==3||a===0);
    const staticStyle={...base,motion:'static',pageBars:4,pageRows:2,markOpacity:100};
    renderer.render(0,staticStyle);
    const rows=renderer.staticLayout.pages[0].rows,first=rows[0].measures[0],row=rows[0];
    const headerEnergy=index=>{const r=rows[index],d=c.getImageData(Math.ceil(r.x),Math.ceil(r.top+(score.contentTop??0)*r.scale),Math.floor(r.headerWidth*r.scale-2),Math.floor((score.contentHeight??score.height)*r.scale)).data;let energy=0;for(let i=3;i<d.length;i+=4)energy+=d[i];return energy};
    const start=headerEnergy(0),future=headerEnergy(1),end=first.decayEnd+.45+2.4+.05;
    renderer.render(first.decayEnd+.4,staticStyle);const waiting=headerEnergy(0);
    renderer.render(first.decayEnd+.45+1.2,staticStyle);const during=headerEnergy(0);
    renderer.render(end,staticStyle);const gone=headerEnergy(0),futureAfter=headerEnergy(1);
    renderer.render(end,{...staticStyle,pageDecay:'none'});const retained=headerEnergy(0);
    renderer.render(first.start+(first.end-first.start)*.5,{...staticStyle,decayTrigger:'progress'});const live=headerEnergy(0);
    renderer.render(end,{...staticStyle,reducedMotion:true});const reduced=headerEnergy(0);
    renderer.render(first.decayEnd+.45+1.2,staticStyle);const reverse=headerEnergy(0);
    renderer.render(first.decayEnd+.45+1.2,{...staticStyle,decayOffset:1});const delayed=headerEnergy(0);
    renderer.render(first.decayEnd+.45+1.2,{...staticStyle,decayOffset:-1});const advanced=headerEnergy(0);
    renderer.render(first.start+(first.end-first.start)*.5,{...staticStyle,decayTrigger:'progress',decayOffset:1});const liveDelayed=headerEnergy(0);
    renderer.render(first.start+(first.end-first.start)*.5,{...staticStyle,decayTrigger:'progress',decayOffset:-1});const liveAdvanced=headerEnergy(0);
    renderer.render(first.decayEnd+.45+1.2,{...staticStyle,noteOpacity:100,beamOpacity:100,transparent:false});const staticImage=canvas.toDataURL();
    window.headerQA={renderer,score,base};return {cases,hidden,effects,travel,seekRestored,fixedX:fixed.x,story:story.toDataURL(),staticHeaders:{start,future,waiting,during,gone,futureAfter,retained,live,reduced,reverse,delayed,advanced,liveDelayed,liveAdvanced},image:beforeImage,staticImage};
  })()`);
  await writeFile(output+(process.argv.includes('--baseline')?'/before.png':'/after.png'),Buffer.from(result.image.split(',')[1],'base64'));delete result.image;
  await writeFile(output+'/static-header.png',Buffer.from(result.staticImage.split(',')[1],'base64'));delete result.staticImage;
  await writeFile(output+'/sticky-travel.png',Buffer.from(result.story.split(',')[1],'base64'));delete result.story;
  console.log(JSON.stringify(result,null,2));
  if(!process.argv.includes('--baseline')){
    assert.ok(result.cases.every(c=>c.blank===0),'Header lead-in staff must be continuous');assert.ok(result.hidden&&result.effects,'Respect staff opacity and output layers');
    const [a,b,docked,later,restored]=result.travel;assert.ok(a.x>result.fixedX&&b.x<a.x);assert.ok(Math.abs((b.x-a.x)-(b.left-a.left))<1e-7);assert.equal(docked.x,result.fixedX);assert.equal(later.x,result.fixedX);assert.equal(restored.x,a.x);assert.ok(result.seekRestored);assert.ok(result.travel.every(f=>f.cutoff<=f.anchor+1e-7));
    const h=result.staticHeaders;assert.ok(h.start>1000);assert.equal(h.waiting,h.start);assert.ok(h.during>0&&h.during<h.start);assert.equal(h.gone,0);assert.equal(h.futureAfter,h.future);assert.equal(h.retained,h.start);assert.ok(h.live>0&&h.live<h.start);assert.equal(h.reduced,0);assert.equal(h.reverse,h.during);assert.ok(h.delayed>h.during&&h.advanced<h.during);assert.ok(h.liveDelayed>h.live&&h.liveAdvanced<h.live);
  }
  const ui=await evaluate(`(()=>{const $=id=>document.getElementById(id),set=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('change',{bubbles:true}))};$('resetStyle').click();$('motionEditor').open=true;set('effectTarget','score');set('pageDecay','burn');set('decayTrigger','progress');const duration=window.headerQA.score.duration;set('decayOffset',2.5);const delayed={value:$('decayOffset').value,tail:Number($('seek').max)-duration,visible:!$('decayOffset').closest('[hidden]')};set('decayOffset',-1);const advanced=$('decayOffset').value;$('resetStyle').click();set('pageDecay','burn');return {delayed,advanced,reset:$('decayOffset').value}})()`);
  assert.equal(ui.delayed.value,'2.5');assert.ok(Math.abs(ui.delayed.tail-2.6)<1e-6);assert.ok(ui.delayed.visible);assert.equal(ui.advanced,'-1');assert.equal(ui.reset,'0.45');result.ui=ui;
  const exported=await evaluate(`(async()=>{
    const $=id=>document.getElementById(id),set=(id,value,event='change')=>{$(id).value=value;$(id).dispatchEvent(new Event(event,{bubbles:true}))};
    set('motion','static');set('decayTrigger','progress');set('seek',1.5,'input');$('exportBtn').click();set('exportType','png');set('exportLayer','notation');set('resolution','720');
    const frames=[];
    for(const offset of [0,1,-1]){set('decayOffset',offset);$('doExport').click();const deadline=Date.now()+15000;while($('exportResult').hidden){if(Date.now()>deadline)throw Error('PNG export timeout');await new Promise(r=>setTimeout(r,30))}
      const img=await createImageBitmap(await(await fetch($('exportDownload').href)).blob()),canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const c=canvas.getContext('2d');c.drawImage(img,0,0);const d=c.getImageData(0,0,img.width,img.height).data;let energy=0;for(let i=3;i<d.length;i+=4)energy+=d[i];frames.push({offset,width:img.width,height:img.height,energy});img.close();
    }
    $('closeExport').click();return frames;
  })()`);
  assert.ok(exported.every(f=>f.width===1280&&f.height===720));assert.ok(exported[1].energy>exported[0].energy&&exported[2].energy<exported[0].energy);result.exported=exported;
  assert.deepEqual(errors,[],'No renderer exceptions');result.errors=errors;
  await writeFile(output+(process.argv.includes('--baseline')?'/before.json':'/report.json'),JSON.stringify(result,null,2));
}finally{socket.close()}
