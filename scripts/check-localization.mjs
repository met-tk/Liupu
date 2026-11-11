import { readFile, readdir } from 'node:fs/promises';
import { translate, messages } from '../src/i18n.mjs';

const han=/\p{Script=Han}/u;
export function literals(source){
  const found=[];let i=0;
  function quoted(quote){
    let value='';i++;
    while(i<source.length){
      const char=source[i++];
      if(char==='\\'){const escaped=source[i++]||'';value+=({n:'\n',t:'\t',r:'\r'})[escaped]??escaped;continue}
      if(char===quote){found.push(value);return}
      if(quote==='`'&&char==='$'&&source[i]==='{'){
        i++;scan(true);value+='42';continue;
      }
      value+=char;
    }
  }
  function scan(expression=false){
    let depth=0;
    while(i<source.length){
      const char=source[i];
      if(char==='"'||char==="'"||char==='`'){quoted(char);continue}
      if(source.startsWith('//',i)){i=source.indexOf('\n',i);if(i<0){i=source.length;return}continue}
      if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+2;continue}
      if(char==='/'&&(/[=(,:!&|?;{\[]$/.test(source.slice(0,i).trimEnd())||/return\s*$/.test(source.slice(0,i)))){
        i++;let bracket=false;
        while(i<source.length){const c=source[i++];if(c==='\\'){i++;continue}if(c==='[')bracket=true;if(c===']')bracket=false;if(c==='/'&&!bracket)break}
        while(/[a-z]/i.test(source[i]||'')&&i<source.length)i++;
        continue;
      }
      if(expression&&char==='}'){if(depth===0){i++;return}depth--}
      if(expression&&char==='{')depth++;
      i++;
    }
  }
  scan();return found;
}
const files=['src/index.html','desktop/main.mjs','desktop/visual-storage.mjs','vst-bridge.mjs'];
for(const name of await readdir('src'))if(name.endsWith('.mjs')&&!['demo.mjs','i18n.mjs','i18n-catalog.mjs','ae-package.mjs'].includes(name))files.push('src/'+name);
const missing=new Map();
const content=value=>{
  if(value.includes('<')){
    return [...value.matchAll(/>([^<>]+)</g)].map(m=>m[1]).concat([...value.matchAll(/(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map(m=>m[1]));
  }
  return [value];
};
for(const file of files){
  const source=await readFile(file,'utf8');
  const values=file.endsWith('.html')?content(source):literals(source).flatMap(content);
  for(const value of values){
    if(!han.test(value)||['中文','日本語'].includes(value))continue;
    for(const language of ['ja','en']){
      const result=translate(value,language);
      // Japanese legitimately contains kanji. English is the script-level completeness check.
      if(language==='en'&&han.test(result))missing.set(value,{file,result});
    }
  }
}
for(const row of messages)if(row.length<3||!row[1]||!row[2])throw Error('Incomplete translation: '+row[0]);
if(missing.size){
  for(const [text,info] of missing)console.log(JSON.stringify({text,...info}));
  console.error(`${missing.size} source messages need English coverage`);process.exitCode=1;
}else console.log(`All UI source messages covered; ${messages.length} trilingual entries.`);
