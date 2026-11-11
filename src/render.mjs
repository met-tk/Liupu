import { clamp, positionAt, seed, sweepGlowEnvelope, spatialGlowWeight, lastTimeIndex } from './timing.mjs';
import { drawStickyHeader, stickyCameraTrack, stickyFrame } from './header.mjs';
import { renderStaticScore } from './static-render.mjs';
import { motionAt, edgeMotionAt, applyFlyin } from './motion-program.mjs';
import { drawScanline } from './scanline.mjs';
import { staticMeasureTimeline } from './static-layout.mjs';
import { noteExitTime, performedMeasure, markTimeline } from './effect-timing.mjs';
import { drawMarks } from './mark-render.mjs';
import { prepareMeasureEffects, drawMeasureEffects } from './measure-effects.mjs';
import { drawFragmented, drawFragmentedShape, renderParts } from './fragment-render.mjs';
import { drawLedgerLines } from './ledger-render.mjs';
import { horizontalIndex, horizontalSlice, motionPadding } from './render-index.mjs';

const makeCanvas=()=>document.createElement('canvas');
const rgba=(hex,a)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
const opacity=(s,key,fallback=100)=>clamp((s[key]??fallback)/100,0,1);
const colorLuminance=color=>{
  let hex=String(color||'').trim().replace(/^#/,'');
  if(/^[\da-f]{3,4}$/i.test(hex))hex=[...hex.slice(0,3)].map(c=>c+c).join('');
  if(!/^[\da-f]{6}/i.test(hex))return 0;
  const [r,g,b]=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
  return .2126*r+.7152*g+.0722*b;
};
const glowStops=[-1,-.75,-.5,-.25,0,.25,.5,.75,1];
const progressiveKinds=new Set(['tie','slur','hairpin','octave','tuplet']);

// The reference implementation only activates its left mask once the score
// has actually travelled into the pinned header.  Keeping the same small
// activation ramp prevents the first note, which starts exactly at the header
// edge, from being dimmed on the opening frame.
export function headerFadeActivation(cameraPosition,firstPosition,scale=1,buffer=0){
  if(!Number.isFinite(cameraPosition)||!Number.isFinite(firstPosition))return 0;
  // Keep the first glyph just under the moving layer for a few screen pixels
  // before the fixed-header mask is established.  This is the small entrance
  // buffer used by the reference renderer; it avoids a notehead being clipped
  // exactly on the first frame without moving the playhead or the staff.
  const travel=Math.max(0,cameraPosition-firstPosition-Math.max(0,buffer));
  const screenRamp=40;
  return clamp(travel/(screenRamp/Math.max(.1,scale)),0,1);
}

export function shouldKeepFlowHeaderSymbols(settings,modern=!!settings?.layout,headerVisible=true){
  return modern&&headerVisible&&settings?.headerMode==='flow'&&settings?.headerFlowSymbols!==false;
}

export function maskScrollLayer(ctx,w,h,cutoff,fadeWidth,maskOpacity=1){
  const edge=clamp(cutoff,0,w*.8);
  const amount=clamp(maskOpacity,0,1);
  const eraseLeft=(leftEdge,width,partial=false)=>{
    if(leftEdge<=0)return;
    // A hard clear at the dock boundary leaves a one-pixel vertical contour
    // on stems and beams that cross it. Feather only the last few pixels of
    // the opaque part; the rest of the body still uses the cheap clear path.
    const feather=width>0?Math.min(6,width*.2):0;
    if(feather<=0){
      if(partial){ctx.fillStyle='#000';ctx.fillRect(0,0,leftEdge,h)}
      else ctx.clearRect(0,0,leftEdge,h);
      return;
    }
    // Integer start: fractional clear and gradient edges both partially
    // erase the same pixel column and leave a bright vertical seam.
    const start=Math.max(0,Math.floor(leftEdge-feather)),end=leftEdge+width;
    if(start>0){
      if(partial){ctx.fillStyle='#000';ctx.fillRect(0,0,start,h)}
      else ctx.clearRect(0,0,start,h);
    }
    const gradient=ctx.createLinearGradient(start,0,end,0);
    gradient.addColorStop(0,'#000');gradient.addColorStop(1,'transparent');
    ctx.fillStyle=gradient;ctx.fillRect(start,0,end-start,h);
  };
  // A fully established mask keeps the cheap clearRect path.  During the
  // opening ramp use destination-out alpha over a fixed edge instead of
  // moving the edge itself; moving it is what makes the first note pop.
  if(amount>=.999){
    ctx.globalAlpha=1;ctx.globalCompositeOperation='destination-out';eraseLeft(edge,fadeWidth);
  }else if(amount>0){
    ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=amount;eraseLeft(edge,fadeWidth,true);
  }
  ctx.globalAlpha=1;ctx.globalCompositeOperation='destination-out';
  const tail=ctx.createLinearGradient(w*.96,0,w,0);tail.addColorStop(0,'transparent');tail.addColorStop(1,'#000');
  ctx.fillStyle=tail;ctx.fillRect(w*.96,0,w*.04,h);ctx.globalCompositeOperation='source-over';
}

export function drawRepeatedMeters(ctx,source,boxes,{left,top,scale,w,cutoff,fadeWidth,protect},scratch){
  const rs=source.rasterScale||1,start=Math.max(0,Math.floor(cutoff-Math.min(6,fadeWidth*.2))),end=cutoff+fadeWidth;
  for(const box of boxes){
    const x=left+box.x*scale,y=top+box.y*scale,bw=box.w*scale,bh=box.h*scale;
    if(bw<.1||bh<.1||x+bw<0||x>w)continue;
    if(protect>0&&x<end){
      // A shifted body mask must not carry a repeated meter into the fixed header.
      if(protect>=.999&&x+bw<=start)continue;
      const sw=Math.ceil(bw),sh=Math.ceil(bh),sc=scratch.getContext('2d');
      if(scratch.width<sw||scratch.height<sh){scratch.width=Math.max(scratch.width,sw);scratch.height=Math.max(scratch.height,sh)}
      sc.save();sc.globalAlpha=1;sc.globalCompositeOperation='source-over';sc.clearRect(0,0,sw,sh);
      sc.drawImage(source,box.x*rs,box.y*rs,box.w*rs,box.h*rs,0,0,sw,sh);
      sc.globalCompositeOperation='destination-in';
      const gradient=sc.createLinearGradient((start-x)*sw/bw,0,(end-x)*sw/bw,0);
      gradient.addColorStop(0,`rgba(0,0,0,${1-protect})`);gradient.addColorStop(1,'#000');
      sc.fillStyle=gradient;sc.fillRect(0,0,sw,sh);sc.restore();
      ctx.drawImage(scratch,0,0,sw,sh,x,y,bw,bh);
    }else ctx.drawImage(source,box.x*rs,box.y*rs,box.w*rs,box.h*rs,x,y,bw,bh);
  }
}

// Flowing headers keep only clef/key/meter symbols alive at the left boundary.
// Their body copy is still painted by the moving structure; this pass restores
// the crossing glyphs after the generic marks mask and lets the fixed-column
// bridge take over without changing dynamics, lyrics or barline fading.
export function drawFlowHeaderBoundary(ctx,source,regions,{left=0,top=0,scale=1,cutoff=0,fadeWidth=0,rasterScale=1,alpha=1}={}){
  if(!ctx||!source||!regions?.length||cutoff<=0)return false;
  let restored=false;
  ctx.save();ctx.beginPath();ctx.rect(0,0,cutoff,ctx.canvas.height);ctx.clip();
  for(const region of regions){
    if(region.part!=='header'||!['clef','keySig','meterSig'].includes(region.kind)||region.w<=0||region.h<=0)continue;
    const x=left+region.x*scale,end=x+region.w*scale;
    if(end<=0||x>=cutoff||end<=cutoff-Math.max(0,fadeWidth))continue;
    const transition=clamp(Number.isFinite(alpha)?alpha:1,0,1);
    ctx.globalAlpha=transition;
    ctx.drawImage(source,region.x*rasterScale,region.y*rasterScale,region.w*rasterScale,region.h*rasterScale,x,top+region.y*scale,region.w*scale,region.h*scale);
    restored=true;
  }
  ctx.restore();
  return restored;
}

// Repaint notation that belongs to the moving note layer (ties, slurs and
// similar lines) before the note mask is applied. The source structure is
// cleared from the ordinary structure layer first, so these elements cannot
// be painted twice at the right side of the header boundary.
export function drawMovingRegions(ctx,source,regions,{left=0,top=0,scale=1,w=Infinity,rasterScale=1}={}){
  if(!ctx||!source||!regions?.length)return;
  const rs=source.rasterScale||rasterScale||1;
  for(const region of regions){
    if(region.fadeGroup!=='notes'||region.w<=0||region.h<=0)continue;
    const x=left+region.x*scale,y=top+region.y*scale,rw=region.w*scale,rh=region.h*scale;
    if(x+rw<0||x>w)continue;
    ctx.drawImage(source,region.x*rs,region.y*rs,region.w*rs,region.h*rs,x,y,rw,rh);
  }
}

function eventState(occurrences,time){
  let active,previous,next;
  for(const event of occurrences){
    if(event.start<=time){previous=event;if(!active&&time<event.end)active=event}
    else if(event.start>time&&!next)next=event;
  }
  return {active,previous,next,occurrences};
}

export class ScoreRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.layer=makeCanvas();this.layerCtx=this.layer.getContext('2d');this.noteLayer=makeCanvas();this.noteLayerCtx=this.noteLayer.getContext('2d');
    for(const key of ['tinted','ink','noteEdge','structEdge','structInk','structGlow','stickyInk','stickyGlow','stickyEdge','staffInk','staffInkNoLedger','headerInk','sourceHeaderInk'])this[key]=makeCanvas();
    this.glowSprite=makeCanvas();this.glowSprite.width=this.glowSprite.height=512;this.noteEdge=makeCanvas();this.structEdge=makeCanvas();
    this.regionScratch=makeCanvas();this.regionScratchCtx=this.regionScratch.getContext('2d');this.background=null;
    for(const key of ['markInk','markGlow','markEdge','inlineHeaderInk'])this[key]=makeCanvas();
  }
  setScore(score) {
    this.score=score;
    this.noteIndex=horizontalIndex(score.boxes,entry=>entry[1]);
    this.beamIndex=horizontalIndex(score.beams||[]);
    this.beamGroupIndex=horizontalIndex(score.beamGroups||score.beams||[]);
    this.glyphSize=0;
    for(const index of [this.noteIndex,this.beamIndex,this.beamGroupIndex])for(const entry of index.entries){
      const box=Array.isArray(entry.item)?entry.item[1]:entry.item.box;
      this.glyphSize=Math.max(this.glyphSize,Math.hypot(box.w,box.h));
    }
    this.stickyTrack=stickyCameraTrack(score.quarterStops??score.stops);
    this.measureTimeline=staticMeasureTimeline(score);this.measureVisits=new Map();this.eventMeasures=new Map();
    this.markVisits=new Map((score.markRegions||[]).map(region=>[region.id,markTimeline(region,this.measureTimeline,score.stops)]));
    for(const measure of this.measureTimeline){const visits=this.measureVisits.get(measure.id)||[];visits.push(measure);this.measureVisits.set(measure.id,visits)}
    this.measureIndex=horizontalIndex(this.measureVisits.values(),visits=>({x:visits[0].x,w:visits[0].endX-visits[0].x}));
    this.glowIndex=horizontalIndex(score.glowRegions||[],region=>region);
    for(const events of score.occurrences.values())for(const event of events){
      let lo=0,hi=this.measureTimeline.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(this.measureTimeline[mid].start<=event.start+1e-6)lo=mid+1;else hi=mid}
      const measure=this.measureTimeline[lo-1];
      this.eventMeasures.set(event,measure&&event.start<measure.end-1e-6?measure:undefined);
    }
    this.beamOccurrences=new Map();
    for(const group of score.beamGroups||score.beams||[])this.beamOccurrences.set(group,(group.noteIds||[group.noteId]).flatMap(id=>score.occurrences.get(id)||[]));
    this.rasterScale=score.rasterScale||1;this.atlasScale=score.atlasScale||1;
    for(const key of ['tinted','ink','noteEdge','structEdge','structInk','structGlow','stickyInk','stickyGlow','stickyEdge','staffInk','staffInkNoLedger','headerInk','sourceHeaderInk','markInk','markGlow','markEdge','inlineHeaderInk']){
      this[key].width=this[key].height=1;delete this[key].fragmentTiles;
      const note=['tinted','ink','noteEdge'].includes(key),mark=['markInk','markGlow','markEdge'].includes(key);
      const size=mark?score.markImage:note?score.noteAtlas:score,scale=mark?1:note?this.atlasScale:key==='sourceHeaderInk'?1:this.rasterScale;
      this[key].rasterWidth=Math.round((size?.width??1)*scale);this[key].rasterHeight=Math.round((size?.height??1)*scale);
    }
    this.headerInk.rasterScale=this.staffInk.rasterScale=this.staffInkNoLedger.rasterScale=this.rasterScale;
    if(this.regionScratch){this.regionScratch.width=this.regionScratch.height=1}
    this.colors={};this.fragments=new Map();
    for(const [id,box] of score.boxes){
      const tiles=[],columns=3,rows=4;
      // Absolute time and stable seeds keep seeking and exports reproducible.
      for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
        const key=`${id}:${row}:${col}`,uw=box.w/columns,uh=box.h/rows;
        tiles.push({sx:(box.sx+col*uw)*this.atlasScale,sy:(box.sy+row*uh)*this.atlasScale,dx:col*uw,dy:row*uh,sw:uw*this.atlasScale,sh:uh*this.atlasScale,uw,uh,u:seed(key),v:seed(key+'v'),r:seed(key+'r'),delay:seed(key+'d')*.28});
      }
      this.fragments.set(id,tiles);
    }
  }
  setBackground(image){this.background=image}
  tint(canvas,image,color){
    const width=canvas.rasterWidth??image.width,height=canvas.rasterHeight??image.height;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(image,0,0);
    c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,canvas.width,canvas.height);c.globalCompositeOperation='source-over';
    if(canvas===this.ink||canvas===this.tinted)canvas.fragmentTiles=new Map();
  }
  edgeTint(canvas,image,color,spread=2){
    const width=canvas.rasterWidth??image.width,height=canvas.rasterHeight??image.height;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
    const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);
    const offsets=[[-1,0],[1,0],[0,-1],[0,1],[-.7,-.7],[.7,-.7],[-.7,.7],[.7,.7]];
    c.save();c.globalCompositeOperation='source-over';
    for(const ring of [spread*.55,spread]){
      c.globalAlpha=ring===spread?.38:.62;
      for(const [x,y] of offsets)c.drawImage(image,x*ring,y*ring);
    }
    c.globalAlpha=1;c.drawImage(image,0,0);
    c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,canvas.width,canvas.height);
    // Keep a luminous glyph core instead of hollowing out the center.
    c.globalCompositeOperation='source-atop';c.globalAlpha=.42;c.drawImage(image,0,0);
    c.globalCompositeOperation='source-in';c.fillStyle=color;c.fillRect(0,0,canvas.width,canvas.height);
    c.globalCompositeOperation='lighter';c.globalAlpha=.32;c.drawImage(image,0,0);
    c.restore();c.globalCompositeOperation='source-over';c.globalAlpha=1;
    if(canvas===this.noteEdge)canvas.fragmentTiles=new Map();
  }
  updateColors(settings){
    const s=this.score;
    const parts=renderParts(settings.parts),glow=parts.effects&&settings.glow>0;
    const marks=parts.marks||parts.effects&&!['notes','beams','staff','marks','header','cursor'].some(key=>parts[key]);
    const docked=settings.motion!=='static'&&settings.layout!=='rows'&&(settings.layout?settings.headerMode==='dock':settings.motion==='sticky');
    const body=docked&&s.dockedStructureImage||s.stickyStructureImage;
    if((glow&&settings.glowNote!==false||!settings.layout&&settings.scatter>0)&&this.colors.highlight!==settings.color){
      this.tint(this.tinted,s.noteImage,settings.color);this.colors.highlight=settings.color;
    }
    // The halo sprite re-renders whenever color or feather changes: 512 px keeps
    // the gradient smooth even when a large radius scales it up.
    const glowKey=`${settings.color}:${settings.glowFeather??50}`;
    if(this.colors.glowSprite!==glowKey){
      const c=this.glowSprite.getContext('2d'),g=c.createRadialGradient(256,256,0,256,256,256),f=clamp((settings.glowFeather??50)/100,0,1);
      g.addColorStop(0,'#fff8e9');
      g.addColorStop(.012+f*.05,rgba(settings.color,.98));
      g.addColorStop(.05+f*.2,rgba(settings.color,.5));
      g.addColorStop(.16+f*.42,rgba(settings.color,.2));
      g.addColorStop(.42+f*.5,rgba(settings.color,.06));
      g.addColorStop(.72+f*.26,rgba(settings.color,.015));
      g.addColorStop(1,rgba(settings.color,0));
      c.clearRect(0,0,512,512);c.fillStyle=g;c.fillRect(0,0,512,512);this.colors.glowSprite=glowKey;
    }
    for(const [key,image,color,needed] of [['ink',s.noteImage,settings.noteColor,parts.notes],['structInk',s.structureImage,settings.markColor||settings.noteColor,!s.markRegions&&parts.marks],['structGlow',s.structureImage,settings.color,glow&&(parts.header||!s.markRegions&&parts.marks)],['stickyInk',body,settings.markColor||settings.noteColor,!s.markRegions&&parts.marks],['stickyGlow',body,settings.color,glow&&!s.markRegions&&parts.marks],['staffInk',s.staffLineImage,settings.staffColor||settings.noteColor,parts.staff||parts.header],['staffInkNoLedger',s.staffLineImageNoLedger||s.staffLineImage,settings.staffColor||settings.noteColor,parts.staff||parts.header],['headerInk',s.header.image,settings.markColor||settings.noteColor,parts.header]]){
      if(!needed)continue;
      const cacheKey=key==='stickyInk'||key==='stickyGlow'?`${color}:${docked}`:color;
      if(this.colors[key]!==cacheKey){this.tint(this[key],image,color);this.colors[key]=cacheKey}
    }
    const edgeKey=`${settings.color}:${settings.glowFeather??50}:${docked}`;
    if(settings.glowShape==='edge'&&glow){
      const spread=Math.max(1,Math.round((settings.glowFeather??50)/25));
      for(const [key,image,needed] of [['noteEdge',s.noteImage,settings.glowNote!==false],['structEdge',s.structureImage,parts.header||!s.markRegions&&parts.marks],['stickyEdge',body,!s.markRegions&&parts.marks]]){
        if(needed&&this.colors[key]!==edgeKey){this.edgeTint(this[key],image,settings.color,spread);this.colors[key]=edgeKey}
      }
    }
    if(!s.markRegions&&parts.header&&s.sourceHeaderImage&&this.colors.sourceHeaderInk!==settings.markColor){this.tint(this.sourceHeaderInk,s.sourceHeaderImage,settings.markColor||settings.noteColor);this.colors.sourceHeaderInk=settings.markColor}
    if(s.markImage){
      for(const [key,image,color,needed] of [['markInk',s.markImage,settings.markColor||settings.noteColor,marks],['markGlow',s.markImage,settings.color,marks&&glow],['inlineHeaderInk',s.inlineHeaderImage,settings.markColor||settings.noteColor,parts.header&&settings.motion==='static']]){
        if(!needed)continue;
        if(this.colors[key]!==color){this.tint(this[key],image,color);this.colors[key]=color}
      }
      const key=`${settings.color}:${settings.glowFeather}`;
      if(marks&&settings.glowShape==='edge'&&glow&&this.colors.markEdge!==key){
        this.edgeTint(this.markEdge,s.markImage,settings.color,Math.max(1,Math.round((settings.glowFeather??50)/25)));this.colors.markEdge=key;
      }
    }
  }
  backgroundFrame(settings,w,h){
    const c=this.ctx;c.globalAlpha=1;c.globalCompositeOperation='source-over';c.clearRect(0,0,w,h);if(settings.transparent)return;
    c.fillStyle=settings.backgroundColor;c.fillRect(0,0,w,h);
    if(this.background){
      const ratio=Math.max(w/this.background.width,h/this.background.height),iw=this.background.width*ratio,ih=this.background.height*ratio;
      c.drawImage(this.background,(w-iw)/2,(h-ih)/2,iw,ih);c.fillStyle=rgba(settings.backgroundColor,settings.backgroundDim/100);c.fillRect(0,0,w,h);
    }
  }
  state(id,time,x,w,settings){
    const state=eventState(this.score.occurrences.get(id)||[],time),{active,previous,next}=state;
    const played=!!previous&&!active&&time>=(previous.visualEnd??previous.soundEnd??previous.end)&&(!next||next.start-time>2);
    state.played=played;state.entry=!settings.layout&&settings.fly>0?clamp((x/w-.70)/.30,0,1):0;state.exit=!settings.layout&&settings.scatter>0&&played?clamp((w*.22-x)/(w*.22),0,1):0;
    return state;
  }
  // Pulse snaps while sounding; sweep follows note onsets on either side of time.
  glowLevel({active,previous,next,occurrences},time,settings){
    if(settings.glowMode!=='sweep'&&!settings.glowOffset)return active?1:0;
    const t=time-(settings.glowOffset??0);
    const events=occurrences?.length?occurrences:[active,previous,next];
    if(settings.glowMode!=='sweep'){
      return events.some(e=>e&&t>=e.start&&t<(e.visualEnd??e.soundEnd??e.end))?1:0;
    }
    const options={peak:(settings.glowPeak??100)/100,valley:(settings.glowValley??0)/100,range:settings.glowRange??1.4};
    let level=0;
    for(const event of events)if(event)level=Math.max(level,sweepGlowEnvelope(t,event.start,options));
    return level;
  }
  // Halo radius combines the bloom range with the user radius multiplier.
  // Header staff bridge painted from the body's own staff raster with the same
  // vertical resampling as the active body path (measure tiles or full
  // raster), so pinned and moving lines share spacing and anti-aliasing. The
  // bridge abuts the body at the masked seam (or where the body staff begins
  // during the opening runway) and never overlaps it, avoiding doubled alpha.
  staffBridge(settings,{w,top,left,scale,staffSeam,measureEffects}){
    const s=this.score,ink=this.staffInkNoLedger||this.staffInk;
    if(!ink?.width||!ink?.height||typeof document==='undefined')return undefined;
    const rs=this.rasterScale||1,alpha=opacity(settings,'staffOpacity',75);
    // Max-blend the fading tail so it only fills runway pixels where the body
    // staff is missing (opening gap, decayed measures) instead of adding to
    // lines that are already there. Blend modes work on unpremultiplied
    // colour, so the tail is flattened onto black (or white for dark ink) to
    // make the blend a true per-pixel max/min. A transparent frame has no
    // backdrop to compare against and keeps the plain overlapping fade.
    const blend=settings.transparent?null:colorLuminance(settings.staffColor||settings.noteColor)>=colorLuminance(settings.backgroundColor)?'lighten':'darken';
    return (ctx,bridgeStart,lineStart,cutoff,fadeEnd)=>{
      if(alpha<=0)return;
      const sx=Math.min(ink.width-1,Math.max(0,Math.floor((lineStart+2)*rs)));
      const bodyStart=Math.round(left+lineStart*scale);
      const end=Math.min(w,Math.max(staffSeam,bodyStart));
      let source=ink,sy=0,sh=ink.height,y=top,height=s.height*scale;
      ctx.globalAlpha=alpha;
      if(measureEffects){
        // Same crop and integer-height intermediate as measureTile().
        const contentTop=s.contentTop??0,contentHeight=s.contentHeight??s.height;
        const column=this.bridgeColumn??=document.createElement('canvas');
        const key=`${sx}:${scale}:${alpha}:${contentTop}:${contentHeight}`;
        if(column.key!==key||column.ink!==ink){
          column.width=1;column.height=Math.max(1,Math.ceil(contentHeight*scale));
          const cc=column.getContext('2d');cc.clearRect(0,0,1,column.height);cc.globalAlpha=alpha;
          cc.drawImage(ink,sx,contentTop*rs,1,contentHeight*rs,0,0,1,contentHeight*scale);
          column.key=key;column.ink=ink;
        }
        source=column;sy=0;sh=column.height;y=top+contentTop*scale;height=column.height;ctx.globalAlpha=1;
      }
      const ssx=source===ink?sx:0;
      if(end>bridgeStart)ctx.drawImage(source,ssx,sy,1,sh,bridgeStart,y,end-bridgeStart,height);
      const tailStart=Math.max(bridgeStart,Math.min(cutoff,end)),tailWidth=Math.ceil(fadeEnd-tailStart);
      if(!(tailWidth>0)||!ctx.createLinearGradient)return;
      const tail=this.bridgeTail??=document.createElement('canvas');
      tail.width=tailWidth;tail.height=Math.max(1,Math.ceil(height));
      const tc=tail.getContext('2d');tc.globalCompositeOperation='source-over';tc.globalAlpha=source===ink?alpha:1;tc.clearRect(0,0,tail.width,tail.height);
      tc.drawImage(source,ssx,sy,1,sh,0,0,tailWidth,height);tc.globalAlpha=1;
      const gradient=tc.createLinearGradient(0,0,tailWidth,0);
      const solid=clamp((cutoff-tailStart)/tailWidth,0,1);
      gradient.addColorStop(0,'#000');gradient.addColorStop(solid,'#000');gradient.addColorStop(1,'transparent');
      tc.globalCompositeOperation='destination-in';tc.fillStyle=gradient;tc.fillRect(0,0,tailWidth,tail.height);
      if(blend){tc.globalCompositeOperation='destination-over';tc.fillStyle=blend==='lighten'?'#000':'#fff';tc.fillRect(0,0,tailWidth,tail.height);ctx.globalCompositeOperation=blend}
      ctx.globalAlpha=1;ctx.drawImage(tail,tailStart,y);
    };
  }
  haloRadius(scale,settings){return (14+(settings.bloom??45)*1.5)*scale*(settings.glowRadius??100)/100}
  scorePositionAt(time){
    const s=this.score;if(!s)return 0;
    const clamped=clamp(time,0,s.duration||0);
    return s.quarterStops?positionAt(s.quarterStops,s.secondsToQuarter(clamped)):positionAt(s.stops,clamped);
  }
  spatialSpan(time,scale,settings){
    const cached=this.spatialCache;
    if(this.frameSettings===settings&&cached?.time===time&&cached.scale===scale)return cached;
    const halo=this.haloRadius(scale,settings),smooth=settings.glowMode==='sweep';
    if(!smooth)return {leadPx:Math.max(halo*.55,24*scale),trailPx:Math.max(halo*.85,38*scale)};
    const range=Math.max(.1,settings.glowRange??1.4);
    const x0=this.scorePositionAt(time),xAhead=this.scorePositionAt(time+range),xBehind=this.scorePositionAt(time-range);
    const span={time,scale,
      leadPx:Math.max(halo*1.15,(xAhead-x0)*scale,42*scale),
      trailPx:Math.max(halo*1.25,(x0-xBehind)*scale,48*scale)
    };
    if(this.frameSettings===settings)this.spatialCache=span;
    return span;
  }
  buildSpatialGradient(c,playheadX,leadPx,trailPx,color='#000000',valley=0){
    const lead=Math.max(4,leadPx),trail=Math.max(4,trailPx),x0=playheadX-trail,x1=playheadX+lead,span=x1-x0;
    const g=c.createLinearGradient(x0,0,x1,0);
    for(const s of glowStops){
      const x=s<0?playheadX+s*trail:playheadX+s*lead;
      const pos=clamp((x-x0)/span,0,1);
      const w=spatialGlowWeight(x,playheadX,lead,trail,valley);
      g.addColorStop(pos,rgba(color,clamp(w,0,1)));
    }
    return g;
  }
  // Staff-wide glow: clefs, keys, rests, marks, ties and lyrics light up where
  // the playhead sweeps across their x extent instead of blooming from the AABB center.
  drawGlowRegions(c,time,settings,{left=0,top=0,scale,w,baseAlpha=1,map,bounds,pinned=false,keepMoving=false,parts,xPosition,regions=this.score.glowRegions,excludeFadeGroup}={}){
    if(settings.glow<=0||!regions?.length)return;
    const glowTime=time-(settings.glowOffset??0);
    const smooth=settings.glowMode==='sweep',rs=this.rasterScale;
    const env=smooth?{peak:(settings.glowPeak??100)/100,valley:(settings.glowValley??0)/100,range:settings.glowRange??1.4}:null;
    const project=map||(region=>({x:left+region.x*scale,y:top+region.y*scale}));
    const halo=this.haloRadius(scale,settings),xPos=settings.glowOffset?this.scorePositionAt(glowTime):(xPosition??this.scorePositionAt(glowTime));
    const {leadPx,trailPx}=this.spatialSpan(glowTime,scale,settings),valley=smooth?clamp((settings.glowValley??0)/100,0,1):0;
    const edge=settings.glowShape==='edge',feather=clamp((settings.glowFeather??50)/100,0,1);
    if(!map&&regions===this.score.glowRegions&&this.glowIndex)regions=horizontalSlice(this.glowIndex,(-left-halo*4)/scale,(w-left+halo*4)/scale);
    for(const region of regions){
      if(excludeFadeGroup&&region.fadeGroup===excludeFadeGroup)continue;
      if(settings[region.toggle]===false)continue;
      if(parts&&parts[region.part]===false)continue;
      if(region.pinned&&pinned&&!(keepMoving&&region.moving))continue;
      if(bounds&&(region.x+region.w<bounds.x0||region.x>=bounds.x1))continue;
      const level=smooth
        ?sweepGlowEnvelope(glowTime,region.start,region.end,env)
        :glowTime>=region.start&&glowTime<region.end+.25?1:0;
      if(level<=.012)continue;
      const {x,y}=project(region),rw=region.w*scale,rh=region.h*scale;
      if(x+rw<-halo*4||x>w+halo*4)continue;
      const playheadX=project({x:xPos,y:region.y}).x;
      const progressive=progressiveKinds.has(region.kind)||rw>Math.max(26*scale,rh*1.45);
      // Pinned frames drop the opening clef/key/meter from the body; glow
      // crops from the full raster would leak them inside nearby mark boxes.
      const l=clamp(level,0,1),source=region.atlas?(edge?this.markEdge:this.markGlow):pinned&&!region.pinned&&!region.moving?(edge?this.stickyEdge:this.stickyGlow):(edge?this.structEdge:this.structGlow);
      const sourceScale=region.atlas?this.score.markAtlasScale||1:rs,sx=(region.atlas?region.sx:region.x)*sourceScale,sy=(region.atlas?region.sy:region.y)*sourceScale;
      if(progressive&&this.regionScratchCtx&&c.createLinearGradient){
        if(valley<=.004&&(x>playheadX+leadPx+halo||x+rw<playheadX-trailPx-halo))continue;
        const pad=Math.ceil(Math.min(96,Math.max(8,halo*.55))),sw=Math.max(1,Math.ceil(rw+pad*2)),sh=Math.max(1,Math.ceil(rh+pad*2));
        if(this.regionScratch.width<sw||this.regionScratch.height<sh){
          this.regionScratch.width=Math.max(this.regionScratch.width,sw);
          this.regionScratch.height=Math.max(this.regionScratch.height,sh);
        }
        const sc=this.regionScratchCtx;
        sc.save();sc.globalCompositeOperation='source-over';sc.globalAlpha=1;sc.shadowBlur=0;sc.clearRect(0,0,sw,sh);
        sc.drawImage(source,sx,sy,region.w*sourceScale,region.h*sourceScale,pad,pad,rw,rh);
        sc.globalCompositeOperation='destination-in';
        sc.fillStyle=this.buildSpatialGradient(sc,pad+(playheadX-x),leadPx,trailPx,'#000000',valley);
        sc.fillRect(0,0,sw,sh);sc.restore();
        const allPasses=edge
          ?[[halo*(.36+feather*.18),.55],[halo*(.18+feather*.08),.75],[Math.max(1,halo*.06),.95]]
          :[[halo*(.52+feather*.22),.5],[halo*(.24+feather*.12),.72],[Math.max(1,halo*.08),.95]];
        const passes=l*(settings.glow/100)<.14?allPasses.slice(-1):allPasses;
        // Mask the glyph before blooming; flattening the bloom first caps thin marks below note brightness.
        c.save();c.globalCompositeOperation='lighter';
        for(const [blur,alpha] of passes){
          c.globalAlpha=clamp(baseAlpha*settings.glow/100*l*alpha,0,1);
          c.shadowColor=settings.color;c.shadowBlur=Math.max(1,blur);
          c.drawImage(this.regionScratch,0,0,sw,sh,x-pad,y-pad,sw,sh);
        }
        c.restore();
        continue;
      }
      const allPasses=edge
        ?[[halo*(.36+feather*.18),.55],[halo*(.18+feather*.08),.75],[Math.max(1,halo*.06),.95]]
        :[[halo*(.52+feather*.22),.52],[halo*(.24+feather*.12),.76],[Math.max(1,halo*.08),.95]];
      const passes=l*(settings.glow/100)<.14?allPasses.slice(-1):allPasses;
      c.save();c.globalCompositeOperation='lighter';
      for(const [blur,alpha] of passes){
        c.globalAlpha=clamp(baseAlpha*settings.glow/100*l*alpha,0,1);
        c.shadowColor=settings.color;c.shadowBlur=Math.max(1,blur);
        c.drawImage(source,sx,sy,region.w*sourceScale,region.h*sourceScale,x,y,rw,rh);
      }
      c.restore();
    }
  }
  programmed(id,time,settings,viewport){
    if(!settings.motionProgramActive)return null;
    const occurrences=this.score.occurrences.get(id)||[];
    const next=occurrences.find(e=>e.start>time),previous=occurrences.findLast(e=>e.start<=time);
    const visits=this.measureVisits?.get(this.score.boxes?.get(id)?.measureId);
    const visit=visits&&performedMeasure(visits,time,0,this.currentVisit);
    const upcoming=next&&visit&&visit.start>time&&next.start>=visit.start&&next.start<visit.end;
    const lead=settings.motionProgram.enter.duration-(settings.motionProgram.enter.offset??0);
    const event=previous&&time<(previous.visualEnd??previous.soundEnd??previous.end)?previous:next&&(upcoming||time>=next.start-lead)?next:previous||next;
    if(!event)return null;
    const measure=this.eventMeasures?.get(event);
    if(viewport)for(const phase of ['enter','exit']){
      const offset=settings.motionProgram[phase].offset??0,frame=this.offsetCameras?.[phase];
      if(offset&&frame){
        const x=frame.left+viewport.sourceX*viewport.scale,state=this.state(id,time-offset,x,viewport.width,settings);
        viewport[phase+'Viewport']={x,active:!!state.active,played:state.played};
      }
    }
    const value=(viewport?edgeMotionAt:motionAt)(settings.motionProgram,time,event.start,noteExitTime(event,measure,settings),{enter:settings.noteArrival==='assemble',...viewport});
    if(value.flyin)applyFlyin(value,id);
    return settings.reducedMotion?{...value,x:0,y:0,rotation:0,scale:1}:value;
  }
  drawFragments(c,id,box,x,y,scale,state,settings,boundaryAlpha=1){
    const {entry,exit,played}=state,amount=entry>0?entry:exit,strength=(entry>0?settings.fly:settings.scatter)/100,atlas=exit>0?this.tinted:this.ink;
    for(const f of this.fragments.get(id)){
      const t=clamp((amount-f.delay*.35)/(1-f.delay*.35),0,1),travel=t*t*strength,dx=(entry>0?1:-1)*travel*(75+f.u*210)*scale,dy=travel*(f.v-.5)*400*scale;
      c.save();c.globalAlpha=clamp(1-t*.92,0,1)*(played?.65:1)*opacity(settings,'noteOpacity')*boundaryAlpha;
      c.translate(x+(f.dx+f.uw/2)*scale+dx,y+(f.dy+f.uh/2)*scale+dy);c.rotate(travel*(f.r-.5)*3.5);
      c.drawImage(atlas,f.sx,f.sy,f.sw,f.sh,-f.uw*scale/2,-f.uh*scale/2,f.uw*scale,f.uh*scale);c.restore();
    }
  }
  drawBeam(c,beam,time,settings,{left,top,scale,w,xPosition,notation,effects,headerFade=1}){
    const box=beam.box,x=left+box.x*scale,y=top+box.y*scale;if(!settings.motionProgramActive&&(x+box.w*scale < -220*scale||x>w+220*scale))return;
    const state=this.state(beam.noteId,time,x,w,settings),{active,played,entry,exit}=state;
    const level=effects?this.beamGlowLevel(state,box,time,xPosition,scale,settings):0;
    const amount=active?0:entry>0?entry:exit,strength=settings.layout?0:((entry>0?settings.fly:settings.scatter)??0)/100,travel=amount*amount*strength;
    const dx=(entry>0?1:-1)*travel*(75+seed(beam.noteId)*210),dy=travel*(seed(beam.noteId+'v')-.5)*400;
    const custom=this.programmed(beam.noteId,time,settings,{x,width:w,sourceX:box.x,scale,active:!!active,played}),classic=custom?.fragments?.style==='classic';
    const owner=custom&&!classic?this.score.boxes.get(beam.noteId):box,pivotX=(owner||box).x+(owner||box).w/2,pivotY=(owner||box).y+(owner||box).h/2;
    if(classic){const f=custom.fragments,travel=f.amount*f.amount*f.strength/100;if(!settings.reducedMotion){custom.x+=(custom.phase==='enter'?1:-1)*travel*(75+seed(beam.noteId)*210);custom.y+=travel*(seed(beam.noteId+'v')-.5)*400;custom.rotation+=travel*(seed(beam.noteId+'r')-.5)*3.5*180/Math.PI}custom.opacity*=1-f.amount*.92}
    c.save();c.translate(left+pivotX*scale+(custom?custom.x:dx)*scale,top+pivotY*scale+(custom?custom.y:dy)*scale);c.rotate(custom?custom.rotation*Math.PI/180:travel*(seed(beam.noteId+'r')-.5)*3.5);c.scale(scale*(custom?.scale??1),scale*(custom?.scale??1));
    const trace=()=>{c.beginPath();beam.points.forEach((p,i)=>c[i?'lineTo':'moveTo'](p.x-pivotX,p.y-pivotY));c.closePath()};
    const draw=()=>{
      if(notation){trace();c.globalAlpha=opacity(settings,'beamOpacity')*(custom?custom.opacity:(played?.65:1)*(1-amount*.92))*headerFade;c.fillStyle=settings.beamColor||settings.noteColor;c.fill()}
      if(effects&&level>.004){
        const base=c.globalAlpha*opacity(settings,'beamOpacity')*(custom?.opacity??1)*(1-amount*.92)*headerFade;
        this.renderBeamGlow(c,beam,pivotX,pivotY,level,time,xPosition,scale,settings,base);
      }
    };
    if(custom?.fragments&&!classic){
      // Keep alpha outside the callback: fragment fading multiplies it per tile.
      if(notation){c.globalAlpha=opacity(settings,'beamOpacity')*custom.opacity*headerFade;c.fillStyle=settings.beamColor||settings.noteColor;drawFragmentedShape(c,()=>{trace();c.fill()},{x:box.x-pivotX-1,y:box.y-pivotY-1,width:box.w+2,height:box.h+2,...custom.fragments,phase:custom.phase,key:beam.noteId+':beam',reducedMotion:settings.reducedMotion})}
      if(effects&&level>.004)drawFragmentedShape(c,()=>this.renderBeamGlow(c,beam,pivotX,pivotY,level,time,xPosition,scale,settings,c.globalAlpha*opacity(settings,'beamOpacity')*custom.opacity*headerFade),{x:box.x-pivotX-1,y:box.y-pivotY-1,width:box.w+2,height:box.h+2,...custom.fragments,phase:custom.phase,key:beam.noteId+':beam',reducedMotion:settings.reducedMotion});
    }else draw();
    c.restore();
  }
  drawBeamGroup(c,group,time,settings,{left,top,scale,w,xPosition,headerFade=1}){
    if(settings.glow<=0||settings.glowBeam===false)return;
    const box=group.box,x=left+box.x*scale;
    if(!settings.motionProgramActive&&(x+box.w*scale < -220*scale||x>w+220*scale))return;
    const noteIds=group.noteIds||[group.noteId];
    let displaced=false;
    if(settings.motionProgramActive||!settings.layout&&(settings.fly>0||settings.scatter>0))for(const id of noteIds){
      const nBox=this.score.boxes.get(id)||box,nx=left+nBox.x*scale;
      const st=this.state(id,time,nx,w,settings);
      const amount=st.active?0:st.entry>0?st.entry:st.exit,strength=settings.layout?0:((st.entry>0?settings.fly:settings.scatter)??0)/100;
      if(amount*strength>.005){displaced=true;break}
      const custom=this.programmed(id,time,settings,{x:nx,width:w,sourceX:nBox.x,scale,active:!!st.active,played:st.played});
      if(custom&&(custom.fragments||Math.abs(custom.x)>.01||Math.abs(custom.y)>.01||Math.abs(custom.rotation)>.01||Math.abs((custom.scale??1)-1)>.01)){displaced=true;break}
    }
    if(displaced){
      for(const part of (group.parts||[group]))this.drawBeam(c,part,time,settings,{left,top,scale,w,xPosition,notation:false,effects:true,headerFade});
      return;
    }
    const occurrences=this.beamOccurrences?.get(group)||noteIds.flatMap(id=>this.score.occurrences.get(id)||[]);
    const glowTime=time-(settings.glowOffset??0);
    const level=this.beamGlowLevel(eventState(occurrences,glowTime),box,time,xPosition,scale,settings);
    if(!(level>.012))return;
    const firstBox=this.score.boxes.get(noteIds[0])||box,firstState=this.state(noteIds[0],time,left+firstBox.x*scale,w,settings);
    const custom=this.programmed(noteIds[0],time,settings,{x:left+firstBox.x*scale,width:w,sourceX:firstBox.x,scale,active:!!firstState.active,played:firstState.played});
    const base=opacity(settings,'beamOpacity')*(custom?.opacity??1);
    const pivotX=box.x+box.w/2,pivotY=box.y+box.h/2;
    c.save();c.translate(left+pivotX*scale,top+pivotY*scale);c.scale(scale,scale);
    this.renderBeamGlow(c,group,pivotX,pivotY,level,time,xPosition,scale,settings,base);
    c.restore();
  }
  beamGlowLevel(state,box,time,xPosition,scale,settings){
    if(settings.glow<=0||settings.glowBeam===false)return 0;
    const glowTime=time-(settings.glowOffset??0);
    const xPos=settings.glowOffset?this.scorePositionAt(glowTime):xPosition;
    const smooth=settings.glowMode==='sweep';
    const noteLevel=this.glowLevel(state,time,settings);
    if(smooth&&noteLevel<=.012)return 0;
    if(!smooth&&(!settings.glowOffset&&state.active||noteLevel>0))return 1;
    const {leadPx,trailPx}=this.spatialSpan(glowTime,scale,settings);
    const focusX=clamp(xPos,box.x,box.x+box.w);
    const valley=smooth?clamp((settings.glowValley??0)/100,0,1):0;
    const spatial=spatialGlowWeight(focusX*scale,xPos*scale,leadPx,trailPx,valley);
    if(!smooth){
      const {previous,next}=settings.glowOffset&&state.occurrences?.length?eventState(state.occurrences,glowTime):state;
      const near=previous&&glowTime-(previous.visualEnd??previous.soundEnd??previous.end)<.35
        ||next&&next.start-glowTime<.35;
      return near&&xPos>=box.x-6&&xPos<=box.x+box.w+6?spatial:0;
    }
    const peak=(settings.glowPeak??100)/100;
    return Math.max(noteLevel,peak*spatial*clamp(noteLevel/Math.max(.01,peak*.65),0,1));
  }
  renderBeamGlow(c,beam,pivotX,pivotY,level,time,xPosition,scale,settings,baseAlpha=1){
    if(!(level>.012)||settings.glow<=0||settings.glowBeam===false)return;
    const glowTime=time-(settings.glowOffset??0);
    const xPos=settings.glowOffset?this.scorePositionAt(glowTime):xPosition;
    const box=beam.box,smooth=settings.glowMode==='sweep',edge=settings.glowShape==='edge';
    const halo=this.haloRadius(scale,settings),feather=clamp((settings.glowFeather??50)/100,0,1);
    const {leadPx,trailPx}=this.spatialSpan(glowTime,scale,settings),valley=smooth?clamp((settings.glowValley??0)/100,0,1):0;
    const clampedL=clamp(level,0,1),glowFactor=clamp(settings.glow/100,0,5);
    const trace=()=>{c.beginPath();beam.points.forEach((p,i)=>c[i?'lineTo':'moveTo'](p.x-pivotX,p.y-pivotY));c.closePath()};
    const grad=c.createLinearGradient?this.buildSpatialGradient(c,xPos-pivotX,leadPx/scale,trailPx/scale,settings.color,valley):settings.color;
    const allPasses=edge
      ?[[halo*(.44+feather*.2),2.2,.58],[halo*(.22+feather*.1),1.4,.8],[Math.max(1,halo*.09),.8,.98]]
      :[[halo*(.52+feather*.22),2.4,.55],[halo*(.25+feather*.12),1.5,.78],[Math.max(1,halo*.1),.8,.96]];
    const passes=clampedL*glowFactor<.14?allPasses.slice(-1):allPasses;
    for(const [blur,lineW,alpha] of passes){
      c.save();trace();c.globalCompositeOperation='lighter';
      c.globalAlpha=clamp(baseAlpha*glowFactor*alpha*clampedL,0,1);
      c.shadowColor=settings.color;c.shadowBlur=Math.max(1,blur);
      c.fillStyle=grad;c.strokeStyle=grad;
      c.lineJoin='round';c.lineCap='round';c.lineWidth=lineW;
      if(c.stroke)c.stroke();
      c.fill();c.restore();
    }
    c.save();trace();c.clip();
    c.globalAlpha=clamp(baseAlpha*(smooth?clampedL:1),0,1);
    if(c.createLinearGradient){
      c.fillStyle=grad;
      c.fillRect(box.x-pivotX-2,box.y-pivotY-2,box.w+4,box.h+4);
      c.globalCompositeOperation='lighter';c.globalAlpha=clamp(baseAlpha*glowFactor*.55*clampedL,0,1);
      c.fillStyle=this.buildSpatialGradient(c,xPos-pivotX,leadPx/scale*.6,trailPx/scale*.6,'#fff8e9',0);
      c.fillRect(box.x-pivotX-2,box.y-pivotY-2,box.w+4,box.h+4);
    }else{
      c.fillStyle=settings.color;c.fillRect(box.x-pivotX-1,box.y-pivotY-1,clamp(xPos-box.x+1,0,box.w+2),box.h+2);
    }
    c.restore();
  }
  drawSparks(c,id,x,y,elapsed,scale,settings){
    if(settings.particles<=0||elapsed<0||elapsed>1.3)return;
    const count=Math.min(128,Math.round(settings.particles*.26)),life=1.3,baseAlpha=c.globalAlpha;c.save();c.globalCompositeOperation='lighter';c.strokeStyle=settings.color;
    for(let i=0;i<count;i++){
      const n=seed(id+i),k=seed(id+i+'y'),age=elapsed-seed(id+i+'d')*.22;if(age<0||age>life)continue;
      const vx=(n-.72)*170*scale,vy=(k-.5)*210*scale,px=x+vx*age,py=y+vy*age+age*age*20*scale,a=(1-age/life)**2*.9;
      c.globalAlpha=baseAlpha*a;c.lineWidth=(.5+n)*scale;c.beginPath();c.moveTo(px,py);c.lineTo(px-vx*.035,py-vy*.035);c.stroke();
      if(i%5===0){c.globalAlpha=baseAlpha*a*.55;c.drawImage(this.glowSprite,px-13*scale,py-13*scale,26*scale,26*scale)}
    }
    c.restore();
  }
  cameraFrame(time,settings,w,scale){
    const s=this.score,modern=!!settings.layout;
    time=Math.max(0,time);
    const cameraTime=s.quarterStops?s.secondsToQuarter(time):time;
    const xPosition=positionAt(s.quarterStops??s.stops,cameraTime);
    const firstPosition=(s.quarterStops??s.stops)[0]?.x??0;
    const cameraPosition=modern?(settings.camera==='stationary'?firstPosition:firstPosition+(xPosition-firstPosition)*(settings.cameraAmount??100)/100):xPosition;
    let anchor=w*settings.anchor/100,left=anchor-cameraPosition*scale;
    if(settings.motion==='page'||modern&&settings.camera==='page'){
      const segment=w*(settings.pageSpan??80)/100/scale,start=Math.floor(Math.max(0,xPosition-s.stops[0].x)/segment)*segment;
      left=w*.10-s.stops[0].x*scale-start*scale;anchor=left+xPosition*scale;
    }
    const sticky=modern?settings.headerMode==='dock':settings.motion==='sticky';
    const furthestPosition=Math.max(xPosition,this.stickyTrack[lastTimeIndex(this.stickyTrack,cameraTime)]?.x??xPosition);
    const cameraPeak=modern?(settings.camera==='stationary'?firstPosition:firstPosition+(furthestPosition-firstPosition)*(settings.cameraAmount??100)/100):furthestPosition;
    // The connected-header option removes the entrance reserve so the first
    // moving glyph meets the pinned header at the same x coordinate.  Keep
    // the old breathing room when the bridge is disabled.
    // Leave a short screen-space entrance reserve after the fixed header. The
    // first glyph can then cross the spatial mask over several frames instead
    // of starting exactly on the crop edge.
    // Leave a real screen-space runway between the pinned header and the
    // opening glyph.  The old 28px reserve was shorter than the edge fade on
    // large previews, so the first note could appear to snap into the mask.
    // A connected header paints its staff bridge through this runway and keeps
    // the body flush with the pinned copy.
    // The score-scroll reference keeps the staff bridge continuous.  The old
    // switch is retained only for preset compatibility; rendering always uses
    // the connected geometry so the header and body cannot overlap by a pixel.
    const headerBridge=sticky;
    // Keep a real entrance runway after the pinned header.  The staff bridge
    // remains continuous through it, while the note mask uses the same space
    // to establish a longer, spatially stable opening fade.
    const openingGap=sticky?clamp(Number(settings.headerOpeningGap??64),0,240):0;
    const headerFrame=sticky?stickyFrame(s.header,w,scale,anchor,cameraPosition,firstPosition,cameraPeak,headerBridge,openingGap):null;
    if(sticky){anchor=headerFrame.anchor;left=headerFrame.left}
    if(modern)anchor=left+xPosition*scale;
    return {xPosition,cameraPosition,firstPosition,anchor,left,sticky,headerFrame,cutoff:headerFrame?.cutoff??0};
  }
  render(time,input){
    const s=this.score;if(!s)return;
    const settings={...input},modern=!!settings.layout,parts=renderParts(settings.parts);settings.parts=parts;
    this.frameSettings=settings;this.spatialCache=null;
    const headerStyle={...settings};settings.headerStyle=headerStyle;
    if(!parts.staff)settings.staffOpacity=0;
    if(!parts.marks)settings.markOpacity=0;
    if(!parts.cursor)settings.showLine=false;
    const {canvas,ctx,layer,layerCtx:c,noteLayer}=this,w=canvas.width,h=canvas.height;if(!(w>0&&h>0))return;
    const resolution=h/1080,scale=resolution*Math.min(1080*.48/s.height,2.2)*settings.zoom/100;
    const output=settings.outputLayer||'composite',notation=['composite','notation'].includes(output),effects=['composite','effects'].includes(output),cursor=['composite','cursor'].includes(output)&&settings.showLine;
    this.updateColors(settings);this.backgroundFrame(settings,w,h);
    if(settings.motion==='static'){renderStaticScore(this,time,settings);return}
    if(layer.width!==w||layer.height!==h){layer.width=w;layer.height=h}
    if(noteLayer.width!==w||noteLayer.height!==h){noteLayer.width=w;noteLayer.height=h}
    c.globalAlpha=1;c.globalCompositeOperation='source-over';c.clearRect(0,0,w,h);
    const nc=this.noteLayerCtx;nc.globalAlpha=1;nc.globalCompositeOperation='source-over';nc.clearRect(0,0,w,h);
    const {xPosition,cameraPosition,firstPosition,anchor,left,sticky,headerFrame,cutoff}=this.cameraFrame(time,settings,w,scale);
    const top=h*(settings.layoutY??54)/100-s.height*scale/2;
    this.offsetCameras={};
    if(settings.motionProgramActive)for(const phase of ['enter','exit']){
      const p=settings.motionProgram[phase];
      if(p.enabled!==false&&['classic-fragments','flyin'].includes(p.renderer)&&p.offset)this.offsetCameras[phase]=this.cameraFrame(time-p.offset,settings,w,scale);
    }
    this.currentVisit=this.measureTimeline[lastTimeIndex(this.measureTimeline,time,'start')];
    const measureEffects=(settings.pageDecay&&settings.pageDecay!=='none')||settings.scoreProgramActive;
    const markEffects=settings.markProgramActive||settings.markPageDecay&&settings.markPageDecay!=='none';
    const connectedStaff=sticky&&parts.staff;
    const staffSeam=Math.round(clamp(cutoff,0,w*.8));
    const shiftedFrames=new Map();
    const shiftedFrame=offset=>{
      if(!Number.isFinite(offset)||Math.abs(offset)<1e-9)return {xPosition,cameraPosition,firstPosition,anchor,left,sticky,headerFrame,cutoff};
      if(!shiftedFrames.has(offset))shiftedFrames.set(offset,this.cameraFrame(time-offset,settings,w,scale));
      return shiftedFrames.get(offset);
    };
    const offsetCutoff=offset=>{
      if(!sticky||!Number.isFinite(offset)||Math.abs(offset)<1e-9)return cutoff;
      const shifted=shiftedFrame(offset);
      return shifted.cutoff+left-shifted.left;
    };
    // One header fade drives notes and marks; separate edges made beams,
    // stems and rests of the same group fade at different rates.
    const noteOffset=settings.headerNoteFade===false?0:settings.headerNoteFadeOffset??0;
    const noteCutoff=offsetCutoff(noteOffset);
    const noteFadeFrame=shiftedFrame(noteOffset);
    // The first note is normally placed exactly at the cutoff. Keep the mask
    // a few screen pixels to the left until that note has travelled through
    // the entrance buffer. The edge then settles at the fixed header boundary;
    // every later fade is produced by the element's screen position, never by
    // a time-based alpha ramp.
    const openingBuffer=sticky&&settings.headerNoteFade!==false
      ?Math.max(0,24/Math.max(.1,scale)):0;
    const openingTravelKnown=Number.isFinite(noteFadeFrame.cameraPosition)&&Number.isFinite(firstPosition);
    const noteFadeWidth=sticky&&settings.headerNoteFade!==false
      ?Math.max(32*resolution,w*.02,headerFrame?.openingGap||0):0;
    // In a split body layer the header component is intentionally disabled,
    // but flow mode still needs the opening clef/key/meter in the moving body.
    // Use the marks visibility as the guard so the explicit flow-symbol switch
    // remains effective after the header is separated into its own layer.
    const flowHeaderSymbols=shouldKeepFlowHeaderSymbols(settings,modern,parts.marks!==false);
    if(measureEffects||markEffects)prepareMeasureEffects(this,settings,`scroll:${scale}:${sticky}`);
    const drawStructure=style=>{
    const structureParts=style.parts;
    if(measureEffects&&(notation||effects)&&(structureParts.staff||!s.markRegions&&structureParts.marks)){
      const target=Object.create(this);target.ctx=c;
      const current=this.currentVisit,lead=settings.scoreProgramActive?settings.scoreMotionProgram.enter.duration-(settings.scoreMotionProgram.enter.offset??0):0;
      const visibleMeasures=!settings.scoreProgramActive&&this.measureIndex?horizontalSlice(this.measureIndex,(cutoff-left)/scale,(w-left)/scale):this.measureVisits.values();
      for(const visits of visibleMeasures){
        const visit=performedMeasure(visits,time,lead,current);if(!visit)continue;
        const measure={...visit,sourceX:visit.x,sourceWidth:visit.endX-visit.x,x:left+visit.x*scale,y:top,width:(visit.endX-visit.x)*scale,scale,rowStart:sticky||modern};
        if(!settings.scoreProgramActive&&(measure.x+measure.width<cutoff||measure.x>w))continue;
        drawMeasureEffects(target,measure,time,style,notation,effects);
      }
    }
    // Measure effects already paint the staff inside each animated tile. A
    // second full-score staff raster here would sit above those tiles and make
    // the animated lines look permanently fixed.
    if(notation&&structureParts.staff&&!measureEffects){
      c.globalAlpha=opacity(style,'staffOpacity',75);
      if(sticky){
        // Staff lines belong to the moving score layer. The previous
        // implementation redrew them as a viewport-wide horizontal segment,
        // which made them look pinned while notes and barlines travelled.
        // Ledger lines can still be removed from this raster and redrawn with
        // their note when the dedicated option is enabled.
        c.drawImage(style.ledgerMotion?(this.staffInkNoLedger||this.staffInk):this.staffInk,left,top,s.width*scale,s.height*scale);
      }else c.drawImage(style.ledgerMotion?(this.staffInkNoLedger||this.staffInk):this.staffInk,left,top,s.width*scale,s.height*scale);
    }
    if(notation&&!measureEffects&&structureParts.marks&&!s.markRegions){
      c.globalAlpha=opacity(style,'markOpacity');
      const structureInk=flowHeaderSymbols?this.structInk:(sticky||modern?this.stickyInk:this.structInk);
      c.drawImage(structureInk,left,top,s.width*scale,s.height*scale);
      if(s.overlayImage)c.drawImage(s.overlayImage,left,top,s.width*scale,s.height*scale);
    }
    c.globalAlpha=1;
    };
    if(connectedStaff&&(notation||effects)){
      drawStructure({...settings,markOpacity:0,parts:{...parts,marks:false}});
      // Staff lines must not inherit the notes' left-edge fade: that fade was
      // erasing the bridge after it had already been drawn by the header.
      // Pixel-aligned so the raster staff bridge in the header meets the
      // body staff without an anti-aliased seam or overlap.
      maskScrollLayer(c,w,h,staffSeam,0);ctx.drawImage(layer,0,0);c.clearRect(0,0,w,h);
      drawStructure({...settings,staffOpacity:0,parts:{...parts,staff:false}});
    }else drawStructure(settings);
    if(notation&&!sticky&&s.markRegions&&settings.headerMode!=='hidden'&&parts.header){
      c.globalAlpha=opacity(headerStyle,'markOpacity');
      if(settings.headerMode!=='flow'||settings.headerFlowSymbols!==false)c.drawImage(this.headerInk,left,top,s.width*scale,s.height*scale);
      else for(const box of s.header.extras)c.drawImage(this.headerInk,box.x*this.rasterScale,box.y*this.rasterScale,box.w*this.rasterScale,box.h*this.rasterScale,left+box.x*scale,top+box.y*scale,box.w*scale,box.h*scale);
      c.globalAlpha=1;
    }else if(!s.markRegions&&modern&&!sticky&&settings.headerMode!=='hidden'&&parts?.header!==false&&notation&&!flowHeaderSymbols&&!settings.suppressFlowHeaderCopy){c.globalAlpha=opacity(headerStyle,'markOpacity');c.drawImage(this.sourceHeaderInk,left,top,s.width*scale,s.height*scale);c.globalAlpha=1}
    if(s.markRegions&&(notation||effects)&&(parts.marks||parts.effects)){
      if(sticky){
        drawMarks(this,time,settings,{ctx:c,left,top,scale,w,notation,effects,fadeGroup:'marks'});
        drawMarks(this,time,settings,{ctx:nc,left,top,scale,w,notation,effects,fadeGroup:'notes'});
      }else drawMarks(this,time,settings,{ctx:c,left,top,scale,w,notation,effects});
    }
    if(sticky&&notation&&parts.header&&s.header.repeatedMeters?.length){
      c.globalAlpha=opacity(headerStyle,'markOpacity');
      const protect=settings.headerNoteFade!==false&&noteCutoff<cutoff
        ?headerFadeActivation(cameraPosition,firstPosition,scale,openingBuffer):0;
      drawRepeatedMeters(c,this.headerInk,s.header.repeatedMeters,{left,top,scale,w,cutoff,fadeWidth:noteFadeWidth,protect},this.regionScratch);
      c.globalAlpha=1;
    }
    const smooth=settings.glowMode==='sweep',edgeGlow=settings.glowShape==='edge',halo=this.haloRadius(scale,settings),feather=clamp((settings.glowFeather??50)/100,0,1);
    const notePasses=edgeGlow
      ?[[halo*(.42+feather*.2),.52],[halo*(.2+feather*.1),.76],[Math.max(1,halo*.08),.95]]
      :[[halo*(.58+feather*.26),.56],[halo*(.28+feather*.14),.8],[Math.max(1,halo*.1),.98]];
    const padding=motionPadding(settings,this.glyphSize??0,halo/scale),x0=-left/scale-padding,x1=(w-left)/scale+padding;
    const visible=(index,fallback)=>index&&Number.isFinite(padding)?horizontalSlice(index,x0,x1):fallback;
    const noteEffects=effects&&parts.effects&&(settings.glow>0&&settings.glowNote!==false||settings.particles>0&&!settings.reducedMotion||!smooth&&!edgeGlow&&settings.trail>0);
    const notes=notation&&parts.notes||noteEffects?visible(this.noteIndex,s.boxes):[],noteFrames=new Map();
    for(const pass of ['notation','effects']){
    const passNotation=notation&&pass==='notation',passEffects=effects&&parts.effects&&pass==='effects';
    if(!passNotation&&!passEffects)continue;
    if(passEffects&&(parts.staff||parts.marks||parts.header)){
      this.drawGlowRegions(c,time,settings,{left,top,scale,w,xPosition,pinned:sticky,keepMoving:sticky,parts,regions:s.markRegions?s.glowRegions.filter(r=>!r.atlas):s.glowRegions,excludeFadeGroup:sticky?'notes':undefined});
      if(!s.markRegions&&sticky&&parts.marks){
        const movingGlow=s.glowRegions?.filter(region=>region.fadeGroup==='notes')||[];
        if(movingGlow.length)this.drawGlowRegions(nc,time,settings,{left,top,scale,w,xPosition,pinned:sticky,parts,regions:movingGlow});
      }
    }
    if(passNotation&&parts.beams)for(const beam of visible(this.beamIndex,s.beams))
      this.drawBeam(nc,beam,time,settings,{left,top,scale,w,xPosition,notation:true,effects:false});
    if(passEffects&&settings.glow>0&&settings.glowBeam!==false)for(const group of visible(this.beamGroupIndex,s.beamGroups||s.beams))
      this.drawBeamGroup(nc,group,time,settings,{left,top,scale,w,xPosition});
    if(passNotation&&parts.notes||passEffects&&noteEffects)for(const [id,box] of notes){
      const x=left+box.x*scale,y=top+box.y*scale,bw=box.w*scale,bh=box.h*scale;if(!settings.motionProgramActive&&(x < -bw-220*scale||x>w+220*scale))continue;
      let frame=noteFrames.get(id);
      if(!frame){
        const state=this.state(id,time,x,w,settings);
        frame={state,custom:this.programmed(id,time,settings,{x,width:w,sourceX:box.x,scale,active:!!state.active,played:state.played})};noteFrames.set(id,frame);
      }
      const {state,custom}=frame,{active,previous,played,entry,exit}=state,head=box.head||box,hx=left+(head.x+head.w/2)*scale,hy=top+(head.y+head.h/2)*scale,as=this.atlasScale;
      if(custom?.opacity<=0)continue;
      if(passNotation&&settings.ledgerMotion&&s.ledgerLines?.get(id)?.length){
        nc.save();nc.globalAlpha=custom?.opacity??1;nc.globalAlpha*=opacity(settings,'staffOpacity',75);
        const cx=x+bw/2,cy=y+bh/2;
        nc.translate(cx+(custom?.x||0)*scale,cy+(custom?.y||0)*scale);
        if(custom){nc.rotate(custom.rotation*Math.PI/180);nc.scale(custom.scale,custom.scale)}
        nc.scale(scale,scale);
        drawLedgerLines(nc,s.ledgerLines.get(id),box.x+box.w/2,box.y+box.h/2,custom||{},id,settings.staffColor||settings.noteColor,settings.reducedMotion);nc.restore();
      }
      if(passNotation&&parts.notes){
        if(custom){nc.save();nc.globalAlpha=custom.opacity*opacity(settings,'noteOpacity');nc.translate(x+bw/2+custom.x*scale,y+bh/2+custom.y*scale);nc.rotate(custom.rotation*Math.PI/180);nc.scale(custom.scale,custom.scale);drawFragmented(nc,this.ink,{sx:box.sx*as,sy:box.sy*as,sw:box.w*as,sh:box.h*as,x:-bw/2,y:-bh/2,width:bw,height:bh,...custom.fragments,phase:custom.phase,key:id,unit:scale,reducedMotion:settings.reducedMotion});nc.restore()}
        else if((entry>.015||exit>.015)&&!active)this.drawFragments(nc,id,box,x,y,scale,state,settings);
        else{nc.save();nc.globalAlpha=(played?.65:1)*opacity(settings,'noteOpacity');nc.drawImage(this.ink,box.sx*as,box.sy*as,box.w*as,box.h*as,x,y,bw,bh);nc.restore()}
      }
      if(passEffects){
        nc.save();const effectAlpha=custom?.opacity??1;nc.globalAlpha=effectAlpha;
        if(custom){const cx=x+bw/2,cy=y+bh/2;nc.translate(cx+custom.x*scale,cy+custom.y*scale);nc.rotate(custom.rotation*Math.PI/180);nc.scale(custom.scale,custom.scale);nc.translate(-cx,-cy)}
        const level=settings.glow>0&&settings.glowNote!==false?this.glowLevel(state,time,settings):0,edge=edgeGlow;
        if((level>.012||custom?.classic&&custom.phase==='exit')&&settings.glow>0&&settings.glowNote!==false){
          const l=smooth?clamp(level,0,1):1;
          const age=!smooth&&active?Math.max(0,time-(active.soundStart??active.start)):0,pulseBoost=!smooth&&active?1+.35*Math.exp(-age*7):1;
          const base=nc.globalAlpha*opacity(settings,'noteOpacity')*l*pulseBoost;
          const glyph=edge?this.noteEdge:this.tinted;
          // Pulse is a binary on/off state, so stacking the outer, middle and
          // inner shadow passes only repeats the same raster work for every
          // sounding note. Keep one middle pass for a compact bloom and leave
          // the layered treatment to sweep mode, where the feathered envelope
          // actually changes from frame to frame.
          const firstPass=smooth
            ?(l*(settings.glow/100)<.14?notePasses.length-1:0)
            :Math.max(0,notePasses.length-1);
          for(let i=firstPass;i<notePasses.length;i++){
            const [blur,alpha]=notePasses[i];
            nc.save();nc.globalCompositeOperation='lighter';nc.globalAlpha=clamp(base*settings.glow/100*alpha,0,1);
            nc.shadowColor=settings.color;nc.shadowBlur=Math.max(1,blur*(smooth?.72+.28*l:1));
            drawFragmented(nc,glyph,{sx:box.sx*as,sy:box.sy*as,sw:box.w*as,sh:box.h*as,x,y,width:bw,height:bh,...custom?.fragments,phase:custom?.phase,key:id,unit:scale,reducedMotion:settings.reducedMotion});
            nc.restore();
          }
        }
        const fragmentFade=1-(custom?.fragments?.amount??0);nc.globalAlpha*=fragmentFade;
        const release=previous?time-(previous.visualEnd??previous.soundEnd??previous.end):Infinity;
        if(!smooth&&!edge&&played&&release>=0&&release<.65&&settings.trail>0){
          const length=(1-release/.65)*settings.trail*1.65*scale;nc.save();nc.globalAlpha=effectAlpha*fragmentFade*(1-release/.65)*.36;const streak=nc.createLinearGradient(hx-length,0,hx,0);
          streak.addColorStop(0,rgba(settings.color,0));streak.addColorStop(1,rgba(settings.color,.9));nc.fillStyle=streak;nc.fillRect(hx-length,hy-1.2*scale,length,2.4*scale);nc.restore();
        }
        if(previous&&previous.attack!==false&&!settings.reducedMotion)this.drawSparks(nc,id,hx,hy,time-previous.start,scale,settings);
        nc.restore();
      }
    }
    }
    // Structure and notes are composited separately. The note layer receives
    // one stable edge mask, so a moving mark cannot change note alpha and
    // produce a flicker.
    const leftFade=sticky?0:w*.045;
    const innerRegions=sticky&&!s.markRegions?s.glowRegions?.filter(region=>region.fadeGroup==='notes')||[]:[];
    const movingRegions=sticky&&notation&&parts.marks
      ?innerRegions:[];
    const eraseMovingRegions=sticky&&parts.marks?innerRegions:[];
    // Remove note-attached lines from the structure layer, then redraw them
    // into the note layer. The same fixed-position mask will now fade their
    // visible pixels with the noteheads instead of restoring them as marks.
    if(eraseMovingRegions.length){
      c.save();c.globalCompositeOperation='destination-out';
      for(const region of eraseMovingRegions){
        const x=left+region.x*scale,y=top+region.y*scale;
        c.clearRect(x,y,region.w*scale,region.h*scale);
      }
      c.restore();
    }
    if(movingRegions.length){
      drawMovingRegions(nc,this.stickyInk,movingRegions,{left,top,scale,w,rasterScale:this.rasterScale});
    }
    // Keep the opening note layer unmasked until the camera has entered the
    // pinned area, then establish the edge through alpha instead of moving the
    // cutoff; a notehead straddling the boundary therefore never snaps.
    const noteMaskCutoff=sticky
      ?(settings.headerNoteFade===false||openingTravelKnown?noteCutoff:0)
      :cutoff;
    // Marks that reach left of the edge at the opening stay whole until the
    // score moves, then fade with the notes over the same entrance ramp.
    const noteMaskOpacity=sticky&&settings.headerNoteFade!==false&&openingTravelKnown
      ?headerFadeActivation(noteFadeFrame.cameraPosition,firstPosition,scale,openingBuffer)
      :1;
    // Mask the rendered pixels once with the note edge; restoring glyph bounds
    // lets long marks reach behind the header.
    maskScrollLayer(c,w,h,noteMaskCutoff,sticky?noteFadeWidth:leftFade,noteMaskOpacity);
    ctx.drawImage(layer,0,0);
    maskScrollLayer(nc,w,h,noteMaskCutoff,noteFadeWidth,noteMaskOpacity);ctx.drawImage(noteLayer,0,0);
    if(sticky&&notation&&parts?.header!==false){
      const staffEnd=cutoff+(headerFrame?.openingGap||0);
      // Keep the bridge line continuous through the mask edge.  The short
      // screen-space feather follows the reference renderer's destination-out
      // bridge and hides fractional-pixel seams when the body raster starts.
      // The opening runway is part of the header/body hand-off.  If the
      // bridge fades out before that runway ends, the staff appears to snap
      // or break even though the two rasters share the same geometry.
      const bridgeFadeWidth=Math.max(
        12*resolution,
        Math.min(40*resolution,w*.04),
        headerFrame?.openingGap||0,
      );
      // The raster bridge relies on the body staff being masked at the same
      // seam; without a connected body staff keep the vector bridge.
      const staffBridge=connectedStaff?this.staffBridge(settings,{w,top,left,scale,staffSeam,measureEffects}):undefined;
      drawStickyHeader(ctx,s.header,time,headerStyle,{w,top,scale,staffEnd,bridgeFadeWidth,geometry:headerFrame,staffBridge,left},this.headerInk);
    }
    if(cursor){
      drawScanline(ctx,settings,{x:anchor,centerY:top+s.height*scale/2,baseLength:(s.height+40)*scale,scale,resolution,width:Math.max(resolution,w/1400)});
    }
    if(settings.showTitle&&notation){
      const titleSize=clamp(w/resolution*.022,26,44)*resolution;ctx.fillStyle=settings.noteColor;ctx.font=`400 ${titleSize}px "Songti SC","SimSun",serif`;ctx.textBaseline='top';ctx.fillText(settings.title||s.title,w*.065,h*.105,w*.82);
      ctx.font=`${clamp(w/resolution*.01,14,20)*resolution}px "Segoe UI","Microsoft YaHei",sans-serif`;ctx.globalAlpha=.6;ctx.fillText(s.composer||s.instrument,w*.066,h*.105+titleSize+18*resolution,w*.82);ctx.globalAlpha=1;
    }
  }
}
