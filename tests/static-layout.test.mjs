import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStaticLayout, decayProgress, occurrenceInMeasure, staticMeasureTimeline, staticPageAt } from '../src/static-layout.mjs';

const score={width:2000,height:200,duration:24,header:{width:110,states:[]},boxes:new Map(),measureRegions:Array.from({length:6},(_,i)=>({id:`m${i}`,sourceIndex:i,x:i*250,endX:(i+1)*250})),measureTimes:[0,1,0,1,2,3,4,5].map((id,i)=>({id:`m${id}`,time:i*3}))};
test('static pages lay out performed repeats as independent fixed bars and turn only at a page boundary',()=>{
  const layout=buildStaticLayout(score,{width:1920,height:1080,barsPerRow:2,rowsPerPage:2});
  assert.equal(layout.pages.length,2);assert.equal(layout.pages[0].rows.length,2);
  const first=layout.pages[0].rows[0].measures[0],repeat=layout.pages[0].rows[1].measures[0];
  assert.equal(first.id,repeat.id);assert.equal(first.start,0);assert.equal(repeat.start,6);assert.ok(repeat.y>first.y);
  assert.equal(staticPageAt(layout,0),staticPageAt(layout,11.999));assert.equal(staticPageAt(layout,12).index,1);
  assert.equal(staticPageAt(layout,27).index,1);assert.equal(first.x,repeat.x);
});
test('static score geometry and motion units are proportional between 720p and 1080p',()=>{
  const a=buildStaticLayout(score,{width:1920,height:1080}),b=buildStaticLayout(score,{width:1280,height:720});
  assert.ok(Math.abs(a.scale/b.scale-1.5)<1e-9);
  const big=a.pages[0].rows[0].measures[0],small=b.pages[0].rows[0].measures[0];
  for(const key of ['x','y','width'])assert.ok(Math.abs(big[key]/small[key]-1.5)<1e-9);
});
test('decay waits for the bar to end plus delay, preserves future bars, then reaches complete removal',()=>{
  assert.equal(decayProgress(3,3,.5,2),0);assert.equal(decayProgress(3.49,3,.5,2),0);
  assert.equal(decayProgress(4.5,3,.5,2),.5);assert.equal(decayProgress(6,3,.5,2),1);
  assert.equal(decayProgress(3,6,.5,2),0);
});
test('each repeated note selects the event from its own performed bar',()=>{
  const occurrences=[{start:0,end:2},{start:6,end:8}],timeline=staticMeasureTimeline(score);
  assert.equal(occurrenceInMeasure(occurrences,timeline[0]),occurrences[0]);
  assert.equal(occurrenceInMeasure(occurrences,timeline[2]),occurrences[1]);
  assert.equal(occurrenceInMeasure(occurrences,timeline[3]),null);
});
test('final incomplete row retains the full-page glyph scale and original measure proportions',()=>{
  const layout=buildStaticLayout(score,{width:1920,height:1080,barsPerRow:3,rowsPerPage:2});
  const first=layout.pages[0].rows[0].measures[0],last=layout.pages[1].rows[0].measures.at(-1);
  assert.equal(first.scale,last.scale);assert.equal(first.width,last.width);
});
test('a held note crossing the barline postpones staff decay until its own release',()=>{
  const held={...score,boxes:new Map([['long',{measureId:'m0'}]]),events:[{id:'long',start:0,end:4.2},{id:'long',start:6,end:10.1}]};
  const timeline=staticMeasureTimeline(held);
  assert.equal(timeline[0].end,3);assert.equal(timeline[0].decayEnd,4.2);
  assert.equal(timeline[2].end,9);assert.equal(timeline[2].decayEnd,10.1);
  assert.equal(timeline[1].decayEnd,6);
});
test('tied visual segments retain bar membership while decay waits for the whole sound chain',()=>{
  const tied={...score,boxes:new Map([['a',{measureId:'m0'}],['b',{measureId:'m1'}]]),events:[{id:'a',start:0,end:3,soundEnd:6},{id:'b',start:3,end:6,soundEnd:6,attack:false}]};
  const timeline=staticMeasureTimeline(tied);
  assert.equal(timeline[0].decayEnd,6);assert.equal(timeline[1].decayEnd,6);
  assert.equal(occurrenceInMeasure(tied.events,timeline[1]).id,'b');
});
test('row-start markers preserve inline definitions and page zoom cannot push notation outside its bounds',()=>{
  const layout=buildStaticLayout(score,{width:1920,height:1080,barsPerRow:3,rowsPerPage:2,zoom:160});
  const fit=buildStaticLayout(score,{width:1920,height:1080,barsPerRow:3,rowsPerPage:2,zoom:100});
  assert.equal(layout.scale,fit.scale);
  for(const page of layout.pages)for(const row of page.rows){assert.equal(row.measures[0].rowStart,true);assert.ok(row.measures.slice(1).every(measure=>!measure.rowStart));assert.ok(row.x+row.width<=1920);assert.ok(row.top+score.height*row.scale<=1080)}
});
test('empty SVG canvas margins do not shrink the score or change world-coordinate alignment',()=>{
  const padded={...score,height:600,contentTop:160,contentHeight:200};
  const cropped=buildStaticLayout(padded,{width:1920,height:1080}),reference=buildStaticLayout(score,{width:1920,height:1080});
  assert.equal(cropped.scale,reference.scale);
  for(const [index,row] of cropped.pages[0].rows.entries()){
    const other=reference.pages[0].rows[index];
    assert.ok(Math.abs(row.top+padded.contentTop*row.scale-other.top)<1e-9);
    assert.equal(row.height,other.height);assert.equal(row.visibleY,other.visibleY);
    assert.equal(row.measures[0].y,row.top);
  }
});
test('unordered events and occurrence-only scores preserve repeat boundaries, missing bars and visual tails',()=>{
  const events=[
    {id:'a',start:9,end:10,soundEnd:13,visualEnd:14},
    {id:'b',start:6-1e-6,end:8,soundEnd:10},
    {id:'a',start:3-1e-6,end:100},
    {id:'b',start:3.5,end:100},
    {id:'unknown',start:0,end:100},
    {id:'a',start:-.5e-6,end:1,soundEnd:4,visualEnd:5},
    {id:'a',start:12-1e-6,end:100},
  ];
  const source={...score,duration:12,boxes:new Map([['a',{measureId:'m0'}],['b',{measureId:'m1'}]]),
    measureTimes:[{id:'m0',time:0},{id:'missing',time:3},{id:'m1',time:6},{id:'m0-rend2',time:9}],events};
  const expected=[['m0',0,0,3,5],['m1',2,6,9,10],['m0',3,9,12,14]];
  const summarize=value=>staticMeasureTimeline(value).map(({id,occurrence,start,end,decayEnd})=>[id,occurrence,start,end,decayEnd]);
  assert.deepEqual(summarize(source),expected);
  assert.deepEqual(summarize({...source,events:undefined,occurrences:new Map([['a',events.filter(event=>event.id==='a')],['b',events.filter(event=>event.id==='b')]])}),expected);
  assert.equal(source.events,events);assert.equal(events[0].visualEnd,14);
});
test('empty scores and zero-length measures do not borrow adjacent note lifetimes',()=>{
  const empty={...score,measureTimes:[],events:[]};
  assert.deepEqual(staticMeasureTimeline(empty),[]);
  assert.deepEqual(buildStaticLayout(empty,{width:1920,height:1080}).pages,[]);
  const repeated={...score,duration:3,measureTimes:[{id:'m0',time:0},{id:'m0',time:0}],
    boxes:new Map([['a',{measureId:'m0'}]]),events:[{id:'a',start:0,end:5}]};
  assert.deepEqual(staticMeasureTimeline(repeated).map(measure=>measure.decayEnd),[0,5]);
});
test('long repeated scores inspect each event box once when building decay lifetimes',()=>{
  let reads=0;
  class CountedBoxes extends Map {get(id){reads++;return super.get(id)}}
  const count=256,events=Array.from({length:count*4},(_,i)=>({id:'a',start:i*.75,end:i*.75+1}));
  const repeated={...score,duration:count*3,boxes:new CountedBoxes([['a',{measureId:'m0'}]]),events,
    measureTimes:Array.from({length:count},(_,i)=>({id:'m0',time:i*3}))};
  const timeline=staticMeasureTimeline(repeated);
  assert.equal(timeline.length,count);assert.equal(timeline.at(-1).decayEnd,events.at(-1).end);
  assert.equal(reads,events.length);
});
test('repeated opening bars retain their first-note crop after the header is removed',()=>{
  const opening={...score,header:{width:110,states:[{staves:[{clef:{x:10,w:40}}]}]},
    boxes:new Map([['later',{measureId:'m0',x:100}],['first',{measureId:'m0',x:60}],['other',{measureId:'m1',x:15}]])};
  const measures=buildStaticLayout(opening,{width:1920,height:1080}).pages.flatMap(page=>page.rows.flatMap(row=>row.measures));
  assert.deepEqual(measures.filter(measure=>measure.id==='m0').map(measure=>[measure.sourceX,measure.sourceWidth]),[[55,195],[55,195]]);
  assert.equal(measures.find(measure=>measure.id==='m1').sourceX,250);
});
test('later row starts crop their own line-start definitions before the row header is drawn',()=>{
  const rowScore={...score,duration:12,header:{width:110,states:[{time:0,staves:[{clef:{x:10,w:40}}]}]},
    boxes:new Map([['a',{measureId:'m0',x:60}],['b',{measureId:'m2',x:560}]]),
    measureTimes:[0,1,2,3].map((_,i)=>({id:`m${i}`,time:i*3}))};
  const rows=buildStaticLayout(rowScore,{width:1920,height:1080,barsPerRow:2,rowsPerPage:2}).pages[0].rows;
  assert.ok(rows[1].measures[0].sourceX>rows[1].measures[0].x);
});
