import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import createModule from '../node_modules/verovio/dist/verovio-module.mjs';
import {VerovioToolkit} from '../node_modules/verovio/dist/verovio.mjs';

test('Bravura engraves the notation fixture, including header changes and common expressive marks',async()=>{
  const tk=new VerovioToolkit(await createModule());
  try{
    tk.setOptions({inputFrom:'xml',font:'Bravura',breaks:'none',adjustPageWidth:true,adjustPageHeight:true});
    assert.ok(tk.loadData(await readFile(new URL('./fixtures/notation-marks.musicxml',import.meta.url),'utf8')));
    const svg=tk.renderToSVG(1);
    for(const kind of ['clef','keySig','meterSig','beam','slur','tie','dynam','hairpin','pedal','syl','artic','fermata','trill','turn','mordent','tuplet','arpeg','fing','octave','reh','tempo'])assert.ok(new RegExp(`class="[^"]*\\b${kind}\\b`).test(svg),`missing ${kind}`);
    assert.ok(svg.includes('dolce'),'text direction survives conversion');
    assert.ok((svg.match(/class="clef"/g)||[]).length>=4,'clef changes remain present');
    assert.match(svg,/id="grace1"/,'grace note survives import');
    assert.equal(tk.renderToTimemap({includeMeasures:true}).filter(e=>e.measureOn).length,3);
  }finally{tk.destroy()}
});
