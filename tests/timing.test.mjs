import test from 'node:test';
import assert from 'node:assert/strict';
import createModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { demoXML } from '../src/demo.mjs';
import { noteEvents, cameraStops, positionAt, formatTime } from '../src/timing.mjs';

test('chords, note-off ordering and repeated notation IDs retain independent durations', () => {
  const events = noteEvents([
    {tstamp:0,on:['a','b']}, {tstamp:500,off:['a'],on:['a']},
    {tstamp:1000,off:['a','b']}
  ], () => ({pitch:60}));
  assert.deepEqual(events.map(e=>[e.id,e.start,e.end]), [['a',0,.5],['b',0,1],['a',.5,1]]);
});
test('camera interpolates by time and cuts at a backwards repeat', () => {
  const stops = [{time:0,x:100},{time:1,x:300},{time:2,x:100}];
  assert.equal(positionAt(stops,.5),200);
  assert.equal(positionAt(stops,1.5),300);
  assert.equal(positionAt(stops,2),100);
  assert.equal(formatTime(64.9),'01:04');
});

test('camera moves through leading rests and reaches the final barline', () => {
  const boxes=new Map([['rest',{x:100}],['note',{x:300}]]);
  const stops=cameraStops([{id:'rest',start:0},{id:'note',start:2}],boxes,4,
    [{time:0,x:50,endX:500,sourceIndex:0}]);
  assert.equal(positionAt(stops,0),100);
  assert.equal(positionAt(stops,1),200);
  assert.equal(positionAt(stops,3),400);
  assert.equal(positionAt(stops,4),500);
});

test('camera advances through a sustained note to the barline before a repeat cut', () => {
  const boxes=new Map([['note',{x:100}]]);
  const stops=cameraStops([{id:'note',start:0},{id:'note',start:4}],boxes,8,
    [{time:0,x:50,endX:500,sourceIndex:0},{time:4,x:50,endX:500,sourceIndex:0}]);
  assert.equal(positionAt(stops,2),300);
  assert.ok(positionAt(stops,3.999)>499);
  assert.equal(positionAt(stops,4),100);
  assert.equal(positionAt(stops,6),300);
  assert.equal(positionAt(stops,8),500);
});

test('empty measures retain camera anchors without creating audio notes', () => {
  const events=[{id:'first',start:0},{id:'last',start:8}];
  const boxes=new Map([['first',{x:100}],['last',{x:900}]]);
  const stops=cameraStops(events,boxes,12,[
    {time:0,x:50,endX:400,sourceIndex:0},
    {time:4,x:400,endX:800,sourceIndex:1},
    {time:8,x:800,endX:1200,sourceIndex:2}
  ]);
  assert.equal(positionAt(stops,4),400);
  assert.equal(positionAt(stops,6),650);
  assert.equal(events.length,2);
});
test('real MusicXML fixture renders piano staves and a full playback map', async () => {
  const module = await createModule();
  const tk = new VerovioToolkit(module);
  tk.setOptions({ inputFrom:'xml', breaks:'none', adjustPageWidth:true, adjustPageHeight:true, header:'none', footer:'none' });
  assert.ok(tk.loadData(demoXML));
  const svg = tk.renderToSVG(1);
  assert.match(svg,/class="note"/);
  assert.match(svg,/class="staff"/);
  const tm = tk.renderToTimemap({includeMeasures:true,includeRests:true});
  const events = noteEvents(tm, id=>tk.getMIDIValuesForElement(id));
  assert.ok(events.length >= 180);
  assert.ok(tm.at(-1).tstamp > 40000);
  assert.ok(events.some(e=>e.pitch === 72));
  tk.destroy();
});
