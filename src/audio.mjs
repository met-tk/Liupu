import { PianoSampler } from './piano.mjs';

const AUDIO_STOP_FADE=.018;

export class AudioPlayer {
  constructor() {
    this.nodes=new Set();this.nodeGains=new Map();this.audioBuffer=null;this.volume=.5;this.offset=0;this.rate=1;
    this.base=0;this.playing=false;this.playRequest=0;this.output='piano';this.leadIn=0;
  }
  async init(){
    if(!this.ctx){
      this.ctx=new AudioContext({latencyHint:'interactive'});
      this.master=this.ctx.createGain();this.master.gain.value=this.volume;
      // Speakers and video capture share the same protected mix.
      this.limiter=this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value=-3;this.limiter.knee.value=6;this.limiter.ratio.value=12;
      this.limiter.attack.value=.003;this.limiter.release.value=.15;
      this.destination=this.ctx.createMediaStreamDestination();
      this.master.connect(this.limiter);this.limiter.connect(this.ctx.destination);this.limiter.connect(this.destination);
    }
    if(!this.piano)this.piano=new PianoSampler(this.ctx,this.master,state=>this.onStatus?.(state));
    if(this.ctx.state==='suspended')await this.ctx.resume();
  }
  async prepare(score){
    await this.init();
    if(!this.audioBuffer&&this.output==='piano')await this.piano.prepare(score.audioEvents??score.events);
  }
  time(){return this.playing?this.base+Math.max(0,this.ctx.currentTime-this.startClock)*this.rate:this.base}
  stop(){
    this.playRequest++;
    if(this.playing)this.base=this.time();
    this.playing=false;clearInterval(this.scheduler);this.piano?.stop();
    this.pendingEvents=[];this.nextEvent=0;
    const hasClock=Number.isFinite(this.ctx?.currentTime),now=hasClock?this.ctx.currentTime:0;
    for(const node of this.nodes){
      const gain=this.nodeGains.get(node),parameter=gain?.gain;
      if(hasClock&&parameter&&typeof parameter.linearRampToValueAtTime==='function'){
        const stopAt=now+AUDIO_STOP_FADE;
        try{
          if(typeof parameter.cancelAndHoldAtTime==='function')parameter.cancelAndHoldAtTime(now);
          else {parameter.cancelScheduledValues?.(now);parameter.setValueAtTime?.(parameter.value??1,now)}
          parameter.linearRampToValueAtTime(0,stopAt);node.stop(stopAt);
        }catch{try{node.stop()}catch{}}
      }else{try{node.stop()}catch{}}
    }
    this.nodes.clear();
    this.nodeGains.clear();
    if(this.nativeActive){
      this.nativeActive=false;
      this.nativeStop=this.vst.request('stop').catch(error=>this.onError?.(error));
    }
    return this.nativeStop;
  }
  // leadIn reserves a short silent tail before the first audible event.  The
  // musical clock remains at `time` during this interval so the score header
  // and playhead do not jump before sound starts.
  async play(time,score,rate,offset,leadIn=0){
    this.stop();const request=this.playRequest;
    if(!Number.isFinite(rate)||rate<=0)throw new Error('播放速度必须大于零。');
    await this.prepare(score);await this.nativeStop;
    if(request!==this.playRequest)return;
    this.base=time;this.rate=rate;this.offset=offset;
    this.leadIn=Math.max(0,Number(leadIn)||0);
    this.startClock=this.ctx.currentTime+this.leadIn;
    if(!this.audioBuffer&&this.output==='vst'){
      const events=(score.audioEvents??score.events).filter(e=>e.end>time&&e.velocity!==0).map(e=>({
        start:Math.max(0,e.start-time)/rate,end:(e.end-time)/rate,pitch:Math.round(e.pitch),velocity:e.velocity??80
      }));
      this.nativeActive=true;
      try{
        const result=await this.vst.request('play',{events,startDelay:.15+this.leadIn,volume:this.volume});
        if(request!==this.playRequest)return;
        this.startClock=this.ctx.currentTime+(result.startDelay??(.15+this.leadIn));
      }catch(error){this.nativeActive=false;throw error}
      this.playing=true;return;
    }
    this.playing=true;
    if(this.audioBuffer){
      const source=this.ctx.createBufferSource();source.buffer=this.audioBuffer;source.playbackRate.value=rate;
      const audioTime=time-offset;
      if(audioTime<this.audioBuffer.duration){
        const gain=this.ctx.createGain();
        const startAt=this.startClock+Math.max(0,-audioTime)/rate;
        if(typeof gain.gain?.setValueAtTime==='function')gain.gain.setValueAtTime(1,startAt);else gain.gain.value=1;
        source.connect(gain);gain.connect(this.master);
        source.start(startAt,Math.max(0,audioTime));
        this.nodes.add(source);this.nodeGains.set(source,gain);
        source.onended=()=>{this.nodes.delete(source);this.nodeGains.delete(source);source.disconnect();gain.disconnect()};
      }else source.disconnect();
    }else{
      this.pendingEvents=(score.audioEvents??score.events).filter(e=>e.end>time).sort((a,b)=>a.start-b.start);
      this.nextEvent=0;
      this.schedule();this.scheduler=setInterval(()=>this.schedule(),25);
    }
  }
  schedule(){
    if(!this.playing)return;
    const time=this.time(),horizon=time+.13*this.rate;
    while(this.nextEvent<this.pendingEvents.length){
      const e=this.pendingEvents[this.nextEvent];
      if(e.start>horizon)break;
      this.nextEvent++;
      if(e.end<=time)continue;
      const start=this.startClock+Math.max(0,e.start-this.base)/this.rate;
      const length=Math.max(.01,(e.end-Math.max(time,e.start))/this.rate);
      this.piano.schedule(e,start,length,Math.max(0,time-e.start)/this.rate);
    }
  }
  setVolume(value){
    this.volume=Math.min(1,Math.max(0,Number(value)||0));
    if(this.master)this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.02);
    if(this.nativeActive)this.vst.request('volume',{volume:this.volume}).catch(error=>this.onError?.(error));
  }
}
