const smooth=t=>t*t*(3-2*t);
const kinds=['clef','keySig','meterSig'];

// getBoundingClientRect() excludes the stroke from a horizontal SVG path's
// height. Read the declared/computed stroke width in screen units so the
// pinned bridge uses the same thickness as the rasterized score body.
export function staffStrokeWidth(path,rect={}){
  const matrix=path?.getScreenCTM?.();
  const screenScale=matrix
    ?Math.max(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d))
    :1;
  const declared=Number.parseFloat(path?.getAttribute?.('stroke-width')||'');
  if(Number.isFinite(declared)&&declared>0)return declared*screenScale;
  const computed=globalThis.getComputedStyle?.(path)?.strokeWidth;
  const inherited=Number.parseFloat(computed||'');
  if(Number.isFinite(inherited)&&inherited>0)return inherited;
  return Math.max(.7,Number(rect.height)||0);
}

// A staff group may contain ledger paths alongside the five regular staff
// lines.  Keep the bridge tied to the regular five-line band; ledger strokes
// stay in the moving note layer.
export function selectStaffLinePaths(rects){
  // SVG staff lines are horizontal stroked paths.  Chromium reports their
  // geometric bounding box with height 0 (the stroke is not included), so
  // filtering on a positive height would silently remove every five-line
  // staff from the pinned header.  Width remains the reliable visibility
  // signal; vertical glyph paths still have a positive width as well and
  // are excluded by the caller's direct-child selection.
  const valid=(rects||[]).filter(({rect})=>rect&&rect.width>0&&rect.height>=0);
  if(valid.length<=5)return valid;
  const byY=valid.slice().sort((a,b)=>(a.rect.top+a.rect.height/2)-(b.rect.top+b.rect.height/2));
  let best=byY.slice(0,5),bestScore=Infinity;
  for(let start=0;start<=byY.length-5;start++){
    const candidate=byY.slice(start,start+5),ys=candidate.map(({rect})=>rect.top+rect.height/2);
    const gaps=ys.slice(1).map((y,index)=>y-ys[index]);
    const spacing=gaps.reduce((sum,gap)=>sum+gap,0)/gaps.length;
    if(!(spacing>0))continue;
    const variance=gaps.reduce((sum,gap)=>sum+(gap-spacing)**2,0)/gaps.length;
    const widthPenalty=candidate.reduce((sum,{rect})=>sum+1/Math.max(1,rect.width),0);
    const score=variance+widthPenalty*.02;
    if(score<bestScore){bestScore=score;best=candidate}
  }
  return best;
}

// Verovio normally places opening clefs, key signatures and meters directly
// under their staff.  Some scores (especially those with multiple voices or
// cautionary changes) wrap the same groups in a transparent container.  Keep
// treating those groups as part of the pinned header while never picking up a
// definition that lives inside a moving layer/note/chord.
export function pinnedStaffHeader(node,staff=node?.closest?.('g.staff')){
  if(!node||!staff||!node.matches?.('g.clef,g.keySig,g.meterSig'))return false;
  for(let parent=node.parentElement;parent&&parent!==staff;parent=parent.parentElement){
    if(parent.matches?.('g.layer,g.note,g.chord,g.beam'))return false;
  }
  // A renderer may insert a transparent grouping wrapper between the staff
  // and its opening definition. It is still pinned when no moving layer sits
  // between the node and the staff.
  return node.parentElement===staff||node.parentElement?.closest?.('g.staff')===staff;
}

function openingWrappedHeader(node,staff,firstMeasure){
  if(!firstMeasure||node.closest('g.measure')!==firstMeasure)return false;
  const xs=[...staff.querySelectorAll('g.note')].map(note=>note.getBoundingClientRect().left);
  return xs.length>0&&node.getBoundingClientRect().left<=Math.min(...xs)+1;
}

function findStaffHeader(staff,kind,firstMeasure=null){
  return [...staff.querySelectorAll(`g.${kind}`)].find(node=>visibleHeader(node)&&(pinnedStaffHeader(node,staff)||openingWrappedHeader(node,staff,firstMeasure)));
}

function visibleHeader(node){
  const rect=node.getBoundingClientRect();
  return rect.width>0&&rect.height>0;
}

// A repeated meter gets a new SVG id even when its visible glyphs are unchanged.
function meterShape(node){
  const bounds=node.getBoundingClientRect(),glyphs=[...node.querySelectorAll('use')];
  if(!(bounds.width>0&&bounds.height>0)||!glyphs.length)return null;
  const shape=[];
  for(const glyph of glyphs){
    const href=glyph.getAttribute('href')||glyph.getAttribute('xlink:href'),r=glyph.getBoundingClientRect();
    if(!href||!(r.width>0&&r.height>0))return null;
    shape.push([href,r.left-bounds.left,r.top-bounds.top,r.width,r.height]);
  }
  return shape;
}

function sameMeterShape(a,b){
  return !!a&&!!b&&a.length===b.length&&a.every((glyph,i)=>
    glyph[0]===b[i][0]&&glyph.slice(1).every((value,j)=>Math.abs(value-b[i][j+1])<.25));
}

// Header symbols are the engraver's own glyphs; only their horizontal positions are fixed.
export async function prepareStickyHeaders(svg,rawMap,performance,svgImage,rootRect,sourceDoc){
  const measures=[...svg.querySelectorAll('g.measure')],sourceStates=[],carry=[],current=[];
  const meterShapes=[],repeatedMeters=[],repeatedMeterIds=new Set();
  const transitions={clef:[],keySig:[],meterSig:[]},movingIds=new Set();
  const sourceKeys=[];let staffOffset=0;
  for(const part of sourceDoc.querySelectorAll('score-partwise > part')){
    const count=Number(part.querySelector('staves')?.textContent)||1;
    [...part.querySelectorAll(':scope > measure')].forEach((measure,index)=>{
      for(const child of measure.children){
        if(['note','forward','backup'].includes(child.localName))break;
        if(child.localName!=='attributes')continue;
        for(const key of child.querySelectorAll(':scope > key'))if(key.querySelector('fifths')?.textContent.trim()==='0'){
          sourceKeys[index]||=new Set();const number=Number(key.getAttribute('number'));
          for(let i=0;i<count;i++)if(!number||i===number-1)sourceKeys[index].add(staffOffset+i);
        }
      }
    });
    staffOffset+=count;
  }
  const widths={clef:0,keySig:0,meterSig:0};
  const rectOf=node=>{const r=node.getBoundingClientRect();return {x:r.left-rootRect.left,y:r.top-rootRect.top,w:r.width,h:r.height}};
  const firstMeasure=measures[0];
  const firstStaves=[...firstMeasure.querySelectorAll('g.staff')];
  const lines=firstStaves.map(staff=>{
    const paths=[...staff.querySelectorAll(':scope > path')]
      .map(path=>({path,rect:path.getBoundingClientRect()}))
      // Horizontal SVG staff paths have a zero-height geometric rect; their
      // visible thickness is carried by stroke-width.
      .filter(({rect})=>rect.width>0&&rect.height>=0);
    return selectStaffLinePaths(paths).map(({path,rect})=>{const r=rectOf(path);return {y:r.y+r.h/2,width:staffStrokeWidth(path,rect)}});
  });
  const clefGlyph=node=>(node?.querySelector('use')?.getAttribute('href')||node?.querySelector('use')?.getAttribute('xlink:href')||'').match(/#(E[0-9A-F]{3})-/)?.[1];
  const fullClefs=new Map(firstStaves.flatMap((staff,i)=>{const node=findStaffHeader(staff,'clef',firstMeasure);return node?[[clefGlyph(node),{box:rectOf(node),staff:i}]]:[]}));
  const clefBox=(node,staff)=>{
    const full=fullClefs.get({E07A:'E050',E07C:'E062'}[clefGlyph(node)]);
    return full?{...full.box,drawY:full.box.y+(lines[staff]?.[0]?.y||0)-(lines[full.staff]?.[0]?.y||0),id:node.id}:{...rectOf(node),id:node.id};
  };
  const repeatedMeter=(node,rect,staff)=>{
    const shape=meterShape(node),repeated=sameMeterShape(meterShapes[staff],shape);
    meterShapes[staff]=shape;
    if(repeated){
      repeatedMeters.push({...rect,id:node.id});
      if(node.id)repeatedMeterIds.add(node.id);
    }
    return repeated;
  };
  const snapshot=staves=>staves.map(staff=>({...staff}));
  const record=(before,marks,fallbackX)=>{
    const after=snapshot(current);
    for(const kind of kinds){
      const changed=after.map((staff,i)=>(before[i]?.[kind]?.id||'')!==(staff[kind]?.id||'')?i:-1).filter(i=>i>=0);
      if(!changed.length)continue;
      const movers=marks.filter(mark=>mark.kind===kind&&changed.includes(mark.staff));
      const x=movers.length?Math.min(...movers.map(mark=>mark.box.x)):fallbackX,at={};
      for(const staff of changed){
        const own=movers.filter(mark=>mark.staff===staff);
        at[staff]={x:own.length?Math.min(...own.map(mark=>mark.box.x)):fallbackX,moving:own.length>0};
      }
      transitions[kind].push({x,at,staves:after,movers});
      for(const mark of movers)if(mark.box.id)movingIds.add(mark.box.id);
    }
  };
  for(const [measureIndex,measure] of measures.entries()){
    const before=snapshot(current),found=[],consumed=new Set(),staves=[...measure.querySelectorAll('g.staff')];
    staves.forEach((staff,i)=>{
      carry[i]||={};current[i]||={};
      for(const kind of kinds){
        const node=findStaffHeader(staff,kind,firstMeasure);
        if(!node)continue;
        consumed.add(node);
        const rect=rectOf(node);widths[kind]=Math.max(widths[kind],rect.w);
        if(kind==='meterSig'&&repeatedMeter(node,rect,i))continue;
        carry[i][kind]=current[i][kind]={...rect,id:node.id};
        if(measureIndex>0)found.push({kind,staff:i,box:{...rect,id:node.id},moving:true});
      }
      // Cancellation naturals belong to the moving score, not the continuing C-major header.
      if(sourceKeys[measureIndex]?.has(i))carry[i].keySig=current[i].keySig=null;
    });
    if(measureIndex>0)record(before,found,rectOf(measure).x);
    sourceStates.push(snapshot(carry));
    // Keep every printed change, including multiple changes in the final bar.
    const inner=[];
    staves.forEach((staff,i)=>{
      for(const kind of ['clef','meterSig'])for(const node of staff.querySelectorAll(`g.${kind}`)){
        if(!consumed.has(node)&&visibleHeader(node))inner.push({kind,staff:i,node,box:{...rectOf(node),id:node.id},moving:true});
      }
    });
    inner.sort((a,b)=>a.box.x-b.box.x);
    for(const mark of inner){
      const {kind,staff,node,box}=mark;
      if(kind==='meterSig'&&repeatedMeter(node,box,staff))continue;
      const previous=snapshot(current);
      // Other layouts keep their measure snapshots; docking uses the original
      // glyph and size throughout, rather than swapping in an enlarged copy.
      carry[staff][kind]=kind==='clef'?clefBox(node,staff):box;
      current[staff][kind]=box;
      widths[kind]=Math.max(widths[kind],carry[staff][kind].w,box.w);
      record(previous,[mark],box.x);
    }
  }
  const firstClef=findStaffHeader(firstStaves[0],'clef',firstMeasure),clefX=firstClef?rectOf(firstClef).x:0;
  // The bridge starts at the first engraved staff line.  It is separate from
  // the clef position because the opening system may reserve extra room for a
  // brace, instrument label, or a rehearsal mark before the moving notation.
  const firstStaffRects=[...(firstStaves[0]?.querySelectorAll(':scope > path')||[])]
    .map(path=>({path,rect:path.getBoundingClientRect()}));
  const bridgeLines=selectStaffLinePaths(firstStaffRects);
  const bridgeStartX=bridgeLines.length
    ?Math.min(...bridgeLines.map(({rect})=>rect.left-rootRect.left))
    :clefX;
  const extras=[...svg.querySelectorAll('g.system > g.grpSym,g.system > g.label,g.system > path')].map(node=>{
    const box=rectOf(node);
    if(node.localName==='path'&&(box.w>0||box.h>0))return {...box,x:box.x-2,y:box.y-2,w:box.w+4,h:box.h+4};
    return box;
  }).filter(r=>r.w&&r.h);
  const minX=Math.min(clefX,...extras.map(r=>r.x));
  const columns={};let offset=clefX-minX;
  for(const kind of kinds){columns[kind]=offset;offset+=widths[kind]+(kind==='clef'?10:7)}
  const width=offset+12;
  const headerSVG=svg.cloneNode(true);
  for(const shape of headerSVG.querySelectorAll('path,polygon,polyline,line,text,use,rect,circle,ellipse')){
    if(!shape.closest('defs')&&!shape.closest('g.clef,g.keySig,g.meterSig,g.system > g.grpSym,g.system > g.label,g.system > path'))shape.remove();
  }
  const image=await svgImage(headerSVG),indices=new Map(measures.map((m,i)=>[m.id,i]));
  const states=rawMap.filter(e=>e.measureOn).map(e=>{
    const id=indices.has(e.measureOn)?e.measureOn:e.measureOn.replace(/-rend\d+$/,'');
    const staves=sourceStates[indices.get(id)]||sourceStates[0];
    return {time:performance.quarterToSeconds(e.qstamp),staves,key:staves.map(s=>kinds.map(k=>s[k]?.id||'').join(':')).join('|')};
  });
  return {image,states,base:sourceStates[0],transitions,movingIds,repeatedMeters,repeatedMeterIds,lines,extras,minX,clefX,bridgeStartX,columns,width};
}

export function stickyGeometry(header,w,scale){
  // Compress only horizontal header spacing on narrow video formats, preserving staff alignment.
  const xScale=Math.min(scale,w*.27/header.width),x=w*.022;
  return {x,xScale,cutoff:x+header.width*xScale};
}

export function stickyCameraTrack(stops){
  let peak=-Infinity;
  return stops.map(stop=>({time:stop.time,x:peak=Math.max(peak,stop.x,stop.arrivalX??-Infinity)}));
}

export function stickyFrame(header,w,scale,anchor,position,firstPosition,furthestPosition=position,headerBridge=false,openingGap=0){
  // A connected header owns the staff bridge up to the first moving glyph.
  // Removing the entrance reserve in that mode makes the opening note start
  // directly at the end of the pinned header instead of leaving a viewport
  // sized hole between the two layers.  The legacy detached mode keeps its
  // breathing room for the opening note.
  // Start the body at the end of the pinned header in both modes.  A detached
  // header still separates naturally once it docks while the score continues
  // moving; adding a reserve here would make the first frame jump as soon as
  // playback advances and would leave the opening note far from the header.
  const fixed=stickyGeometry(header,w,scale),gap=Math.max(0,Number(openingGap)||0);
  anchor=Math.max(anchor,fixed.cutoff+gap);
  // Reserve room for every header state without covering the opening note.
  // Until docking, this entire block moves at exactly the score's speed.
  const openingX=Math.max(fixed.x,Math.min(anchor+(header.minX-firstPosition)*scale,anchor-header.width*fixed.xScale-gap));
  const x=Math.max(fixed.x,openingX-(furthestPosition-firstPosition)*scale);
  return {...fixed,x,cutoff:x+header.width*fixed.xScale,anchor,left:anchor-position*scale,openingGap:gap};
}

export function drawStickyHeader(ctx,header,time,settings,{w,top,scale,staffEnd,bridgeFadeWidth=0,geometry,staffBridge,left},ink){
  const {x,xScale,cutoff}=geometry??stickyGeometry(header,w,scale);
  ctx.save();ctx.strokeStyle=settings.staffColor||settings.noteColor;ctx.globalAlpha=(settings.staffOpacity??75)/100;
  // The bridge belongs to the pinned header column and starts at the engraved
  // five-line staff edge, so the clef/key/meter stay aligned with the moving
  // staff after the body is masked at the dock boundary.
  // Use the actual left edge of the first five-line staff.  The clef often
  // sits several pixels to the right of that edge (and an instrument label or
  // brace can add more left-side room), so deriving the bridge from clefX
  // leaves a visible kink where the moving staff meets the pinned header.
  const headerLineStart=Number.isFinite(header.bridgeStartX)
    ?header.bridgeStartX
    :(Number.isFinite(header.clefX)?header.clefX-4:0);
  const bridgeStart=Math.min(cutoff,x+(headerLineStart-header.minX)*xScale);
  const fadeWidth=Math.max(0,Number(bridgeFadeWidth)||0),fadeEnd=Math.min(w,cutoff+fadeWidth);
  // A renderer-supplied bridge paints the staff with the body's own raster
  // pipeline so both sides share line spacing and anti-aliasing exactly.
  const rasterBridge=typeof staffBridge==='function';
  if(rasterBridge){ctx.save();staffBridge(ctx,bridgeStart,headerLineStart,cutoff,fadeEnd);ctx.restore()}
  if(!rasterBridge)for(const staff of header.lines)for(const line of staff){
    ctx.lineWidth=line.width*scale;ctx.beginPath();ctx.moveTo(bridgeStart,top+line.y*scale);
    if(fadeWidth>0&&ctx.createLinearGradient){
      const gradient=ctx.createLinearGradient(bridgeStart,0,fadeEnd,0);
      const span=Math.max(1,fadeEnd-bridgeStart),solid=clamp01((cutoff-bridgeStart)/span);
      gradient.addColorStop(0,settings.staffColor||settings.noteColor);
      gradient.addColorStop(solid,settings.staffColor||settings.noteColor);
      gradient.addColorStop(1,'transparent');
      ctx.strokeStyle=gradient;ctx.lineTo(fadeEnd,top+line.y*scale);
    }else ctx.lineTo(staffEnd??cutoff+2,top+line.y*scale);
    ctx.stroke();ctx.strokeStyle=settings.staffColor||settings.noteColor;
  }
  ctx.globalAlpha=(settings.markOpacity??100)/100;
  const rs=ink.rasterScale||1;
  for(const box of header.extras)ctx.drawImage(ink,box.x*rs,box.y*rs,box.w*rs,box.h*rs,x+(box.x-header.minX)*xScale,top+box.y*scale,box.w*xScale,box.h*scale);
  const paintBox=(b,dx,alpha)=>{
    if(!b||b.w<.1||b.h<.1||alpha<=0)return;
    ctx.globalAlpha=alpha*(settings.markOpacity??100)/100;
    ctx.drawImage(ink,b.x*rs,b.y*rs,b.w*rs,b.h*rs,dx,top+(b.drawY??b.y)*scale,b.w*xScale,b.h*scale);
  };
  // Position-driven hand-off (score-scroll's lockDistance): a change symbol
  // scrolls with the score, slides over the header and locks once its left
  // edge reaches its column.  The outgoing glyph fades over the same distance.
  const base=header.base??header.states?.[0]?.staves??[];
  const screen=sx=>left+sx*scale;
  const plans=[],sliding=[];
  for(const kind of kinds){
    if(!Number.isFinite(header.columns?.[kind]))continue;
    const colX=x+header.columns[kind]*xScale,list=Number.isFinite(left)?header.transitions?.[kind]||[]:[];
    // Each staff locks its own glyph, independently of other staves' changes.
    const mark=(t,staff)=>{
      if(t.at?.[staff])return t.at[staff];
      const mover=t.movers.find(m=>m.staff===staff);
      return mover?{x:mover.box.x,moving:true}:{x:t.x,moving:!t.at&&t.movers.length>0};
    };
    const dock=m=>m.moving?colX:cutoff;
    const reach=m=>m.moving
      ?clamp01((cutoff-screen(m.x))/Math.max(1,cutoff-colX))
      :clamp01((cutoff+fadeWidth-screen(m.x))/Math.max(1,fadeWidth));
    const staves=Math.max(base.length,...list.map(t=>t.staves.length));
    for(let staff=0;staff<staves;staff++){
      const events=list.filter(t=>!t.at||t.at[staff]);
      let index=-1;
      while(index+1<events.length&&screen(mark(events[index+1],staff).x)<=dock(mark(events[index+1],staff)))index++;
      plans.push({kind,colX,list:events,index,mark,reach,staff});
      for(let event=index+1;event<events.length;event++)for(const mover of events[event].movers){
        if(mover.staff!==staff)continue;
        const t=events[event],next=events[event+1];
        const sx=screen(mover.box.x);if(sx>w)continue;
        // Cancellation naturals leave the header empty: fade them as they dock.
        // Nearby changes can arrive before this glyph docks; keep its outgoing
        // fade continuous on both sides of the lock point.
        const alpha=(t.staves[staff]?.[kind]?1:1-smooth(reach(mark(t,staff))))*
          (next?1-smooth(reach(mark(next,staff))):1);
        const dx=Math.max(colX,sx);
        sliding.push({box:mover.box,dx,alpha});
      }
    }
  }
  for(const {kind,colX,list,index,mark,reach,staff} of plans){
    const next=list[index+1];
    const before=(index>=0?list[index].staves:base)[staff]?.[kind],after=next?.staves?.[staff]?.[kind];
    const changed=next&&(before?.id||'')!==(after?.id||'');
    const nextMark=next&&mark(next,staff),progress=next?smooth(reach(nextMark)):0;
    paintBox(before,colX,changed?1-progress:1);
  }
  // Source-over respects the glyph alpha; bounding boxes must not hide ink
  // behind their transparent spaces or cut holes in other moving glyphs.
  for(const s of sliding)paintBox(s.box,s.dx,s.alpha);
  ctx.restore();
}

function clamp01(value){return Math.max(0,Math.min(1,Number(value)||0))}

// In flowing-header mode the score keeps moving, but the line-start symbols
// must still survive the body mask long enough to meet the header column.  The
// full sticky header also paints staff lines and extras; this bridge deliberately
// paints only clef/key/meter glyphs so every other mark keeps the normal fade.
export function drawFlowHeaderSymbols(ctx,header,time,settings,{top=0,scale=1,geometry}={},ink,alpha=1){
  if(!ctx||!header||!ink||!(alpha>0))return;
  const {x,xScale}=geometry??stickyGeometry(header,ctx.canvas?.width||0,scale);
  const index=Math.max(0,header.states.findLastIndex(s=>s.time<=time));
  const state=header.states[index],old=header.states[Math.max(0,index-1)];
  if(!state)return;
  const progress=state.key!==old?.key&&state.time>old?.time
    ?smooth(Math.min(1,Math.max(0,(time-state.time)/.22))):1;
  const rs=ink.rasterScale||1;
  const columns=header.columns||{};
  const paint=(snapshot,kind,opacityValue,shiftX=0)=>{
    if(!snapshot||!(opacityValue>0))return;
    ctx.globalAlpha=opacityValue*alpha*(settings.markOpacity??100)/100;
    for(const staff of snapshot.staves||[]){
      const box=staff[kind];
      if(!box||box.w<.1||box.h<.1||!Number.isFinite(columns[kind]))continue;
      ctx.drawImage(
        ink,box.x*rs,box.y*rs,box.w*rs,box.h*rs,
        x+columns[kind]*xScale+shiftX*scale,
        top+(box.drawY??box.y)*scale,
        box.w*xScale,box.h*scale,
      );
    }
  };
  ctx.save();
  for(const kind of kinds){
    let changed=false;
    const length=Math.max(old?.staves?.length||0,state.staves?.length||0);
    for(let staff=0;staff<length;staff++){
      if((old?.staves?.[staff]?.[kind]?.id||'')!==(state.staves?.[staff]?.[kind]?.id||'')){changed=true;break}
    }
    if(changed&&progress<1){
      paint(old,kind,1-progress,-4*progress);
      paint(state,kind,progress,4*(1-progress));
    }else paint(state,kind,1);
  }
  ctx.restore();
}
