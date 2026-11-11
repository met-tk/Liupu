import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import createModule from 'verovio/wasm';
import {VerovioToolkit} from 'verovio/esm';
import {extractMusicXMLTempos, createTempoTimeline, retimeTimemap} from '../src/performance.mjs';
import {noteEvents, positionAt} from '../src/timing.mjs';

// The extractor needs only this standard Element surface; actual XML parsing remains the browser's job.
const el = (name, attrs = {}, ...values) => ({localName:name, children:values.filter(value => typeof value !== 'string'), textContent:values.map(value => typeof value === 'string' ? value : value.textContent).join(''), getAttribute:key => attrs[key] ?? null});
const text = (name, value) => el(name, {}, String(value));
const doc = (...parts) => ({documentElement:el('score-partwise', {}, ...parts)});
const part = (...measures) => el('part', {}, ...measures);
const measure = (...nodes) => el('measure', {}, ...nodes);
const note = (duration, ...extra) => el('note', {}, text('duration', duration), ...extra);
const sound = (tempo, ...extra) => el('sound', {tempo:String(tempo)}, ...extra);
const metro = (unit, value, dots = 0) => el('direction-type', {}, el('metronome', {}, text('beat-unit', unit), ...Array.from({length:dots}, () => el('beat-unit-dot')), text('per-minute', value)));
const direction = (...nodes) => el('direction', {}, ...nodes);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test('tempo integration handles changes inside sustained notes and is exactly invertible', () => {
  const timeline = createTempoTimeline([{quarter:4,bpm:90}, {quarter:0,bpm:60}, {quarter:2,bpm:120}]);
  assert.deepEqual(timeline.tempoChanges, [{quarter:0,time:0,bpm:60},{quarter:2,time:2,bpm:120},{quarter:4,time:3,bpm:90}]);
  close(timeline.quarterToSeconds(7), 5);
  close(timeline.quarterToSeconds(3) - timeline.quarterToSeconds(1), 1.5);
  assert.equal(timeline.tempoAt(1.999), 60);
  assert.equal(timeline.tempoAt(2), 120);
  for (let q = 0; q <= 100; q += .125) close(timeline.secondsToQuarter(timeline.quarterToSeconds(q)), q);
});

test('camera changes speed inside a sustained note by interpolating quarter positions', () => {
  const timeline = createTempoTimeline([{quarter:0,bpm:60},{quarter:2,bpm:120}]);
  const quarterStops = [{time:0,x:100},{time:4,x:500}];
  const position = time => positionAt(quarterStops,timeline.secondsToQuarter(time));
  close(position(2) - position(1),100);
  close(position(2.5) - position(2),100);
  close(position(3),500);
  const oldSecondsStops = [{time:0,x:100},{time:3,x:500}];
  assert.notEqual(positionAt(oldSecondsStops,2),position(2));
});

test('tempo table removes redundant entries, resolves coincident marks and rejects invalid inputs', () => {
  const timeline = createTempoTimeline([{quarter:0,bpm:60}, {quarter:2,bpm:60}, {quarter:4,bpm:30}, {quarter:4,bpm:120}]);
  assert.equal(timeline.tempoChanges.length, 2);
  assert.equal(timeline.tempoAt(4), 120);
  close(createTempoTimeline([]).quarterToSeconds(4), 2);
  for (const change of [{quarter:NaN,bpm:60},{quarter:0,bpm:Infinity},{quarter:0,bpm:0},{quarter:-1,bpm:60},{quarter:0,bpm:'60'}]) assert.throws(() => createTempoTimeline([change]), RangeError);
  for (const value of [NaN,Infinity,-1]) {
    assert.throws(() => timeline.quarterToSeconds(value), RangeError);
    assert.throws(() => timeline.secondsToQuarter(value), RangeError);
  }
});

test('extracts divisions, pickup length, chord/grace, backup, forward and additive meter', () => {
  const data = extractMusicXMLTempos(doc(part(
    measure(el('attributes', {}, text('divisions',4), el('time', {}, text('beats',4),text('beat-type',4))), direction(sound(60)), note(4)),
    measure(el('attributes', {}, text('divisions',8), el('time', {}, text('beats','3+2'),text('beat-type',8))), note(0,el('grace')), note(8), note(8,el('chord')), el('backup',{},text('duration',8)), el('forward',{},text('duration',12)), direction(metro('eighth',120,1)), note(8)),
    measure()
  )));
  assert.deepEqual(data.measures.map(m => m.duration), [1,2.5,2.5]);
  assert.deepEqual(data.measures[0].marks, [{quarter:0,bpm:60}]);
  assert.deepEqual(data.measures[1].marks, [{quarter:1.5,bpm:90}]);
  assert.deepEqual(data.warnings, []);
});

test('sound tempo takes priority, sound offsets override direction offsets, visual offsets do not alter playback', () => {
  const data = extractMusicXMLTempos(doc(part(measure(
    el('attributes',{},text('divisions',4)),
    direction(metro('half',60), sound(70), el('offset',{},'8')),
    note(4),
    direction(sound(80), el('offset',{sound:'yes'},'2')),
    direction(sound(90, el('offset',{},'4')), el('offset',{sound:'yes'},'-2')),
    note(12)
  ))));
  assert.deepEqual(data.measures[0].marks, [{quarter:0,bpm:70},{quarter:1.5,bpm:80},{quarter:2,bpm:90}]);
});

test('all parts contribute tempo, conflicts use first part and warn', () => {
  const data = extractMusicXMLTempos(doc(
    part(measure(note(2),direction(sound(120)),note(2))),
    part(measure(direction(sound(60)),note(2),direction(sound(150)),note(2)))
  ));
  assert.deepEqual(data.measures[0].marks, [{quarter:0,bpm:60},{quarter:2,bpm:120}]);
  assert.ok(data.warnings.some(warning => warning.includes('冲突')));
});

test('double dots convert correctly; invalid values, tempo ranges and text instructions are not guessed', () => {
  const data = extractMusicXMLTempos(doc(part(measure(
    direction(metro('quarter',40,2)), note(1),
    direction(sound(0)), direction(metro('quarter','80-100')),
    direction(el('direction-type',{},text('words','poco rit.'))),
    direction(el('direction-type',{},text('words','accel.'))), note(1)
  ))));
  assert.deepEqual(data.measures[0].marks, [{quarter:0,bpm:70}]);
  assert.ok(data.warnings.some(w => w.includes('数字速度无效')));
  assert.ok(data.warnings.some(w => w.includes('无法换算')));
  assert.equal(data.warnings.filter(w => w.includes('不推测')).length, 1);
});

test('retiming replays source tempo marks on repeats and preserves note arrays and source map', () => {
  const map = [{qstamp:0,tstamp:0,tempo:60,measureOn:'a',on:['n']}, {qstamp:4,tstamp:4000,measureOn:'b',off:['n']}, {qstamp:7,tstamp:7000,measureOn:'a',on:['n']}, {qstamp:11,tstamp:11000,measureOn:'b',off:['n']}, {qstamp:14,tstamp:14000}];
  const data = {measures:[{duration:4,marks:[{quarter:0,bpm:60},{quarter:2,bpm:120}]},{duration:3,marks:[{quarter:0,bpm:90}]}],warnings:[]};
  const result = retimeTimemap(map, data, ['a','b']);
  assert.deepEqual(result.timemap.map(e => e.tstamp), [0,3000,5000,8000,10000]);
  assert.deepEqual(result.tempoChanges.map(e => e.bpm), [60,120,90,60,120,90]);
  assert.deepEqual(noteEvents(result.timemap, () => ({pitch:60})).map(e => [e.start,e.end]), [[0,3],[5,8]]);
  assert.equal(map[1].tstamp, 4000);
  assert.equal(result.timemap[0].on, map[0].on);
  close(result.duration,10);
});

test('repeat jumps restore the source inherited tempo when no new mark occurs at its start', () => {
  const data = {measures:[{marks:[{quarter:0,bpm:60}]},{marks:[{quarter:1,bpm:120}]},{marks:[]}],warnings:[]};
  const map = ['a','b','c','b','c'].map((measureOn,index) => ({measureOn,qstamp:index * 2,tstamp:index * 1000}));
  map.push({qstamp:10,tstamp:10000});
  const result = retimeTimemap(map,data,['a','b','c']);
  assert.deepEqual(result.tempoChanges.map(({quarter,bpm}) => [quarter,bpm]), [[0,60],[3,120],[6,60],[7,120]]);
});

test('skipping the first ending retains the tempo from the actual playback path', () => {
  const data = {measures:[{marks:[{quarter:0,bpm:60}]},{marks:[{quarter:0,bpm:120}]},{marks:[]}],warnings:[]};
  const map = ['verse','ending1','verse','ending2'].map((measureOn,index) => ({measureOn,qstamp:index * 4,tstamp:index * 4000}));
  map.push({qstamp:16,tstamp:16000});
  const result = retimeTimemap(map,data,['verse','ending1','ending2']);
  assert.deepEqual(result.tempoChanges.map(({quarter,bpm}) => [quarter,bpm]), [[0,60],[4,120],[8,60]]);
  assert.equal(result.tempoAt(result.quarterToSeconds(12)),60);
  close(result.duration,14);
});

test('a first tempo mark in the middle of a measure does not take effect prematurely', () => {
  const data = {measures:[{marks:[{quarter:2,bpm:60}]}],warnings:[]};
  const result = retimeTimemap([{qstamp:0,tstamp:0,tempo:60,measureOn:'a'},{qstamp:4,tstamp:4000}],data,['a']);
  assert.deepEqual(result.tempoChanges.map(({quarter,bpm}) => [quarter,bpm]), [[0,120],[2,60]]);
  close(result.duration,3);
  const noMarks = retimeTimemap([{qstamp:0,tstamp:0,tempo:80,measureOn:'a'},{qstamp:4,tstamp:3000}],{measures:[{marks:[]}],warnings:[]},['a']);
  close(noMarks.duration,3);
});

test('rest-only events and conditional repeat tempos retain their musical positions', () => {
  const data = {measures:[{marks:[{quarter:0,bpm:60},{quarter:1,bpm:120,passes:[2]}]}],warnings:[]};
  const result = retimeTimemap([{qstamp:0,tstamp:0,measureOn:'a',restsOn:['r']},{qstamp:2,tstamp:1000,measureOn:'a'},{qstamp:4,tstamp:2000,restsOff:['r']}],data,['a']);
  assert.deepEqual(result.tempoChanges.map(({quarter,bpm})=>[quarter,bpm]), [[0,60],[3,120]]);
  close(result.duration,3.5);
  assert.deepEqual(result.timemap[0].restsOn,['r']);
  assert.throws(() => retimeTimemap([{qstamp:2},{qstamp:1}],data,['a']),RangeError);
  assert.throws(() => retimeTimemap([{tstamp:0}],data,['a']),RangeError);
});

test('real Verovio fixture exposes intra-measure tempo limitation; corrected map has 10-second repeated performance', async () => {
  const xml = await readFile(new URL('./fixtures/tempo-changes.musicxml', import.meta.url),'utf8');
  const tk = new VerovioToolkit(await createModule());
  try {
    tk.setOptions({inputFrom:'xml',breaks:'none',adjustPageWidth:true,xmlIdChecksum:true});
    assert.ok(tk.loadData(xml));
    const svg = tk.renderToSVG(1);
    const ids = [...svg.matchAll(/<g id="([^"]+)" class="measure">/g)].map(match => match[1]);
    const map = tk.renderToTimemap({includeMeasures:true,includeRests:true});
    const data = {measures:[{duration:4,marks:[{quarter:0,bpm:60},{quarter:2,bpm:120}]},{duration:3,marks:[{quarter:0,bpm:90}]}],warnings:[]};
    const result = retimeTimemap(map,data,ids);
    assert.equal(ids.length,2);
    assert.equal(map.filter(e => e.measureOn).length,4);
    close(result.duration,10);
    const events = noteEvents(result.timemap,id => tk.getMIDIValuesForElement(id));
    close(events.find(e => e.id === 'tempo-e').start,2);
    close(events.find(e => e.id === 'tempo-f').start,2.5);
    close(events.find(e => e.id === 'tempo-g').start,3);
    assert.equal(events.filter(e => e.id === 'tempo-c' || e.id === 'tempo-c-rend2').length,2);
    assert.ok(events.every(e => e.end > e.start));
  } finally { tk.destroy(); }
});
