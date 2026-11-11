import { defaultMotionProgram } from './motion-program.mjs';
import { defaultScoreProgram } from './effect-library.mjs';

export const visualDefaults={
  fly:75,scatter:65,glow:60,bloom:45,particles:35,trail:55,anchor:34,zoom:100,
  glowMode:'pulse',glowShape:'halo',glowRange:1.4,glowOffset:0,glowPeak:100,glowValley:0,glowRadius:100,glowFeather:50,
  glowNote:true,glowBeam:true,glowClef:true,glowKeyMeter:true,glowRest:true,glowMark:true,glowTie:true,glowLyric:true,
  showLine:true,showTitle:true,color:'#fff2d6',noteColor:'#f3f3f3',noteOpacity:100,
  staffColor:'#c4c7cb',staffOpacity:75,beamColor:'#f3f3f3',beamOpacity:100,
  markColor:'#f3f3f3',markOpacity:100,backgroundColor:'#090c0e',backgroundDim:45,
  theme:'dark',motion:'sticky',aspect:'16:9',title:'Nocturne Op.9 No.2',titleColor:'#f3f3f3',
  scanLength:100,scanGlow:60,scanBloom:100,pageBars:4,pageRows:2,pageDecay:'burn',
  decayOffset:.45,decayDelay:0,decayDuration:2.4,noteArrival:'visible',noteExitTrigger:'note',
  // Ledger strokes travel with their note by default, matching the moving
  // staff treatment; the switch remains available for a fixed-staff variant.
  decayTrigger:'measure',ledgerMotion:true,scoreProgramActive:false,
  // Keep opening noteheads readable while they pass the fixed header edge.
  // The header editor exposes this separately from the bridge geometry.
  headerNoteFade:true,headerNoteFadeOffset:0,headerMarkFade:true,headerMarkFadeOffset:0,headerOpeningGap:64,
  // In a flowing header the opening clef/key/meter belongs to the moving
  // score by default.  Turning this off keeps the extracted header copy.
  headerFlowSymbols:true,
  scoreMotionProgram:{...defaultScoreProgram,exit:{...defaultScoreProgram.exit,delay:0}},
  markProgramActive:false,markMotionProgram:structuredClone({...defaultScoreProgram,exit:{...defaultScoreProgram.exit,delay:0}}),
  markPageDecay:'none',markDecayTrigger:'measure',markDecayOffset:.45,markDecayDelay:0,markDecayDuration:2.4,
  motionProgramActive:false,motionProgram:defaultMotionProgram,reducedMotion:false
};
