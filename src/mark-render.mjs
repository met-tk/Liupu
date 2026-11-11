import { markEffectSettings, performedMeasure } from './effect-timing.mjs';
import { drawMeasureEffects } from './measure-effects.mjs';

export function drawMarks(renderer,time,input,{ctx=renderer.ctx,left=0,top=0,scale,w,notation,effects,row,bounds,fadeGroup}){
  const effectsOnly=input.parts?.effects&&!['notes','beams','staff','marks','header','cursor'].some(key=>input.parts[key]);
  if(input.parts?.marks===false&&!effectsOnly||!renderer.score.markRegions)return;
  const settings=markEffectSettings(input),rs=renderer.score.markAtlasScale||1;
  if(effectsOnly){notation=false;settings.markOpacity=input.headerStyle?.markOpacity??100}
  const lead=settings.scoreProgramActive?settings.scoreMotionProgram.enter.duration-(settings.scoreMotionProgram.enter.offset??0):0;
  const animated=settings.scoreProgramActive||settings.pageDecay&&settings.pageDecay!=='none';
  for(const region of renderer.score.markRegions){
    if(fadeGroup&&region.fadeGroup!==fadeGroup)continue;
    if(bounds&&(region.x>=bounds.x1||region.x+region.w<=bounds.x0))continue;
    const visits=renderer.markVisits.get(region.id)||[];
    const visit=row?visits.find(v=>v.occurrence<=row.measures.at(-1).occurrence&&v.lastOccurrence>=row.measures[0].occurrence)
      :performedMeasure(visits,time,lead,renderer.currentVisit);
    if(!visit)continue;
    const sourceX=Math.max(region.x,bounds?.x0??region.x),sourceEnd=Math.min(region.x+region.w,bounds?.x1??region.x+region.w);
    const x=left+sourceX*scale,y=top+region.y*scale,width=(sourceEnd-sourceX)*scale,height=region.h*scale;
    const padding=effects?Math.ceil(Math.min(96,renderer.haloRadius(scale,settings))):0;
    if(!animated&&(x+width+padding<0||x-padding>w))continue;
    const paint=c=>{
      if(notation){
        c.save();c.globalAlpha*=(settings.markOpacity??100)/100;
        c.drawImage(renderer.markInk,(region.sx+sourceX-region.x)*rs,region.sy*rs,(sourceEnd-sourceX)*rs,region.h*rs,x,y,width,height);c.restore();
      }
      if(effects&&settings.parts.effects!==false&&region.toggle){
        const glowVisit=row?visit:performedMeasure(visits,time-(settings.glowOffset??0))||visit;
        const glowRegion={...region,start:glowVisit.glowStart??region.start,end:glowVisit.glowEnd??region.end};
        c.save();if(sourceX>region.x||sourceEnd<region.x+region.w){c.beginPath();c.rect(x,y-padding,width,height+2*padding);c.clip()}
        renderer.drawGlowRegions(c,time,settings,{scale,w,xPosition:renderer.scorePositionAt(time),
          regions:[glowRegion],baseAlpha:(settings.markOpacity??100)/100,map:r=>({x:left+r.x*scale,y:top+r.y*scale})});c.restore();
      }
    };
    ctx.save();
    if(!animated)paint(ctx);
    else{
      const tileWidth=Math.max(1,Math.ceil(width+2*padding)),tileHeight=Math.max(1,Math.ceil(height+2*padding));
      const measure={...visit,id:region.id+':'+visit.occurrence,sourceX:region.x,sourceWidth:region.w,
        x:x-padding,y:top,width:tileWidth,scale,contentTop:region.y-padding/scale,contentHeight:tileHeight/scale};
      const target=Object.create(renderer);target.ctx=ctx;
      drawMeasureEffects(target,measure,time,settings,true,effects,()=>{
        const tiles=renderer.measureCache.marks??=new Map(),key=`${region.id}:${sourceX}:${sourceEnd}`;
        let tile=tiles.get(key);
        if(!tile){
          let pixels=tileWidth*tileHeight;for(const surface of tiles.values())pixels+=surface.width*surface.height;
          while(tiles.size&&(tiles.size>=64||pixels>4_000_000)){
            const oldest=tiles.keys().next().value,surface=tiles.get(oldest);
            pixels-=surface.width*surface.height;tiles.delete(oldest);
          }
          tile=document.createElement('canvas');tiles.set(key,tile);
        }
        if(tile.width!==tileWidth||tile.height!==tileHeight){tile.width=tileWidth;tile.height=tileHeight}
        const c=tile.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,tileWidth,tileHeight);
        c.translate(padding-x,padding-y);paint(c);return tile;
      });
    }
    ctx.restore();
  }
  if(renderer.score.overlayImage&&notation&&fadeGroup!=='notes'){
    const s=renderer.score,rs=renderer.rasterScale,visits=row?row.measures:[...renderer.measureVisits.values()].map(v=>performedMeasure(v,time,lead,renderer.currentVisit)).filter(Boolean);
    for(const visit of visits){
      const sourceX=visit.sourceX??visit.x,sourceWidth=visit.sourceWidth??visit.endX-sourceX,x=left+sourceX*scale;
      if(x+sourceWidth*scale<0||x>w)continue;
      const tile=renderer.overlaySurface??=document.createElement('canvas'),contentTop=s.contentTop??0,contentHeight=s.contentHeight??s.height;
      tile.width=Math.max(1,Math.ceil(sourceWidth*scale));tile.height=Math.max(1,Math.ceil(contentHeight*scale));
      const c=tile.getContext('2d');c.globalAlpha=(settings.markOpacity??100)/100;
      c.drawImage(s.overlayImage,sourceX*rs,contentTop*rs,sourceWidth*rs,contentHeight*rs,0,0,sourceWidth*scale,contentHeight*scale);
      if(animated){
        const target=Object.create(renderer);target.ctx=ctx;
        drawMeasureEffects(target,{...visit,sourceX,sourceWidth,x,y:top,width:sourceWidth*scale,scale},time,settings,true,false,tile);
      }else ctx.drawImage(tile,x,top+contentTop*scale);
    }
  }
}
