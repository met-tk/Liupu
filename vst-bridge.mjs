import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { translate } from './src/i18n.mjs';

export function validateVstCommand(body){
  if(!body||!['status','load','showEditor','unload','play','stop','volume'].includes(body.action))throw new Error('不支持的宿主命令。');
  const command={action:body.action};
  if(body.action==='load'&&['zh','ja','en'].includes(body.language)){
    const labels=['file:','Open','Choose','Save','Cancel','Go up to parent directory','Hard Drive','CD/DVD drive','Documents','Music','Pictures','Desktop','Home folder','New Folder','Please enter the name for the folder','Create Folder',"Couldn't create the folder!",'File already exists',"There's already a file called: FLNM",'Are you sure you want to overwrite it?','Overwrite'];
    command.chooserTitle=translate('选择 VST3 乐器（.vst3 文件或文件夹）',body.language);
    command.chooserTranslations=labels.map(key=>`${JSON.stringify(key)} = ${JSON.stringify(translate(key,body.language))}`).join('\n');
  }
  if(body.action==='volume'||body.action==='play'){
    if(!Number.isFinite(body.volume)||body.volume<0||body.volume>1)throw new Error('音量须为 0–1。');
    command.volume=body.volume;
  }
  if(body.action==='play'){
    if(!Array.isArray(body.events)||body.events.length>16000)throw new Error('乐谱发声事件过多。');
    command.events=body.events.map(e=>{
      if(!e||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>43200||
        !Number.isInteger(e.pitch)||e.pitch<0||e.pitch>127||!Number.isFinite(e.velocity)||e.velocity<1||e.velocity>127)throw new Error('乐谱发声事件无效。');
      return {start:e.start,end:e.end,pitch:e.pitch,velocity:Math.round(e.velocity)};
    });
    command.startDelay=.15;
  }
  return command;
}

export class VstBridge {
  constructor(executable=fileURLToPath(new URL('./native/bin/LiupuVstHost.exe',import.meta.url))){
    this.executable=executable;this.pending=new Map();this.nextId=0;
  }
  available(){return process.platform==='win32'&&existsSync(this.executable)}
  start(){
    if(this.child)return;
    if(!this.available())throw new Error('尚未构建 Windows VST3 宿主，请先运行 npm run build:native。');
    const child=spawn(this.executable,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;
    const fail=message=>{
      if(this.child!==child)return;
      this.child=null;
      for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(new Error(message))}
      this.pending.clear();
    };
    child.on('error',error=>fail(`VST 宿主无法启动：${error.message}`));
    child.on('exit',()=>fail('VST 宿主已退出。可重新导入乐器，或切回内置钢琴。'));
    child.stdin.on('error',()=>fail('VST 宿主连接已断开。'));
    child.stderr.on('data',data=>process.stderr.write(data));
    createInterface({input:child.stdout}).on('line',line=>{
      let result;try{result=JSON.parse(line)}catch{return}
      const entry=this.pending.get(result.id);if(!entry)return;
      clearTimeout(entry.timer);this.pending.delete(result.id);
      entry.resolve({...result,available:true});
    });
  }
  async request(body){
    const command=validateVstCommand(body);
    if(command.action==='status'&&!this.child)return {ok:true,available:this.available(),loaded:false,name:'',editorOpen:false};
    if(command.action==='stop'&&!this.child)return {ok:true,loaded:false};
    this.start();const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);this.child?.kill();
        reject(new Error('VST 宿主长时间没有响应，已关闭宿主以停止声音。请重新导入乐器。'));
      },command.action==='load'?300000:15000);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,...command})+'\n');
    });
  }
  close(){this.child?.kill()}
}
