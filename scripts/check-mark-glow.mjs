import assert from 'node:assert/strict';
import {app,BrowserWindow} from 'electron';
import {mkdirSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('artifacts','mark-glow-121'),profile=path.join(output,'profile');
mkdirSync(profile,{recursive:true});
app.setPath('sessionData',profile);
app.commandLine.appendSwitch('user-data-dir',profile);
const baseline=process.argv.includes('--baseline');

async function probe(fixtureXml){
  const {loadScore}=await import('/score.mjs'),{ScoreRenderer}=await import('/render.mjs');
  const {visualDefaults}=await import('/visual-defaults.mjs'),{allParts}=await import('/composition.mjs');
  const {drawMarks}=await import('/mark-render.mjs');
  const {prepareMeasureEffects}=await import('/measure-effects.mjs');
  const score=await loadScore(await(await fetch('/assets/Chopin_Nocturne_Op9_No2.musicxml')).text(),'Chopin.musicxml');
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const c=canvas.getContext('2d',{willReadFrequently:true}),renderer=new ScoreRenderer(canvas);renderer.setScore(score);
  const settings={...visualDefaults,layout:'strip',camera:'follow',motion:'sticky',headerMode:'dock',layoutY:54,
    motionProgramActive:false,scoreProgramActive:false,markProgramActive:false,pageDecay:'none',markPageDecay:'none',
    glow:100,glowPeak:100,glowValley:0,color:'#ffffff',particles:0,trail:0,showTitle:false,showLine:false,parts:allParts()};
  const pixels=()=>c.getImageData(0,0,canvas.width,canvas.height).data;
  const energy=()=>{const p=pixels();let total=0,max=0;for(let i=3;i<p.length;i+=4){total+=p[i];max=Math.max(max,p[i])}return {total,max}};
  const images={},samples=[];
  for(const glowShape of ['halo','edge']){
    const style={...settings,glowShape};
    renderer.updateColors(style);
    for(const region of score.markRegions.filter(r=>['slur','tie','hairpin','tuplet','pedal','octave'].includes(r.kind))){
      const time=(region.start+region.end)/2;
      c.clearRect(0,0,canvas.width,canvas.height);
      renderer.drawGlowRegions(c,time,style,{scale:2,w:canvas.width,xPosition:region.x+region.w/2,regions:[region],
        map:r=>({x:canvas.width/2+(r.x-region.x-region.w/2)*2,y:150+(r.y-region.y)*2})});
      samples.push({kind:region.kind,shape:glowShape,id:region.id,...energy()});
      c.clearRect(0,0,canvas.width,canvas.height);
      renderer.drawGlowRegions(c,time,{...style,[region.toggle]:false},{scale:2,w:canvas.width,xPosition:region.x+region.w/2,regions:[region],
        map:r=>({x:canvas.width/2+(r.x-region.x-region.w/2)*2,y:150+(r.y-region.y)*2})});
      if(energy().total!==0)throw Error('Disabled mark still glows: '+region.kind);
    }
    renderer.render(20.3,{...style,theme:'light',backgroundColor:'#f2efe5',noteColor:'#252b29',beamColor:'#252b29',
      markColor:'#252b29',staffColor:'#92938e',zoom:200,bloom:45,glowMode:'sweep'});
    images['light-'+glowShape]=canvas.toDataURL();
    renderer.render(20.3,{...style,zoom:200,glowMode:'sweep'});images['dark-'+glowShape]=canvas.toDataURL();
  }
  const fixture=await loadScore(fixtureXml,'repeated-marks.musicxml');
  renderer.setScore(fixture);renderer.updateColors(settings);prepareMeasureEffects(renderer,settings,'glow-qa');
  const repeated=[];
  const regions=fixture.markRegions;
  if(!regions.some(r=>r.kind==='harm'&&r.toggle==='glowMark'))throw Error('Chord symbols must use the general mark toggle');
  if(!regions.every(r=>r.toggle))throw Error('Every atlas mark must have a glow toggle');
  for(const region of regions){
    const visits=renderer.markVisits.get(region.id);
    if(visits?.length<2)continue;
    for(const visit of visits){
      const midpoint=visit.glowStart===undefined?visit.start+(region.start-visits[0].start+region.end-visits[0].start)/2:(visit.glowStart+visit.glowEnd)/2;
      for(const rows of [false,true])for(const glowMode of ['pulse','sweep'])for(const glowOffset of [-.35,0,.35]){
        const time=midpoint+glowOffset,style={...settings,glowMode,glowOffset};
        const options={ctx:c,left:150-region.x,top:150-region.y,scale:1,w:canvas.width,notation:false,effects:true,
          row:rows?{measures:[visit]}:undefined,bounds:{x0:region.x,x1:region.x+region.w}};
        c.clearRect(0,0,canvas.width,canvas.height);
        fixture.markRegions=[region];
        drawMarks(renderer,time,style,options);
        repeated.push({kind:region.kind,visit:visit.occurrence,rows,glowMode,glowOffset,time,...energy()});
        c.clearRect(0,0,canvas.width,canvas.height);
        drawMarks(renderer,time,{...style,[region.toggle]:false},options);
        if(energy().total!==0)throw Error('Disabled repeated mark still glows: '+region.kind);
      }
    }
  }
  fixture.markRegions=regions;
  return {samples,repeated,images};
}

async function check(){
  try{
    await import('../desktop/main.mjs');await app.whenReady();
    const deadline=Date.now()+90000;
    let window;
    while(!window||!await window.webContents.executeJavaScript(`Boolean(document.getElementById('play')&&!document.getElementById('play').disabled)`)){
      window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:'));
      assert.ok(Date.now()<deadline,'Score startup timed out');await new Promise(r=>setTimeout(r,100));
    }
    let xml=await readFile('tests\\fixtures\\notation-marks.musicxml','utf8');
    xml=xml.replace('<measure number="1">','<measure number="1"><barline location="left"><repeat direction="forward"/></barline>')
      .replace('<note id="grace1">','<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony><note id="grace1">')
      .replace('<bar-style>light-heavy</bar-style>','<bar-style>light-heavy</bar-style><repeat direction="backward"/>');
    const report=await window.webContents.executeJavaScript(`(${probe.toString()})(${JSON.stringify(xml)})`);
    for(const [name,data] of Object.entries(report.images))await writeFile(path.join(output,`${baseline?'before':'after'}-${name}.png`),Buffer.from(data.split(',')[1],'base64'));
    delete report.images;
    await writeFile(path.join(output,`${baseline?'before':'report'}.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify({samples:report.samples.length,dim:report.samples.filter(s=>s.max<250),repeated:report.repeated.length,missingRepeat:report.repeated.filter(s=>!s.total)},null,2));
    if(!baseline){
      assert.ok(report.samples.length>100);
      for(const sample of report.samples)assert.ok(sample.max>=250,`Dim ${sample.kind}/${sample.shape}: ${sample.max}`);
      assert.ok(report.repeated.some(r=>r.visit>2));
      for(const sample of report.repeated)assert.ok(sample.total>0,`Missing ${sample.kind} at visit ${sample.visit}`);
    }
  }catch(error){console.error(error);process.exitCode=1}
  finally{app.exit(process.exitCode||0)}
}
void check();
