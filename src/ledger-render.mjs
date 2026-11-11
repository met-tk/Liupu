import { drawFragmentedShape } from './fragment-render.mjs';

// Ledger strokes are kept as lightweight geometry rather than baked into the
// note atlas. This lets the animation switch choose between the existing
// fixed staff layer and note-local motion without rebuilding a score.
export function drawLedgerLines(ctx, lines, cx, cy, transform={}, key='ledger', color='#fff', reducedMotion=false) {
  if (!lines?.length) return;
  const fragments=transform.fragments;
  for (const [index,line] of lines.entries()) {
    const x=Math.min(line.x1,line.x2)-cx, y=line.y-cy;
    const width=Math.max(1,Math.abs(line.x2-line.x1)), height=Math.max(1,line.width||1);
    drawFragmentedShape(ctx,()=>{
      ctx.strokeStyle=color;ctx.lineWidth=line.width||1;ctx.lineCap='butt';
      ctx.beginPath();ctx.moveTo(line.x1-cx,line.y-cy);ctx.lineTo(line.x2-cx,line.y-cy);ctx.stroke();
    },{x:x-1,y:y-height/2-1,width:width+2,height:height+2,...fragments,phase:transform.phase,key:`${key}:${index}`,reducedMotion});
  }
}
