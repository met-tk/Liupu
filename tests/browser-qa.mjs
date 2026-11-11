import {loadScore} from './score.mjs';
import {ScoreRenderer,maskScrollLayer} from './render.mjs';
import {loadSVGOverlay} from './svg-overlay.mjs';
import {createFramePlan,createZipWriter} from './export.mjs';
import {demoXML} from './demo.mjs';
import {checkStaticRendering} from './static-browser-checks.mjs';
const button=document.getElementById('run'),out=document.getElementById('results'),canvas=document.getElementById('canvas');
const base={fly:0,scatter:0,glow:60,bloom:40,particles:30,trail:50,anchor:42,zoom:100,showLine:false,showTitle:false,color:'#ffe6ac',noteColor:'#ffffff',noteOpacity:100,beamColor:'#ffffff',beamOpacity:100,staffColor:'#bbbbbb',staffOpacity:75,markColor:'#ffffff',markOpacity:100,backgroundColor:'#090c0e',backgroundDim:45,motion:'sticky',aspect:'16:9',transparent:true,outputLayer:'composite'};
const pixelData=()=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
const visible=data=>{let n=0;for(let i=3;i<data.length;i+=4)if(data[i])n++;return n};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const toPNG=()=>new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
const imageCanvas=image=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);return c};
const cropPixels=(c,box)=>c.getContext('2d').getImageData(Math.floor(box.x),Math.floor(box.y),Math.ceil(box.w)+1,Math.ceil(box.h)+1).data;
function sourceBoxes(score,selector){
 const staging=document.getElementById('engraving');staging.innerHTML=score.originalSVG;
 const svg=staging.querySelector('svg');svg.style.width=`${score.width}px`;svg.style.height=`${score.height}px`;
 const root=svg.getBoundingClientRect(),boxes=[...svg.querySelectorAll(selector)].map(node=>{const r=node.getBoundingClientRect();return {x:r.left-root.left,y:r.top-root.top,w:r.width,h:r.height}});
 staging.replaceChildren();return boxes;
}
function isolatedChordStemSamples(score){
 const staging=document.getElementById('engraving');staging.innerHTML=score.originalSVG;
 const svg=staging.querySelector('svg');svg.style.width=`${score.width}px`;svg.style.height=`${score.height}px`;
 const root=svg.getBoundingClientRect(),rect=node=>{const r=node.getBoundingClientRect();return {x:r.left-root.left,y:r.top-root.top,w:r.width,h:r.height}};
 // Reject source regions occupied by any graphic that intentionally remains in
 // structure, including horizontal ledger lines that cross an entire stem box.
 const structure=[...svg.querySelectorAll('path,polygon,polyline,line,text,use,rect,circle,ellipse')].filter(node=>{
  if(node.closest('defs'))return false;
  if(node.closest('g.note')&&!node.closest('g.verse,g.artic,g.fing'))return false;
  if(node.closest('g.chord')&&node.closest('g.stem,g.flag,g.dots'))return false;
  if(node.matches('g.beam > polygon,g.staff > path'))return false;
  return true;
 }).map(rect);
 const samples=[];
 for(const stem of svg.querySelectorAll('g.chord > g.stem')){
  const path=stem.querySelector(':scope > path');if(!path)continue;const b=rect(path);
  for(const fraction of [.5,.35,.65,.2,.8]){
   const sample={x:b.x-2,y:b.y+b.h*fraction-2,w:Math.max(1,b.w)+4,h:4};
   if(structure.some(r=>sample.x<r.x+r.w+2&&sample.x+sample.w>r.x-2&&sample.y<r.y+r.h+2&&sample.y+sample.h>r.y-2))continue;
   samples.push({id:stem.id,...sample});break;
  }
 }
 staging.replaceChildren();return samples;
}
function atlasIsIsolated(score){
 const boxes=[...score.boxes.values()];
 return boxes.every((b,i)=>b.sx>=2&&b.sy>=2&&b.sx+b.w+2<=score.noteAtlas.width&&b.sy+b.h+2<=score.noteAtlas.height&&boxes.slice(i+1).every(a=>b.sx+b.w+2<=a.sx||a.sx+a.w+2<=b.sx||b.sy+b.h+2<=a.sy||a.sy+a.h+2<=b.sy));
}
button.onclick=async()=>{
 button.disabled=true;out.textContent='正在载入…';const lines=[];
 const check=(ok,label)=>{if(!ok)throw new Error(label);lines.push('PASS '+label);out.textContent=lines.join('\n')};
 try{
  const maskCanvas=document.createElement('canvas');maskCanvas.width=1000;maskCanvas.height=100;
  const maskCtx=maskCanvas.getContext('2d');
  const maskedPixels=(alpha,width,fade=60)=>{
   maskCtx.clearRect(0,0,1000,100);maskCtx.globalAlpha=alpha;maskCtx.fillStyle='#fff';maskCtx.fillRect(10,45,width,10);maskCtx.globalAlpha=1;
   maskScrollLayer(maskCtx,1000,100,100,fade);
   return [20,80,100,120,140,165,400].map(x=>maskCtx.getImageData(x,50,1,1).data[3]);
  };
  const longMark=maskedPixels(1,800),shortMark=maskedPixels(1,200);
  check(longMark[0]===0&&longMark[1]===0&&longMark[2]<longMark[3]&&longMark[3]<longMark[4]&&longMark[5]===255&&longMark[6]===255,'长标记按空间逐像素淡出，不延伸回谱头且右侧保持完整');
  check(longMark.slice(0,6).every((a,i)=>a===shortMark[i]),'相同坐标的淡出不受标记宽度或中心点影响');
  const dimMark=maskedPixels(.4,800),hardMark=maskedPixels(1,800,0);
  check(dimMark[0]===0&&Math.abs(dimMark[3]-longMark[3]*.4)<=1&&Math.abs(dimMark[6]-102)<=1,'标记原始不透明度与淡出相乘，不被补画恢复');
  check(hardMark[1]===0&&hardMark[2]===255,'关闭标记淡出仅裁切边界，不改变边界右侧');
  const score=await loadScore(await(await fetch('./notation-marks.musicxml')).text(),'notation-marks.musicxml'),renderer=new ScoreRenderer(canvas);renderer.setScore(score);
  check(atlasIsIsolated(score),'音符图集独立矩形不重叠且保留透明边距');
  const lyric=sourceBoxes(score,'g.verse')[0],marksCanvas=imageCanvas(score.structureImage),lyricNote=score.boxes.get('n1');
  check(lyric&&visible(cropPixels(marksCanvas,lyric))>5,'歌词像素保留在其他标记层');
  check(lyricNote.y+lyricNote.h<lyric.y,'歌词不再进入音符图集裁切范围');
  check(score.beams?.length>0,'提取符杠矢量');
  check(score.header?.states.length===3,'三个小节都有固定谱头状态');
  check(score.header.states[0].staves[0].clef.id!==score.header.states[1].staves[0].clef.id&&score.header.states[1].staves[0].clef.id!==score.header.states[2].staves[0].clef.id,'前一小节的提示谱号正确继承为下一小节谱头');
  check(score.header.states[2].staves.every(s=>!s.keySig),'回到 C 大调后固定调号清空');
  for(const layer of ['composite','notation','effects','cursor']){
   renderer.render(.25,{...base,outputLayer:layer,showLine:layer==='cursor'});const data=pixelData();
   check(data[3]===0&&data.at(-1)===0,layer+' 四角透明');check(visible(data)>20,layer+' 有可见图元');
  }
  const isolated={...base,motion:'flow',outputLayer:'notation',staffOpacity:0,markOpacity:0,noteOpacity:0,beamOpacity:100,beamColor:'#ff0000'};
  renderer.render(1,isolated);const beamData=pixelData();check(visible(beamData)>50,'符杠可独立显示');
  check(beamData.some((v,i)=>i%4===0&&v>150&&beamData[i+1]<50&&beamData[i+3]>100),'符杠独立红色');
  renderer.render(1,{...isolated,beamOpacity:0});check(visible(pixelData())===0,'所有记谱组件不透明度 0 完全透明');
  renderer.render(1,{...isolated,beamOpacity:0,noteOpacity:100});check(visible(pixelData())>50,'音符可独立显示');
  renderer.render(.4,base);const a=new Uint8ClampedArray(pixelData());renderer.render(.4,base);check(same(a,pixelData()),'同一时刻渲染结果确定');
  const headerCrop=()=>canvas.getContext('2d').getImageData(0,0,Math.floor(canvas.width*.15),canvas.height).data;
  const dockedStyle={...base,anchor:20};
  renderer.render(2.5,dockedStyle);const first=new Uint8ClampedArray(headerCrop());renderer.render(3.5,dockedStyle);check(visible(first)>0&&same(first,headerCrop()),'到达左侧停靠区后谱头保持固定');
  renderer.render(4.5,dockedStyle);check(!same(first,headerCrop()),'换调号拍号谱号后固定谱头更新');
  const png=await toPNG(),bitmap=await createImageBitmap(png);const decoded=document.createElement('canvas');decoded.width=bitmap.width;decoded.height=bitmap.height;decoded.getContext('2d').drawImage(bitmap,0,0);
  check(decoded.getContext('2d').getImageData(0,0,1,1).data[3]===0,'编码后的 PNG 保留 Alpha');bitmap.close();
  const zip=createZipWriter(),plan=createFramePlan({start:4,end:4.1,fps:30});for(let i=0;i<plan.frameCount;i++){renderer.render(plan.frameAt(i).scoreTime,base);await zip.add(`frames/frame_${String(i+1).padStart(6,'0')}.png`,await toPNG())}check(zip.finish().size>1000&&zip.entryCount===3,'三帧透明 PNG 组成有效 ZIP');
  let rejected=false;try{await loadSVGOverlay('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',score.width,score.height)}catch{rejected=true}check(rejected,'不同坐标 SVG 被拒绝');
  const safe=await loadSVGOverlay(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${score.width} ${score.height}"><script>alert(1)</script><image href="https://example.com/a.png"/><path fill="#ff0" d="M200 20h40v10h-40z" onclick="alert(1)"/></svg>`,score.width,score.height);
  check(!safe.svg.includes('script')&&!safe.svg.includes('onclick')&&!safe.svg.includes('example.com'),'补充 SVG 移除活动内容和外部资源');
  const styled=await loadSVGOverlay('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0\n64 32"><g style="opacity:.8"><rect x="4" y="4" width="20" height="20" fill="#00f" style="fill:#ff0000;fill-opacity:.5;stroke:none;background-image:url(https://example.com/a.png)"/></g></svg>',64,32);
  const styledDoc=new DOMParser().parseFromString(styled.svg,'image/svg+xml');
  check(!styledDoc.querySelector('[style]')&&!styled.svg.includes('example.com')&&styledDoc.querySelector('rect').getAttribute('fill-opacity')==='0.5','SVG 安全内联样式转为展示属性，移除外部资源');
  const styledCanvas=document.createElement('canvas');styledCanvas.width=64;styledCanvas.height=32;styledCanvas.getContext('2d').drawImage(styled.image,0,0);
  const styledPixel=styledCanvas.getContext('2d').getImageData(10,10,1,1).data;
  check(styledPixel[0]>250&&styledPixel[1]===0&&styledPixel[2]===0&&Math.abs(styledPixel[3]-102)<=1,'编辑器 SVG 的颜色优先级和嵌套透明度保持不变');
  const hostStyle=document.createElement('style');hostStyle.textContent='#engraving svg{fill:none;stroke:red;stroke-width:12}';document.head.append(hostStyle);
  let chordScore;try{chordScore=await loadScore(demoXML,'chord-atlas.musicxml')}finally{hostStyle.remove()}
  const chordStructure=imageCanvas(chordScore.structureImage),chordAtlas=imageCanvas(chordScore.noteImage),stemBoxes=sourceBoxes(chordScore,'g.chord > g.stem');
  const filled=chordScore.boxes.get('m0r0'),filledHead=filled.head;
  const center=chordAtlas.getContext('2d').getImageData(Math.floor(filled.sx+filledHead.x-filled.x+filledHead.w/2),Math.floor(filled.sy+filledHead.y-filled.y+filledHead.h/2),1,1).data;
  check(center[3]>200,'图集实心音头不受页面 svg fill:none 图标样式污染');
  const stemSamples=isolatedChordStemSamples(chordScore),stemResidue=stemSamples.map(b=>({...b,pixels:visible(cropPixels(chordStructure,b))})).filter(b=>b.pixels);
  check(stemSamples.length>=Math.min(4,stemBoxes.length)&&stemSamples.length>0,`源 SVG 找到 ${stemSamples.length} 个避开加线和其他结构图元的共享符干采样区`);
  check(stemResidue.length===0,'和弦共享符干未留在结构层'+(stemResidue.length?'：'+stemResidue.map(b=>`${b.id} @ ${b.x.toFixed(1)},${b.y.toFixed(1)} 残留 ${b.pixels} 像素`).join('；'):''));
  const owner=chordScore.boxes.get('m0l00'),other=chordScore.boxes.get('m0l01');
  check(owner&&other&&owner.h>other.h*2&&visible(cropPixels(chordAtlas,{x:owner.sx,y:owner.sy,w:owner.w,h:owner.h}))>20,'和弦共享符干随首个音符进入图集');
  check(atlasIsIsolated(chordScore),'含重叠和弦符干的音符仍使用独立图集区域');
  const reconstructed=document.createElement('canvas');reconstructed.width=chordScore.width;reconstructed.height=chordScore.height;
  reconstructed.getContext('2d').drawImage(chordScore.noteImage,owner.sx,owner.sy,owner.w,owner.h,owner.x,owner.y,owner.w,owner.h);
  const otherHead=other.head;
  check(visible(cropPixels(reconstructed,{x:otherHead.x+otherHead.w*.55,y:otherHead.y,w:otherHead.w*.3,h:otherHead.h}))===0,'共享符干图块不会串入另一和弦音的符头');
  await checkStaticRendering(renderer,chordScore,base,check);
  renderer.setScore(score);score.overlayImage=safe.image;renderer.render(1,base);out.textContent=lines.join('\n')+'\n完成：'+lines.length+' 项检查通过。';
 }catch(err){out.textContent=lines.join('\n')+'\nFAIL '+err.message;console.error(err)}finally{button.disabled=false}
};
