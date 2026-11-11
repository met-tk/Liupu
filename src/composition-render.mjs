import { ScoreRenderer } from './render.mjs';
import { PARTS, resolveLayerConfig } from './composition.mjs';
import { motionAt, applyFlyin } from './motion-program.mjs';
import { drawFragmented } from './fragment-render.mjs';

const canvas=()=>document.createElement('canvas');
const scorePartKeys=new Set(PARTS.map(([key])=>key));
export class CompositionRenderer {
  constructor(target){this.canvas=target;this.ctx=target.getContext('2d');this.pool=new Map();this.background=null}
  setScore(score){this.score=score;this.pool.clear();this.fallback=null}
  setBackground(image){this.background=image}
  surface(id,scoreLayer){
    if(!this.pool.has(id)){const c=canvas();this.pool.set(id,{canvas:c,ctx:c.getContext('2d'),renderer:scoreLayer?new ScoreRenderer(c):null});this.pool.get(id).renderer?.setScore(this.score)}
    const s=this.pool.get(id);if(s.canvas.width!==this.canvas.width||s.canvas.height!==this.canvas.height){s.canvas.width=this.canvas.width;s.canvas.height=this.canvas.height}return s;
  }
  render(time,settings){
    if(!this.score)return;
    if(!settings.composition){this.fallback??=new ScoreRenderer(this.canvas);if(this.fallback.score!==this.score)this.fallback.setScore(this.score);this.fallback.setBackground(this.background);this.fallback.render(time,settings);return}
    const {ctx:c,canvas:target}=this,w=target.width,h=target.height,scene=settings.composition,outputPart=settings.outputPart;
    const baseSettings={...settings};
    const partsFor=node=>{
      if(!outputPart)return node.parts;
      if(!scorePartKeys.has(outputPart))return Object.fromEntries(PARTS.map(([key])=>[key,false]));
      return Object.fromEntries(PARTS.map(([key])=>[key,key===outputPart&&node.parts[key]]));
    };
    for(const id of this.pool.keys())if(!scene.nodes.some(n=>n.id===id))this.pool.delete(id);
    c.resetTransform();c.globalAlpha=1;c.globalCompositeOperation='source-over';
    const background=ctx=>{if(settings.transparent)return;ctx.fillStyle=settings.backgroundColor;ctx.fillRect(0,0,w,h);if(this.background){const r=Math.max(w/this.background.width,h/this.background.height),iw=this.background.width*r,ih=this.background.height*r;ctx.drawImage(this.background,(w-iw)/2,(h-ih)/2,iw,ih);ctx.globalAlpha=settings.backgroundDim/100;ctx.fillStyle=settings.backgroundColor;ctx.fillRect(0,0,w,h);ctx.globalAlpha=1}};
    const title=ctx=>{if(!settings.showTitle||outputPart&&outputPart!=='title'||!['composite','notation'].includes(settings.outputLayer||'composite'))return;const resolution=h/1080;ctx.save();ctx.fillStyle=settings.titleColor||scene.nodes.find(n=>n.kind==='score')?.config.noteColor||'#f3f3f3';ctx.textBaseline='top';ctx.font=`400 ${32*resolution}px "Songti SC","SimSun",serif`;ctx.fillText(settings.title||this.score.title,w*.055,h*.075,w*.89);ctx.globalAlpha=.6;ctx.font=`${14*resolution}px "Segoe UI","Microsoft YaHei",sans-serif`;ctx.fillText(this.score.composer||this.score.instrument,w*.056,h*.075+48*resolution,w*.89);ctx.restore()};
    // The usual single-layer scene needs no full-frame intermediate canvas.
    const only=scene.nodes.length===1?scene.nodes[0]:null,t=only?.transform;
    if(only?.kind==='score'&&only.enabled&&only.parent===null&&!only.timeOffset&&!only.animationEnabled&&!outputPart&&t.x===0&&t.y===0&&t.scaleX===1&&t.scaleY===1&&t.rotation===0&&t.opacity===1&&t.blend==='source-over'){
      this.fallback??=new ScoreRenderer(target);if(this.fallback.score!==this.score)this.fallback.setScore(this.score);
      this.fallback.setBackground(this.background);
      const config=resolveLayerConfig(only,scene);
      this.fallback.render(time,{...baseSettings,...config,composition:undefined,parts:only.parts,layoutTitle:settings.layoutTitle??settings.showTitle,showTitle:false,showLine:config.showLine&&settings.exportCursor!==false});
      title(c);return;
    }
    c.clearRect(0,0,w,h);
    if(!outputPart&&!scene.nodes.some(n=>n.kind==='background')||outputPart==='background'&&!scene.nodes.some(n=>n.kind==='background'))background(c);
    const draw=(node,parent,at)=>{
      if(!node.enabled)return;at-=node.timeOffset;if(at<0)return;
      const t=node.transform,animation=node.animationEnabled?motionAt(node.program,at,Math.min(node.program.enter.duration,this.score.duration),this.score.duration):{x:0,y:0,scale:1,rotation:0,opacity:1};
      if(t.opacity*animation.opacity<=0)return;
      if(node.kind==='background'&&settings.transparent)return;
      if(node.kind==='title'&&(!settings.showTitle||outputPart&&outputPart!=='title'||!['composite','notation'].includes(settings.outputLayer||'composite')))return;
      const parts=node.kind==='score'?partsFor(node):null;
      if(parts&&!PARTS.some(([key])=>parts[key]))return;
      const s=this.surface(node.id,node.kind==='score');s.ctx.resetTransform();s.ctx.globalAlpha=1;s.ctx.globalCompositeOperation='source-over';if(!s.renderer)s.ctx.clearRect(0,0,w,h);
      if(node.kind==='score'){
        const config=resolveLayerConfig(node,scene);
        s.renderer.render(at,{...baseSettings,...config,composition:undefined,parts,transparent:true,layoutTitle:settings.layoutTitle??settings.showTitle,showTitle:false,showLine:config.showLine&&settings.exportCursor!==false,outputLayer:outputPart==='cursor'?'cursor':settings.outputLayer||'composite',reducedMotion:settings.reducedMotion});
      }else if(node.kind==='background')background(s.ctx);
      else if(node.kind==='title')title(s.ctx);
      else for(const child of scene.nodes.filter(n=>n.parent===node.id))draw(child,s.ctx,at);
      if(animation.flyin)applyFlyin(animation,node.id);
      const reduced=settings.reducedMotion;
      parent.save();parent.globalAlpha=t.opacity*animation.opacity;parent.globalCompositeOperation=t.blend;
      parent.translate(w*(.5+t.x/100)+(reduced?0:animation.x*h/1080),h*(.5+t.y/100)+(reduced?0:animation.y*h/1080));
      parent.rotate((t.rotation+(reduced?0:animation.rotation))*Math.PI/180);parent.scale(t.scaleX*(reduced?1:animation.scale),t.scaleY*(reduced?1:animation.scale));
      if(animation.fragments&&!reduced)drawFragmented(parent,s.canvas,{x:-w/2,y:-h/2,width:w,height:h,...animation.fragments,phase:animation.phase,key:node.id,unit:h/1080});else parent.drawImage(s.canvas,-w/2,-h/2);parent.restore();
    };
    for(const node of scene.nodes.filter(n=>n.parent===null))draw(node,c,time);
    if(!scene.nodes.some(n=>n.kind==='title')&&(!outputPart||outputPart==='title'))title(c);
  }
}
