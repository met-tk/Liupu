export const notationChecks=[
  ['clef','g.clef','谱号'],['key','g.keySig','调号'],['time','g.meterSig','拍号'],
  ['rest','g.rest,g.mRest','休止符'],['beam','g.beam','符杠'],['grace','g.graceGrp,g.note.grace','装饰音'],
  ['slur','g.slur','连奏线'],['tied','g.tie','延音线'],['dynamics','g.dynam','力度'],['wedge','g.hairpin','渐强弱'],
  ['pedal','g.pedal','踏板'],['lyric','g.syl','歌词'],['articulations','g.artic','奏法'],
  ['fermata','g.fermata','延长号'],['trill-mark','g.trill','颤音'],['turn','g.turn','回音'],['mordent','g.mordent','波音'],
  ['tuplet','g.tuplet','连音组'],['arpeggiate','g.arpeg','琶音'],['fingering','g.fing','指法'],
  ['octave-shift','g.octave','八度线'],['ending','g.ending','反复房子'],['rehearsal','g.reh','排练标记'],['words','g.dir,g.tempo','文字指示']
];
// Staff-level symbols that own a separate performance-glow region.
export const HEADER_GLOW_KINDS=['clef','keySig','meterSig','custos'];
// Anything inside a note/chord (accidentals, stems, flags, dots) is drawn and
// lit with its note, so it is skipped here. Verovio nests a mid-beam clef/key/
// meter change inside g.beam; it is a standalone glyph and must still glow.
export function glowRegionEligible(node,cls){
  if(node.closest('g.note,g.chord,defs'))return false;
  return !node.closest('g.beam')||HEADER_GLOW_KINDS.includes(cls);
}
export function inspectNotation(doc,svg){
  const found=[],missing=[];
  for(const [source,selector,label] of notationChecks){
    if(!doc.querySelector(source))continue;
    (svg.querySelector(selector)?found:missing).push(label);
  }
  const unsupported=['other-notation','other-direction','other-articulation','other-ornament','other-technical','image'].filter(tag=>doc.querySelector(tag));
  let result=`已检测 ${found.length} 类常用标记的图形输出：${found.join('、')||'基础音符'}。`;
  if(missing.length)result+=` 需目视复核：${missing.join('、')}。`;
  if(unsupported.length)result+=' 含扩展或图片标记，可能需要 SVG 补充。';
  return result+' 此检查只确认类别存在，不保证每个实例、位置或特殊记谱法完整；发声预听不模拟全部奏法。';
}
