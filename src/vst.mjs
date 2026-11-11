import { currentLanguage } from './i18n.mjs';

export class VstClient {
  constructor(){this.queue=Promise.resolve()}
  request(action,data={}){
    const run=async()=>{
      const response=await fetch('/api/vst',{
        method:'POST',headers:{'Content-Type':'application/json','X-Liupu-VST':'1'},
        body:JSON.stringify({action,...data,language:currentLanguage()})
      });
      let result;
      try{result=await response.json()}catch{throw new Error('VST 宿主不可用，请重新启动应用；网页版需通过 npm start 启动。')}
      if(!response.ok||!result.ok)throw new Error(result.error||'VST 宿主请求失败。');
      return result;
    };
    const pending=this.queue.then(run);this.queue=pending.catch(()=>{});return pending;
  }
}
