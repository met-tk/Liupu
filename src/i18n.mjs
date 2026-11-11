import catalog from './i18n-catalog.mjs';

export const messages=catalog.trim().split('\n').map(line=>line.split('\t'));
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=messages.filter(([key])=>/\{\w+\}/.test(key)).map(row=>{
  const keys=[...row[0].matchAll(/\{(\w+)\}/g)].map(m=>m[1]);
  const expression=row[0].split(/\{(\w+)\}/).map((part,index)=>index%2?/^(name|file|url|path|detail)$/.test(part)?'(.+?)':'([^。]+?)':escape(part)).join('');
  return {row,keys,regex:new RegExp('^'+expression+'$','s')};
});
const exact=new Map(messages.map(row=>[row[0],row]));
const terms=messages.filter(([key])=>!key.includes('{')&&/\p{Script=Han}/u.test(key)).sort((a,b)=>b[0].length-a[0].length);
const termMap=new Map(terms.map(row=>[row[0],row]));
const termRegex=new RegExp(terms.map(([key])=>escape(key)).join('|'),'g');
export function translate(text,language='zh'){
  if(typeof text!=='string'||!text.trim())return text;
  const column=language==='ja'?1:language==='en'?2:0;
  const whitespace=text.match(/^(\s*)(.*?)(\s*)$/s),source=whitespace[2];
  const render=row=>column===0?(row[3]||row[0]):row[column]||row[0];
  if(exact.has(source))return whitespace[1]+render(exact.get(source))+whitespace[3];
  if(source.includes('\n'))return whitespace[1]+source.split('\n').map(line=>translate(line,language)).join('\n')+whitespace[3];
  for(const {row,keys,regex} of patterns){
    const match=source.match(regex);
    if(match)return whitespace[1]+render(row).replace(/\{(\w+)\}/g,(_,key)=>{
      const value=match[keys.indexOf(key)+1];
      return /^(name|file|url|path)$/.test(key)?value:translate(value,language);
    })+whitespace[3];
  }
  const sentences=source.split(/(?<=。)\s*/u).filter(Boolean);
  if(sentences.length>1)return whitespace[1]+sentences.map(part=>translate(part,language)).join(language==='zh'?'':' ')+whitespace[3];
  return text.replace(termRegex,key=>render(termMap.get(key)));
}
export const currentLanguage=()=>globalThis.document?.documentElement.lang==='ja'?'ja':globalThis.document?.documentElement.lang==='en'?'en':'zh';
export const t=text=>translate(text,currentLanguage());

export function localizeDocument(language){
  const document=globalThis.document;
  if(!document)return;
  document.documentElement.lang={zh:'zh-CN',ja:'ja',en:'en'}[language]||'zh-CN';
  document.dispatchEvent(new CustomEvent('localechange',{detail:language}));
}

// Keep source copy separate from rendered text, so switching language is reversible.
export function observeLocalization(getLanguage,root=document.body){
  const sources=new WeakMap(),attributes=new WeakMap();
  const skip=element=>!element||element.closest('script,style,textarea,#engraving,[translate="no"],[data-user-content]');
  function text(node){
    if(skip(node.parentElement))return;
    const old=sources.get(node),source=old&&node.data===old.rendered?old.source:node.data;
    const rendered=translate(source,getLanguage());
    sources.set(node,{source,rendered});
    if(node.data!==rendered)node.data=rendered;
  }
  function element(node){
    if(skip(node)||node.hasAttribute('data-user-attributes'))return;
    const old=attributes.get(node)||{};
    for(const key of ['aria-label','title','alt','placeholder']){
      const value=node.getAttribute(key);if(value===null)continue;
      const source=old[key]&&value===old[key].rendered?old[key].source:value,rendered=translate(source,getLanguage());
      old[key]={source,rendered};if(value!==rendered)node.setAttribute(key,rendered);
    }
    attributes.set(node,old);
  }
  function walk(node){
    if(node.nodeType===3){text(node);return}
    if(node.nodeType!==1||skip(node))return;
    element(node);
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
    while(walker.nextNode()){const current=walker.currentNode;if(current.nodeType===3)text(current);else element(current)}
  }
  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='characterData')text(record.target);
      else if(record.type==='attributes')element(record.target);
      else for(const node of record.addedNodes)walk(node);
    }
  });
  walk(root);element(document.documentElement);
  document.title=translate('流谱 Studio · 乐谱影像工作台',getLanguage());
  observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','alt','placeholder']});
  document.addEventListener('localechange',()=>{walk(root);document.title=translate('流谱 Studio · 乐谱影像工作台',getLanguage())});
  return ()=>observer.disconnect();
}
