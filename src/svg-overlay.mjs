const allowedElements=new Set(['svg','g','defs','path','polygon','polyline','line','rect','circle','ellipse','text','tspan','use','clipPath','title','desc']);
const allowedAttributes=new Set(['id','class','xmlns','xmlns:xlink','viewBox','width','height','x','y','x1','y1','x2','y2','dx','dy','d','points','rx','ry','r','cx','cy','transform','fill','stroke','color','opacity','fill-opacity','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','fill-rule','clip-rule','clip-path','font-family','font-size','font-style','font-weight','text-anchor','dominant-baseline','preserveAspectRatio','href','xlink:href']);
const presentationAttributes=new Set(['fill','stroke','color','opacity','fill-opacity','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','fill-rule','clip-rule','clip-path','font-family','font-size','font-style','font-weight','text-anchor','dominant-baseline','display','visibility','paint-order','vector-effect','letter-spacing','word-spacing']);
for(const name of presentationAttributes)allowedAttributes.add(name);
const safeValue=value=>!/[\\]|javascript:|data:|https?:|@import/i.test(value)&&(!/url\s*\(/i.test(value)||/^url\(\s*(['"]?)#[\w.-]+\1\s*\)$/i.test(value));

export async function loadSVGOverlay(text,width,height,rasterScale=1){
  if(text.length>4_000_000||/<!ENTITY|<!DOCTYPE/i.test(text))throw new Error('只接受不带外部实体的 SVG，最大 4 MB。');
  const doc=new DOMParser().parseFromString(text,'image/svg+xml'),svg=doc.documentElement;
  if(doc.querySelector('parsererror')||svg.localName!=='svg')throw new Error('文件不是有效 SVG。');
  const viewBox=(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  if(viewBox.length!==4||viewBox.some(v=>!Number.isFinite(v))||viewBox[0]!==0||viewBox[1]!==0||Math.abs(viewBox[2]-width)>1||Math.abs(viewBox[3]-height)>1)throw new Error(`SVG 的 viewBox 须为 0 0 ${width} ${height}。请从“导出原始排版 SVG”开始编辑，保持画布不变。`);
  for(const el of [svg,...svg.querySelectorAll('*')]){
    if(!allowedElements.has(el.localName)){el.remove();continue}
    // Editors commonly serialize colors and opacity as inline CSS. Preserve only
    // SVG presentation properties, then remove CSS and all active/external data.
    const style=document.createElement('span').style;
    style.cssText=el.getAttribute('style')||'';
    for(const name of presentationAttributes){
      const value=style.getPropertyValue(name).trim();
      if(value&&safeValue(value))el.setAttribute(name,value);
    }
    for(const a of [...el.attributes]){
      const localRef=/^#[\w.-]+$/.test(a.value);
      if(!allowedAttributes.has(a.name)||!a.name.startsWith('xmlns')&&!safeValue(a.value)||a.localName==='href'&&!localRef)el.removeAttribute(a.name);
    }
  }
  if(svg.querySelectorAll('*').length>30000)throw new Error('补充 SVG 图元过多，请只保留新增标记。');
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  // Decode above unit size so overlay marks stay crisp alongside raster-scaled score layers.
  const scale=rasterScale>1?rasterScale:1;
  svg.setAttribute('width',Math.ceil(width*scale));svg.setAttribute('height',Math.ceil(height*scale));
  const clean=new XMLSerializer().serializeToString(svg),url=URL.createObjectURL(new Blob([clean],{type:'image/svg+xml'}));
  try{const image=new Image();image.src=url;await image.decode();return {image,svg:clean}}
  finally{URL.revokeObjectURL(url)}
}
