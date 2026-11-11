import {loadScore} from './score.mjs';
import {prepareTieSource} from './ties.mjs';
import {ScoreRenderer} from './render.mjs';
const result=document.getElementById('result'),rows=document.getElementById('rows');
const defaults={fly:0,scatter:0,glow:60,bloom:45,particles:35,trail:55,anchor:34,zoom:100,showLine:true,showTitle:true,color:'#fff2d6',noteColor:'#f3f3f3',noteOpacity:100,staffColor:'#c4c7cb',staffOpacity:75,beamColor:'#f3f3f3',beamOpacity:100,markColor:'#f3f3f3',markOpacity:100,backgroundColor:'#090c0e',backgroundDim:45,motion:'sticky'};
async function inspect(xml,name,fixture=false){
  result.textContent='读取与核对中…';rows.replaceChildren();
  try{
    const source=new DOMParser().parseFromString(xml,'application/xml'),ties=prepareTieSource(source);
    const score=await loadScore(xml,name),byId=new Map([...source.querySelectorAll('note[id]')].map(note=>[note.id,note]));
    const lines=[],check=(ok,label)=>{if(!ok)throw new Error(label);lines.push('PASS '+label)};
    check(score.events.length-score.audioEvents.length===score.tiedContinuations,'每个延音续接只减少一次重新起音');
    check(score.events.every(event=>score.audioEvents.filter(sound=>sound.noteIds.includes(event.id)&&sound.start<=event.start+1e-7&&sound.end>=event.end-1e-7).length===1),'每个可见符头恰好对应一个连续发声事件');
    check(score.audioEvents.every(sound=>sound.noteIds.length===1||sound.noteIds.slice(1).every((id,index)=>ties.links.some(link=>link.from===sound.noteIds[index]&&link.to===id))),'每个合并段均有原谱明确的延音连接');
    const a=score.events.filter(event=>event.attack===false);
    check(a.every(event=>!score.audioEvents.some(sound=>sound.id===event.id&&Math.abs(sound.start-event.start)<1e-7)),'延音线后续符头不生成新的声音源');
    if(fixture){
      check(score.events.length===6&&score.audioEvents.length===4,'部分和弦三段延音：6个符头仅4次起音');
      check(score.events.find(event=>event.id==='c2').attack===false&&score.events.find(event=>event.id==='c3').attack===false,'C音的后两段只续音');
      check(score.events.filter(event=>event.id.startsWith('e')).every(event=>event.attack),'同一和弦中无延音线的E音仍分别起音');
    }
    const wanted=score.events.filter(event=>{
      const note=byId.get(event.id),number=Number(note?.closest('measure')?.getAttribute('number'));
      return fixture||number>=17&&number<=20&&note?.querySelector('staff')?.textContent==='1';
    });
    for(const event of wanted){
      const note=byId.get(event.id),tr=document.createElement('tr');
      for(const value of [note?.closest('measure')?.getAttribute('number')||'—',event.pitch,`${event.start.toFixed(3)}–${event.end.toFixed(3)}`,`${event.soundStart.toFixed(3)}–${event.soundEnd.toFixed(3)}`,event.attack?'起音':'续音，不起音',event.id]){const td=document.createElement('td');td.textContent=value;tr.append(td)}rows.append(tr);
    }
    result.textContent=lines.join('\n')+`\n${name}：${score.events.length} 个符头事件，${score.audioEvents.length} 次起音，${score.tiedContinuations} 个延音续接。\n原谱连接 ${ties.links.length} 条。\n播放提示：${score.playbackWarnings.join('；')||'无'}\n完成：${lines.length} 项通过。`;
    const renderer=new ScoreRenderer(document.getElementById('canvas'));renderer.setScore(score);renderer.render(wanted[0]?.start||0,defaults);
  }catch(error){result.textContent='FAIL '+error.message;console.error(error)}
}
document.getElementById('source').onchange=async event=>{const file=event.target.files[0];if(file)await inspect(await file.text(),file.name)};
document.getElementById('fixture').onclick=async()=>inspect(await(await fetch('./tied-chords.musicxml')).text(),'tied-chords.musicxml',true);
