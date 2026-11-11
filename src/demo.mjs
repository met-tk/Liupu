// Original fixture: a sixteen-bar piano study, authored for this prototype.
const melodies = [
  ['E5','G5','B5','G5','E5','B4','G4','B4'],
  ['D5','F5','A5','F5','D5','A4','F4','A4'],
  ['C5','E5','G5','E5','C5','G4','E4','G4'],
  ['B4','D5','G5','D5','B4','G4','D4','G4'],
  ['A4','C5','E5','A5','G5','E5','C5','E5'],
  ['G4','B4','D5','G5','F5','D5','B4','D5'],
  ['F4','A4','C5','F5','E5','C5','A4','C5'],
  ['G4','B4','D5','F5','E5','D5','B4','G4']
];
const bass = [['C3','G3'],['D3','A3'],['A2','E3'],['G2','D3'],['F2','C3'],['E2','B2'],['D2','A2'],['G2','D3']];
const pitch = p => `<pitch><step>${p[0]}</step><octave>${p.slice(1)}</octave></pitch>`;
export const demoXML = `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0">
<work><work-title>月光习作</work-title></work>
<identification><creator type="composer">流谱 · 原创演示</creator></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name><part-abbreviation>Pno.</part-abbreviation><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list>
<part id="P1">${Array.from({length:16},(_,i)=>{
  const notes = melodies[i%8];
  return `<measure number="${i+1}">
  ${i===0?'<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><words>Andante</words></direction-type><sound tempo="72"/></direction>':''}
  ${notes.map((p,n)=>`${((i===4||i===8||i===12)&&n===0)||(i===6&&n===4)?`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${i===4?108:i===6?84:i===8?132:60}</per-minute></metronome></direction-type><sound tempo="${i===4?108:i===6?84:i===8?132:60}"/></direction>`:''}<note id="m${i}r${n}">${pitch(p)}<duration>1</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff><beam number="1">${n%4===0?'begin':n%4===3?'end':'continue'}</beam></note>`).join('')}
  <backup><duration>8</duration></backup>
  ${[0,1].map((_,n)=>bass[i%8].map((p,j)=>`<note id="m${i}l${n}${j}">${j?'<chord/>':''}${pitch(p)}<duration>4</duration><voice>2</voice><type>half</type><stem>down</stem><staff>2</staff></note>`).join('')).join('')}
  ${i===15?'<barline location="right"><bar-style>light-heavy</bar-style></barline>':''}
  </measure>`;
}).join('')}</part></score-partwise>`;
