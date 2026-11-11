// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const child = spawn(fileURLToPath(new URL('./bin/LiupuVSTHost.exe',import.meta.url)), [], {
  windowsHide:true, stdio:['pipe','pipe','pipe']
});
const pending = new Map();
let nextId = 0;
child.stderr.on('data', data => process.stderr.write(data));
createInterface({input:child.stdout}).on('line', line => {
  try {
    const response = JSON.parse(line);
    const entry = pending.get(response.id);
    if (entry) { clearTimeout(entry.timer);pending.delete(response.id);entry.resolve(response); }
  } catch { throw new Error('Non-JSON data leaked onto the native protocol stdout: '+line); }
});
child.on('exit', (code, signal) => {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);entry.reject(new Error(`Host exited (${code}, ${signal})`));
  }
  pending.clear();
});
const request = (action, fields={}) => new Promise((resolve,reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id);reject(new Error(`${action} timed out`)); },60000);
  pending.set(id,{resolve,reject,timer});
  child.stdin.write(JSON.stringify({id,action,...fields})+'\n');
});

try {
  const initial = await request('status');
  assert.equal(initial.ok,true);assert.equal(initial.loaded,false);assert.equal(initial.error,'');
  assert.ok(initial.sampleRate>0 && initial.device);
  assert.equal((await request('play',{volume:0.1,events:[]})).ok,false);
  assert.equal((await request('volume',{volume:1.1})).ok,false);
  assert.equal((await request('volume',{volume:0.1})).ok,true);
  assert.equal((await request('load',{path:'X:\\not-a-plugin.vst3'})).ok,false);
  console.log('PASS status / audio device / invalid commands:',JSON.stringify(initial));
  const plugin = process.argv[2];
  if (plugin) {
    const loaded = await request('load',{path:plugin});
    assert.equal(loaded.ok,true,loaded.error);assert.equal(loaded.loaded,true);
    const shown = await request('showEditor');
    assert.equal(shown.ok,true,shown.error);assert.equal(shown.editorOpen,true);
    console.log('PASS actual VST3 load and native editor:',JSON.stringify(shown));
    const played = await request('play',{volume:0.1,startDelay:0.15,
      events:[{pitch:60,start:0,end:0.6,velocity:80},{pitch:64,start:0.2,end:0.8,velocity:80},{pitch:67,start:0.4,end:1,velocity:80}]});
    assert.equal(played.ok,true,played.error);
    await delay(800);
    const sounding = await request('status');
    assert.ok(sounding.outputPeak>0.00001,'The instrument did not generate nonzero output samples');
    console.log('PASS instrument generated audible output samples:',JSON.stringify(sounding));
    assert.equal((await request('stop')).playing,false);
    assert.equal((await request('play',{volume:0,events:[{pitch:60,start:0,end:0.2,velocity:1}]})).ok,true);
    await delay(500);
    const muted = await request('status');
    assert.equal(muted.outputPeak,0,'Play volume=0 must mute the native output');
    assert.equal((await request('play',{volume:0.1,events:[{pitch:60,start:0,end:0.2,velocity:0.5}]})).ok,false);
    const unloaded = await request('unload');
    assert.equal(unloaded.loaded,false);assert.equal(unloaded.editorOpen,false);
    console.log('PASS stop / volume / integer velocity / unload');
  } else {
    console.log('Plugin-specific checks skipped. Pass an absolute .vst3 path to test load, editor and sound.');
  }
  child.stdin.end();
  const [code] = await Promise.race([once(child,'exit'),delay(5000).then(()=>{throw new Error('EOF did not shut down the host')})]);
  assert.equal(code,0);
  console.log('PASS clean EOF shutdown');
} finally {
  if (child.exitCode===null)child.kill();
}
