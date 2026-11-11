import {writeFile,mkdir,readFile} from 'node:fs/promises';
export async function connect(port=9336,{fresh=false}={}){
  const base=`http://127.0.0.1:${port}`;
  const tab=fresh?await(await fetch(base+'/json/new?http://127.0.0.1:4173/',{method:'PUT'})).json():(await(await fetch(base+'/json/list')).json()).find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:'));
  if(!tab)throw Error('No QA tab');const socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
  let serial=0;const pending=new Map(),errors=[];
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await send('Runtime.enable');await send('Page.enable');
  const screenshot=async path=>{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(r.data,'base64'))};
  return {send,evaluate,screenshot,errors,close:()=>socket.close()};
}
if(process.argv[1]?.endsWith('qa-cdp.mjs')){
  const c=await connect(Number(process.env.QA_PORT)||9336);try{
    if(process.argv[2])console.log(JSON.stringify(await c.evaluate(await readFile(process.argv[2],'utf8')),null,2));
    else console.log(JSON.stringify(await c.evaluate(`({ready:!document.getElementById('play')?.disabled,text:document.body.innerText.slice(0,3500)})`),null,2));
    await mkdir('artifacts/composition-qa',{recursive:true});await c.screenshot('artifacts/composition-qa/current.png');console.log('errors',c.errors);
  }finally{c.close()}
}
