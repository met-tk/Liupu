// Drives only the explicit test instance started with --remote-debugging-port=9334.
const action=process.argv[2];
const expressions={
  download:"document.getElementById('closeExport').click();document.getElementById('downloadDemo').click()",
  load:"document.getElementById('audioTab').click();document.getElementById('soundSource').value='vst';document.getElementById('soundSource').dispatchEvent(new Event('change'));setTimeout(()=>document.getElementById('loadVst').click(),300)",
  editor:"document.getElementById('showVst').click()",
  play:"document.getElementById('restart').click();document.getElementById('play').click()",
  pause:"document.getElementById('play').click()",
  status:"(async()=>{const {VstClient}=await import('/vst.mjs');return {vst:await new VstClient().request('status'),time:document.getElementById('currentTime').textContent}})()"
};
const targets=await(await fetch('http://127.0.0.1:9334/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:'));
if(!target)throw new Error('Test page not found');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
const result=new Promise((resolve,reject)=>{
  socket.onmessage=({data})=>{const message=JSON.parse(data);if(message.id===1)message.error?reject(Error(JSON.stringify(message.error))):resolve(message.result)};
  socket.onclose=()=>action==='close'?resolve({closed:true}):reject(Error('CDP disconnected'));
});
if(action==='close')socket.send(JSON.stringify({id:1,method:'Browser.close'}));
else{
  if(!expressions[action])throw new Error('Unknown action');
  socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expressions[action],awaitPromise:true,returnByValue:true}}));
}
const timer=setTimeout(()=>{console.error('CDP action timeout');socket.close();process.exitCode=1},15000);
try{console.log(JSON.stringify(await result,null,2))}finally{clearTimeout(timer);socket.close()}
