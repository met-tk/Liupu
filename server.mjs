import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VstBridge } from './vst-bridge.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.musicxml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav', '.md':'text/plain; charset=utf-8' };
export async function startServer({root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist'),port=4173,vst=new VstBridge()}={}){
root=path.resolve(root);
const server = http.createServer(async (req, res) => {
  const host=req.headers.host;
  const boundPort=server.address()?.port;
  if(![`127.0.0.1:${boundPort}`,`localhost:${boundPort}`].includes(host)){res.writeHead(403).end('Invalid host');return}
  if(req.url==='/api/vst'){
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(body))};
    if(req.method!=='POST'||req.headers['x-liupu-vst']!=='1'||req.headers['content-type']!=='application/json'||
      (req.headers.origin&&req.headers.origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site'){
      reply(403,{ok:false,error:'VST 控制仅允许来自本项目页面。'});return;
    }
    try{
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2_000_000)throw new Error('请求过大。')}
      reply(200,await vst.request(JSON.parse(body)));
    }catch(error){reply(400,{ok:false,error:error.message})}
    return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return}
  try {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
let closing;
return {server,url:`http://127.0.0.1:${server.address().port}`,close(){
  return closing??=new Promise(resolve=>{vst.close();server.close(resolve);server.closeAllConnections()});
}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const service=await startServer();
  console.log(`Local: ${service.url}`);
  process.on('exit',()=>{void service.close()});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await service.close();process.exit(0)});
}
