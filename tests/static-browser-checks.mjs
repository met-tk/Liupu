import {defaultMotionProgram} from './motion-program.mjs';

export async function checkStaticRendering(renderer,score,base,check){
  renderer.setScore(score);
  const canvas=renderer.canvas,c=canvas.getContext('2d');
  const style={...base,motion:'static',pageBars:4,pageRows:2,pageDecay:'burn',decayDelay:.45,decayDuration:2.4,noteArrival:'visible',motionProgram:defaultMotionProgram,motionProgramActive:false,showTitle:false,showLine:false,glow:0,particles:0,outputLayer:'notation'};
  const pixels=()=>c.getImageData(0,0,canvas.width,canvas.height).data;
  const visible=data=>{let n=0;for(let i=3;i<data.length;i+=4)if(data[i])n++;return n};
  const same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
  renderer.render(0,style);
  const page=renderer.staticLayout.pages[0],measure=page.rows[0].measures[0];
  document.getElementById('layoutDiagnostics')?.remove();
  const diagnostic=document.createElement('pre');diagnostic.id='layoutDiagnostics';diagnostic.textContent=JSON.stringify({scoreHeight:score.height,contentTop:score.contentTop,contentHeight:score.contentHeight,canvas:[canvas.width,canvas.height],scale:renderer.staticLayout.scale,rows:renderer.staticLayout.pages.map(page=>page.rows.map(row=>({width:row.width,height:row.height,source:row.measures.map(m=>m.sourceWidth)})))},null,2);document.body.append(diagnostic);
  check(page.rows.length===2&&page.rows[1].top>page.rows[0].top,'静态谱页实际绘制两个固定系统');
  const crop=()=>c.getImageData(Math.ceil(measure.x+4),Math.max(0,Math.ceil(measure.y+(score.contentTop||0)*measure.scale)),Math.floor(measure.width-8),Math.ceil((score.contentHeight||score.height)*measure.scale)).data;
  const staffOnly={...style,noteOpacity:0,beamOpacity:0,markOpacity:0,staffOpacity:100};
  renderer.render(.2,staffOnly);const untouched=new Uint8ClampedArray(crop()),before=visible(untouched);
  renderer.render(measure.end-.05,staffOnly);check(same(untouched,crop()),'当前小节播放期间谱线位置及像素保持固定');
  renderer.render(measure.decayEnd+.45+1.2,staffOnly);const during=visible(crop());
  check(before>20&&during>0&&during<before,'已播放小节的谱线逐步焚毁');
  renderer.render(measure.decayEnd+.45+2.45,staffOnly);check(visible(crop())===0,'焚毁结束后小节谱线完全消失');
  renderer.render(.2,{...style,staffOpacity:0,markOpacity:0,beamOpacity:0});check(visible(crop())>20,'静态音符默认提前可见');
  renderer.render(measure.end+2.1,{...style,staffOpacity:0,markOpacity:0,beamOpacity:0});check(visible(crop())===0,'奏完音符的退场完成后不残留在五线谱');
  const fx={...style,outputLayer:'effects',particles:35};
  renderer.render(measure.decayEnd+1.5,fx);const burned=new Uint8ClampedArray(pixels());
  check(visible(burned)>10&&burned[3]===0&&burned.at(-1)===0,'焚毁光效层有余烬且保留透明背景');
  renderer.render(12,fx);renderer.render(measure.decayEnd+1.5,fx);check(same(burned,pixels()),'消解与余烬在反向定位后逐像素重现');
  renderer.render(measure.decayEnd+1.5,{...staffOnly,pageDecay:'dissolve'});check(visible(crop())>0&&visible(crop())<before,'微尘模式同样逐步消解谱线');
  renderer.render(measure.decayEnd+3,{...staffOnly,pageDecay:'none'});check(same(untouched,crop()),'保留谱线选项不消解完成的小节');
  renderer.render(1,{...style,staffOpacity:0,markOpacity:0,beamOpacity:0,noteOpacity:0});check(visible(pixels())===0,'静态模式所有记谱组件透明度零时完全透明');
  renderer.render(1,{...style,layoutTitle:true,showTitle:true});const geometry=JSON.stringify(renderer.staticLayout);
  renderer.render(1,{...style,layoutTitle:true,showTitle:false,outputLayer:'effects'});check(geometry===JSON.stringify(renderer.staticLayout),'分层输出即使隐藏标题仍共享相同谱面坐标');
  renderer.render(1,{...style,motionProgramActive:true,motionProgram:defaultMotionProgram});const first=new Uint8ClampedArray(pixels());
  renderer.render(7,{...style,motionProgramActive:true,motionProgram:defaultMotionProgram});renderer.render(1,{...style,motionProgramActive:true,motionProgram:defaultMotionProgram});check(same(first,pixels()),'关键帧模式预览与逐帧导出使用相同确定性变换');
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),bitmap=await createImageBitmap(blob);
  check(bitmap.width===canvas.width&&bitmap.height===canvas.height,'静态谱页 PNG 成功编码且输出尺寸正确');bitmap.close();
}
