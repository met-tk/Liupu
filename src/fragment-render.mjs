import { clamp, seed } from './timing.mjs';

// Fragments use only score identity and phase progress, so seeking and exports agree.
export function drawFragmentedShape(c, draw, {x=0,y=0,width,height,amount=0,strength=100,phase='exit',key='fragment',unit=1,reducedMotion=false,style}={}) {
  const classic=style==='classic';
  const progress=clamp(amount,0,1);
  if(progress<=0){draw();return}
  if(progress>=1&&!classic||width<=0||height<=0)return;
  if(reducedMotion||strength<=0){c.save();c.globalAlpha*=1-progress;draw();c.restore();return}
  const columns=classic?3:Math.min(16,Math.max(3,Math.ceil(width/(48*unit)))),rows=classic?4:Math.min(12,Math.max(4,Math.ceil(height/(48*unit))));
  const cellWidth=width/columns,cellHeight=height/rows,direction=phase==='enter'?1:-1;
  const matrix=c.getTransform?.(),viewport=c.canvas;
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const id=`${key}:${row}:${col}`,delay=seed(id+'d')*(classic?.098:.1),t=clamp((progress-delay)/(1-delay),0,1),travel=t*t*strength/100;
    const cx=x+(col+.5)*cellWidth,cy=y+(row+.5)*cellHeight;
    const tx=cx+direction*travel*(75+seed(id)*210)*unit,ty=cy+travel*(seed(id+'v')-.5)*400*unit,angle=travel*(seed(id+'r')-.5)*3.5;
    if(matrix&&viewport){
      const cos=Math.cos(angle),sin=Math.sin(angle),px=matrix.a*tx+matrix.c*ty+matrix.e,py=matrix.b*tx+matrix.d*ty+matrix.f;
      const rx=(Math.abs(matrix.a*cos+matrix.c*sin)*cellWidth+Math.abs(matrix.c*cos-matrix.a*sin)*cellHeight)/2+1;
      const ry=(Math.abs(matrix.b*cos+matrix.d*sin)*cellWidth+Math.abs(matrix.d*cos-matrix.b*sin)*cellHeight)/2+1;
      if(px+rx<0||px-rx>viewport.width||py+ry<0||py-ry>viewport.height)continue;
    }
    c.save();c.globalAlpha*=1-t*(classic?.92:1);
    c.translate(tx,ty);c.rotate(angle);c.translate(-cx,-cy);
    c.beginPath();c.rect(x+col*cellWidth,y+row*cellHeight,cellWidth,cellHeight);c.clip();draw();c.restore();
  }
}

export function drawFragmented(c,image,options={}) {
  let {sx=0,sy=0,sw=image.width,sh=image.height}=options;
  const {x=0,y=0,width=sw,height=sh}=options,tiles=image.fragmentTiles;
  let ready=false;
  const draw=()=>{
    if(!ready&&tiles&&options.amount>0&&(options.amount<1||options.style==='classic')&&!options.reducedMotion&&options.strength!==0){
      const key=`${sx}:${sy}:${sw}:${sh}`;
      let tile=tiles.get(key);
      if(!tile){
        // Isolate atlas glyphs before repeated clipped draws; retain border texels for identical sampling.
        const left=Math.max(0,Math.floor(sx)-1),top=Math.max(0,Math.floor(sy)-1);
        const w=Math.min(image.width,Math.ceil(sx+sw)+1)-left,h=Math.min(image.height,Math.ceil(sy+sh)+1)-top;
        if(w*h<=1_000_000){
          let pixels=w*h;for(const {canvas} of tiles.values())pixels+=canvas.width*canvas.height;
          while(tiles.size&&(tiles.size>=512||pixels>4_000_000)){
            const oldest=tiles.keys().next().value,{canvas}=tiles.get(oldest);
            pixels-=canvas.width*canvas.height;tiles.delete(oldest);
          }
          const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
          canvas.getContext('2d').drawImage(image,left,top,w,h,0,0,w,h);
          tile={canvas,left,top};tiles.set(key,tile);
        }
      }
      if(tile){image=tile.canvas;sx-=tile.left;sy-=tile.top}
    }
    ready=true;c.drawImage(image,sx,sy,sw,sh,x,y,width,height);
  };
  drawFragmentedShape(c,draw,{...options,x,y,width,height});
}

export function renderParts(parts) {
  // Old presets hid beams and performance effects together with notes.
  return {notes:parts?.notes!==false,beams:parts?.beams??parts?.notes!==false,effects:parts?.effects??parts?.notes!==false,staff:parts?.staff!==false,marks:parts?.marks!==false,header:parts?.header!==false,cursor:parts?.cursor!==false};
}
