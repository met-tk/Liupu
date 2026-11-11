import { clamp } from './timing.mjs';

const baseId=id=>String(id).replace(/-rend\d+$/,'');

// One occurrence per performed bar: a repeat gets a fresh position and lifetime.
export function staticMeasureTimeline(score){
  const regions=new Map(score.measureRegions.map(region=>[region.id,region])),byMeasure=new Map();
  const events=score.events||[...(score.occurrences?.values()||[])].flat();
  const timeline=score.measureTimes.flatMap((measure,index)=>{
    const region=regions.get(measure.id)||regions.get(baseId(measure.id));
    if(!region)return [];
    const end=score.measureTimes[index+1]?.time??score.duration;
    const entry={...region,id:region.id,occurrence:index,start:measure.time,end,decayEnd:end};
    if(!byMeasure.has(region.id))byMeasure.set(region.id,[]);
    byMeasure.get(region.id).push(entry);
    return [entry];
  });
  for(const event of events){
    const visits=byMeasure.get(score.boxes.get(event.id)?.measureId);
    if(!visits)continue;
    // Visits follow playback order; events may arrive grouped by note ID.
    let lo=0,hi=visits.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(visits[mid].start-1e-6<=event.start)lo=mid+1;else hi=mid}
    const measure=visits[lo-1];
    if(measure&&event.start<measure.end-1e-6)measure.decayEnd=Math.max(measure.decayEnd,event.visualEnd??event.soundEnd??event.end);
  }
  return timeline;
}

export function decayProgress(time,measureEnd,delay=.45,duration=2.4){
  return clamp((time-measureEnd-Math.max(0,delay))/Math.max(.05,duration),0,1);
}

export function buildStaticLayout(score,{width,height,barsPerRow=4,rowsPerPage=2,showTitle=true,zoom=100,custom=false,continuous=false,headerVisible=true,margin=5.5,gap=4.5}){
  const bars=clamp(Math.round(barsPerRow),custom?1:2,custom?12:4),rows=clamp(Math.round(rowsPerPage),1,custom?8:3),timeline=staticMeasureTimeline(score);
  const headerWidth=headerVisible?(score.header?.width||0)+12:0,contentTop=score.contentTop??0,contentHeight=score.contentHeight??score.height;
  // Opening definitions are redrawn by the row header. Every row needs its
  // first measure cropped, including rows that begin at a later source bar;
  // cropping only sourceIndex 0 leaves a second clef/key/meter underneath the
  // row header until that measure tile decays.
  const firstState=score.header?.states[0];
  const headerEnd=state=>Math.max(0,...(state?.staves||[]).flatMap(staff=>Object.values(staff).filter(Boolean).map(box=>box.x+box.w)));
  const openingEnd=headerEnd(firstState);
  const firstNotes=new Map();
  if(firstState)for(const box of score.boxes.values())firstNotes.set(box.measureId,Math.min(firstNotes.get(box.measureId)??Infinity,box.x-5));
  const entries=timeline.map(measure=>{
    return {...measure,sourceX:measure.x,sourceWidth:Math.max(1,measure.endX-measure.x)};
  });
  const rowGroups=[];
  for(let i=0;i<entries.length;i+=bars)rowGroups.push(entries.slice(i,i+bars));
  for(const group of rowGroups)for(const [groupIndex,measure] of group.entries()){
    // Repeated visits of the opening source bar also need their crop, even
    // when barsPerRow keeps two visits on the same visual row.
    if(groupIndex>0&&measure.sourceIndex!==0)continue;
    const state=score.header?.states?.findLast?.(entry=>entry.time<=measure.start+1e-6)||firstState;
    const stateEnd=headerEnd(state)||openingEnd;
    if(!state||stateEnd>=measure.endX-16)continue;
    const firstNote=Math.min(measure.endX,firstNotes.get(measure.id)??Infinity);
    const sourceX=Math.max(measure.x,Math.min(firstNote,stateEnd+9,(measure.contentStartX??measure.endX)-2));
    measure.sourceX=sourceX;measure.sourceWidth=Math.max(1,measure.endX-sourceX);
  }
  const widest=Math.max(1,...rowGroups.map(group=>group.reduce((sum,measure)=>sum+measure.sourceWidth,0)));
  const left=width*margin/100,availableWidth=width*(1-2*margin/100),top=height*(showTitle?.24:.105),bottom=height*.09,rowGap=height*gap/100;
  const fit=Math.min(availableWidth/(headerWidth+widest),(height-top-bottom-rowGap*(rows-1))/(rows*contentHeight));
  // Static pages always fit; the row/bar controls are the way to enlarge notation.
  const scale=Math.max(.01,fit*Math.min(custom?10:1,Math.max(custom?.1:.2,zoom/100)));
  const pages=[];
  const batch=continuous?Math.max(1,rowGroups.length):rows;
  for(let i=0;i<rowGroups.length;i+=batch){
    const groups=rowGroups.slice(i,i+batch),page={index:pages.length,start:groups[0][0].start,end:groups.at(-1).at(-1).end,rows:[]};
    groups.forEach((group,rowIndex)=>{
      const visibleY=top+rowIndex*(contentHeight*scale+rowGap);
      const row={index:rowIndex,x:left,top:visibleY-contentTop*scale,visibleY,height:contentHeight*scale,scale,headerWidth,measures:[],start:group[0].start,end:group.at(-1).end};
      let x=left+headerWidth*scale;
      for(const [index,measure] of group.entries()){row.measures.push({...measure,rowStart:index===0,x,y:row.top,width:measure.sourceWidth*scale,scale});x+=measure.sourceWidth*scale}
      row.width=x-left;page.rows.push(row);
    });
    pages.push(page);
  }
  return {pages,scale,width,height,contentTop,contentHeight,barsPerRow:bars,rowsPerPage:rows};
}

export function staticPageAt(layout,time){
  const pages=layout.pages;
  return pages[Math.max(0,pages.findLastIndex(page=>page.start<=time))]||null;
}

export function occurrenceInMeasure(occurrences,measure){
  return occurrences?.find(event=>event.start>=measure.start-1e-6&&event.start<measure.end-1e-6)||null;
}
