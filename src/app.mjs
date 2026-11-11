import { loadScore, prepareEngine } from './score.mjs';
import { CompositionRenderer } from './composition-render.mjs';
import { createStudioSettings, compositionTail, applyVisualPreset, builtinPresets } from './composition.mjs';
import { bindStudioEditor } from './studio-editor.mjs';
import { visualDefaults } from './visual-defaults.mjs';
import { AudioPlayer } from './audio.mjs';
import { VstClient } from './vst.mjs';
import { clamp, formatTime, lastTimeIndex, nextFrameTime } from './timing.mjs';
import { createFramePlan, createZipWriter } from './export.mjs';
import { makeAESetupScript, makeAEGuide } from './ae-package.mjs';
import { loadSVGOverlay } from './svg-overlay.mjs';
import { bindEffectEditor } from './effect-editor.mjs';
import { bindSelectWheel } from './select-wheel.mjs';
import './desktop.mjs';
import { bindPreferences } from './ui-settings.mjs';

bindSelectWheel(document);
await bindPreferences();

const $=id=>document.getElementById(id);
$('trackTitle').dataset.userContent='';
// Number inputs use change handlers throughout the editor, including controls
// created after startup. Commit the typed value explicitly when Enter is used.
document.addEventListener('keydown',event=>{
  const input=event.target;
  if(event.key!=='Enter'||event.isComposing||!input?.matches?.('input[type="number"]'))return;
  event.preventDefault();input.dispatchEvent(new Event('change',{bubbles:true}));
});
const defaults={...structuredClone(visualDefaults),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
const sliders=['glow','bloom','glowPeak','glowValley','glowRadius','glowFeather','particles','trail','anchor','scanLength','scanGlow','scanBloom','zoom','backgroundDim','noteOpacity','staffOpacity','beamOpacity','markOpacity'];
const paletteKeys=['backgroundColor','noteColor','staffColor','beamColor','markColor'];
for(const [key,label] of [['staff','五线谱线'],['beam','符杠'],['mark','其他标记']]){
  const group=document.createElement('div');group.className='component-control';
  group.innerHTML=`<label class="palette-field"><span>${label}颜色</span><input type="color" id="${key}Color" aria-label="${label}颜色"><input type="text" id="${key}ColorHex" maxlength="7" aria-label="${label}颜色 HEX"></label><div class="slider-field"><label for="${key}Opacity">${label}不透明度 <output id="${key}OpacityOut">100%</output></label><input id="${key}Opacity" type="range" min="0" max="100" value="100"></div>`;
  $('componentControls').append(group);
}
const settings=createStudioSettings(defaults);
applyVisualPreset(settings,builtinPresets(defaults)[0]);
if(matchMedia('(prefers-reduced-motion: reduce)').matches){settings.particles=0;settings.trail=0}
const renderer=new CompositionRenderer($('canvas')), player=new AudioPlayer();
const vst=new VstClient();player.vst=vst;
player.onStatus=state=>{
  $('pianoStatus').dataset.error=state.state==='error';
  $('pianoStatus').textContent=state.state==='loading'?`正在载入钢琴采样 ${state.loaded} / ${state.total}…`:
    state.state==='error'?`${state.message} 请再次点击播放重试。`:'Salamander 钢琴已就绪 · Yamaha C5 · 三层力度 · 立体声';
};
player.onError=error=>{pause();$('vstStatus').textContent=error.message;$('vstStatus').dataset.error=true;toast(error.message)};
let effectEditor,studioEditor;
let score, time=0, looping=false, busy=false, toastTimer, recording=null, loadSequence=0, frameDeadline=0, pendingPlay=false;
let exportURL=null,exportPosterURL=null,sequenceJob=null,recordingPreparation=null,playSequence=0;
// Keep the opening frame visible for a short, intentional breath before sound.
// The audio clock holds the score time during this period, so the first frame
// and the fixed header stay aligned with the opening notation.
const PLAY_LEAD_IN=.35;
function totalDuration(){
  return score?compositionTail(settings,score.duration):0;
}
function syncDuration(){
  if(!score)return;
  const duration=totalDuration();
  $('duration').textContent=formatTime(duration);$('seek').max=duration;$('exportStart').max=duration;$('exportEnd').max=duration;
  if(Number($('exportEnd').value)>duration)$('exportEnd').value=Math.floor(duration*100)/100;
  if(time>duration){player.stop();time=duration;player.base=time;playingUI()}
  [...$('ruler').children].forEach(span=>span.style.left=`${Number(span.dataset.time)/duration*100}%`);
  [...$('miniNotes').children].forEach(el=>el.style.left=`${Number(el.dataset.time)/duration*100}%`);
  drawWaveform();updateTransport();
}

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500)}
function status(message){$('statusText').textContent=message}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function safeName(){return(settings.title||'流谱作品').replace(/[\\/:*?"<>|]/g,'_').slice(0,60)}
function clearExport(){
  $('exportVideo').pause();$('exportVideo').removeAttribute('src');$('exportVideo').load();$('exportImage').removeAttribute('src');
  $('exportResult').hidden=true;$('exportDownload').removeAttribute('href');
  if(exportURL){URL.revokeObjectURL(exportURL);exportURL=null}
  if(exportPosterURL){URL.revokeObjectURL(exportPosterURL);exportPosterURL=null}
}
function presentExport(blob,extension,poster=null,downloadName=null){
  clearExport();exportURL=URL.createObjectURL(blob);
  const video=extension==='webm';$('exportImage').hidden=video||extension==='zip'&&!poster;$('exportVideo').hidden=!video;
  if(poster){exportPosterURL=URL.createObjectURL(poster);$('exportImage').src=exportPosterURL}
  else if(extension!=='zip')$(video?'exportVideo':'exportImage').src=exportURL;
  const link=$('exportDownload');link.href=exportURL;link.download=downloadName||`${safeName()}.${extension}`;link.textContent=downloadName?'下载 AE 合成包':`下载 ${extension.toUpperCase()}`;
  $('exportSize').textContent=`${(blob.size/1024/1024).toFixed(2)} MB · 已在本机生成`;$('exportResult').hidden=false;
  $('exportProgress').textContent='已生成，可预览后点击下载。';
}
function playingUI(){const p=player.playing||pendingPlay;$('play').setAttribute('aria-label',pendingPlay&&!player.playing?'取消准备播放':p?'暂停':'播放');$('play').classList.toggle('playing',p);$('play').querySelector('use').setAttribute('href',p?'#i-pause':'#i-play')}
function pause(){playSequence++;pendingPlay=false;$('play').removeAttribute('aria-busy');player.stop();time=clamp(player.base,0,totalDuration());playingUI();updateTransport();render();status('已暂停')}
async function play(){
  if(!score||busy||pendingPlay||vstBusy)return;
  const request=++playSequence;
  pendingPlay=true;$('play').setAttribute('aria-busy','true');status('正在准备音源…');
  playingUI();
  try{
    if(time>=totalDuration()-.02)time=0;
    await player.play(time,score,Number($('speed').value),Number($('offset').value),PLAY_LEAD_IN);
    if(request!==playSequence)return;
    playingUI();
    if(player.playing)status(player.audioBuffer?'正在播放演奏录音':player.output==='vst'?'VST3 乐器播放中':'Salamander 钢琴播放中');
  }catch(e){if(request===playSequence){toast(`无法播放：${e.message}`);status(`播放失败 · ${e.message}`)}}
  finally{if(request===playSequence){pendingPlay=false;$('play').removeAttribute('aria-busy');playingUI()}}
}
async function seek(value){
  if(!score||recording||busy)return;
  const wasPlaying=player.playing||pendingPlay;pause();time=clamp(Number(value),0,totalDuration());player.base=time;
  updateTransport();render();if(wasPlaying)await play();else playingUI();
}
function render(){if(score)renderer.render(time,settings)}
function updateTransport(){
  if(!score)return;
  const setText=(id,value)=>{const element=$(id);if(element.textContent!==value)element.textContent=value};
  setText('currentTime',formatTime(time));$('seek').value=time;
  $('timelinePlayhead').style.left=`${time/totalDuration()*100}%`;
  const index=lastTimeIndex(score.measureTimes,time);
  setText('barStatus',time>=score.duration?'尾部消散':`第 ${Math.max(0,index)+1} 小节`);
  setText('liveTempo',`${Math.round((score.tempoAt?.(time)||score.bpm)*Number($('speed').value))} BPM`);
}
function animate(stamp){
  requestAnimationFrame(animate);
  if(!player.playing){frameDeadline=0;return}
  const next=nextFrameTime(stamp,frameDeadline);if(next===null)return;frameDeadline=next;
  time=clamp(player.time(),0,totalDuration());
  if(recording&&time>=recording.end){finishRecording();return}
  if(time>=totalDuration()-.001){
    pause();
    if(looping&&!recording){time=0;player.base=0;play()}
    return;
  }
  render();updateTransport();
  if(recording)$('exportProgress').textContent=`正在录制 ${Math.min(100,Math.round((time-recording.start)/(recording.end-recording.start)*100))}% · 请保持页面可见`;
}
requestAnimationFrame(animate);

function resizeStage(){
  const wrap=$('stage').parentElement;
  const [a,b]=settings.aspect.split(':').map(Number),r=a/b;
  const width=Math.min(wrap.clientWidth-40,Math.max(180,wrap.clientHeight-10)*r);
  $('stage').style.width=`${Math.max(180,width)}px`;
  $('stage').style.aspectRatio=`${a}/${b}`;
  if(!recording&&!sequenceJob&&!recordingPreparation)setCanvasSize();
}
new ResizeObserver(resizeStage).observe($('stage').parentElement);
function outputDimensions(res=1080){
  const [a,b]=settings.aspect.split(':').map(Number);
  return a>=b?[Math.round(res*a/b),res]:[res,Math.round(res*b/a)];
}
function setCanvasSize(res){
  if(res===undefined){
    // Preview follows the stage's device pixels so notation stays crisp on HiDPI screens; exports keep explicit sizes.
    const stage=$('stage'),dpr=Math.min(window.devicePixelRatio||1,2);
    res=clamp(Math.round(Math.min(stage.clientWidth||540,stage.clientHeight||540)*dpr),180,2160);
  }
  const [w,h]=outputDimensions(res);
  if($('canvas').width!==w||$('canvas').height!==h){$('canvas').width=w;$('canvas').height=h}
  render();
}

async function openScore(xml,filename,isDemo=false){
  if(recording||sequenceJob)return;
  const seq=++loadSequence;busy=true;pause();
  $('play').disabled=true;$('exportBtn').disabled=true;$('loading').hidden=false;
  $('loading').querySelector('b').textContent='正在排版乐谱';$('loading').querySelector('span:last-child').textContent='读取音符、声部和节拍…';
  status('正在读取 MusicXML…');
  try{
    // Allow the loading state to paint before the synchronous engraving operation.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const result=await loadScore(xml,filename);
    if(seq!==loadSequence)return;
    score=result;renderer.setScore(score);time=0;player.base=0;
    $('notationReport').textContent=score.notationReport||'已保留引擎输出的记谱标记；尚未覆盖所有特殊记谱法。';
    $('playbackReport').textContent=`已识别 ${score.tiedContinuations} 个延音续接，合并为持续发声。续音符头仅跟随位置高亮，不重新起音；连奏线下的独立音符仍分别发声。`;
    $('playbackWarnings').hidden=!score.playbackWarnings.length;$('playbackWarnings').textContent=score.playbackWarnings.join(' ');
    $('overlayRemove').disabled=true;$('overlayStatus').textContent='补充 SVG 须与原始排版 SVG 使用相同 viewBox；沿谱面坐标滚动，不改变播放时间。';
    if(player.audioBuffer){player.audioBuffer=null;resetAudioUI();toast('已更换乐谱，请重新关联对应录音。')}
    settings.title=score.title;$('titleInput').value=settings.title;
    $('projectName').textContent=score.title;$('scoreFilename').textContent=filename;$('demoTag').hidden=!isDemo;
    $('instrument').textContent=score.instrument;
    $('instrument').title=score.instrument;$('timeSignature').textContent=score.signature;$('scoreTempo').textContent=score.tempoChanges.length>1?`${Math.min(...score.tempoChanges.map(t=>t.bpm))}–${Math.max(...score.tempoChanges.map(t=>t.bpm))} BPM`:`${score.bpm} BPM`;$('measureCount').textContent=score.measures;
    $('tempoList').replaceChildren();
    score.tempoChanges.forEach(t=>{
      const li=document.createElement('li'),button=document.createElement('button'),at=document.createElement('span'),bpm=document.createElement('b');
      at.textContent=formatTime(t.time);bpm.textContent=`${Math.round(t.bpm*100)/100} BPM`;
      button.append(at,bpm);button.title=`跳到 ${t.time.toFixed(2)} 秒`;button.onclick=()=>seek(t.time);li.append(button);$('tempoList').append(li);
    });
    $('tempoWarnings').hidden=!score.tempoWarnings.length;$('tempoWarnings').textContent=score.tempoWarnings.join(' ');
    $('duration').textContent=formatTime(score.duration);$('seek').max=score.duration;
    $('exportStart').max=score.duration;$('exportStart').value=0;$('exportEnd').max=score.duration;
    $('exportEnd').value=Math.min(10,Math.floor(score.duration*100)/100)||score.duration;
    $('trackTitle').textContent=score.title;$('ruler').replaceChildren();$('miniNotes').replaceChildren();
    const stride=Math.max(1,Math.ceil(score.measureTimes.length/16));
    score.measureTimes.forEach((m,n)=>{if(n%stride)return;const span=document.createElement('span');span.textContent=n+1;span.dataset.time=m.time;span.style.left=`${m.time/score.duration*100}%`;$('ruler').append(span)});
    for(const e of score.events.filter((_,i)=>i%Math.max(1,Math.ceil(score.events.length/100))===0).slice(0,100)){
      const el=document.createElement('i');el.style.height=`${clamp((e.pitch-30)*.45,3,20)}px`;el.dataset.time=e.start;el.style.left=`${e.start/score.duration*100}%`;$('miniNotes').append(el);
    }
    $('loading').hidden=true;
    status(`${isDemo?'演示乐谱':'已导入'} · ${score.measures} 小节 · ${score.tempoChanges.length} 段速度 · ${score.tempoWarnings.length?'速度提示见音频面板':'本地处理'}`);
    syncDuration();render();resizeStage();
  }catch(e){
    if(seq!==loadSequence)return;
    toast(`导入失败：${e.message}`);status(`导入失败 · ${e.message}`);
    if(score)$('loading').hidden=true;
    else{$('loading').querySelector('b').textContent='暂时无法读取乐谱';$('loading').querySelector('span:last-child').textContent=e.message}
  }finally{
    if(seq===loadSequence){busy=false;$('play').disabled=!score;$('exportBtn').disabled=!score}
  }
}

async function readScoreFile(file){
  if(!file)return;
  if(!/\.(musicxml|xml)$/i.test(file.name)){toast('请选择 .musicxml 或 .xml 文件；MXL 压缩谱将在后续版本支持。');return}
  if(file.size>4_000_000){toast('原型限制为 4 MB 乐谱，请先导出选段。');return}
  await openScore(await file.text(),file.name);
}
async function readAudioFile(file){
  if(!file||recording||sequenceJob)return;
  if(!score){toast('请先导入乐谱。');return}
  if(file.size>100_000_000){toast('音频超过原型的 100 MB 限制，请截取片段后导入。');return}
  const currentScore=score;
  pause();status('正在解码演奏音频…');
  try{
    await player.init();const buffer=await player.ctx.decodeAudioData(await file.arrayBuffer());
    if(currentScore!==score)return;
    player.audioBuffer=buffer;$('audioFilename').dataset.userContent='';$('audioFilename').textContent=file.name;$('audioSubtitle').textContent=`演奏录音 · ${formatTime(buffer.duration)}`;
    $('audioStatus').textContent=`已载入 ${file.name}（${formatTime(buffer.duration)}）。播放时将使用这段录音。`;
    $('removeAudio').disabled=false;$('audioTrackPrompt').hidden=true;$('waveform').hidden=false;$('audioTrack').classList.add('has-audio');
    $('audioTrack').setAttribute('aria-label','在音频时间轴定位');
    drawWaveform();status('演奏音频已载入 · 可在音频面板调整起点偏移');toast('音频已载入，播放试听或调整同步。');
  }catch(e){toast(`音频无法解码，请尝试 WAV 或 MP3。${e.message}`);status('音频导入失败 · 已保留之前的音频')}
}
function drawWaveform(){
  const canvas=$('waveform'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!player.audioBuffer||!score)return;
  const data=player.audioBuffer.getChannelData(0),sr=player.audioBuffer.sampleRate,offset=Number($('offset').value);
  ctx.fillStyle='#a4c6b4';
  for(let x=0;x<canvas.width;x+=3){
    const start=Math.floor((x/canvas.width*totalDuration()-offset)*sr),end=Math.floor(((x+3)/canvas.width*totalDuration()-offset)*sr);
    let peak=0;
    for(let j=Math.max(0,start);j<Math.min(data.length,end);j+=Math.max(1,Math.floor((end-start)/20)))peak=Math.max(peak,Math.abs(data[j]));
    if(peak){const height=Math.max(2,peak*canvas.height*.9);ctx.fillRect(x,(canvas.height-height)/2,1.5,height)}
  }
}
function resetAudioUI(){
  delete $('audioFilename').dataset.userContent;$('audioFilename').textContent='添加演奏音频';$('audioSubtitle').textContent='WAV · MP3 · M4A';
  $('audioStatus').textContent='尚未导入录音。当前使用上方选择的乐器。导入录音后将优先播放录音。';
  $('removeAudio').disabled=true;$('audioTrackPrompt').hidden=false;$('waveform').hidden=true;$('audioTrack').classList.remove('has-audio');$('audioTrack').setAttribute('aria-label','导入演奏音频');
  $('offset').value=0;
}
for(const id of ['scoreImport','importPlus'])$(id).onclick=()=>$('scoreFile').click();
for(const id of ['audioImport','audioImport2'])$(id).onclick=()=>$('audioFile').click();
$('scoreFile').onchange=async e=>{try{await readScoreFile(e.target.files[0])}catch(err){toast(err.message)}e.target.value=''};
$('audioFile').onchange=async e=>{await readAudioFile(e.target.files[0]);e.target.value=''};
let defaultXML;
const defaultFilename='Chopin_Nocturne_Op9_No2.musicxml';
async function openDefaultScore(){
  try{
    if(!defaultXML){const response=await fetch('./assets/Chopin_Nocturne_Op9_No2.musicxml');if(!response.ok)throw Error('默认乐谱读取失败');defaultXML=await response.text()}
    await openScore(defaultXML,defaultFilename,true);
  }catch(error){toast(error.message);status(error.message);$('loading').querySelector('b').textContent=error.message;$('loading').querySelector('span:last-child').textContent='请重新载入默认乐谱。'}
}
$('loadDemo').onclick=openDefaultScore;
$('downloadDemo').onclick=async()=>{if(!defaultXML)await openDefaultScore();if(defaultXML)download(new Blob([defaultXML],{type:'application/vnd.recordare.musicxml+xml'}),defaultFilename)};
$('play').onclick=()=>player.playing||pendingPlay?pause():play();
$('restart').onclick=()=>seek(0);
$('loop').onclick=()=>{looping=!looping;$('loop').setAttribute('aria-pressed',looping)};
// Dragging the progress bar fires `input` many times per second. Restarting
// playback on each one starts and fades out sounding piano voices mid-sample,
// which is heard as a buzz. Keep audio paused while scrubbing and resume once
// the drag is released.
let scrubbing=false,scrubResume=false;
function scrub(value){
  if(!score||recording||busy)return;
  if(!scrubbing){scrubbing=true;scrubResume=player.playing||pendingPlay;if(scrubResume)pause()}
  time=clamp(Number(value),0,totalDuration());player.base=time;updateTransport();render();
}
async function endScrub(value){
  if(!scrubbing)return;
  scrubbing=false;const resume=scrubResume;scrubResume=false;
  if(!score||recording||busy)return;
  time=clamp(Number(value),0,totalDuration());player.base=time;updateTransport();render();
  if(resume)await play();else playingUI();
}
$('seek').oninput=e=>scrub(e.target.value);
$('seek').onchange=e=>scrubbing?endScrub(e.target.value):Math.abs(Number(e.target.value)-time)>1e-3&&seek(e.target.value);
for(const type of ['pointerup','pointercancel','keyup','blur'])$('seek').addEventListener(type,e=>endScrub(e.target.value));
$('volume').oninput=e=>player.setVolume(Number(e.target.value));
$('speed').onchange=async()=>{if(player.playing||pendingPlay){pause();await play()}updateTransport()};
$('offset').onchange=async()=>{
  $('offset').value=clamp(Number($('offset').value)||0,-30,30);drawWaveform();
  if(player.playing||pendingPlay){pause();await play()}
};
$('removeAudio').onclick=()=>{pause();player.audioBuffer=null;resetAudioUI();toast('已切换为所选乐器。')};
let vstLoaded=false,vstBusy=false;
function vstState(result){
  vstLoaded=!!result.loaded;
  $('showVst').disabled=!vstLoaded;$('unloadVst').disabled=!vstLoaded;
  $('vstStatus').dataset.error=false;
  $('vstStatus').textContent=vstLoaded?`已载入 ${result.name} · ${result.sampleRate||'—'} Hz`:
    result.available===false?'宿主尚未构建。请运行 npm run build:native，然后刷新页面。':'尚未载入乐器。请选择本机已安装的 .vst3 文件或文件夹。';
}
async function vstAction(action){
  if(vstBusy||recording||sequenceJob)return;
  vstBusy=true;
  if(action!=='status'&&action!=='showEditor')pause();
  $('loadVst').disabled=true;
  if(action==='load')$('vstStatus').textContent='请在系统文件窗口中选择 VST3 乐器…';
  try{vstState(await vst.request(action))}
  catch(error){$('vstStatus').textContent=error.message;$('vstStatus').dataset.error=true;toast(error.message)}
  finally{vstBusy=false;$('loadVst').disabled=false}
}
$('soundSource').onchange=async()=>{
  pause();player.output=$('soundSource').value;
  $('pianoControls').hidden=player.output!=='piano';$('vstControls').hidden=player.output!=='vst';
  if(player.output==='vst')await vstAction('status');
  if(player.audioBuffer)toast('当前优先播放演奏录音。移除录音后使用所选乐器。');
};
$('loadVst').onclick=()=>vstAction('load');
$('showVst').onclick=()=>vstAction('showEditor');
$('unloadVst').onclick=()=>vstAction('unload');
let checkingVst=false;
setInterval(async()=>{
  if(!player.nativeActive||checkingVst||vstBusy)return;
  checkingVst=true;
  try{const state=await vst.request('status');if(!state.loaded)throw new Error('VST 宿主已退出，请重新导入乐器。')}
  catch(error){player.onError(error);vstLoaded=false;$('showVst').disabled=true;$('unloadVst').disabled=true}
  finally{checkingVst=false}
},2000);
window.addEventListener('pagehide',()=>{
  if(player.nativeActive)fetch('/api/vst',{method:'POST',headers:{'Content-Type':'application/json','X-Liupu-VST':'1'},body:JSON.stringify({action:'stop'}),keepalive:true}).catch(()=>{});
  player.stop();
});
for(const id of ['scoreTrack','ruler'])$(id).onclick=e=>{
  const box=$('trackContent').getBoundingClientRect();seek((e.clientX-box.left)/box.width*totalDuration());
};
$('audioTrack').onclick=e=>player.audioBuffer?$('scoreTrack').onclick(e):$('audioFile').click();

function syncStyle(){
  for(const key of sliders){$(key).value=settings[key];$(`${key}Out`).textContent=`${settings[key]}%`}
  for(const key of ['showLine','showTitle'])$(key).checked=settings[key];
  for(const key of ['theme','aspect','motion','color','glowMode','glowShape'])$(key).value=settings[key];
  $('glowRange').value=settings.glowRange;$('glowOffset').value=settings.glowOffset??0;$('glowSweepControls').hidden=settings.glowMode!=='sweep';
  const glowToggleKeys=['glowNote','glowBeam','glowClef','glowKeyMeter','glowRest','glowMark','glowTie','glowLyric'];
  for(const key of glowToggleKeys)$(key).checked=settings[key]!==false;
  for(const key of paletteKeys){$(key).value=settings[key];$(`${key}Hex`).value=settings[key].toUpperCase()}
  $('titleInput').value=settings.title;$('aspectLabel').textContent=settings.aspect;
  document.querySelectorAll('[data-color]').forEach(b=>{const active=b.dataset.color===settings.color;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active)});
  syncMotionControls();syncDuration();render();studioEditor?.syncContext();
}
function markCustomPreset(){
  studioEditor?.refreshDirty();
  document.querySelectorAll('[data-preset]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false')});
}
function syncMotionControls(){
  const isStatic=settings.layout==='rows';
  $('staticControls').hidden=!isStatic;$('anchorField').hidden=isStatic;
  $('trailField').hidden=isStatic;$('staticZoomHint').hidden=!isStatic;$('zoom').max=1000;
  for(const key of ['pageBars','pageRows','pageDecay','decayOffset','decayDelay','decayDuration','noteArrival','decayTrigger','noteExitTrigger'])$(key).value=settings[key];
  $('ledgerMotion').checked=settings.ledgerMotion===true;
  $('decayTiming').hidden=settings.decayTrigger==='progress';
  $('decayHelp').textContent=settings[effectEditor?.decayKey('decayTrigger')??'decayTrigger']==='progress'?'消解边缘随播放位置推进；持续音符按音符出场设置保留。':'小节与持续音结束后开始。时间偏移可以提前或延后出场；谱头是否消解在「谱头」中设置。';
  effectEditor?.sync();
  $('scanlineControls').disabled=!settings.showLine;
}
effectEditor=bindEffectEditor(settings,{changed:()=>{syncMotionControls();syncDuration();render();studioEditor?.syncContext()},download,locked:()=>busy||recording||sequenceJob});
for(const key of ['noteArrival','noteExitTrigger','decayTrigger'])$(key).onchange=e=>{settings[key==='decayTrigger'?effectEditor.decayKey(key):key]=e.target.value;if(key!=='decayTrigger')settings.motionProgramActive=true;syncMotionControls();syncDuration();render()};
$('ledgerMotion').onchange=e=>{settings.ledgerMotion=e.target.checked;markCustomPreset();render()};
for(const key of ['pageBars','pageRows','pageDecay'])$(key).onchange=e=>{settings[key==='pageDecay'?effectEditor.decayKey(key):key]=key==='pageDecay'?e.target.value:Number(e.target.value);syncDuration();render()};
for(const key of ['decayOffset','decayDelay','decayDuration'])$(key).onchange=e=>{
  const value=Number(e.target.value),destination=effectEditor.decayKey(key);settings[destination]=Number.isFinite(value)?clamp(value,Number(e.target.min),Number(e.target.max)):defaults[destination];e.target.value=settings[destination];
  if(key!=='decayOffset'){const program=destination===key?'scoreMotionProgram':'markMotionProgram';settings[program]=structuredClone(settings[program]);settings[program].exit[key==='decayDelay'?'delay':'duration']=settings[destination]} 
  effectEditor.sync();syncDuration();render();
};
for(const key of sliders)$(key).oninput=e=>{settings[key]=Number(e.target.value);$(`${key}Out`).textContent=`${settings[key]}%`;if(['fly','scatter','glow','bloom','glowPeak','glowValley','glowRadius','glowFeather','particles','trail'].includes(key))markCustomPreset();render()};
for(const key of ['glowNote','glowBeam','glowClef','glowKeyMeter','glowRest','glowMark','glowTie','glowLyric'])$(key).onchange=e=>{settings[key]=e.target.checked;markCustomPreset();render()};
$('glowMode').onchange=e=>{settings.glowMode=e.target.value;$('glowSweepControls').hidden=settings.glowMode!=='sweep';markCustomPreset();render()};
$('glowShape').onchange=e=>{settings.glowShape=e.target.value;markCustomPreset();render()};
$('glowRange').onchange=e=>{const value=Number(e.target.value);settings.glowRange=Number.isFinite(value)?clamp(value,.1,12):defaults.glowRange;e.target.value=settings.glowRange;markCustomPreset();render()};
$('glowOffset').onchange=e=>{const value=Number(e.target.value);settings.glowOffset=Number.isFinite(value)?clamp(value,-12,12):defaults.glowOffset;e.target.value=settings.glowOffset;markCustomPreset();render()};
for(const key of ['showLine','showTitle'])$(key).onchange=e=>{settings[key]=e.target.checked;syncMotionControls();render()};
$('motion').onchange=e=>{settings.motion=e.target.value;syncMotionControls();syncDuration();render()};
$('theme').onchange=e=>{
  settings.theme=e.target.value;
  const colors=settings.theme==='paper'?{noteColor:'#272b2c',beamColor:'#272b2c',markColor:'#272b2c',staffColor:'#686b70'}:settings.theme==='dark'?{noteColor:defaults.noteColor,beamColor:defaults.beamColor,markColor:defaults.markColor,staffColor:defaults.staffColor}:null;
  if(colors){for(const n of settings.composition.nodes)if(n.kind==='score')Object.assign(n.config,colors);settings.titleColor=colors.noteColor;settings.backgroundColor=settings.theme==='paper'?'#f2efe6':defaults.backgroundColor}
  syncStyle();
};
$('aspect').onchange=e=>{settings.aspect=e.target.value;$('aspectLabel').textContent=settings.aspect;setCanvasSize();resizeStage()};
$('titleInput').oninput=e=>{settings.title=e.target.value;render()};
$('color').oninput=e=>{settings.color=e.target.value;syncStyle()};
document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{settings.color=b.dataset.color;syncStyle()});
for(const key of paletteKeys){
  const applyColor=value=>{settings[key]=value.toLowerCase();settings.theme='custom';syncStyle()};
  $(key).oninput=e=>applyColor(e.target.value);
  const commitHex=e=>{
    const value=e.target.value.trim();
    if(!/^#[0-9a-f]{6}$/i.test(value)){toast('请输入六位 HEX 颜色，例如 #101B30。');e.target.value=settings[key].toUpperCase();return}
    applyColor(value);
  };
  $(`${key}Hex`).oninput=e=>{if(/^#[0-9a-f]{6}$/i.test(e.target.value.trim()))applyColor(e.target.value.trim())};
  $(`${key}Hex`).onchange=commitHex;
  $(`${key}Hex`).onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commitHex(e);e.target.blur()}};
}
$('backgroundImport').onclick=()=>$('backgroundFile').click();
$('backgroundFile').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||busy||recording||sequenceJob)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('请选择 PNG、JPEG 或 WebP 图片。');return}
  if(file.size>20_000_000){toast('背景图片最多 20 MB，请压缩后重试。');return}
  let url;
  try{
    url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();
    if(busy||recording||sequenceJob){toast('正在处理乐谱或导出，请完成后重新导入背景图片。');return}
    if(image.width*image.height>40_000_000)throw new Error('图片像素过大，请缩小至 4000 万像素以内。');
    renderer.setBackground(image);$('backgroundName').dataset.userContent='';$('backgroundName').textContent=file.name;$('removeBackground').disabled=false;render();toast('背景图片已载入。');
  }catch(err){toast(`背景读取失败：${err.message}`)}finally{if(url)URL.revokeObjectURL(url)}
};
$('removeBackground').onclick=()=>{renderer.setBackground(null);delete $('backgroundName').dataset.userContent;$('backgroundName').textContent='使用纯色背景 · 图片仅在本机读取';$('removeBackground').disabled=true;render()};
$('downloadSVG').onclick=()=>{if(score)download(new Blob([score.originalSVG],{type:'image/svg+xml'}),`${safeName()}-notation.svg`)};
$('overlayImport').onclick=()=>$('overlayFile').click();
$('overlayFile').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||!score||busy||recording||sequenceJob)return;
  const sourceScore=score;
  try{
    if(file.size>4_000_000)throw new Error('补充 SVG 最多 4 MB。');
    const result=await loadSVGOverlay(await file.text(),sourceScore.width,sourceScore.height,sourceScore.rasterScale);
    if(score!==sourceScore)return;
    if(busy||recording||sequenceJob){toast('正在处理乐谱或导出，请完成后重新导入补充 SVG。');return}
    score.overlayImage=result.image;$('overlayRemove').disabled=false;$('overlayStatus').textContent=`已载入 ${file.name} · 保留 SVG 自身颜色与透明度`;render();
  }catch(err){toast(`SVG 无法载入：${err.message}`)}
};
$('overlayRemove').onclick=()=>{if(score)score.overlayImage=null;$('overlayRemove').disabled=true;$('overlayStatus').textContent='已移除补充标记。';render()};
const tabs=['effects','audio'];
function selectTab(name){
  for(const tab of tabs){const active=name===tab;$(`${tab}Tab`).classList.toggle('active',active);$(`${tab}Tab`).setAttribute('aria-selected',active);$(`${tab}Tab`).tabIndex=active?0:-1;$(`${tab}Panel`).hidden=!active}
}
tabs.forEach((name,index)=>{
  $(`${name}Tab`).onclick=()=>selectTab(name);
  $(`${name}Tab`).onkeydown=e=>{
    if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
      e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
      selectTab(tabs[next]);$(`${tabs[next]}Tab`).focus();
    }
  };
});
$('settingsMobile').onclick=()=>document.querySelector('.inspector').scrollIntoView({behavior:'smooth'});
function setFocus(value){document.body.classList.toggle('focus-mode',value);resizeStage();if(!value)$('focusBtn').focus()}
$('focusBtn').onclick=()=>setFocus(true);$('exitFocus').onclick=()=>setFocus(false);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&document.body.classList.contains('focus-mode'))setFocus(false);
  if(e.code==='Space'&&!/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)&&!document.querySelector('dialog[open]')){
    e.preventDefault();if(!recording)(player.playing||pendingPlay?pause():play());
  }
});
let dragDepth=0;
document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('dropOverlay').hidden=false}});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('dropOverlay').hidden=true}});
document.addEventListener('dragover',e=>{e.preventDefault()});
document.addEventListener('drop',async e=>{
  e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;if(recording||sequenceJob)return;
  const files=[...e.dataTransfer.files],xml=files.find(f=>/\.(xml|musicxml)$/i.test(f.name)),audio=files.find(f=>f.type.startsWith('audio/')||/\.(mp3|wav|m4a|ogg|flac)$/i.test(f.name));
  if(xml)await readScoreFile(xml);
  if(audio)await readAudioFile(audio);
  if(!xml&&!audio)toast('请拖入 MusicXML 乐谱或 WAV、MP3 等音频文件。');
});

$('exportBtn').onclick=()=>{pause();$('exportProgress').textContent='';$('exportDialog').showModal()};
$('closeExport').onclick=()=>{$('exportVideo').pause();$('exportDialog').close()};
$('exportDialog').addEventListener('close',()=>$('exportVideo').pause());
function syncExportOptions(){
  const type=$('exportType').value,video=type==='webm',aePackage=type==='ae',sequence=type==='sequence'||aePackage;
  $('videoOptions').hidden=type==='png';$('fpsField').hidden=!sequence;$('elementOptions').hidden=video;
  const layers=$('exportLayer').querySelector('option[value="layers"]'),elementLayers=$('exportLayer').querySelector('option[value="element-layers"]');layers.disabled=!sequence;elementLayers.disabled=!aePackage;
  if(!sequence&&['layers','element-layers'].includes($('exportLayer').value))$('exportLayer').value='composite';
  const layer=$('exportLayer').value,independent=['layers','element-layers','effects','cursor'].includes(layer);
  $('exportTransparent').disabled=independent;if(independent)$('exportTransparent').checked=true;
  $('exportTitle').disabled=['effects','cursor','element-layers'].includes(layer);$('exportCursor').disabled=!['composite'].includes(layer);
  $('doExport').lastChild.textContent=video?'开始录制':aePackage?'生成 AE 合成包':sequence?'生成 PNG 序列':'生成 PNG';
  $('exportModeHelp').textContent=video?'WebM 为带背景预览视频，目标 30 fps；保持页面可见。透明合成请使用 AE 合成包或 PNG 序列。':aePackage?'解压 ZIP 后在 After Effects 中运行 setup-ae.jsx；每包最多 1800 张 PNG 或 600 MB。':'离线逐帧渲染，不受预览帧率影响；每包最多 1800 张 PNG 或 600 MB，长曲请分段导出。';
}
$('exportType').onchange=syncExportOptions;$('exportLayer').onchange=syncExportOptions;
$('exportDialog').addEventListener('cancel',e=>{if(recording||sequenceJob||recordingPreparation)e.preventDefault()});
$('doExport').onclick=async()=>{
  if(!score||recording||sequenceJob||busy)return;
  const res=Number($('resolution').value);
  if($('exportType').value==='webm')await startRecording(res);
  else await exportElement(res,['sequence','ae'].includes($('exportType').value),$('exportType').value==='ae');
};
function setRecordingControls(disabled){
  const job=recording||sequenceJob||recordingPreparation;
  if(disabled){
    job.previousDisabled=new Map();
    document.querySelectorAll('button,input,select,textarea').forEach(el=>{job.previousDisabled.set(el,el.disabled);el.disabled=true});
    $('cancelRecording').hidden=false;$('cancelRecording').disabled=false;
  }else{
    for(const [el,value] of job.previousDisabled)el.disabled=value;
    $('cancelRecording').hidden=true;
  }
}
const canvasPNG=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 编码失败，请降低分辨率。')),'image/png'));
function elementStyle(layer){
  const part=layer.startsWith('part:')?layer.slice(5):null,background=part==='background',cursor=part==='cursor';
  return {...settings,composition:structuredClone(settings.composition),outputLayer:part?(cursor?'cursor':'composite'):layer,outputPart:part,transparent:part? !background : $('exportTransparent').checked||['layers','element-layers'].includes($('exportLayer').value),layoutTitle:part==='title'||$('exportTitle').checked,showTitle:part==='title'||$('exportTitle').checked&&!['effects','cursor'].includes(layer),exportCursor:cursor||!part&&layer==='cursor'||!part&&layer==='composite'&&$('exportCursor').checked};
}
async function exportElement(res,sequence,aePackage=false){
  let plan;
  const selected=$('exportLayer').value;
  const layers=selected==='layers'?
    [{key:'notation',name:'谱面',role:'notation',blendMode:'normal'} ,{key:'effects',name:'演奏光效',role:'effects',blendMode:'add'},{key:'cursor',name:'扫描线',role:'cursor',blendMode:'screen'}]:
    selected==='element-layers'?
      [{key:'part:staff',name:'五线谱线',role:'staff',blendMode:'normal'},{key:'part:marks',name:'记谱标记',role:'marks',blendMode:'normal'},{key:'part:beams',name:'符杠',role:'beams',blendMode:'normal'},{key:'part:notes',name:'音符',role:'notes',blendMode:'normal'},{key:'part:effects',name:'演奏光效',role:'effects',blendMode:'add'},{key:'part:header',name:'谱头',role:'header',blendMode:'normal'},{key:'part:cursor',name:'扫描线',role:'cursor',blendMode:'screen'},{key:'part:background',name:'背景',role:'background',blendMode:'normal'},{key:'part:title',name:'标题',role:'title',blendMode:'normal'}]:
        [{key:selected,name:selected==='composite'?'完整乐谱效果':selected==='notation'?'谱面':selected==='effects'?'演奏光效':'扫描线',role:selected,blendMode:'normal'}];
  try{
    if(sequence){
      plan=createFramePlan({start:Number($('exportStart').value),end:Number($('exportEnd').value),speed:Number($('speed').value),fps:Number($('exportFPS').value)});
      if(plan.end>totalDuration()+1e-7)throw new Error(`结束时间不能超过含退场的时长 ${totalDuration().toFixed(2)} 秒。`);
      if(plan.frameCount*layers.length>1800)throw new Error('此区间超过 1800 张 PNG，请缩短区间或选择 30 fps。');
    }
  }catch(err){$('exportProgress').textContent=err.message;return}
  pause();clearExport();sequenceJob={cancelled:false};busy=true;setRecordingControls(true);
  const oldTime=time,[w,h]=outputDimensions(res),styles=layers.map(layer=>elementStyle(layer.key));
  $('canvas').width=w;$('canvas').height=h;
  try{
    if(!sequence){
      renderer.render(time,styles[0]);const blob=await canvasPNG($('canvas'));
      if(!sequenceJob.cancelled)presentExport(blob,'png');
      return;
    }
    const zip=createZipWriter();let poster;
    for(let i=0;i<plan.frameCount;i++){
      const frame=plan.frameAt(i);
      for(let j=0;j<layers.length;j++){
        if(sequenceJob.cancelled)throw new Error('已取消，未生成不完整素材包。');
        renderer.render(frame.scoreTime,styles[j]);const blob=await canvasPNG($('canvas'));
        if(!poster)poster=blob;
        await zip.add(`${layers[j].role}/frame_${String(i+1).padStart(6,'0')}.png`,blob);
      }
      $('exportProgress').textContent=`正在生成 ${i+1} / ${plan.frameCount} 帧 · ${layers.length} 层 · ${(zip.bytes/1024/1024).toFixed(1)} MB`;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(sequenceJob.cancelled)throw new Error('已取消，未生成不完整素材包。');
    const layerInfo=layers.map((layer,index)=>({id:layer.role,name:layer.name,role:layer.role,path:`${layer.role}/frame_%06d.png`,firstFile:`${layer.role}/frame_000001.png`,frameCount:plan.frameCount,fps:plan.fps,blendMode:layer.blendMode,enabled:true,alpha:styles[index].transparent?'straight':'opaque'}));
    const metadata={schema:'liupu-ae-package',version:1,application:{name:'流谱 Studio',version:'1.2.2'},composition:{name:safeName(),width:w,height:h,pixelAspect:1,fps:plan.fps,frameCount:plan.frameCount,duration:plan.frameCount/plan.fps},source:{start:plan.start,endExclusive:plan.end,speed:plan.speed,scoreDuration:score.duration,title:settings.title||score.title},color:{space:'sRGB',bitDepth:8},audio:{included:false},layers:layerInfo,render:{transparent:styles.every(style=>style.transparent),title:$('exportTitle').checked,cursor:layers.some(layer=>layer.role==='cursor')},settings:aePackage?undefined:styles[0]};
    metadata.source.endExclusive=plan.end;
    await zip.add('manifest.json',new TextEncoder().encode(JSON.stringify(metadata,null,2)));
    if(aePackage){
      await zip.add('setup-ae.jsx',new TextEncoder().encode(makeAESetupScript(metadata)));
      await zip.add('README.txt',new TextEncoder().encode(makeAEGuide(metadata)));
    }else{
      const guide=`流谱 Studio · 合成素材\n\n${w} × ${h} · ${plan.fps} fps · ${plan.frameCount} 帧 · sRGB 8-bit\n范围 ${plan.start}–${plan.end} 乐谱秒，播放倍率 ${plan.speed}。序列不含音频，使用原始录音在合成软件中对齐。\n\n${layers.length>1?'各目录分别导入，保持相同起点、尺寸、缩放和位置。':'直接作为独立图层叠加。'}\n画布未自动裁切，所有帧和图层保持相同坐标。无界面、无水印；标题和光标只按导出选项保留。\n透明 PNG 的棋盘格不是文件内容。\n`;
      await zip.add('README.txt',new TextEncoder().encode(guide));
    }
    presentExport(zip.finish(),'zip',poster,aePackage?`${safeName()}-AE.zip`:null);$('exportProgress').textContent=`已生成 ${plan.frameCount} 帧 × ${layers.length} 层${aePackage?'，解压后运行 setup-ae.jsx':'，可下载 ZIP 导入合成软件'}。`;
    status('透明序列已生成 · 固定帧率逐帧渲染');
  }catch(err){$('exportProgress').textContent=err.message;status('素材生成未完成 · 已保留工程')}
  finally{setRecordingControls(false);sequenceJob=null;busy=false;time=oldTime;setCanvasSize();updateTransport()}
}
async function startRecording(res){
  if(player.output==='vst'&&!player.audioBuffer){$('exportProgress').textContent='VST 声音暂不进入 WebM。请切回 Salamander 钢琴，或导入插件渲染的录音后导出。';return}
  const start=Number($('exportStart').value),end=Number($('exportEnd').value);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>totalDuration()+.01){$('exportProgress').textContent=`请输入 0 到 ${totalDuration().toFixed(1)} 秒内有效的起止时间。`;return}
  if(document.hidden){$('exportProgress').textContent='请先将预览页面切换到前台再录制。';return}
  if(!window.MediaRecorder||!$('canvas').captureStream){$('exportProgress').textContent='当前浏览器不支持录制，请使用新版 Chrome 或 Edge。';return}
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
  if(!mime){$('exportProgress').textContent='当前浏览器没有可用的 WebM 编码器。';return}
  recordingPreparation={cancelled:false};busy=true;setRecordingControls(true);
  try{
    clearExport();$('exportProgress').textContent='正在准备钢琴采样与录制…';await player.prepare(score);
    if(recordingPreparation.cancelled||document.hidden){$('exportProgress').textContent='录制准备已取消。';return}
    setCanvasSize(res);time=start;player.base=start;render();
    const stream=$('canvas').captureStream(30);
    const audioTrack=player.destination.stream.getAudioTracks()[0];
    if(audioTrack)stream.addTrack(audioTrack.clone());
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:12_000_000});
    recording={recorder,stream,start,end,chunks:[],cancelled:false,previousTime:time,previousDisabled:recordingPreparation.previousDisabled};
    recordingPreparation=null;busy=false;
    recorder.ondataavailable=e=>{if(e.data.size&&recording)recording.chunks.push(e.data)};
    recorder.onerror=()=>{toast('浏览器编码失败，请尝试 720p。');finishRecording(true)};
    recorder.onstop=()=>{
      const current=recording;if(!current)return;
      if(!current.cancelled&&current.chunks.length)presentExport(new Blob(current.chunks,{type:mime}),'webm');
      current.stream.getTracks().forEach(t=>t.stop());
      setRecordingControls(false);recording=null;setCanvasSize();
      $('exportProgress').textContent=current.cancelled?'录制已取消。':current.chunks.length?'录制完成，可播放检查并下载。':'未生成视频数据，请重试。';
      status(current.cancelled?'录制已取消':'WebM 实时录制完成 · 正式离线渲染尚未实现');
    };
    recorder.start(250);await play();
    if(!player.playing)throw new Error('音频时钟未能启动。');
    status('正在录制 · 请保持页面可见');
  }catch(e){
    if(recording)finishRecording(true);
    $('exportProgress').textContent=`录制失败：${e.message}`;
  }finally{
    if(recordingPreparation){setRecordingControls(false);recordingPreparation=null;busy=false}
  }
}
function finishRecording(cancelled=false){
  if(!recording)return;
  recording.cancelled=cancelled;pause();
  if(recording.recorder.state!=='inactive')recording.recorder.stop();
  else {recording.stream.getTracks().forEach(t=>t.stop());setRecordingControls(false);recording=null;setCanvasSize()}
}
$('cancelRecording').onclick=()=>{if(sequenceJob)sequenceJob.cancelled=true;else if(recordingPreparation)recordingPreparation.cancelled=true;else finishRecording(true)};
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&recording){finishRecording(true);toast('页面切换到后台，录制已取消。请保持页面可见后重试。')}
});
let initialLibrary;
if(window.liupuDesktop?.readVisualLibrary){
  initialLibrary={};
  try{initialLibrary=await window.liupuDesktop.readVisualLibrary();if(initialLibrary.error)toast(initialLibrary.error)}catch{toast('预设库未能读取，可继续设计并导出预设包。')}
}
studioEditor=bindStudioEditor(settings,defaults,{
  changed:()=>{syncDuration();render()},syncStyle,effectEditor,download,initialLibrary,
  locked:()=>busy||recording||sequenceJob||recordingPreparation,
  getThumbnail:preset=>{
    if(!score)return null;const target=document.createElement('canvas');target.width=384;target.height=216;
    const preview=new CompositionRenderer(target),style=createStudioSettings(defaults);applyVisualPreset(style,preset);style.title=settings.title;preview.setScore(score);preview.render(Math.min(3,score.duration/3),style);return target;
  }
});
$('resetStyle').onclick=()=>{studioEditor.reset();toast('已恢复纯净流动预设，素材与导出设置保留。')};
syncStyle();
syncExportOptions();
prepareEngine().then(openDefaultScore).catch(e=>{
  $('loading').querySelector('b').textContent='乐谱引擎加载失败';
  $('loading').querySelector('span:last-child').textContent='请通过本地服务器打开页面，并确认 vendor 文件完整。';
  status(e.message);
});
