import test from 'node:test';
import assert from 'node:assert/strict';
import {drawFragmented,drawFragmentedShape,renderParts} from '../src/fragment-render.mjs';

function recordingContext(){
  const log=[],stack=[],c={globalAlpha:.8,log,save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()}};
  for(const method of ['translate','rotate','beginPath','rect','clip','drawImage'])c[method]=(...args)=>log.push([method,c.globalAlpha,...args]);
  return c;
}

test('new element flags remain independent while old note-only flags preserve meaning',()=>{
  assert.deepEqual(renderParts({notes:false}),{notes:false,beams:false,effects:false,staff:true,marks:true,header:true,cursor:true});
  const current=renderParts({notes:false,beams:true,effects:true,header:false});
  assert.equal(current.beams,true);assert.equal(current.effects,true);assert.equal(current.header,false);
  assert.equal(renderParts({notes:true,beams:false,effects:false}).notes,true);
});

test('fragment playback is deterministic, bounded, and preserves caller opacity',()=>{
  const image={width:200,height:100},options={amount:.53,strength:5000,key:'note:repeat2',phase:'exit'};
  const a=recordingContext(),b=recordingContext();drawFragmented(a,image,options);drawFragmented(b,image,options);
  assert.deepEqual(a.log,b.log);assert.equal(a.globalAlpha,.8);
  assert.ok(a.log.filter(x=>x[0]==='drawImage').length>1);
  assert.ok(a.log.every(x=>Number.isFinite(x[1])&&x[1]>=0&&x[1]<=.8));
  assert.ok(a.log.filter(x=>x[0]==='translate').every(x=>x.slice(2).every(Number.isFinite)));
  const reverse=recordingContext();drawFragmented(reverse,image,{...options,phase:'enter'});assert.notDeepEqual(reverse.log,a.log);
});

test('fragment endpoints and reduced motion avoid tile motion and preserve an exact hold frame',()=>{
  for(const amount of [0,1]){
    const c=recordingContext();drawFragmented(c,{width:50,height:30},{amount,strength:1000});
    assert.equal(c.log.filter(x=>x[0]==='drawImage').length,amount===0?1:0);
    assert.equal(c.log.filter(x=>x[0]==='translate').length,0);
  }
  const c=recordingContext();let alpha;
  drawFragmentedShape(c,()=>{alpha=c.globalAlpha},{width:50,height:30,amount:.5,strength:1000,reducedMotion:true});
  assert.equal(alpha,.4);assert.equal(c.globalAlpha,.8);assert.equal(c.log.length,0);
});
