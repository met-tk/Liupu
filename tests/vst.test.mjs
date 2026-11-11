import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVstCommand, VstBridge } from '../vst-bridge.mjs';
import { VstClient } from '../src/vst.mjs';

test('native boundary accepts only bounded notes and strips file paths and unknown fields',()=>{
  assert.deepEqual(validateVstCommand({action:'load',path:'C:/untrusted.dll'}),{action:'load'});
  const localized=validateVstCommand({action:'load',language:'ja',chooserTitle:'untrusted'});
  assert.match(localized.chooserTitle,/楽器/);assert.match(localized.chooserTranslations,/"Open" = "開く"/);
  assert.deepEqual(validateVstCommand({action:'load',language:'unknown'}),{action:'load'});
  assert.throws(()=>validateVstCommand({action:'execute'}));
  for(const event of [{start:-1,end:2,pitch:60,velocity:80},{start:2,end:1,pitch:60,velocity:80},
    {start:0,end:1,pitch:128,velocity:80},{start:0,end:1,pitch:60,velocity:0}]){
    assert.throws(()=>validateVstCommand({action:'play',volume:.5,events:[event]}));
  }
  const result=validateVstCommand({action:'play',volume:.5,events:[{start:0,end:1,pitch:60,velocity:80.2}],startDelay:999});
  assert.equal(result.startDelay,.15);assert.equal(result.events[0].velocity,80);
  assert.throws(()=>validateVstCommand({action:'volume',volume:Infinity}));
});

test('missing native host is reported without spawning for status or stop',async()=>{
  const host=new VstBridge('X:/nonexistent-liupu-test/LiupuVstHost.exe');
  assert.equal((await host.request({action:'status'})).available,false);
  assert.equal((await host.request({action:'stop'})).ok,true);
  await assert.rejects(host.request({action:'load'}),/build:native/);
});

test('browser commands stay ordered, and a failed command does not poison the queue',async t=>{
  const calls=[];let release;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const action=JSON.parse(options.body).action;calls.push(action);
    assert.equal(options.headers['X-Liupu-VST'],'1');
    if(action==='play')await new Promise(resolve=>{release=resolve});
    return {ok:true,json:async()=>({ok:action!=='load',error:'load failed'})};
  });
  const client=new VstClient(),play=client.request('play'),stop=client.request('stop');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['play']);release();await Promise.all([play,stop]);
  assert.deepEqual(calls,['play','stop']);
  await assert.rejects(client.request('load'),/load failed/);
  assert.equal((await client.request('status')).ok,true);
});
