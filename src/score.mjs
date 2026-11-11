import createModule from './vendor/verovio-module.mjs';
import { VerovioToolkit } from './vendor/verovio.mjs';
import { noteEvents, cameraStops, pickRasterScale, timeAtX } from './timing.mjs';
import { extractMusicXMLTempos, retimeTimemap } from './performance.mjs';
import { splitBeamPolygon } from './beam.mjs';
import { prepareStickyHeaders, pinnedStaffHeader } from './header.mjs';
import { inspectNotation, glowRegionEligible } from './notation.mjs';
import { prepareTieSource, mergeTiedEvents, alignChordVisualEnds } from './ties.mjs';
import { extractMusicXMLDynamics } from './dynamics.mjs';

// These sibling notation lines belong to the moving note body even when the
// engraver emits them outside g.note. They must share the note mask rather
// than the independent header-mark fade.
// These elements are attached to the moving musical event.  Verovio has used
// both camel-case and lower-case class names for barlines across renderers;
// normalize them here so a version change cannot silently pin the barline in
// the structure raster again.
export const NOTE_FADE_KINDS=new Set(['tie','slur','tuplet','octave','barline','truebarline']);
export function notationFadeGroup(kind){
  const normalized=String(kind||'').replace(/[_-]/g,'').toLowerCase();
  return NOTE_FADE_KINDS.has(normalized)?'notes':'marks';
}

let modulePromise;
export function prepareEngine() { return modulePromise ||= createModule(); }

function xmlDocument(xml) {
  if (xml.length > 4_000_000) throw new Error('乐谱超过原型的 4 MB 限制，请先导出较短的选段。');
  if (/<!ENTITY/i.test(xml)) throw new Error('乐谱包含自定义 XML 实体，请重新导出标准 MusicXML。');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 文件格式有误，请从制谱软件重新导出 MusicXML。');
  if (doc.documentElement.localName !== 'score-partwise') throw new Error('请选择分部格式的 MusicXML（.musicxml 或 .xml）。压缩 MXL 暂未开放。');
  if (!doc.querySelector('note')) throw new Error('这份乐谱中没有音符或休止符。');
  if (doc.querySelectorAll('note').length > 3000) throw new Error('原型最多处理 3000 个音符，请先导出选段。');
  if ([...doc.querySelectorAll('part')].some(p => p.querySelectorAll(':scope > measure').length > 256)) throw new Error('原型最多处理 256 小节，请先导出选段。');
  return doc;
}

async function svgImage(svg) {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type:'image/svg+xml;charset=utf-8' }));
  try { image.src = url; await image.decode(); return image; }
  finally { URL.revokeObjectURL(url); }
}

// Decode an SVG layer at a multiple of its viewBox so sampling stays crisp.
// Coordinate math stays in viewBox units; only the decoded bitmap grows.
function rasterImage(element, scale) {
  const vb = element.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0 && scale > 1) {
    const w = Math.ceil(vb.width * scale), h = Math.ceil(vb.height * scale);
    element.setAttribute('width', w); element.setAttribute('height', h);
    element.style.width = `${w}px`; element.style.height = `${h}px`;
  }
  return svgImage(element);
}

function moveGraphic(node,parent){
  const matrix=parent.getScreenCTM().inverse().multiply(node.getScreenCTM());
  node.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
  parent.append(node);
}

function separateNoteParts(svg){
  // Lyrics and articulation marks remain in the notation layer when notes move.
  for(const mark of svg.querySelectorAll('g.note g.verse,g.note g.artic,g.note g.fing,g.note g.fermata,g.note g.ornam,g.note g.trill,g.note g.mordent,g.note g.turn,g.chord > g.artic,g.chord > g.fing,g.chord > g.fermata')){
    const note=mark.closest('g.note,g.chord');if(note)moveGraphic(mark,note.parentElement);
  }
  for(const chord of svg.querySelectorAll('g.chord')){
    const owner=chord.querySelector(':scope > g.note');if(!owner)continue;
    for(const part of chord.querySelectorAll(':scope > g.stem,:scope > g.flag,:scope > g.dots'))moveGraphic(part,owner);
  }
}

// Verovio emits ledger strokes either directly under a staff or inside a
// g.ledgerLines wrapper. Keep their geometry separate from the staff raster
// so the motion switch can move them with the note without rebuilding the
// imported SVG.
function collectLedgerLines(svg,rootRect,boxes){
  const result=new Map();
  for(const staff of svg.querySelectorAll('g.staff')){
    const paths=[...staff.querySelectorAll(':scope > path,:scope > g.ledgerLines > path')],rects=paths
      .map(path=>({path,rect:path.getBoundingClientRect()}))
      // Horizontal ledger paths have a zero-height geometric rect because
      // their visible thickness comes from stroke-width. Keep them in the
      // candidate set so they can follow their note during motion.
      .filter(({rect})=>rect.width>0&&rect.height>=0);
    if(rects.length<=5)continue;
    // Do not rely on DOM order: some Verovio builds emit ledger paths before
    // the five staff lines. The regular five-line y sequence is the staff;
    // everything outside its envelope is a candidate ledger.
    const byY=rects.slice().sort((a,b)=>(a.rect.top+a.rect.height/2)-(b.rect.top+b.rect.height/2));
    let staffLines=byY.slice(0,5),bestScore=Infinity;
    for(let start=0;start<=byY.length-5;start++){
      const candidate=byY.slice(start,start+5),ys=candidate.map(({rect})=>rect.top+rect.height/2);
      const gaps=ys.slice(1).map((y,index)=>y-ys[index]);
      const spacing=gaps.reduce((sum,gap)=>sum+gap,0)/gaps.length;
      if(!(spacing>0))continue;
      const variance=gaps.reduce((sum,gap)=>sum+(gap-spacing)**2,0)/gaps.length;
      const widthPenalty=candidate.reduce((sum,{rect})=>sum+1/Math.max(1,rect.width),0);
      const score=variance+widthPenalty*.02;
      if(score<bestScore){bestScore=score;staffLines=candidate}
    }
    if(staffLines.length<5)continue;
    const ys=staffLines.map(({rect})=>rect.top+rect.height/2),minY=Math.min(...ys),maxY=Math.max(...ys);
    const staffSet=new Set(staffLines.map(({path})=>path));
    for(const {path,rect} of rects){
      if(staffSet.has(path))continue;
      const y=rect.top+rect.height/2;
      if(rect.width<=0||rect.height<0||y>=minY-4&&y<=maxY+4)continue;
      const x1=rect.left-rootRect.left,x2=rect.right-rootRect.left,worldY=y-rootRect.top;
      let best=null;
      for(const [id,box] of boxes){
        const head=box.head||box,hx=head.x+head.w/2,hy=head.y+head.h/2;
        if(hx<x1-3||hx>x2+3)continue;
        const distance=Math.abs(hy-worldY);
        if(!best||distance<best.distance)best={id,distance};
      }
      if(!best)continue;
      // Verovio's stroke-width is expressed in SVG user units.  The canvas
      // coordinates stored below are already in the SVG's screen-space units,
      // so applying the raw value (for example 22) turns a thin ledger stroke
      // into a white rectangle over the notehead. Convert through the path's
      // screen CTM first, matching the visible staff-line thickness.
      const matrix=path.getScreenCTM?.();
      const screenScale=matrix
        ? Math.max(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d))
        : 0;
      const declaredWidth=Number(path.getAttribute('stroke-width'))||0;
      const width=Math.max(.5,declaredWidth*screenScale||rect.height||.5);
      path.setAttribute('data-liupu-ledger','true');
      const lines=result.get(best.id)||[];lines.push({x1,x2,y:worldY,width});result.set(best.id,lines);
    }
  }
  return result;
}

function makeNoteAtlas(svg,boxes,rootRect,nodes=new Map([...svg.querySelectorAll('g.note')].map(node=>[node.id,node]))){
  const ns='http://www.w3.org/2000/svg',padding=4,entries=[...boxes].sort((a,b)=>b[1].h-a[1].h);
  if(!entries.length){
    const empty=svg.cloneNode(false);empty.setAttribute('width','1');empty.setAttribute('height','1');empty.setAttribute('viewBox','0 0 1 1');
    return {svg:empty,width:1,height:1};
  }
  const area=entries.reduce((sum,[,b])=>sum+(b.w+padding*2)*(b.h+padding*2),0);
  const rowWidth=Math.max(...entries.map(([,b])=>b.w+padding*2),Math.min(4096,Math.ceil(Math.sqrt(area))));
  let x=0,y=0,rowHeight=0,width=0;
  for(const [,box] of entries){
    const w=box.w+padding*2,h=box.h+padding*2;
    if(x&&x+w>rowWidth){x=0;y+=rowHeight;rowHeight=0}
    box.sx=x+padding;box.sy=y+padding;x+=w;rowHeight=Math.max(rowHeight,h);width=Math.max(width,x);
  }
  const height=y+rowHeight;
  if(width>16384||height>16384||width*height>24_000_000)throw new Error('音符图集超出原型限制，请导出较短选段。');
  const atlas=svg.cloneNode(false);atlas.removeAttribute('style');atlas.setAttribute('width',width);atlas.setAttribute('height',height);atlas.setAttribute('viewBox',`0 0 ${width} ${height}`);atlas.setAttribute('overflow','hidden');
  for(const child of svg.children)if(['defs','style'].includes(child.localName))atlas.append(child.cloneNode(true));
  for(const [id,box] of entries){
    const note=nodes.get(id),tile=document.createElementNS(ns,'svg'),wrapper=document.createElementNS(ns,'g');
    for(const [name,value] of Object.entries({x:box.sx,y:box.sy,width:box.w,height:box.h,viewBox:`${box.x} ${box.y} ${box.w} ${box.h}`,overflow:'hidden'}))tile.setAttribute(name,value);
    // Flatten the original ancestors' coordinate transform into world pixels;
    // the cropped viewport contains only this note, even for overlapping chords.
    const matrix=new DOMMatrix().translate(-rootRect.left,-rootRect.top).multiply(note.parentElement.getScreenCTM());
    wrapper.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
    // Read only the SVG's own presentation attributes. Host UI icon styles such
    // as `svg { fill:none }` must never become baked into the raster atlas.
    const ancestors=[];for(let parent=note.parentElement;parent&&parent!==svg;parent=parent.parentElement)ancestors.unshift(parent);
    for(const ancestor of ancestors)for(const name of ['color','fill','stroke','fill-opacity','stroke-opacity','stroke-width','font-family','font-size']){
      const value=ancestor.style?.getPropertyValue(name)||ancestor.getAttribute(name);if(value)wrapper.setAttribute(name,value);
    }
    wrapper.append(note.cloneNode(true));tile.append(wrapper);atlas.append(tile);
  }
  return {svg:atlas,width,height};
}

function makeMarkAtlas(structure,svg){
  const containers=new Set(['system','measure','staff','layer','beam','chord','section','ending']);
  const nodes=new Map(),boxes=new Map(),groups=new Map();
  svg.replaceWith(structure);
  try{
    const root=structure.getBoundingClientRect();
    for(const shape of structure.querySelectorAll('path,polygon,polyline,line,text,use,rect,circle,ellipse')){
      if(shape.closest('defs,g.clef,g.keySig,g.meterSig,g.system > g.grpSym,g.system > g.label')||shape.matches('g.system > path'))continue;
      let owner=shape;
      while(owner.parentElement!==structure){
        const parent=owner.parentElement;
        if(!parent||parent.localName!=='g'||[...parent.classList].some(kind=>containers.has(kind)))break;
        owner=parent;
      }
      const rect=shape.getBoundingClientRect();
      if(!(rect.width>0||rect.height>0))continue;
      const bounds=groups.get(owner)||[];bounds.push(rect);groups.set(owner,bounds);
    }
    for(const [node,rects] of groups){
      const id=`mark:${boxes.size}`,x=Math.max(0,Math.min(...rects.map(r=>r.left-root.left))-2);
      const y=Math.max(0,Math.min(...rects.map(r=>r.top-root.top))-2);
      const right=Math.max(...rects.map(r=>r.right-root.left))+2,bottom=Math.max(...rects.map(r=>r.bottom-root.top))+2;
      boxes.set(id,{x,y,w:Math.ceil(right-x),h:Math.ceil(bottom-y),measureId:node.closest('g.measure')?.id,kind:node.getAttribute('class')?.split(/\s+/)[0]||node.localName});
      nodes.set(id,node);
    }
    return {atlas:makeNoteAtlas(structure,boxes,root,nodes),regions:[...boxes].map(([id,box])=>({id,...box}))};
  }finally{structure.replaceWith(svg)}
}

export async function loadScore(xml, filename) {
  const doc = xmlDocument(xml);
  const tieSource=prepareTieSource(doc);
  const dynamics=extractMusicXMLDynamics(doc);
  const tk = new VerovioToolkit(await prepareEngine());
  const staging = document.querySelector('#engraving');
  try {
    tk.setOptions({
      inputFrom:'xml', font:'Bravura', breaks:'none', adjustPageWidth:true, adjustPageHeight:true,
      header:'none', footer:'none', scale:60, svgViewBox:true, pageMarginTop:80,
      pageMarginBottom:80, pageMarginLeft:80, pageMarginRight:80,
      midiTempoAdjustment:1, xmlIdChecksum:true
    });
    if (!tk.loadData(new XMLSerializer().serializeToString(doc))) throw new Error('乐谱引擎未能读取文件，请检查 MusicXML 格式。');
    staging.innerHTML = tk.renderToSVG(1);
    const svg = staging.querySelector('svg');
    if (!svg) throw new Error('乐谱没有可渲染的谱面。');
    const vb = svg.viewBox.baseVal;
    const width = Math.ceil(vb.width), height = Math.ceil(vb.height);
    if (width > 30000 || height > 8000 || width * height > 24_000_000) throw new Error('谱面尺寸超出原型限制，请减少声部或导出较短选段。');
    // Layers are rasterized above unit size so glyphs stay sharp when zoomed or exported at high resolution.
    const rasterScale = pickRasterScale(width, height);
    svg.setAttribute('width', width); svg.setAttribute('height', height);
    const originalSVG=new XMLSerializer().serializeToString(svg);
    const notationReport=inspectNotation(doc,svg);
    svg.style.width = `${width}px`; svg.style.height = `${height}px`;
    svg.setAttribute('color', '#ffffff');
    svg.setAttribute('fill', '#ffffff');
    // A renderer-generated SVG is still isolated from external resources.
    svg.querySelectorAll('script,foreignObject,image,a').forEach(e=>e.remove());
    svg.querySelectorAll('*').forEach(el=>{
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || ((a.localName === 'href') && !a.value.startsWith('#'))) el.removeAttribute(a.name);
      }
      if (/^(black|#000|#000000)$/i.test(el.getAttribute('fill') || '')) el.setAttribute('fill', '#ffffff');
      if (/^(black|#000|#000000)$/i.test(el.getAttribute('stroke') || '')) el.setAttribute('stroke', '#ffffff');
      if (/^(black|#000|#000000)$/i.test(el.getAttribute('color') || '')) el.setAttribute('color', '#ffffff');
    });
    separateNoteParts(svg);
    const rootRect = svg.getBoundingClientRect();
    const systemRect=(svg.querySelector('g.system')||svg).getBoundingClientRect();
    const contentTop=Math.max(0,Math.floor(systemRect.top-rootRect.top)-8);
    const contentHeight=Math.min(height,Math.ceil(systemRect.bottom-rootRect.top)+8)-contentTop;
    const boxes = new Map();
    for (const node of svg.querySelectorAll('g.note')) {
      const r = node.getBoundingClientRect();
      const head=(node.querySelector('.notehead')||node).getBoundingClientRect();
      if (r.width > 0 && r.height > 0) boxes.set(node.id, {
        measureId:node.closest('g.measure')?.id,
        x:Math.max(0,r.left-rootRect.left-2), y:Math.max(0,r.top-rootRect.top-2),
        w:Math.ceil(r.width+4), h:Math.ceil(r.height+4),
        head:{x:Math.max(0,head.left-rootRect.left-1),y:Math.max(0,head.top-rootRect.top-1),w:Math.ceil(head.width+2),h:Math.ceil(head.height+2)}
      });
    }
    const ledgerLines=collectLedgerLines(svg,rootRect,boxes);
    const positions = new Map(boxes);
    for (const node of svg.querySelectorAll('g.rest, g.mRest')) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0) positions.set(node.id, {x:Math.max(0,rect.left-rootRect.left-2)});
    }
    const measurePositions = new Map([...svg.querySelectorAll('g.measure')].map((node,sourceIndex) => {
      const staffLine = node.querySelector('g.staff > path');
      const rect = (staffLine || node).getBoundingClientRect();
      const leadMarks=[...node.querySelectorAll('g.dir,g.tempo,g.dynam,g.reh')].map(mark=>mark.getBoundingClientRect().left-rootRect.left);
      return [node.id, {sourceIndex, x:Math.max(0,rect.left-rootRect.left), endX:rect.right-rootRect.left,contentStartX:Math.min(rect.right-rootRect.left,...leadMarks)}];
    }));
    const renderedId=(id,lookup)=>lookup.has(id)?id:lookup.has(id.replace(/-rend\d+$/,''))?id.replace(/-rend\d+$/,''):id;
    const rawMap = tk.renderToTimemap({includeMeasures:true,includeRests:true});
    const performance=retimeTimemap(rawMap,extractMusicXMLTempos(doc),[...measurePositions.keys()]);
    const header=await prepareStickyHeaders(svg,rawMap,performance,(element)=>rasterImage(element,rasterScale),rootRect,doc);
    const beams=[],beamGroups=[];
    for(const polygon of svg.querySelectorAll('g.beam > polygon')){
      const parent=polygon.closest('g.beam'),matrix=svg.getScreenCTM().inverse().multiply(polygon.getScreenCTM());
      const points=[...polygon.points].map(p=>{const q=new DOMPoint(p.x,p.y).matrixTransform(matrix);return {x:q.x,y:q.y}});
      const stems=[...parent.querySelectorAll('g.note')].map(note=>{
        const stem=note.querySelector('g.stem')||note.closest('g.chord')?.querySelector('g.stem');
        const r=(stem||note).getBoundingClientRect();return {id:note.id,x:r.left-rootRect.left+r.width/2};
      });
      const splitParts=splitBeamPolygon(points,stems).map((part,idx)=>({...part,id:`${parent.id}:${beams.length+idx}`}));
      beams.push(...splitParts);
      if(splitParts.length&&points.length>=3){
        const bx=Math.min(...points.map(p=>p.x)),by=Math.min(...points.map(p=>p.y));
        const bw=Math.max(...points.map(p=>p.x))-bx,bh=Math.max(...points.map(p=>p.y))-by;
        if(bw>.001&&bh>.001)beamGroups.push({
          id:`${parent.id}:group:${beamGroups.length}`,
          noteId:splitParts[0].noteId,
          noteIds:splitParts.map(p=>p.noteId),
          parts:splitParts,
          points,
          box:{x:bx,y:by,w:bw,h:bh}
        });
      }
    }
    const map=performance.timemap;
    const renderedEvent=e=>{const id=renderedId(e.id,boxes);return {...e,id,velocity:dynamics.velocities.get(id)??80}};
    const playback=mergeTiedEvents(noteEvents(map, id=>tk.getMIDIValuesForElement(id)).map(renderedEvent),tieSource.links);
    const {audioEvents}=playback;
    const chordMembers=[...svg.querySelectorAll('g.chord')].map(chord=>[...chord.querySelectorAll(':scope > g.note')].map(note=>note.id));
    const events=alignChordVisualEnds(playback.events,chordMembers);
    // Camera anchors include silent notation; audio events remain note-only.
    const quarterEvents=rawMap.flatMap(e=>[...(e.on||[]),...(e.restsOn||[])].map(id=>({id:renderedId(id,positions),start:e.qstamp})));
    const cameraMeasures=rawMap.filter(e=>e.measureOn).flatMap(e=>{
      const position=measurePositions.get(renderedId(e.measureOn,measurePositions));
      return position?[{time:e.qstamp,...position}]:[];
    });
    const quarterStops=cameraStops(quarterEvents,positions,Math.max(...rawMap.map(e=>e.qstamp)),cameraMeasures);
    const stops=quarterStops.map(stop=>({...stop,time:performance.quarterToSeconds(stop.time)}));
    // Verovio puts opening clef/key/meter symbols directly under g.staff in
    // most scores, but some layouts nest them in g.layer. Record every
    // line-start definition so the fixed header and scrolling body cannot
    // paint a second copy of the opening meter signature.
    const openingHeaderIds=new Set();
    const firstMeasure=svg.querySelector('g.measure');
    const firstNoteX=new Map();
    if(firstMeasure)for(const staff of firstMeasure.querySelectorAll('g.staff')){
      const xs=[...staff.querySelectorAll('g.note')].map(note=>note.getBoundingClientRect().left);
      if(xs.length)firstNoteX.set(staff,Math.min(...xs));
    }
    for(const staff of svg.querySelectorAll('g.staff'))
      for(const node of staff.querySelectorAll('g.clef,g.keySig,g.meterSig')){
        const pinned=pinnedStaffHeader(node,staff);
        // A few Verovio layouts wrap the opening meter in a layer even though
        // it is still a line-start definition. Keep it out of the scrolling
        // body when it appears before the first note of the opening measure;
        // later in-bar changes remain untouched.
        const measure=node.closest('g.measure'),openingWrapped=measure===firstMeasure&&firstNoteX.has(staff)&&node.getBoundingClientRect().left<=firstNoteX.get(staff)+1;
        if((pinned||openingWrapped)&&node.id)openingHeaderIds.add(node.id);
      }
    // Glow regions: every staff element outside note heads gets a light-up
    // window derived from when the playhead sweeps across its x extent.
    const glowClasses=[['clef','glowClef'],['keySig','glowKeyMeter'],['meterSig','glowKeyMeter'],['custos','glowClef'],
      ['rest','glowRest'],['mRest','glowRest'],['mRpt','glowRest'],['multiRest','glowRest'],
      ['dynam','glowMark'],['dir','glowMark'],['tempo','glowMark'],['reh','glowMark'],['hairpin','glowMark'],['octave','glowMark'],['breath','glowMark'],['pedal','glowMark'],['voltaBracket','glowMark'],
      ['tie','glowTie'],['slur','glowTie'],['barLine','glowMark'],['barline','glowMark'],['trueBarline','glowMark'],
      ['verse','glowLyric'],['artic','glowLyric'],['fing','glowLyric'],['trill','glowLyric'],['turn','glowLyric'],['mordent','glowLyric'],['arpeg','glowLyric'],['fermata','glowLyric'],['ornament','glowLyric'],['ornam','glowLyric'],['tuplet','glowLyric']];
    // A tie/slur/tuplet/octave line is part of the moving notation even when
    // Verovio places its SVG group outside g.note. Keep it in the same spatial
    // fade group as the noteheads. Dynamics, tempo, rehearsal and other marks
    // remain in the independent header/structure group.
    const glowRegions=[],seenGlowNodes=new Set();
    for(const [cls,toggle] of glowClasses){
      for(const node of svg.querySelectorAll(`g.${cls}`)){
        if(seenGlowNodes.has(node))continue;
        seenGlowNodes.add(node);
        if(!glowRegionEligible(node,cls))continue;
        const r=node.getBoundingClientRect();
        if(r.width<=0||r.height<=0||r.width>width)continue;
        const rx=Math.max(0,r.left-rootRect.left-2),ry=Math.max(0,r.top-rootRect.top-2);
        const rw=Math.min(width-rx,r.width+4),rh=Math.min(height-ry,r.height+4);
        if(rw<=0||rh<=0)continue;
        const kind=cls==='barline'||cls==='trueBarline'?'barLine':cls;
        const fadeGroup=notationFadeGroup(kind),noteAttached=fadeGroup==='notes';
        const region={toggle,kind,fadeGroup:noteAttached?'notes':'marks',part:['clef','keySig','meterSig','custos'].includes(kind)?'header':'marks',x:rx,y:ry,w:rw,h:rh};
        // Line-start clefs/keys are repainted by the pinned header in docked and
        // row modes; only glow them where the world layer actually draws them.
        if(['clef','keySig','meterSig','custos'].includes(cls)&&(
          node.parentElement?.matches('g.staff')||openingHeaderIds.has(node.id))){
          region.pinned=true;
        }
        // In-layer changes also glow in static rows, where they are not line-start headers.
        if(header.movingIds.has(node.id)||header.repeatedMeterIds.has(node.id))region.moving=true;
        region.start=timeAtX(stops,region.x);
        region.end=Math.max(timeAtX(stops,region.x+region.w),region.start+.2);
        glowRegions.push(region);
      }
    }
    glowRegions.sort((a,b)=>a.start-b.start);

    const duration = Math.max(0, ...map.map(e=>e.tstamp/1000), ...events.map(e=>e.end));
    if (!duration || !boxes.size || !events.length) throw new Error('这份乐谱没有可播放的音符。请先尝试含旋律的 MusicXML。');
    const structure = svg.cloneNode(true);
    structure.querySelectorAll('g.note').forEach(e=>e.remove());
    structure.querySelectorAll('g.beam > polygon,g.staff > path').forEach(e=>e.remove());
    // Ledger paths are painted with the staff layer in fixed mode or with
    // their note when ledgerMotion is enabled. They must not remain in the
    // generic structure raster, otherwise the moving copy would be doubled.
    structure.querySelectorAll('path[data-liupu-ledger]').forEach(e=>e.remove());
    const staffLines=svg.cloneNode(true);
    for(const shape of staffLines.querySelectorAll('path,polygon,polyline,line,text,use,rect,circle,ellipse')){
      if(!shape.closest('defs')&&!(shape.localName==='path'&&(shape.parentElement.matches('g.staff')||shape.matches('[data-liupu-ledger]'))))shape.remove();
    }
    const staffLinesNoLedger=staffLines.cloneNode(true);
    staffLinesNoLedger.querySelectorAll('path[data-liupu-ledger]').forEach(path=>path.remove());
    const stickyStructure=structure.cloneNode(true);
    // Definitions are painted separately in fixed-header mode; in-bar changes
    // remain visible. The id set also removes nested line-start symbols.
    // Remove every pinned definition from the scrolling structure, including
    // wrappers without stable IDs.  Keeping one of those nodes in the body
    // paints a second clef/key/meter beside the fixed header in detached mode.
    for(const node of [...stickyStructure.querySelectorAll('g.clef,g.keySig,g.meterSig')]){
      const staff=node.closest('g.staff');
      if(pinnedStaffHeader(node,staff)||node.id&&openingHeaderIds.has(node.id))node.remove();
    }
    stickyStructure.querySelectorAll('g.system > g.grpSym,g.system > g.label,g.system > path').forEach(e=>e.remove());
    const dockedStructure=stickyStructure.cloneNode(true);
    const handedOff=[...dockedStructure.querySelectorAll('g.clef,g.meterSig')].filter(node=>header.movingIds.has(node.id)||header.repeatedMeterIds.has(node.id));
    handedOff.forEach(node=>node.remove());
    const sourceHeaders=structure.cloneNode(true);
    for(const shape of sourceHeaders.querySelectorAll('path,polygon,polyline,line,text,use,rect,circle,ellipse')){
      const headerNode=shape.closest('g.clef,g.keySig,g.meterSig,g.system > g.grpSym,g.system > g.label,g.system > path');
      if(!shape.closest('defs')&&!(headerNode&&(
        headerNode.matches('g.system > g.grpSym,g.system > g.label,g.system > path')||
        pinnedStaffHeader(headerNode,headerNode.closest('g.staff'))||openingHeaderIds.has(headerNode.id))))shape.remove();
    }
    const noteAtlas=makeNoteAtlas(svg,boxes,rootRect);
    const marks=makeMarkAtlas(structure,svg),markAtlasScale=pickRasterScale(marks.atlas.width,marks.atlas.height,{max:2.5,limit:16384});
    const inlineHeaders=stickyStructure.cloneNode(true);
    for(const shape of inlineHeaders.querySelectorAll('path,polygon,polyline,line,text,use,rect,circle,ellipse')){
      if(!shape.closest('defs,g.clef,g.keySig,g.meterSig'))shape.remove();
    }
    const toggleByKind=new Map(glowClasses);
    for(const region of marks.regions){
      if(!region.measureId)region.measureId=[...measurePositions].find(([,measure])=>region.x<measure.endX)?.[0];
      Object.assign(region,{atlas:true,part:'marks',fadeGroup:notationFadeGroup(region.kind),toggle:toggleByKind.get(region.kind)||'glowMark',
        start:timeAtX(stops,region.x),end:Math.max(timeAtX(stops,region.x+region.w),timeAtX(stops,region.x)+.2)});
    }
    glowRegions.splice(0,glowRegions.length,...glowRegions.filter(region=>region.part==='header'),...marks.regions.filter(region=>region.toggle));
    const atlasScale=pickRasterScale(noteAtlas.width,noteAtlas.height,{max:2.5,limit:16384});
    const stickyImage=rasterImage(stickyStructure,rasterScale);
    const [structureImage, noteImage,staffLineImage,staffLineImageNoLedger,stickyStructureImage,sourceHeaderImage,dockedStructureImage,markImage,inlineHeaderImage] = await Promise.all([rasterImage(structure,rasterScale), rasterImage(noteAtlas.svg,atlasScale),rasterImage(staffLines,rasterScale),rasterImage(staffLinesNoLedger,rasterScale),stickyImage,svgImage(sourceHeaders),handedOff.length?rasterImage(dockedStructure,rasterScale):stickyImage,rasterImage(marks.atlas.svg,markAtlasScale),rasterImage(inlineHeaders,rasterScale)]);
    const occurrences = new Map();
    for (const e of events) {
      if (!occurrences.has(e.id)) occurrences.set(e.id, []);
      occurrences.get(e.id).push(e);
    }
    const measureTimes = map.filter(e=>e.measureOn).map(e=>({time:e.tstamp/1000,id:renderedId(e.measureOn,measurePositions)}));
    const measureRegions=[...measurePositions].map(([id,region])=>({id,...region}));
    const parts = [...doc.querySelectorAll('score-part > part-name')].map(e=>e.textContent);
    return {
      xml, filename, width, height, boxes, events, duration, structureImage, noteImage, noteAtlas:{width:noteAtlas.width,height:noteAtlas.height}, occurrences,beams,beamGroups,ledgerLines,staffLineImage,staffLineImageNoLedger,stickyStructureImage,dockedStructureImage,sourceHeaderImage,header,originalSVG,notationReport,rasterScale,atlasScale,glowRegions,
      markImage,markAtlas:{width:marks.atlas.width,height:marks.atlas.height},markAtlasScale,markRegions:marks.regions,inlineHeaderImage,
      stops, measureTimes,
      quarterStops, measureRegions, contentTop, contentHeight, audioEvents,
      playbackWarnings:[...new Set([...tieSource.warnings,...playback.warnings,...dynamics.warnings])],tiedContinuations:events.filter(e=>e.attack===false).length,
      secondsToQuarter:performance.secondsToQuarter,tempoAt:performance.tempoAt,tempoChanges:performance.tempoChanges,tempoWarnings:performance.warnings,
      title:doc.querySelector('work-title, movement-title')?.textContent || filename.replace(/\.(xml|musicxml)$/i,''),
      composer:doc.querySelector('creator[type="composer"]')?.textContent || '',
      bpm:performance.tempoChanges[0]?.bpm || 120,
      signature:`${doc.querySelector('time > beats')?.textContent || '—'} / ${doc.querySelector('time > beat-type')?.textContent || '—'}`,
      measures:doc.querySelector('part')?.querySelectorAll(':scope > measure').length || 0,
      instrument:parts.join(' · ') || '乐谱'
    };
  } finally { staging.replaceChildren(); tk.destroy(); }
}
