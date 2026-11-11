import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';

test('desktop server uses isolated ports and retains host/origin/path protection',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'liupu-server-'));
  await writeFile(path.join(root,'index.html'),'desktop-test');
  const calls=[];
  const bridge={request:async body=>{calls.push(body);return {ok:true,available:true}},close:()=>calls.push('close')};
  const first=await startServer({root,port:0,vst:bridge});
  const second=await startServer({root,port:0,vst:bridge});
  const request=(url,options={})=>new Promise((resolve,reject)=>{
    const req=http.request(url,options,res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:text,headers:res.headers}))});
    req.on('error',reject);req.end(options.body);
  });
  try{
    assert.notEqual(first.url,second.url);
    const index=await request(first.url);
    assert.equal(index.status,200);assert.equal(index.body,'desktop-test');
    assert.match(index.headers['content-security-policy'],/frame-ancestors 'none'/);
    assert.equal((await request(first.url,{headers:{Host:'attacker.invalid'}})).status,403);
    assert.equal((await request(first.url+'/%2e%2e%5csecret.txt')).status,403);
    const headers={'Content-Type':'application/json','X-Liupu-VST':'1',Origin:first.url};
    assert.equal((await request(first.url+'/api/vst',{method:'POST',headers,body:'{"action":"status"}'})).status,200);
    assert.deepEqual(calls,[{action:'status'}]);
    assert.equal((await request(first.url+'/api/vst',{method:'POST',headers:{...headers,Origin:'https://attacker.invalid'},body:'{}'})).status,403);
    assert.equal((await request(first.url+'/api/vst',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  }finally{
    await first.close();await first.close();await second.close();
    assert.equal(calls.filter(x=>x==='close').length,2);
    await rm(root,{recursive:true,force:true});
  }
});
