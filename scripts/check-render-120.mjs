import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'artifacts','render-120');
const profile=path.join(output,'profile');
mkdirSync(profile,{recursive:true});
app.setPath('sessionData',profile);
app.commandLine.appendSwitch('user-data-dir',profile);
const baseline=process.argv.includes('--baseline');

async function renderChecks(fixtureXml){
  const {loadScore}=await import('/score.mjs');
  const {ScoreRenderer}=await import('/render.mjs');
  const {visualDefaults}=await import('/visual-defaults.mjs');
  const {drawStickyHeader}=await import('/header.mjs');
  const {presetPhase}=await import('/effect-library.mjs');
  const {allParts,createStudioSettings,selectedNode,splitHeader,splitElements}=await import('/composition.mjs');
  const {CompositionRenderer}=await import('/composition-render.mjs');
  const score=await loadScore(await (await fetch('/assets/Chopin_Nocturne_Op9_No2.musicxml')).text(),'Chopin.musicxml');
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),renderer=new ScoreRenderer(canvas);
  renderer.setScore(score);
  const settings={...visualDefaults,layout:'strip',camera:'follow',headerMode:'flow',motion:'flow',layoutY:54,
    motionProgramActive:false,scoreProgramActive:false,markProgramActive:false,pageDecay:'none',markPageDecay:'none',glow:0,particles:0,trail:0,showTitle:false,showLine:false};
  const images={};
  for(const [name,time,style] of [
    ['flow-opening',0,{}],['flow-ending',score.duration-2,{}],['dock-opening',0,{motion:'sticky',headerMode:'dock'}],
    ['rows',35,{motion:'static',layout:'rows',headerMode:'row',camera:'stationary',pageBars:3,pageRows:3,glow:80}]
  ]){
    renderer.render(time,{...settings,...style});
    images[name]=canvas.toDataURL();
  }
  const headerCanvas=document.createElement('canvas');headerCanvas.width=score.header.image.width;headerCanvas.height=score.header.image.height;
  const hc=headerCanvas.getContext('2d',{willReadFrequently:true});hc.drawImage(score.header.image,0,0);
  const energy=box=>{
    const data=hc.getImageData(Math.floor(box.x*score.rasterScale),Math.floor(box.y*score.rasterScale),Math.ceil(box.w*score.rasterScale),Math.ceil(box.h*score.rasterScale)).data;
    let alpha=0;for(let i=3;i<data.length;i+=4)alpha+=data[i];return alpha;
  };
  const header=score.header.base.map(staff=>Object.fromEntries(Object.entries(staff).map(([kind,box])=>[kind,box&&{...box,energy:energy(box)}])));
  const calls=[],stack=[];
  const mock={globalAlpha:1,save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()},beginPath(){},moveTo(){},lineTo(){},stroke(){},drawImage(_ink,sx,sy,sw,sh,x,y,w,h){calls.push({sx,sy,x,y,w,h,alpha:this.globalAlpha})}};
  const scale=Math.min(1080*.48/score.height,2.2);
  const frame=renderer.cameraFrame(0,{...settings,motion:'sticky',headerMode:'dock'},1920,scale);
  drawStickyHeader(mock,score.header,0,settings,{w:1920,top:0,scale,geometry:frame.headerFrame,left:frame.left},renderer.headerInk);
  const pixels=()=>new Uint8ClampedArray(ctx.getImageData(0,0,canvas.width,canvas.height).data);
  const alpha=data=>{let sum=0;for(let i=3;i<data.length;i+=4)sum+=data[i];return sum};
  const only=keys=>Object.fromEntries(Object.keys(allParts()).map(key=>[key,keys.includes(key)]));
  const checks={validTransitions:Object.values(score.header.transitions).flat().every(event=>event.movers.every(m=>m.box.w>0&&m.box.h>0)),
    openingMeters:score.header.base.every(staff=>calls.some(call=>Math.abs(call.sx-staff.meterSig.x*score.rasterScale)<.01&&call.alpha===1))};
  renderer.render(score.duration-2,{...settings,parts:only(['header']),transparent:true});
  checks.noPinnedFlowTail=alpha(pixels())===0;
  const original=ctx.getImageData.bind(ctx),baseRows={...settings,layout:'rows',motion:'static',camera:'stationary',headerMode:'hidden',
    pageBars:3,pageRows:3,transparent:true,parts:only(['marks','effects'])};
  const region=score.markRegions?.find(region=>region.kind==='dynam');
  if(region){
    const padded={...score,contentTop:30,contentHeight:score.contentHeight-30,markRegions:[region],glowRegions:[region]};
    renderer.setScore(padded);
    const time=region.start+.01;
    renderer.render(time,{...baseRows,glow:0,outputLayer:'notation'});const ink=pixels();
    renderer.render(time,{...baseRows,glow:100,bloom:0,glowRadius:10,outputLayer:'effects',color:'#ffffff'});const glow=pixels();
    const offset=Math.max(2,Math.round(padded.contentTop*renderer.staticLayout.scale));
    const overlap=dy=>{let value=0;for(let y=Math.max(0,-dy);y<canvas.height-Math.max(0,dy);y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4+3,j=((y+dy)*canvas.width+x)*4+3;value+=ink[i]*glow[j];
    }return value};
    checks.rowGlow={aligned:overlap(0),oldOffset:overlap(-offset),offset};
    checks.rowGlowAligned=checks.rowGlow.aligned>checks.rowGlow.oldOffset&&alpha(glow)>0;
    images['rows-highlight']=canvas.toDataURL();
    renderer.render(time,{...baseRows,parts:only(['effects']),glow:100,bloom:0,glowRadius:10,outputLayer:'effects',color:'#ffffff'});
    const isolatedGlow=pixels();checks.splitMarkGlowMatches=glow.every((value,i)=>value===isolatedGlow[i]);
    renderer.setScore(score);
  }else checks.rowGlowAligned=false;
  renderer.render(0,{...baseRows,headerMode:'row',parts:only(['staff','header']),markOpacity:0,staffOpacity:100,outputLayer:'notation'});
  const row=renderer.staticLayout.pages[0].rows[0],seam=row.measures[0].x;
  const band=x=>score.header.lines.flat().map(line=>{
    const y=row.top+line.y*row.scale,data=original(Math.round(x),Math.floor(y)-2,1,6).data;
    return Array.from({length:6},(_,i)=>data[i*4+3]).reduce((a,b)=>a+b,0);
  });
  const a=band(seam-3),b=band(seam+3);
  checks.staffSeam={left:a,right:b,maxDifference:Math.max(...a.map((value,i)=>Math.abs(value-b[i])))};
  checks.staffSeamMatched=checks.staffSeam.maxDifference<=6;
  const markProgram={version:1,name:'QA',enter:presetPhase('scatter','enter'),exit:presetPhase('scatter','exit',{duration:1,delay:0})};
  const markStyle={...baseRows,pageBars:12,pageRows:8,markProgramActive:true,markMotionProgram:markProgram,markDecayOffset:0,markDecayDelay:0,markDecayDuration:1};
  const delayed={...markProgram,enter:{...markProgram.enter,offset:2}};
  renderer.render(0,{...markStyle,markMotionProgram:delayed});checks.allMarksWait=alpha(pixels())===0;
  renderer.render(.01,{...markStyle,markProgramActive:false});const settled=pixels();checks.marksVisible=alpha(settled)>0;
  for(const decay of ['none','fade','dissolve','burn']){
    renderer.render(score.duration+2,{...markStyle,markPageDecay:decay});
    checks['noMarkFragments-'+decay]=alpha(pixels())===0;
  }
  renderer.render(.01,{...markStyle,markProgramActive:false});const restored=pixels();checks.markSeekStable=settled.every((value,i)=>value===restored[i]);
  renderer.render(.01,{...markStyle,markProgramActive:false});images['marks-only']=canvas.toDataURL();
  renderer.render(.25,markStyle);images['marks-entering']=canvas.toDataURL();
  const independent={...settings,transparent:true,parts:only(['notes','beams','staff']),headerMode:'hidden'};
  renderer.render(1,independent);const plain=pixels();
  renderer.render(1,{...independent,markProgramActive:true,markMotionProgram:markProgram,markPageDecay:'burn'});
  const changed=pixels();checks.markChangesLeaveNotesAndStaff=plain.every((value,i)=>value===changed[i]);
  const composition=createStudioSettings(visualDefaults);Object.assign(composition,settings,{transparent:true});
  Object.assign(selectedNode(composition).config,settings);
  const cr=new CompositionRenderer(canvas);cr.setScore(score);cr.render(0,composition);const full=pixels();
  splitHeader(composition);cr.render(0,composition);const split=pixels();
  const difference=(left,right)=>{let delta=0,energy=0;for(let i=3;i<left.length;i+=4){delta+=Math.abs(left[i]-right[i]);energy+=left[i]}return delta/Math.max(1,energy)};
  checks.splitHeaderDifference=difference(full,split);checks.splitHeaderMatches=checks.splitHeaderDifference<.001;
  const elements=createStudioSettings(visualDefaults);Object.assign(elements,settings,{transparent:true});Object.assign(selectedNode(elements).config,settings);
  splitElements(elements);cr.render(0,elements);const elementsPixels=pixels();
  checks.splitElementsDifference=difference(full,elementsPixels);checks.splitElementsMatches=checks.splitElementsDifference<.03;
  const coverage=source=>{
    const tile=document.createElement('canvas');tile.width=Math.ceil(source.width);tile.height=Math.ceil(source.height);
    const c=tile.getContext('2d');c.drawImage(source.structureImage,0,0,source.width,source.height);
    const expected=c.getImageData(0,0,tile.width,tile.height).data;c.clearRect(0,0,tile.width,tile.height);
    c.drawImage(renderer.headerInk,0,0,source.width,source.height);
    const rs=source.markAtlasScale;
    for(const r of source.markRegions)c.drawImage(source.markImage,r.sx*rs,r.sy*rs,r.w*rs,r.h*rs,r.x,r.y,r.w,r.h);
    const actual=c.getImageData(0,0,tile.width,tile.height).data;let missing=0,solid=0;
    for(let y=1;y<tile.height-1;y++)for(let x=1;x<tile.width-1;x++){
      if(expected[(y*tile.width+x)*4+3]<150)continue;solid++;
      let found=false;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(actual[((y+dy)*tile.width+x+dx)*4+3]>=80)found=true;
      if(!found)missing++;
    }
    return {missing,solid,ratio:missing/Math.max(1,solid),kinds:[...new Set(source.markRegions.map(r=>r.kind))]};
  };
  renderer.setScore(score);renderer.updateColors(settings);checks.chopinCoverage=coverage(score);checks.chopinMarksComplete=checks.chopinCoverage.ratio<.01;
  const doc=new DOMParser().parseFromString(fixtureXml,'application/xml'),bars=doc.querySelectorAll('part>measure');
  const add=(measure,location,content)=>{const bar=doc.createElement('barline');bar.setAttribute('location',location);
    bar.innerHTML=content;if(location==='left')measure.prepend(bar);else measure.append(bar)};
  add(bars[0],'left','<repeat direction="forward"/>');
  add(bars[1],'left','<ending number="1" type="start"/>');add(bars[1],'right','<ending number="1" type="stop"/><repeat direction="backward"/>');
  add(bars[2],'left','<ending number="2" type="start"/>');bars[2].querySelector('barline[location="right"]').innerHTML+='<ending number="2" type="stop"/>';
  const fixture=await loadScore(new XMLSerializer().serializeToString(doc),'notation-repeat-regression.musicxml');
  renderer.setScore(fixture);renderer.updateColors(settings);checks.fixtureCoverage=coverage(fixture);checks.fixtureMarksComplete=checks.fixtureCoverage.ratio<.01;
  checks.completeMarkGlow=fixture.markRegions.every(region=>region.toggle);
  checks.repeatVisits=renderer.markVisits.size>0&&[...renderer.markVisits.values()].some(visits=>visits.length>1);
  renderer.render(1,{...baseRows,pageBars:1,pageRows:8,markProgramActive:false,headerMode:'row',parts:allParts(),glow:50});
  images['notation-repeat']=canvas.toDataURL();
  const overlay=document.createElement('canvas'),rs=fixture.rasterScale;overlay.width=Math.ceil(fixture.width*rs);overlay.height=Math.ceil(fixture.height*rs);
  const oc=overlay.getContext('2d');oc.fillStyle='#ff0000';oc.fillRect((fixture.markRegions[0].x+20)*rs,((fixture.contentTop||0)+10)*rs,18*rs,18*rs);
  const overlayStyle={...baseRows,pageBars:3,pageRows:8,markProgramActive:false,headerMode:'hidden'};
  renderer.render(1,overlayStyle);const withoutOverlay=alpha(pixels());
  fixture.overlayImage=overlay;renderer.render(1,overlayStyle);checks.overlayPreserved=alpha(pixels())>withoutOverlay;
  for(const decay of ['fade','dissolve','burn']){
    renderer.render(fixture.duration+2,{...overlayStyle,markPageDecay:decay,markDecayOffset:0,markDecayDuration:1});
    checks['noOverlayResidue-'+decay]=alpha(pixels())===0;
  }
  renderer.setScore(score);
  const result={width:score.width,height:score.height,rasterScale:score.rasterScale,header,checks,
    markKinds:score.markRegions?.reduce((result,region)=>{result[region.kind]=(result[region.kind]||0)+1;return result},{}),images};
  window.render120={score,renderer,canvas,settings};
  return result;
}

async function check(){
  try{
    await mkdir(output,{recursive:true});
    await import('../desktop/main.mjs');await app.whenReady();
    const end=Date.now()+90000;
    let window;
    while(!window){
      window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:'));
      assert.ok(Date.now()<end,'Window startup timed out');if(!window)await new Promise(r=>setTimeout(r,100));
    }
    while(!await window.webContents.executeJavaScript(`Boolean(document.getElementById('play')&&!document.getElementById('play').disabled)`)){
      assert.ok(Date.now()<end,'Score startup timed out');await new Promise(r=>setTimeout(r,100));
    }
    const fixture=await readFile(path.join(root,'tests','fixtures','notation-marks.musicxml'),'utf8');
    const report=await window.webContents.executeJavaScript(`(${renderChecks.toString()})(${JSON.stringify(fixture)})`);
    for(const [name,data] of Object.entries(report.images))await writeFile(path.join(output,`${baseline?'before':'after'}-${name}.png`),Buffer.from(data.split(',')[1],'base64'));
    delete report.images;
    await writeFile(path.join(output,baseline?'before.json':'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if(!baseline)for(const [name,value] of Object.entries(report.checks))if(typeof value==='boolean')assert.equal(value,true,name);
  }catch(error){console.error(error);process.exitCode=1}
  finally{app.exit(process.exitCode||0)}
}
void check();
