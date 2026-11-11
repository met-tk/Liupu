// Clip real engraved polygons at stem midpoints, keeping slopes and secondary beams intact.
function clip(points,x,keepRight){
  const result=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],insideA=keepRight?a.x>=x:a.x<=x,insideB=keepRight?b.x>=x:b.x<=x;
    if(insideA)result.push(a);
    if(insideA!==insideB){const t=(x-a.x)/(b.x-a.x);result.push({x,y:a.y+(b.y-a.y)*t})}
  }
  return result;
}
export function splitBeamPolygon(points,stems){
  const unique=[...stems].filter(s=>Number.isFinite(s.x)).sort((a,b)=>a.x-b.x).filter((s,i,a)=>!i||Math.abs(s.x-a[i-1].x)>.01);
  if(points.length<3||!unique.length)return [];
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
  return unique.flatMap((stem,i)=>{
    const min=i?(unique[i-1].x+stem.x)/2:left,max=i<unique.length-1?(stem.x+unique[i+1].x)/2:right;
    const cut=clip(clip(points,min,true),max,false);
    if(cut.length<3)return [];
    const x=Math.min(...cut.map(p=>p.x)),y=Math.min(...cut.map(p=>p.y)),w=Math.max(...cut.map(p=>p.x))-x,h=Math.max(...cut.map(p=>p.y))-y;
    return w>.001&&h>.001?[{noteId:stem.id,points:cut,box:{x,y,w,h}}]:[];
  });
}
