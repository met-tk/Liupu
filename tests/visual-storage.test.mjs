import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {visualStorage} from '../desktop/visual-storage.mjs';
test('desktop preset libraries survive a new store instance and serialize concurrent writes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'liupu-storage-test-'));
  try{const s=visualStorage(dir);assert.deepEqual(await s.read(),{});await Promise.all([s.write('liupu.visual-presets.v1','[{"name":"A"}]'),s.write('liupu.visual-presets.v1','[{"name":"B"}]'),s.write('liupu.ae-effects.v1','[]')]);const restored=await visualStorage(dir).read();assert.equal(restored['liupu.visual-presets.v1'],'[{"name":"B"}]');assert.equal(restored['liupu.ae-effects.v1'],'[]');assert.throws(()=>s.write('../escape','[]'));assert.throws(()=>s.write('liupu.visual-presets.v1','{}'));assert.throws(()=>s.write('liupu.visual-presets.v1',JSON.stringify(Array(51).fill({}))));}finally{await rm(dir,{recursive:true,force:true})}
});

test('v2 presets and older desktop writes remain isolated',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'liupu-storage-versions-'));
  try{
    const s=visualStorage(dir);
    await s.write('liupu.visual-presets.v1','[{"version":1,"name":"Old"}]');
    await s.write('liupu.visual-presets.v2','[{"version":2,"name":"New"}]');
    await s.write('liupu.visual-presets.v3','[{"version":3,"name":"Classic"}]');
    await s.write('liupu.visual-presets.v4','[{"version":4,"name":"Offsets"}]');
    await s.write('liupu.visual-presets.v5','[{"version":5,"name":"Marks"}]');
    await s.write('liupu.visual-presets.v1','[{"version":1,"name":"Edited in old app"}]');
    const restored=await visualStorage(dir).read();
    assert.equal(restored['liupu.visual-presets.v2'],'[{"version":2,"name":"New"}]');
    assert.equal(restored['liupu.visual-presets.v3'],'[{"version":3,"name":"Classic"}]');
    assert.equal(restored['liupu.visual-presets.v4'],'[{"version":4,"name":"Offsets"}]');
    assert.equal(restored['liupu.visual-presets.v5'],'[{"version":5,"name":"Marks"}]');
    assert.equal(restored['liupu.visual-presets.v1'],'[{"version":1,"name":"Edited in old app"}]');
  }finally{await rm(dir,{recursive:true,force:true})}
});
