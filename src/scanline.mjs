import { clamp } from './timing.mjs';

const rgba=(hex,alpha)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;
const setting=(value,fallback,min,max)=>clamp(Number.isFinite(value)?value:fallback,min,max);

// One cursor renderer for scrolling, static pages and exported cursor layers.
export function drawScanline(ctx,settings,{x,centerY,baseLength,scale=1,resolution=1,width=resolution,softEnds=true}){
  settings={...settings,color:settings.scanColor||settings.color};
  x+=(settings.scanOffsetX||0)*ctx.canvas.width/100;centerY+=(settings.scanOffsetY||0)*ctx.canvas.height/100;
  width*=setting(settings.scanWidth,100,1,3000)/100;
  const length=baseLength*setting(settings.scanLength,100,1,1000)/100;
  const glow=setting(settings.scanGlow,60,0,300)/100,spread=setting(settings.scanBloom,100,0,1000)/100;
  const top=centerY-length/2,bottom=centerY+length/2;
  if(!(length>0))return;
  ctx.save();ctx.globalAlpha=1;
  if(settings.scanAngle){ctx.translate(x,centerY);ctx.rotate(settings.scanAngle*Math.PI/180);ctx.translate(-x,-centerY)}
  let ink=settings.color;
  if(softEnds){
    ink=ctx.createLinearGradient(0,top,0,bottom);
    ink.addColorStop(0,rgba(settings.color,0));ink.addColorStop(.22,settings.color);
    ink.addColorStop(.78,settings.color);ink.addColorStop(1,rgba(settings.color,0));
  }
  ctx.shadowBlur=0;
  if(glow>0&&spread>0){
    // Elliptical radial fields share the core's tips. Both width and energy fall
    // smoothly to zero there; there is no rectangular wash or clipped blur.
    for(const [radius,energy] of [[50*scale*spread,.20],[12*resolution*spread,.34]]){
      ctx.save();ctx.translate(x,centerY);ctx.scale(Math.max(.01,radius),length/2);
      const wash=ctx.createRadialGradient(0,0,0,0,0,1);
      wash.addColorStop(0,rgba(settings.color,energy*glow));
      wash.addColorStop(.35,rgba(settings.color,energy*glow*.65));
      wash.addColorStop(.72,rgba(settings.color,energy*glow*.12));
      wash.addColorStop(1,rgba(settings.color,0));
      ctx.fillStyle=wash;ctx.fillRect(-1,-1,2,2);ctx.restore();
    }
  }
  ctx.fillStyle=ink;ctx.beginPath();ctx.moveTo(x,top);
  ctx.bezierCurveTo(x+width*.7,top+length*.28,x+width*.7,bottom-length*.28,x,bottom);
  ctx.bezierCurveTo(x-width*.7,bottom-length*.28,x-width*.7,top+length*.28,x,top);
  ctx.fill();ctx.restore();
}
