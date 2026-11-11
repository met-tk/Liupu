import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
// Keep the legacy key readable so existing saved animations survive the one-way AE export change.
const KEYS=['liupu.visual-presets.v1','liupu.visual-presets.v2','liupu.visual-presets.v3','liupu.visual-presets.v4','liupu.visual-presets.v5','liupu.ae-effects.v1'];
export function visualStorage(directory){
  let queue=Promise.resolve();
  const file=key=>path.join(directory,key+'.json');
  return {
    async read(){const result={};for(const key of KEYS){try{const text=await readFile(file(key),'utf8');if(Buffer.byteLength(text)<=4_000_000&&Array.isArray(JSON.parse(text)))result[key]=text}catch(e){if(e.code!=='ENOENT')result.error='部分预设库未能读取，请从导出的预设包恢复。'}}return result},
    write(key,text){
      if(!KEYS.includes(key)||typeof text!=='string'||Buffer.byteLength(text)>4_000_000)throw Error('预设库大小超出限制');
      const values=JSON.parse(text);if(!Array.isArray(values)||values.length>50)throw Error('预设库最多保存 50 项');
      const job=queue.then(async()=>{await mkdir(directory,{recursive:true});const target=file(key);await writeFile(target+'.tmp',text,'utf8');await rename(target+'.tmp',target);return true});queue=job.catch(()=>{});return job;
    }
  };
}
