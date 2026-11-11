import test from 'node:test';
import assert from 'node:assert/strict';
import { horizontalIndex, horizontalSlice, motionPadding } from '../src/render-index.mjs';
import { lastTimeIndex, nextFrameTime } from '../src/timing.mjs';
import { effectPresets, presetPhase } from '../src/effect-library.mjs';
import { evaluateMotion, applyFlyin } from '../src/motion-program.mjs';

test('scroll index preserves paint order, overlaps and exact viewport boundaries after seeking',()=>{
  const items=Array.from({length:2000},(_,i)=>({id:i,box:{x:((i*31)%2000)*40-1000,w:i%13===0?2000:20,h:30}}));
  const index=horizontalIndex(items);
  for(const [left,right] of [[0,1000],[50000,51000],[-1000,-980],[80000,81000],[0,1000],[-2000,-1000]]){
    assert.deepEqual(horizontalSlice(index,left,right),items.filter(({box})=>box.x<=right&&box.x+box.w>=left));
  }
  assert.deepEqual(horizontalSlice(horizontalIndex([]),0,100),[]);
});

test('animation viewport padding covers every preset, keyframe extremes and fragment travel',()=>{
  for(const [name] of effectPresets)for(const strength of [75,5000]){
    const program={enter:presetPhase(name,'enter',{strength}),exit:presetPhase(name,'exit',{strength})};
    const padding=motionPadding({motionProgramActive:true,motionProgram:program,trail:300},100,300);
    for(const phase of ['enter','exit'])for(let i=0;i<=20;i++){
      const value=evaluateMotion(program,phase,i/20);value.phase=phase;applyFlyin(value,'offscreen-note');
      const radius=Math.abs(value.scale)*(100+(value.fragments?Math.hypot(285,200)*strength/100:0)+1200);
      assert.ok(Math.abs(value.x)+radius<=padding,`${name}/${phase}/${strength}/${i}`);
    }
  }
  const phase=presetPhase('spin','exit');phase.frames.at(-1).x=10000;phase.frames.at(-1).scale=20;
  const settings={motionProgramActive:true,motionProgram:{enter:phase,exit:phase}};
  assert.ok(motionPadding(settings,500,100)>=10000+20*(500+400));
  phase.easing='future-overshoot';assert.equal(motionPadding(settings,500,100),Infinity);
  assert.equal(motionPadding({motionProgramActive:false},500,100),220);
});

test('timeline lookup finds the last equal timestamp without scanning the remaining score',()=>{
  const entries=[{time:0,start:0},{time:1,start:1},{time:1,start:1},{time:4,start:4}];
  for(const time of [-1,0,1,2,10,0,4]){
    assert.equal(lastTimeIndex(entries,time),entries.findLastIndex(e=>e.time<=time));
    assert.equal(lastTimeIndex(entries,time,'start'),entries.findLastIndex(e=>e.start<=time));
  }
  assert.equal(lastTimeIndex([],1),-1);
  let reads=0;const long=Array.from({length:100000},(_,i)=>({get time(){reads++;return i}}));
  assert.equal(lastTimeIndex(long,2),2);assert.ok(reads<20);
});

test('RAF pacing tolerates 60 Hz timestamp jitter and caps high refresh displays without drift',()=>{
  for(const hz of [59.94,60,120,144,165]){
    let deadline=0,frames=0;
    for(let i=0;i<hz*10;i++){
      const now=i*1000/hz+(i%2?.1:0),next=nextFrameTime(now,deadline);
      if(next!==null){frames++;deadline=next}
    }
    assert.ok(Math.abs(frames-600)<=1,`${hz} Hz rendered ${frames} frames in 10 seconds`);
  }
  assert.equal(nextFrameTime(5,16),null);
  assert.ok(nextFrameTime(2000,16)>2000,'a long stall resets the deadline instead of catch-up rendering');
});
