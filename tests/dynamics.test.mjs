import test from 'node:test';
import assert from 'node:assert/strict';
import createModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { extractMusicXMLDynamics } from '../src/dynamics.mjs';
import { mergeTiedEvents } from '../src/ties.mjs';
import { noteEvents } from '../src/timing.mjs';

// Minimal standard Element surface, matching the other MusicXML extractor tests.
const el = (localName, attrs = {}, ...values) => ({
  localName, attrs, children:values.filter(value => typeof value !== 'string'),
  textContent:values.map(value => typeof value === 'string' ? value : value.textContent).join(''),
  getAttribute(name) { return this.attrs[name] ?? null; },
});
const txt = (name, value, attrs = {}) => el(name, attrs, String(value));
const attributes = divisions => el('attributes', {}, txt('divisions', divisions));
const measure = (...values) => el('measure', {number:'1'}, ...values);
const part = (...measures) => el('part', {id:'P1'}, ...measures);
const doc = (...parts) => ({documentElement:el('score-partwise', {version:'4.0'}, ...parts)});
const note = (id, options = {}) => el('note', {id, ...options.attrs},
  ...(options.chord ? [el('chord')] : []), ...(options.grace ? [el('grace')] : []),
  ...(options.rest ? [el('rest')] : [el('pitch', {}, txt('step', 'C'), txt('octave', 4))]),
  txt('duration', options.duration ?? 1), txt('voice', options.voice || 1), txt('type', 'quarter'), txt('staff', options.staff || 1));
const direction = (sign, options = {}) => el('direction', {},
  el('direction-type', {}, ...(sign ? [el('dynamics', {}, el(sign))] : []), ...(options.wedge ? [el('wedge', {type:options.wedge})] : [])),
  ...(options.offset ? [txt('offset', options.offset[0], options.offset[1])] : []),
  ...(options.staff ? [txt('staff', options.staff)] : []), ...(options.voice ? [txt('voice', options.voice)] : []),
  ...(options.sound ? [el('sound', options.sound, ...(options.soundOffset !== undefined ? [txt('offset', options.soundOffset)] : []))] : []));
const backup = duration => el('backup', {}, txt('duration', duration));
const forward = duration => el('forward', {}, txt('duration', duration));
const values = source => Object.fromEntries(extractMusicXMLDynamics(source).velocities);
const serialize = node => `<${node.localName}${Object.entries(node.attrs).map(([key, value]) => ` ${key}="${value}"`).join('')}>${node.children.length ? node.children.map(serialize).join('') : node.textContent}</${node.localName}>`;

test('symbolic dynamics persist across measures but remain independent across parts', () => {
  const source = doc(part(measure(note('default'), direction('p'), note('soft'), direction('mf'), note('medium')),
    measure(note('inherited'), direction('f'), note('loud'))), part(measure(note('other-part'))));
  assert.deepEqual(values(source), {default:80, soft:48, medium:80, inherited:80, loud:96, 'other-part':80});
});

test('numeric MusicXML dynamics use forte 90, override signs, preserve zero and clamp MIDI range', () => {
  const source = doc(part(measure(direction('f', {sound:{dynamics:'40'}}), note('numeric'),
    note('own', {attrs:{dynamics:'120'}}), note('silent', {attrs:{dynamics:'0'}}), note('after-own'),
    direction('p', {sound:{dynamics:'1000'}}), note('clamped'),
    el('sound', {dynamics:'0'}), note('zero-sound'))));
  assert.deepEqual(values(source), {numeric:36, own:108, silent:0, 'after-own':36, clamped:127, 'zero-sound':0});
});

test('onset order applies dynamics to backup voices and chord members without affecting earlier notes', () => {
  const source = doc(part(measure(attributes(2), direction('p'), note('upper-before', {duration:2}),
    direction('f'), note('upper-after', {duration:2}), note('chord', {chord:true, duration:2}), backup(4),
    note('lower-before', {duration:2, voice:2}), note('lower-after', {duration:2, voice:2}))));
  assert.deepEqual(values(source), {'upper-before':48, 'upper-after':96, chord:96, 'lower-before':48, 'lower-after':96});
});

test('staff and voice scopes isolate simultaneous dynamics and a later part mark replaces them', () => {
  const source = doc(part(measure(direction('p', {staff:1}), direction('ff', {staff:2}),
    direction('mp', {staff:1, voice:2}), note('upper'), backup(1), note('upper-second', {voice:2}),
    backup(1), note('lower', {staff:2}), direction('mf'), note('lower-reset', {staff:2}),
    backup(1), note('upper-reset'))));
  assert.deepEqual(values(source), {upper:48, 'upper-second':64, lower:112, 'lower-reset':80, 'upper-reset':80});
});

test('sounding offsets use divisions and sound offset overrides the visual direction offset', () => {
  const source = doc(part(measure(attributes(2), direction('p'),
    direction('f', {offset:[2, {sound:'yes'}]}), note('before', {duration:2}), note('after', {duration:2})),
  measure(direction('pp', {offset:[2]}), note('visual-offset-ignored', {duration:2}),
    direction('f', {offset:[-2, {sound:'yes'}], sound:{dynamics:'100'}, soundOffset:0}),
    note('sound-offset', {duration:2})),
  measure(attributes(4), direction('p'), direction('ff', {offset:[4, {sound:'yes'}]}),
    forward(4), note('forward-position', {duration:4}))));
  assert.deepEqual(values(source), {before:48, after:96, 'visual-offset-ignored':36, 'sound-offset':90, 'forward-position':112});
});

test('grace notes do not advance onset, rests are excluded and note overrides do not persist', () => {
  const source = doc(part(measure(direction('p'), note('grace', {grace:true}), note('main'),
    note('rest', {rest:true}), direction('ff'), note('own', {attrs:{dynamics:'50'}}), note('following'))));
  assert.deepEqual(values(source), {grace:48, main:48, own:45, following:112});
});

test('unsupported wedges, repeat conditions, invalid numbers and out-of-measure offsets warn', () => {
  const source = doc(part(measure(direction('p'), direction(null, {wedge:'crescendo'}), direction('sfz'),
    direction('f', {sound:{dynamics:'100', 'time-only':'2'}}),
    direction('ff', {offset:[-1, {sound:'yes'}]}), direction('pp', {offset:[2, {sound:'yes'}]}),
    direction('mf', {offset:['not-a-number', {sound:'yes'}]}),
    direction(null, {sound:{dynamics:'NaN'}}), note('safe', {attrs:{dynamics:'-1'}}))));
  const result = extractMusicXMLDynamics(source);
  assert.equal(result.velocities.get('safe'), 48);
  for (const text of ['渐强', '突强', 'time-only', '数字力度', '偏移']) assert.ok(result.warnings.some(warning => warning.includes(text)), text);
  assert.equal(new Set(result.warnings).size, result.warnings.length);
});

test('real Verovio IDs receive source velocities and tied playback keeps the initial attack velocity', async () => {
  const source = doc(el('part-list', {}, el('score-part', {id:'P1'}, txt('part-name', 'Piano'))),
    part(measure(attributes(1), direction('p'), note('soft'), direction('f'), note('loud'))));
  const tk = new VerovioToolkit(await createModule());
  try {
    tk.setOptions({inputFrom:'xml'});
    assert.ok(tk.loadData(serialize(source.documentElement)));
    const extracted = extractMusicXMLDynamics(source);
    const events = noteEvents(tk.renderToTimemap(), id => tk.getMIDIValuesForElement(id))
      .map(event => ({...event, velocity:extracted.velocities.get(event.id)}));
    assert.deepEqual(events.map(event => [event.id, event.velocity]), [['soft',48], ['loud',96]]);
    const tied = mergeTiedEvents(events, [{from:'soft', to:'loud'}]);
    assert.equal(tied.audioEvents.length, 1);
    assert.equal(tied.audioEvents[0].velocity, 48);
  } finally { tk.destroy(); }
});
