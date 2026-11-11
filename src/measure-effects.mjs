import { clamp, seed } from './timing.mjs';
import { motionAt, evaluateMotion, applyFlyin } from './motion-program.mjs';
import { measureEffectProgress, scoreEffectTime } from './effect-timing.mjs';
import { drawFragmented } from './fragment-render.mjs';
const opacity=(settings,key,fallback=100)=>clamp((settings[key]??fallback)/100,0,1);
const canvas=()=>document.createElement('canvas');

function measureTile(renderer,measure,settings){
  // A split flowing score deliberately has no `header` part: the opening
  // clef/key/meter still live in its marks raster and must remain available
  // when the flow-symbol switch is on. Include that switch in the tile key so
  // changing it cannot reuse a tile painted with the other structure source.
  const flowHeaderSymbols=settings.layout&&settings.parts?.marks!==false&&settings.headerMode==='flow'&&settings.headerFlowSymbols!==false;
  const cache=renderer.measureCache.tiles,key=`${measure.id}:${measure.rowStart}:${settings.staffOpacity}:${settings.markOpacity}:${settings.ledgerMotion?'moving':'fixed'}:${flowHeaderSymbols?'flow-symbols':'pinned-symbols'}:${measure.sourceX}:${measure.sourceWidth}:${measure.scale}`;
  if(cache.has(key))return cache.get(key);
  const tile=canvas(),scale=measure.scale,contentTop=renderer.score.contentTop??0,contentHeight=renderer.score.contentHeight??renderer.score.height;
  tile.width=Math.max(1,Math.ceil(measure.width));tile.height=Math.max(1,Math.ceil(contentHeight*scale));
  const c=tile.getContext('2d'),sourceWidth=Math.min(renderer.score.width-measure.sourceX,measure.sourceWidth+1/scale),targetWidth=sourceWidth*scale,rs=renderer.rasterScale||1;
  c.globalAlpha=opacity(settings,'staffOpacity',75);if(c.globalAlpha>0)c.drawImage(settings.ledgerMotion?(renderer.staffInkNoLedger||renderer.staffInk):renderer.staffInk,measure.sourceX*rs,contentTop*rs,sourceWidth*rs,contentHeight*rs,0,0,targetWidth,contentHeight*scale);
  c.globalAlpha=renderer.score.markRegions?opacity(settings.headerStyle??settings,'markOpacity'):opacity(settings,'markOpacity');
  // A flowing header has no pinned copy to replace the opening clef, key or
  // meter. Keep the original structure in that mode so measure effects do not
  // reintroduce the missing-symbol bug through their cached tiles.
  const structureImage=renderer.score.markRegions
    ?null
    :measure.rowStart&&!flowHeaderSymbols?renderer.stickyInk:renderer.structInk;
  if(c.globalAlpha>0&&structureImage)c.drawImage(structureImage,measure.sourceX*rs,contentTop*rs,sourceWidth*rs,contentHeight*rs,0,0,targetWidth,contentHeight*scale);
  if(!renderer.score.markRegions&&renderer.score.overlayImage&&settings.parts?.marks!==false)c.drawImage(renderer.score.overlayImage,measure.sourceX*rs,contentTop*rs,sourceWidth*rs,contentHeight*rs,0,0,targetWidth,contentHeight*scale);
  cache.set(key,tile);return tile;
}

function drawDecay(renderer,measure,tile,progress,time,settings,notation,effects){
  const c=renderer.ctx,resolution=renderer.canvas.height/1080,tileY=measure.y+(measure.contentTop??renderer.score.contentTop??0)*measure.scale;
  if(progress<=0){if(notation)c.drawImage(tile,measure.x,tileY);return}
  if(progress>=1)return;
  if(settings.reducedMotion){if(notation){c.save();c.globalAlpha*=1-progress;c.drawImage(tile,measure.x,tileY);c.restore()}return}
  if(settings.pageDecay==='fade'){if(notation){c.save();c.globalAlpha*=1-progress;c.drawImage(tile,measure.x,tileY);c.restore()}return}
  const burn=settings.pageDecay==='burn',sweep=burn||settings.decayTrigger==='progress',surface=renderer.measureCache.surface,edge=renderer.measureCache.edge;
  if(surface.width!==tile.width||surface.height!==tile.height){surface.width=edge.width=tile.width;surface.height=edge.height=tile.height}
  const s=surface.getContext('2d'),e=edge.getContext('2d'),cell=Math.max(2,3.5*resolution);
  s.globalCompositeOperation='source-over';s.globalAlpha=1;s.clearRect(0,0,surface.width,surface.height);s.drawImage(tile,0,0);
  e.globalCompositeOperation='source-over';e.globalAlpha=1;e.clearRect(0,0,edge.width,edge.height);
  s.globalCompositeOperation='destination-out';s.fillStyle='#000';
  const key=`${measure.id}:${measure.occurrence}`,live=settings.decayTrigger==='progress',front=live?progress:sweep?progress*1.32-.16:progress*1.125-.0625;
  const roughness=live?Math.min(.08,12*resolution/tile.width):.19,sharpness=live?1/Math.max(.005,10*resolution/tile.width):sweep?9:8;
  for(let y=0,row=0;y<tile.height;y+=cell,row++)for(let x=0,col=0;x<tile.width;x+=cell,col++){
    const n=seed(`${key}:${col}:${row}`),threshold=sweep?x/tile.width+(n-.5)*roughness:n;
    const keep=clamp((threshold-front)*sharpness+.5,0,1);
    if(keep<1){s.globalAlpha=1-keep;s.fillRect(x,y,cell+.2,cell+.2)}
    if(burn&&effects){const heat=Math.max(0,1-Math.abs(threshold-front)*15);if(heat>0){e.globalAlpha=heat;e.fillStyle=heat>.72?'#ffe8b0':'#f48642';e.fillRect(x,y,cell+.2,cell+.2)}}
  }
  s.globalCompositeOperation='source-over';s.globalAlpha=1;
  if(notation)c.drawImage(surface,measure.x,tileY);
  if(effects&&burn){
    e.globalCompositeOperation='destination-in';e.globalAlpha=1;e.drawImage(tile,0,0);e.globalCompositeOperation='source-over';
    c.save();c.globalAlpha*=.9;c.shadowColor='#f67c39';c.shadowBlur=9*resolution;c.drawImage(edge,measure.x,tileY);c.restore();
  }
  const density=settings.decayParticles??settings.particles;
  if(effects&&density>0&&(settings.parts?.staff!==false||String(measure.id).startsWith('header:'))){
    c.save();const baseAlpha=c.globalAlpha,count=Math.min(96,Math.round(6+density*.22)),lines=renderer.score.header.lines.flat();
    for(let i=0;i<count;i++){
      const n=seed(`${key}:spark:${i}`),v=seed(`${key}:sparkv:${i}`),life=.5+n*.65,age=((time-(live?measure.start:measure.decayEnd))*(.65+v)+n*life)%life;
      if(age<0)continue;
      const originX=burn?clamp(front-v*.13,0,1)*tile.width:n*tile.width,staff=lines[Math.floor(v*lines.length)];
      if(!staff)continue;
      const x=measure.x+originX+Math.sin(age*2+n*6)*9*resolution,y=measure.y+staff.y*measure.scale-age*(18+v*34)*resolution;
      c.globalAlpha=baseAlpha*(1-age/life)*Math.sin(progress*Math.PI)*.7;c.fillStyle=burn?(i%3?'#f5a768':'#ffdfaa'):(settings.staffColor||settings.noteColor);
      const size=(.5+n)*resolution;c.fillRect(x,y,size,size);
    }
    c.restore();
  }
}


export function prepareMeasureEffects(renderer,settings,scope){
  const style=[settings.staffColor,settings.staffOpacity,settings.markColor,settings.markOpacity,settings.parts?.staff,settings.parts?.marks,settings.parts?.header,settings.headerStyle?.staffOpacity,settings.headerStyle?.markOpacity,scope].join(':');
  const cache=renderer.measureCache;
  if(!cache||cache.score!==renderer.score||cache.style!==style||cache.overlay!==renderer.score.overlayImage)
    renderer.measureCache={score:renderer.score,style,overlay:renderer.score.overlayImage,tiles:new Map(),surface:canvas(),edge:canvas()};
}

export function drawMeasureEffects(renderer,measure,time,settings,notation,effects,tile){
  const progress=measureEffectProgress(renderer.score,measure,time,settings);
  const program=settings.scoreProgramActive&&settings.scoreMotionProgram;
  const transform=program?(progress>0&&program.exit.enabled!==false
    ?{...evaluateMotion(program,'exit',progress),phase:'exit',...(progress>=1?{opacity:0}:{})}
    :motionAt(program,time,measure.start,measure.decayEnd,{exit:false})):null;
  if(transform?.flyin)applyFlyin(transform,`measure:${measure.id}:${measure.occurrence}`);
  if(transform?.opacity<=.001||transform?.scale<=.001)return;
  const c=renderer.ctx;
  if(settings.pageDecay!=='none'&&progress>=1)return;
  const width=measure.width,height=(measure.contentHeight??renderer.score.contentHeight??renderer.score.height)*measure.scale;
  const cx=measure.x+width/2,cy=measure.y+(measure.contentTop??renderer.score.contentTop??0)*measure.scale+height/2;
  const zoom=settings.reducedMotion?1:transform?.scale??1;
  const angle=settings.reducedMotion?0:(transform?.rotation??0)*Math.PI/180;
  const dx=settings.reducedMotion?0:(transform?.x??0)*measure.scale,dy=settings.reducedMotion?0:(transform?.y??0)*measure.scale;
  const fragments=!settings.reducedMotion&&transform?.fragments;
  const padding=effects?100*renderer.canvas.height/1080:0;
  const travel=fragments?Math.hypot(285,200)*fragments.strength/100*measure.scale:0;
  const radiusX=zoom*(fragments?Math.hypot(width+padding*2,height+padding*2)/2+travel:(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*height)/2)+padding;
  const radiusY=zoom*(fragments?Math.hypot(width+padding*2,height+padding*2)/2+travel:(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*height)/2)+padding;
  const matrix=c.getTransform?.()??{a:1,b:0,c:0,d:1,e:0,f:0};
  const screenX=matrix.a*(cx+dx)+matrix.c*(cy+dy)+matrix.e,screenY=matrix.b*(cx+dx)+matrix.d*(cy+dy)+matrix.f;
  const screenRadiusX=Math.abs(matrix.a)*radiusX+Math.abs(matrix.c)*radiusY,screenRadiusY=Math.abs(matrix.b)*radiusX+Math.abs(matrix.d)*radiusY;
  if(screenX+screenRadiusX<0||screenX-screenRadiusX>renderer.canvas.width||screenY+screenRadiusY<0||screenY-screenRadiusY>renderer.canvas.height)return;
  // Build dynamic mark tiles only after visibility and lifetime checks.
  if(typeof tile==='function')tile=tile();
  c.save();
  if(transform){
    const cx=measure.x+measure.width/2,cy=measure.y+((measure.contentTop??renderer.score.contentTop??0)+(measure.contentHeight??renderer.score.contentHeight??renderer.score.height)/2)*measure.scale;
    c.globalAlpha*=transform.opacity;
    if(!settings.reducedMotion){c.translate(cx+transform.x*measure.scale,cy+transform.y*measure.scale);c.rotate(transform.rotation*Math.PI/180);c.scale(transform.scale,transform.scale);c.translate(-cx,-cy)}
  }
  tile??=measureTile(renderer,measure,settings);
  if(transform?.fragments){
    const resolution=renderer.canvas.height/1080,padding=effects?Math.ceil(100*resolution):0,tileY=measure.y+(measure.contentTop??renderer.score.contentTop??0)*measure.scale;
    const surface=renderer.measureCache.fragments??=canvas(),width=tile.width+padding*2,height=tile.height+padding*2;
    if(surface.width!==width||surface.height!==height){surface.width=width;surface.height=height}
    const target=Object.create(renderer),f=surface.getContext('2d');target.ctx=f;
    f.setTransform(1,0,0,1,0,0);f.clearRect(0,0,width,height);f.save();f.translate(padding-measure.x,padding-tileY);
    drawDecay(target,measure,tile,settings.pageDecay==='none'?0:progress,scoreEffectTime(time,settings),settings,notation,effects);f.restore();
    drawFragmented(c,surface,{x:measure.x-padding,y:tileY-padding,...transform.fragments,phase:transform.phase,key:`measure:${measure.id}:${measure.occurrence}`,unit:measure.scale,reducedMotion:settings.reducedMotion});
  }else drawDecay(renderer,measure,tile,settings.pageDecay==='none'?0:progress,scoreEffectTime(time,settings),settings,notation,effects);
  c.restore();
}
