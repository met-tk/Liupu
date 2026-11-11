import { clamp, positionAt } from './timing.mjs';
import { defaultMotionProgram, motionAt, applyFlyin } from './motion-program.mjs';
import { buildStaticLayout, occurrenceInMeasure, staticPageAt } from './static-layout.mjs';
import { prepareMeasureEffects, drawMeasureEffects } from './measure-effects.mjs';
import { noteExitTime } from './effect-timing.mjs';
import { drawScanline } from './scanline.mjs';
import { drawFragmented, drawFragmentedShape } from './fragment-render.mjs';
import { drawLedgerLines } from './ledger-render.mjs';
import { drawMarks } from './mark-render.mjs';

const opacity=(settings,key,fallback=100)=>clamp((settings[key]??fallback)/100,0,1);
const identity={x:0,y:0,rotation:0,scale:1,opacity:1,phase:'hold',progress:1};

// Geometry and event membership only change when the static layout is rebuilt.
function indexNotes(score,layout){
  const measures=layout.pages.flatMap(page=>page.rows.flatMap(row=>row.measures)),byId=new Map(),byNote=new Map();
  for(const measure of measures){
    const visits=byId.get(measure.id)||[];visits.push(measure);byId.set(measure.id,visits);
    measure.noteEvents=new Map();measure.beams=[];measure.beamGroups=[];
    measure.glowRegions=(score.glowRegions||[]).filter(region=>region.x+region.w>=measure.sourceX&&region.x<measure.endX);
  }
  for(const [id,box] of score.boxes){
    const visits=box.measureId?byId.get(box.measureId)||[]:measures.filter(measure=>box.x>=measure.sourceX&&box.x<measure.endX);
    byNote.set(id,visits);
    for(const measure of visits)measure.noteEvents.set(id,occurrenceInMeasure(score.occurrences.get(id),measure));
  }
  for(const beam of score.beams)for(const measure of byNote.get(beam.noteId)||[])measure.beams.push(beam);
  for(const group of score.beamGroups||score.beams){
    const members=new Map();
    for(const id of group.noteIds||[group.noteId])for(const measure of byNote.get(id)||[]){
      const noteIds=members.get(measure)||[];noteIds.push(id);members.set(measure,noteIds);
    }
    for(const [measure,noteIds] of members){
      const occurrences=noteIds.flatMap(id=>measure.noteEvents.get(id)?score.occurrences.get(id)||[]:[]);
      measure.beamGroups.push({group,noteIds,occurrences});
    }
  }
}

function rowHeader(renderer,row,settings){
  const {ctx:c,score,headerInk}=renderer,header=score.header,scale=row.scale;
  const state=header.states[Math.max(0,header.states.findLastIndex(state=>state.time<=row.start+1e-6))];
  if(!state)return;
  c.save();c.globalAlpha=opacity(settings,'staffOpacity',75);
  const rs=renderer.rasterScale||1,ink=renderer.staffInkNoLedger||renderer.staffInk;
  const start=header.bridgeStartX??header.clefX-4,sourceX=Math.floor((start+2)*rs);
  const x=row.x+(start-header.minX)*scale,end=row.x+row.headerWidth*scale;
  if(end>x)c.drawImage(ink,sourceX,(score.contentTop??0)*rs,1,(score.contentHeight??score.height)*rs,x,row.top+(score.contentTop??0)*scale,end-x,(score.contentHeight??score.height)*scale);
  c.globalAlpha=opacity(settings,'markOpacity');
  const hrs=headerInk.rasterScale||1;
  for(const box of header.extras)c.drawImage(headerInk,box.x*hrs,box.y*hrs,box.w*hrs,box.h*hrs,row.x+(box.x-header.minX)*scale,row.top+box.y*scale,box.w*scale,box.h*scale);
  for(const staff of state.staves)for(const kind of ['clef','keySig','meterSig']){
    const box=staff[kind];if(!box||box.w<.1||box.h<.1)continue;
    c.drawImage(headerInk,box.x*hrs,box.y*hrs,box.w*hrs,box.h*hrs,row.x+header.columns[kind]*scale,row.top+(box.drawY??box.y)*scale,box.w*scale,box.h*scale);
  }
  c.restore();
}

function rowHeaderTile(renderer,row,settings){
  const cache=renderer.measureCache;
  cache.headers??=new Map();
  if(cache.headers.has(row.index))return cache.headers.get(row.index);
  const tile=document.createElement('canvas'),score=renderer.score;
  tile.width=Math.max(1,Math.ceil(row.headerWidth*row.scale));
  tile.height=Math.max(1,Math.ceil((score.contentHeight??score.height)*row.scale));
  const c=tile.getContext('2d'),target=Object.create(renderer);target.ctx=c;
  c.translate(-row.x,-row.top-(score.contentTop??0)*row.scale);
  rowHeader(target,row,settings);
  cache.headers.set(row.index,tile);return tile;
}

function noteState(renderer,id,measure,time,settings,program){
  const occurrences=renderer.score.occurrences.get(id)||[],occurrence=measure.noteEvents.get(id);
  if(!occurrence)return {transform:identity,active:false,occurrence:null};
  const transform=motionAt(program,time,occurrence.start,noteExitTime(occurrence,measure,settings),{enter:settings.noteArrival==='assemble',exit:true});
  if(transform.flyin)applyFlyin(transform,id);
  if(settings.reducedMotion){transform.x=0;transform.y=0;transform.rotation=0;transform.scale=1}
  return {transform,active:time>=occurrence.start&&time<occurrence.end,occurrence,occurrences};
}

function transformNote(c,box,measure,transform){
  const cx=box.x+box.w/2,cy=box.y+box.h/2;
  c.translate(measure.x+(cx-measure.sourceX+transform.x)*measure.scale,measure.y+(cy+transform.y)*measure.scale);
  c.rotate(transform.rotation*Math.PI/180);c.scale(measure.scale*transform.scale,measure.scale*transform.scale);
  return {cx,cy};
}

function drawNotes(renderer,measure,time,settings,program,notation,effects,xPosition){
  const c=renderer.ctx,s=renderer.score,states=new Map();
  for(const id of measure.noteEvents.keys())states.set(id,noteState(renderer,id,measure,time,settings,program));
  const smooth=settings.glowMode==='sweep',edge=settings.glowShape==='edge',halo=renderer.haloRadius(1,settings),feather=clamp((settings.glowFeather??50)/100,0,1);
  const notePasses=edge
    ?[[halo*(.4+feather*.18),.5],[halo*(.18+feather*.09),.74],[Math.max(1,halo*.07),.92]]
    :[[halo*(.56+feather*.24),.54],[halo*(.26+feather*.13),.78],[Math.max(1,halo*.09),.96]];
  for(const pass of ['notation','effects']){
  const passNotation=notation&&pass==='notation',passEffects=effects&&settings.parts.effects&&pass==='effects';
  if(!passNotation&&!passEffects)continue;
  if(passNotation&&settings.parts.beams)for(const beam of measure.beams){
    const box=s.boxes.get(beam.noteId),state=states.get(beam.noteId);if(!box||!state||state.transform.opacity<=.001||state.transform.scale<=.001)continue;
    const {transform}=state;c.save();const {cx,cy}=transformNote(c,box,measure,transform);
    c.globalAlpha=transform.opacity*opacity(settings,'beamOpacity');
    drawFragmentedShape(c,()=>{
      c.beginPath();beam.points.forEach((point,index)=>c[index?'lineTo':'moveTo'](point.x-cx,point.y-cy));c.closePath();
      c.fillStyle=settings.beamColor||settings.noteColor;c.fill();
    },{x:beam.box.x-cx-1,y:beam.box.y-cy-1,width:beam.box.w+2,height:beam.box.h+2,...transform.fragments,phase:transform.phase,key:beam.noteId+':beam',reducedMotion:settings.reducedMotion});
    c.restore();
  }
  if(passEffects&&settings.glow>0&&settings.glowBeam!==false)for(const {group,noteIds,occurrences} of measure.beamGroups){
    const firstState=states.get(noteIds[0]);if(!firstState||firstState.transform.opacity<=.001||firstState.transform.scale<=.001)continue;
    const fragmented=noteIds.some(id=>{const t=states.get(id)?.transform;return t&&(t.fragments||Math.abs(t.x-firstState.transform.x)>.01||Math.abs(t.y-firstState.transform.y)>.01||Math.abs(t.rotation-firstState.transform.rotation)>.01||Math.abs(t.scale-firstState.transform.scale)>.01)});
    if(fragmented){
      for(const beam of (group.parts||[group])){
        const box=s.boxes.get(beam.noteId),state=states.get(beam.noteId);if(!box||!state||state.transform.opacity<=.001||state.transform.scale<=.001)continue;
        const {transform,active,occurrence}=state;c.save();const {cx,cy}=transformNote(c,box,measure,transform);
        const beamState={active:active&&occurrence,previous:occurrence&&occurrence.start<=time?occurrence:null,next:occurrence&&occurrence.start>time?occurrence:null,occurrences:state.occurrences};
        const level=renderer.beamGlowLevel(beamState,beam.box,time,xPosition,1,settings);
        c.globalAlpha=transform.opacity*opacity(settings,'beamOpacity');
        if(level>.012)drawFragmentedShape(c,()=>renderer.renderBeamGlow(c,beam,cx,cy,level,time,xPosition,1,settings,c.globalAlpha),{x:beam.box.x-cx-1,y:beam.box.y-cy-1,width:beam.box.w+2,height:beam.box.h+2,...transform.fragments,phase:transform.phase,key:beam.noteId+':beam',reducedMotion:settings.reducedMotion});
        c.restore();
      }
      continue;
    }
    const glowTime=time-(settings.glowOffset??0);
    const active=occurrences.find(e=>glowTime>=e.start&&glowTime<e.end);
    const previous=occurrences.findLast(e=>e.start<=glowTime);
    const next=occurrences.find(e=>e.start>glowTime);
    const level=renderer.beamGlowLevel({active,previous,next,occurrences},group.box,time,xPosition,1,settings);
    if(level>.012){
      const box=s.boxes.get(noteIds[0]),{transform}=firstState;
      c.save();const {cx,cy}=transformNote(c,box,measure,transform);
      const base=transform.opacity*opacity(settings,'beamOpacity');
      renderer.renderBeamGlow(c,group,cx,cy,level,time,xPosition,1,settings,base);
      c.restore();
    }
  }
  const as=renderer.atlasScale||1;
  if(passNotation&&settings.parts.notes||passEffects)for(const [id,state] of states){
    const box=s.boxes.get(id),{transform,active,occurrence}=state;if(transform.opacity<=.001||transform.scale<=.001)continue;
    const level=passEffects&&settings.glow>0&&settings.glowNote!==false?renderer.glowLevel({active:active&&occurrence,previous:occurrence,occurrences:state.occurrences},time,settings):0;
    c.save();const {cx,cy}=transformNote(c,box,measure,transform);
    if(passNotation&&settings.ledgerMotion&&s.ledgerLines?.get(id)?.length){
      c.globalAlpha=transform.opacity*opacity(settings,'staffOpacity',75);
      drawLedgerLines(c,s.ledgerLines.get(id),cx,cy,transform,id,settings.staffColor||settings.noteColor,settings.reducedMotion);
    }
    if(passNotation){
      c.globalAlpha=transform.opacity*opacity(settings,'noteOpacity');
      drawFragmented(c,renderer.ink,{sx:box.sx*as,sy:box.sy*as,sw:box.w*as,sh:box.h*as,x:-box.w/2,y:-box.h/2,width:box.w,height:box.h,...transform.fragments,phase:transform.phase,key:id,reducedMotion:settings.reducedMotion});
    }
    if(passEffects&&level>.012&&settings.glow>0&&settings.glowNote!==false){
      const l=smooth?clamp(level,0,1):1;
      const base=transform.opacity*opacity(settings,'noteOpacity')*l;
      const glyph=edge?renderer.noteEdge:renderer.tinted;
      // Pulse does not animate a bloom envelope, so one middle pass gives the
      // same direct bright/dark response without paying for three shadow
      // rasters per note. Sweep keeps its layered passes for its soft ramp.
      const firstPass=smooth
        ?(l*(settings.glow/100)<.14?notePasses.length-1:0)
        :Math.max(0,notePasses.length-1);
      for(let i=firstPass;i<notePasses.length;i++){
        const [blur,alpha]=notePasses[i];
        c.save();c.globalCompositeOperation='lighter';c.globalAlpha=clamp(base*settings.glow/100*alpha,0,1);
        c.shadowColor=settings.color;c.shadowBlur=Math.max(1,blur*(smooth?.72+.28*l:1));
        drawFragmented(c,glyph,{sx:box.sx*as,sy:box.sy*as,sw:box.w*as,sh:box.h*as,x:-box.w/2,y:-box.h/2,width:box.w,height:box.h,...transform.fragments,phase:transform.phase,key:id,reducedMotion:settings.reducedMotion});
        c.restore();
      }
    }
    const head=box.head||box,hx=head.x+head.w/2-cx,hy=head.y+head.h/2-cy,fragmentFade=1-(transform.fragments?.amount??0);
    c.globalAlpha=transform.opacity*fragmentFade;
    if(passEffects&&occurrence&&occurrence.attack!==false&&!settings.reducedMotion)renderer.drawSparks(c,id+measure.occurrence,hx,hy,time-occurrence.start,1,settings);
    c.restore();
  }
  }
}

export function renderStaticScore(renderer,time,settings){
  const {score:s,ctx:c,canvas:target}=renderer,w=target.width,h=target.height,resolution=h/1080;
  const output=settings.outputLayer||'composite',notation=output==='composite'||output==='notation',effects=output==='composite'||output==='effects',cursor=(output==='composite'||output==='cursor')&&settings.showLine;
  const layoutTitle=settings.layoutTitle??settings.showTitle;
  const modern=!!settings.layout,headerVisible=settings.headerMode!=='hidden';
  const layoutKey=[w,h,settings.pageBars||4,settings.pageRows||2,!!layoutTitle,settings.zoom||100,settings.camera,settings.headerMode,settings.pageMargin,settings.rowGap].join(':');
  if(renderer.staticLayoutScore!==s||renderer.staticLayoutKey!==layoutKey){
    renderer.staticLayout=buildStaticLayout(s,{width:w,height:h,barsPerRow:settings.pageBars||4,rowsPerPage:settings.pageRows||2,showTitle:layoutTitle,zoom:settings.zoom||100,custom:modern,continuous:modern&&settings.camera==='follow',headerVisible,margin:settings.pageMargin??5.5,gap:settings.rowGap??4.5});
    indexNotes(s,renderer.staticLayout);
    renderer.staticLayoutScore=s;renderer.staticLayoutKey=layoutKey;renderer.staticCache=null;
  }
  const page=staticPageAt(renderer.staticLayout,modern&&settings.camera==='stationary'?0:time);if(!page)return;
  c.save();
  let cameraY=0;
  if(modern&&settings.camera!=='follow'){cameraY=h*((settings.layoutY??54)-54)/100;c.translate(0,cameraY)}
  if(modern&&settings.camera==='follow'){
    const index=Math.max(0,page.rows.findLastIndex(row=>row.start<=time)),row=page.rows[index],next=page.rows[index+1],duration=settings.cameraTransition??.6;
    const t=next&&duration>0?clamp((time-next.start+duration)/duration,0,1):0,blend=t*t*(3-2*t);
    const y=row.visibleY+(next?next.visibleY-row.visibleY:0)*blend;
    cameraY=(h*(settings.layoutY??34)/100-y)*(settings.cameraAmount??100)/100;c.translate(0,cameraY);
  }
  prepareMeasureEffects(renderer,settings,layoutKey+':'+page.index);
  const program=settings.motionProgramActive&&settings.motionProgram?settings.motionProgram:modern?{...defaultMotionProgram,enter:{...defaultMotionProgram.enter,enabled:false},exit:{...defaultMotionProgram.exit,enabled:false}}:defaultMotionProgram;
  for(const row of page.rows){
    if(row.visibleY+cameraY>h+200||row.visibleY+row.height+cameraY< -200)continue;
    if((notation||effects)&&headerVisible&&settings.parts?.header!==false){
      // Static row headers follow their first performed bar's timing, including
      // held notes, live progress, repeats and the shared reduced-motion path.
      const first=row.measures[0],header={...first,id:`header:${first.id}`,x:row.x,width:row.headerWidth*row.scale};
      const headerStyle=settings.headerStyle??settings;
      drawMeasureEffects(renderer,header,time,settings.headerExit==='retain'?{...headerStyle,pageDecay:'none',scoreProgramActive:false}:headerStyle,notation,effects,rowHeaderTile(renderer,row,headerStyle));
    }
    for(const measure of row.measures){
      if((notation||effects)&&(settings.parts.staff||!s.markRegions&&settings.parts.marks)){
        drawMeasureEffects(renderer,measure,time,settings,notation,effects);
      }
      if(notation&&s.markRegions&&headerVisible&&settings.parts.header){
        const rs=renderer.rasterScale;
        c.save();c.globalAlpha=opacity(settings.headerStyle??settings,'markOpacity');
        c.drawImage(renderer.inlineHeaderInk,measure.sourceX*rs,(s.contentTop??0)*rs,measure.sourceWidth*rs,(s.contentHeight??s.height)*rs,
          measure.x,measure.y+(s.contentTop??0)*measure.scale,measure.width,(s.contentHeight??s.height)*measure.scale);c.restore();
      }
    }
    if(s.markRegions&&(notation||effects)){
      const runs=[];
      for(const measure of row.measures){
        const run=runs.at(-1);
        if(run&&Math.abs(run.at(-1).endX-measure.sourceX)<1e-6)run.push(measure);
        else runs.push([measure]);
      }
      for(const measures of runs){const first=measures[0];drawMarks(renderer,time,settings,{scale:row.scale,w,notation,effects,row:{measures},
        left:first.x-first.sourceX*row.scale,top:row.top,bounds:{x0:first.sourceX,x1:measures.at(-1).endX}})}
    }
  }
  const xPosition=s.quarterStops?positionAt(s.quarterStops,s.secondsToQuarter(Math.min(time,s.duration))):positionAt(s.stops,time);
  for(const row of page.rows)for(const measure of row.measures){
    if(row.visibleY+cameraY>h+200||row.visibleY+row.height+cameraY< -200)continue;
    if(notation||effects)drawNotes(renderer,measure,time,settings,program,notation,effects,xPosition);
    if(effects&&(settings.parts?.staff||settings.parts?.marks||settings.parts?.header))renderer.drawGlowRegions(c,time,settings,{scale:measure.scale,w,xPosition,parts:settings.parts,regions:s.markRegions?measure.glowRegions.filter(r=>!r.atlas):measure.glowRegions,bounds:{x0:measure.sourceX,x1:measure.endX},pinned:measure.rowStart,
      map:region=>({x:measure.x+(region.x-measure.sourceX)*measure.scale,y:measure.y+region.y*measure.scale})});
    if(cursor&&time>=measure.start&&time<measure.end){
      const source=s.quarterStops?positionAt(s.quarterStops,s.secondsToQuarter(time)):positionAt(s.stops,time),x=measure.x+clamp(source-measure.sourceX,0,measure.sourceWidth)*measure.scale;
      const lines=s.header.lines.flat(),y1=row.top+Math.min(...lines.map(line=>line.y))*row.scale-12*resolution,y2=row.top+Math.max(...lines.map(line=>line.y))*row.scale+12*resolution;
      drawScanline(c,settings,{x,centerY:(y1+y2)/2,baseLength:y2-y1,scale:row.scale,resolution,width:Math.max(1,resolution)});
    }
  }
  c.restore();
  if(notation&&settings.showTitle){
    c.save();c.fillStyle=settings.noteColor;c.textBaseline='top';c.font=`400 ${32*resolution}px "Songti SC","SimSun",serif`;c.fillText(settings.title||s.title,w*.055,h*.075,w*.89);c.font=`${14*resolution}px "Segoe UI","Microsoft YaHei",sans-serif`;c.globalAlpha=.6;c.fillText(s.composer||s.instrument,w*.056,h*.075+48*resolution,w*.89);c.restore();
  }
}
