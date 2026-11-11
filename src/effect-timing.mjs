import { clamp, positionAt, timeAtX } from './timing.mjs';
import { decayProgress } from './static-layout.mjs';

export function scoreEffectTime(time, settings) {
  return time - (Number.isFinite(settings.decayOffset) ? settings.decayOffset : 0);
}

export function measureEffectProgress(score, measure, time, settings) {
  time = scoreEffectTime(time, settings);
  if (settings.decayTrigger !== 'progress') return decayProgress(time, measure.decayEnd, settings.decayDelay ?? .45, settings.decayDuration ?? 2.4);
  if (time <= measure.start) return 0;
  if (time >= measure.end) return 1;
  // Use the same tempo-aware, notational position as the playhead, including repeats.
  const x = score.quarterStops ? positionAt(score.quarterStops, score.secondsToQuarter(time)) : score.stops ? positionAt(score.stops, time) : null;
  return x === null ? clamp((time - measure.start) / (measure.end - measure.start), 0, 1) : clamp((x - measure.sourceX) / measure.sourceWidth, 0, 1);
}

export function noteExitTime(event, measure, settings) {
  const end = event.visualEnd ?? event.soundEnd ?? event.end;
  return settings.noteExitTrigger === 'measure' && measure ? Math.max(end, measure.decayEnd) : end;
}

export function markEffectSettings(settings){
  return {...settings,
    scoreProgramActive:settings.markProgramActive??settings.scoreProgramActive,
    scoreMotionProgram:settings.markMotionProgram??settings.scoreMotionProgram,
    pageDecay:settings.markPageDecay??settings.pageDecay,decayTrigger:settings.markDecayTrigger??settings.decayTrigger,
    decayOffset:settings.markDecayOffset??settings.decayOffset,decayDelay:settings.markDecayDelay??settings.decayDelay,
    decayDuration:settings.markDecayDuration??settings.decayDuration,parts:{...settings.parts,staff:false}};
}

export function markTimeline(region,timeline,stops){
  return timeline.filter(m=>m.id===region.measureId).map(first=>{
    let last=first,decayEnd=first.decayEnd;
    for(let i=timeline.indexOf(first)+1;i<timeline.length;i++){
      const next=timeline[i];
      if(next.sourceIndex<=last.sourceIndex||next.x>=region.x+region.w)break;
      last=next;decayEnd=Math.max(decayEnd,last.decayEnd);
    }
    const visit={...first,end:last.end,decayEnd,lastOccurrence:last.occurrence};
    if(stops?.length){
      const local=[{time:first.start,x:positionAt(stops,first.start)},...stops.filter(stop=>stop.time>first.start&&stop.time<=last.end),{time:last.end,x:last.endX}];
      visit.glowStart=timeAtX(local,region.x);
      visit.glowEnd=Math.max(timeAtX(local,region.x+region.w),visit.glowStart+.2);
    }
    return visit;
  });
}

// A source bar can occur more than once. The upcoming visit wins as soon as its
// entrance starts (or the playhead jumps back), so repeats never inherit decay.
export function performedMeasure(visits, time, lead = 0, currentVisit = null) {
  const active = visits.find(m => time >= m.start && time < m.end);
  if (active) return active;
  const next = visits.find(m => m.start > time), previous = visits.findLast(m => m.start <= time);
  if (next && (time >= next.start - lead || previous && currentVisit && previous.occurrence < currentVisit.occurrence && next.occurrence > currentVisit.occurrence && previous.sourceIndex >= currentVisit.sourceIndex)) return next;
  return previous || next;
}
