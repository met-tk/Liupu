import test from 'node:test';
import assert from 'node:assert/strict';
import createModule from '../node_modules/verovio/dist/verovio-module.mjs';
import {VerovioToolkit} from '../node_modules/verovio/dist/verovio.mjs';
import {glowRegionEligible} from '../src/notation.mjs';

const note=(step,octave,beam,alter='')=>`<note>${'<pitch><step>'+step+'</step>'+(alter?`<alter>${alter}</alter>`:'')+'<octave>'+octave+'</octave></pitch>'}<duration>1</duration><voice>1</voice><type>eighth</type>${alter?'<accidental>sharp</accidental>':''}<beam number="1">${beam}</beam></note>`;
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
${note('C',3,'begin')}<attributes><clef><sign>G</sign><line>2</line></clef></attributes>${note('F',4,'end','1')}
${note('E',4,'begin')}${note('D',4,'end')}</measure></part></score-partwise>`;

// Minimal SVG tag-stack walk: records the ancestor chain of every <g>.
function groups(svg){
  const out=[],stack=[];
  for(const [,close,tag,attrs,self] of svg.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>/g)){
    if(close){stack.pop();continue}
    const entry={tag,classes:(attrs.match(/class="([^"]*)"/)?.[1]||'').split(/\s+/)};
    const chain=[...stack,entry];
    if(tag==='g')out.push({classes:entry.classes,closest:sel=>sel.split(',').some(s=>chain.some(a=>s==='defs'?a.tag==='defs':a.tag==='g'&&a.classes.includes(s.slice(2))))});
    if(!self)stack.push(entry);
  }
  return out;
}

test('a clef change between beamed notes glows; accidentals stay with their note',async()=>{
  const tk=new VerovioToolkit(await createModule());
  try{
    tk.setOptions({inputFrom:'xml',font:'Bravura',breaks:'none',adjustPageWidth:true,adjustPageHeight:true});
    assert.ok(tk.loadData(xml));
    const all=groups(tk.renderToSVG(1));
    const beamedClef=all.find(g=>g.classes.includes('clef')&&g.closest('g.beam'));
    assert.ok(beamedClef,'Verovio nests the mid-beam clef change inside g.beam');
    assert.equal(glowRegionEligible(beamedClef,'clef'),true);
    const accid=all.find(g=>g.classes.includes('accid'));
    assert.ok(accid?.closest('g.note'),'accidental is engraved inside its note');
    assert.equal(glowRegionEligible(accid,'accid'),false,'accidentals glow through the note raster, not a separate region');
  }finally{tk.destroy()}
});

test('glow eligibility keeps the existing exclusions',()=>{
  const stub=classes=>({closest:sel=>sel.split(',').some(s=>classes.includes(s.slice(2))||s===classes[0])});
  assert.equal(glowRegionEligible(stub(['beam']),'tuplet'),false);
  assert.equal(glowRegionEligible(stub(['beam']),'rest'),false);
  assert.equal(glowRegionEligible(stub(['beam']),'keySig'),true);
  assert.equal(glowRegionEligible(stub(['note']),'verse'),false);
  assert.equal(glowRegionEligible(stub(['defs']),'clef'),false);
  assert.equal(glowRegionEligible(stub(['staff']),'clef'),true);
  assert.equal(glowRegionEligible(stub(['measure']),'dynam'),true);
});
