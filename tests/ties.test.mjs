import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { prepareTieSource, mergeTiedEvents } from '../src/ties.mjs';
import { noteEvents } from '../src/timing.mjs';
import { createTempoTimeline } from '../src/performance.mjs';

// Standard Element methods used by the extractor; real MusicXML import is tested below.
const el = (localName, attrs = {}, ...values) => ({
  localName, namespaceURI: null, attrs: { ...attrs }, children: values.filter(value => typeof value !== 'string'),
  textContent: values.map(value => typeof value === 'string' ? value : value.textContent).join(''),
  getAttribute(key) { return this.attrs[key] ?? null; }, setAttribute(key, value) { this.attrs[key] = String(value); }, removeAttribute(key) { delete this.attrs[key]; },
  appendChild(node) { this.children.push(node); return node; },
});
const txt = (name, value) => el(name, {}, String(value));
const tie = (type, attrs = {}) => el('tie', { type, ...attrs });
const tied = (type, attrs = {}) => el('tied', { type, ...attrs });
const note = (id, sound = [], visible = [], options = {}) => el('note', id ? { id } : {},
  ...(options.chord ? [el('chord')] : []), el('pitch', {}, txt('step', options.step || 'C'), txt('alter', options.alter || 0), txt('octave', options.octave || 4)),
  txt('duration', 1), ...sound, txt('voice', options.voice || 1), txt('type', 'quarter'), txt('staff', options.staff || 1),
  ...(visible.length ? [el('notations', {}, ...visible)] : []));
const doc = (...parts) => ({ documentElement: el('score-partwise', { version: '4.0' }, ...parts), createElementNS: (_, name) => el(name) });
const part = (...notes) => el('part', { id: 'P1' }, el('measure', { number: '1' }, ...notes));
const serialize = node => `<${node.localName}${Object.entries(node.attrs).map(([key, value]) => ` ${key}="${value}"`).join('')}>${node.children.length ? node.children.map(serialize).join('') : node.textContent}</${node.localName}>`;
const event = (id, start, end, pitch = 60) => ({ id, start, end, pitch });

test('source IDs are stable and unique, while sound-only ties gain matching visible notation', () => {
  const a = note('valid-a', [tie('start')]), b = note(null, [tie('stop')]);
  const source = doc(part(a, b, note('liupu-note-1'), note('duplicate'), note('duplicate')));
  const result = prepareTieSource(source);
  assert.equal(a.getAttribute('id'), 'valid-a');
  assert.equal(b.getAttribute('id'), 'liupu-note-2');
  assert.deepEqual(result.links, [{ from: 'valid-a', to: 'liupu-note-2' }]);
  assert.match(serialize(a), /<tied type="start">/);
  assert.match(serialize(b), /<tied type="stop">/);
  const first = serialize(source.documentElement);
  assert.deepEqual(prepareTieSource(source).links, result.links);
  assert.equal(serialize(source.documentElement), first);
  assert.ok(result.warnings.some(message => message.includes('ID')));
});

test('voice and part isolate ties, cross-staff ties remain valid and partial chords stay separate', () => {
  const source = doc(part(note('c1', [tie('start')]), note('e1', [], [], { step: 'E', chord: true }),
    note('other-voice', [tie('stop')], [], { voice: 2 }), note('c2', [tie('stop')], [], { staff: 2 }), note('e2', [], [], { step: 'E' })),
  part(note('other-part', [tie('stop')])));
  const result = prepareTieSource(source);
  assert.deepEqual(result.links, [{ from: 'c1', to: 'c2' }]);
  const input = [event('c1', 0, 1), event('e1', 0, 1, 64), event('c2', 1, 2), event('e2', 1, 2, 64)];
  const merged = mergeTiedEvents(input, result.links);
  assert.equal(merged.audioEvents.length, 3);
  assert.equal(merged.audioEvents.find(item => item.id === 'c1').end, 2);
  assert.deepEqual(merged.events.map(item => item.attack), [true, true, false, true]);
  assert.deepEqual(merged.events.filter(item => item.pitch === 60).map(item => [item.soundStart, item.soundEnd]), [[0, 2], [0, 2]]);
  assert.deepEqual(input[0], event('c1', 0, 1));
});

test('explicit sound ties take precedence, visual-only normal chains warn, continue and open hooks are not guessed', () => {
  const source = doc(part(note('a', [], [tied('start')]), note('b', [], [tied('stop'), tied('start')]), note('c', [], [tied('stop')]),
    note('x', [tie('start')], [tied('stop')]), note('y', [tie('stop')]), note('continued', [], [tied('continue')]),
    note('ring', [], [tied('let-ring')]), note('hook', [], [tied('start'), tied('stop')])));
  const result = prepareTieSource(source);
  assert.deepEqual(result.links, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'x', to: 'y' }]);
  assert.ok(result.warnings.some(message => message.includes('兼容推断')));
  assert.ok(result.warnings.some(message => message.includes('continue')));
  assert.ok(result.warnings.some(message => message.includes('开放式')));
});

test('unsupported passes, dangling or different-pitch ties and ambiguous unisons warn instead of guessing', () => {
  const timed = prepareTieSource(doc(part(note('t1', [tie('start', { 'time-only': '2' })]), note('t2', [tie('stop')]))));
  assert.equal(timed.links.length, 0); assert.ok(timed.warnings.some(message => message.includes('time-only')));
  const wrongPitch = prepareTieSource(doc(part(note('a', [tie('start')]), note('b', [tie('stop')], [], { step: 'D' }))));
  assert.equal(wrongPitch.links.length, 0); assert.ok(wrongPitch.warnings.length);
  const unison = prepareTieSource(doc(part(note('a1', [tie('start')]), note('a2', [tie('start')], [], { chord: true }), note('b1', [tie('stop')]), note('b2', [tie('stop')]))));
  assert.equal(unison.links.length, 0); assert.ok(unison.warnings.some(message => message.includes('不唯一')));
  const numbered = prepareTieSource(doc(part(note('a1', [tie('start')], [tied('start', { number: '1' })]), note('a2', [tie('start')], [tied('start', { number: '2' })], { chord: true }), note('b1', [tie('stop')], [tied('stop', { number: '1' })]), note('b2', [tie('stop')], [tied('stop', { number: '2' })]))));
  assert.deepEqual(numbered.links, [{ from: 'a1', to: 'b1' }, { from: 'a2', to: 'b2' }]);
});

test('actual performance adjacency handles repeat visits, jumps and tempo changes without merging ordinary repetitions', () => {
  const input = [event('a', 0, 0.5), event('b', 0.5, 1), event('a', 1, 1.5), event('b', 1.5, 2), event('c', 2, 2.5)];
  const result = mergeTiedEvents(input, [{ from: 'b', to: 'c' }]);
  assert.equal(result.audioEvents.length, 4);
  assert.deepEqual(result.audioEvents.map(item => [item.id, item.start, item.end]), [['a', 0, 0.5], ['b', 0.5, 1], ['a', 1, 1.5], ['b', 1.5, 2.5]]);
  assert.equal(mergeTiedEvents(input.slice(0, 4), [{ from: 'a', to: 'b' }]).audioEvents.length, 2);
  assert.equal(mergeTiedEvents(input, []).audioEvents.length, input.length);
  const tempo = createTempoTimeline([{ quarter: 0, bpm: 60 }, { quarter: 1, bpm: 120 }]);
  const varied = [event('a', tempo.quarterToSeconds(0), tempo.quarterToSeconds(1)), event('b', tempo.quarterToSeconds(1), tempo.quarterToSeconds(2)), event('c', tempo.quarterToSeconds(2), tempo.quarterToSeconds(3))];
  const chain = mergeTiedEvents(varied, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
  assert.equal(chain.audioEvents.length, 1); assert.equal(chain.audioEvents[0].end, 2);
  assert.deepEqual(chain.events.map(item => item.soundEnd), [2, 2, 2]);
  assert.equal(mergeTiedEvents([event('a', 0, 1), event('b', 2, 3)], [{ from: 'a', to: 'b' }]).audioEvents.length, 2);
});

test('invalid or ambiguous event links never suppress unrelated attacks', () => {
  const result = mergeTiedEvents([event('a', 0, 1), event('b', 1, 2), event('b', 1, 2)], [{ from: 'a', to: 'b' }]);
  assert.equal(result.audioEvents.length, 3); assert.ok(result.warnings.length);
  assert.equal(mergeTiedEvents([event('a', 0, 1), event('b', 1, 2, 62)], [{ from: 'a', to: 'b' }]).audioEvents.length, 2);
  assert.equal(mergeTiedEvents([event('a', 0, 1)], [{ from: 'a', to: 'a' }]).audioEvents.length, 1);
});

test('real Verovio chord fixture retains visual heads while sound merges only explicit tied members', async () => {
  const tk = new VerovioToolkit(await createModule());
  try {
    tk.setOptions({ inputFrom: 'xml', breaks: 'none' });
    assert.ok(tk.loadData(await readFile(new URL('./fixtures/tied-chords.musicxml', import.meta.url), 'utf8')));
    const svg = tk.renderToSVG(1), timemap = tk.renderToTimemap({ includeMeasures: true });
    assert.equal((svg.match(/class="tie"/g) || []).length, 2);
    const visuals = noteEvents(timemap, id => tk.getMIDIValuesForElement(id));
    assert.equal(visuals.length, 6);
    const result = mergeTiedEvents(visuals, [{ from: 'c1', to: 'c2' }, { from: 'c2', to: 'c3' }]);
    assert.equal(result.audioEvents.length, 4);
    assert.deepEqual(result.events.filter(item => item.id.startsWith('c')).map(item => item.attack), [true, false, false]);
    assert.equal(result.audioEvents.find(item => item.id === 'c1').end, 1.5);
  } finally { tk.destroy(); }
});

test('preprocessed sound-only MusicXML produces a real visible Verovio tie and one continuous sound', async () => {
  const a = note('a', [tie('start')]), b = note('b', [tie('stop')]);
  const source = doc(el('part-list', {}, el('score-part', { id: 'P1' }, txt('part-name', 'Piano'))), el('part', { id: 'P1' }, el('measure', { number: '1' },
    el('attributes', {}, txt('divisions', 1), el('time', {}, txt('beats', 2), txt('beat-type', 4)), el('clef', {}, txt('sign', 'G'), txt('line', 2))),
    el('direction', {}, el('sound', { tempo: '120' })), a, b)));
  const { links } = prepareTieSource(source), tk = new VerovioToolkit(await createModule());
  try {
    tk.setOptions({ inputFrom: 'xml', breaks: 'none' }); assert.ok(tk.loadData(serialize(source.documentElement)));
    assert.equal((tk.renderToSVG(1).match(/class="tie"/g) || []).length, 1);
    const result = mergeTiedEvents(noteEvents(tk.renderToTimemap(), id => tk.getMIDIValuesForElement(id)), links);
    assert.equal(result.events.length, 2); assert.equal(result.audioEvents.length, 1); assert.equal(result.audioEvents[0].end, 1);
  } finally { tk.destroy(); }
});
