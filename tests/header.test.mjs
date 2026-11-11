import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStickyHeaders,stickyGeometry,stickyFrame,stickyCameraTrack,drawFlowHeaderSymbols,drawStickyHeader,selectStaffLinePaths,staffStrokeWidth} from '../src/header.mjs';

const header={width:170,minX:60};
test('header follows the opening score, docks continuously and starts at the header edge',()=>{
  const fixed=stickyGeometry(header,1280,1);
  const frame=position=>stickyFrame(header,1280,1,435,position,220);
  const a=frame(220),b=frame(240);
  assert.ok(a.x>fixed.x);assert.equal(b.x-a.x,b.left-a.left);
  assert.equal(a.cutoff,a.anchor);assert.equal(b.cutoff,b.left+220);
  const dock=220+a.x-fixed.x;
  assert.ok(Math.abs(frame(dock-.001).x-frame(dock+.001).x-.001)<1e-8);
  assert.equal(frame(dock+10).x,fixed.x);assert.equal(frame(dock+100).x,fixed.x);
});
test('repeats stay docked while a seek back to the opening restores travel',()=>{
  const track=stickyCameraTrack([{time:0,x:220},{time:1,x:240},{time:2,x:220,arrivalX:600}]);
  const fixed=stickyGeometry(header,1280,1);
  assert.equal(stickyFrame(header,1280,1,435,220,220,track[2].x).x,fixed.x);
  assert.ok(stickyFrame(header,1280,1,435,220,220,track[0].x).x>fixed.x);
});
test('narrow frames dock immediately when there is no room for an entrance',()=>{
  for(const [w,scale] of [[720,2],[1080,3]]){
    const f=stickyFrame(header,w,scale,w*.2,220,220);
    assert.equal(f.cutoff,f.anchor);assert.equal(f.x,stickyGeometry(header,w,scale).x);
  }
});
test('connected header removes the opening reserve so the score meets its cutoff',()=>{
  const frame=stickyFrame(header,1280,1,435,220,220,220,true);
  assert.equal(frame.cutoff,frame.anchor);
});
test('opening reserve leaves a short spatial entrance gap after the fixed header',()=>{
  const frame=stickyFrame(header,1280,1,435,220,220,220,true,28);
  assert.equal(frame.openingGap,28);
  assert.equal(frame.cutoff,frame.anchor-28);
});
test('opening header snapshots sharing a timestamp do not crossfade into a ghost copy',()=>{
  const calls=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},drawImage(...args){calls.push(args)}};
  const h={width:100,minX:0,clefX:0,lines:[[{y:10,width:1}]],extras:[],columns:{clef:0,keySig:20,meterSig:40},
    states:[{time:0,key:'part-a',staves:[{clef:{x:0,y:0,w:8,h:8}}]},{time:0,key:'part-b',staves:[{clef:{x:0,y:0,w:8,h:8}}]}]};
  drawStickyHeader(ctx,h,0,{staffColor:'#fff',markOpacity:100,staffOpacity:100},{w:640,top:0,scale:1,geometry:stickyGeometry(h,640,1)},{});
  assert.equal(calls.length,1,'only the selected opening snapshot should be painted');
});
test('header changes hand off by screen position, not by time',()=>{
  const calls=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},drawImage(...args){calls.push(args)}};
  const block=(id,x)=>({id,x,y:0,w:8,h:8});
  const opening={staves:[{clef:block('g',0),keySig:block('c',20),meterSig:block('44',40)}]};
  const changed={staves:[{clef:block('g',0),keySig:block('d',500),meterSig:block('34',520)}]};
  const h={width:100,minX:0,clefX:0,lines:[[{y:10,width:1}]],extras:[],columns:{clef:0,keySig:20,meterSig:40},
    states:[{time:0,key:'opening',...opening}],base:opening.staves,transitions:{clef:[],
      keySig:[{x:500,staves:changed.staves,movers:[{kind:'keySig',staff:0,box:block('d',500)}]}],
      meterSig:[{x:520,staves:changed.staves,movers:[{kind:'meterSig',staff:0,box:block('34',520)}]}]}};
  const geometry={x:10,xScale:1,cutoff:110};
  const draw=left=>{calls.length=0;drawStickyHeader(ctx,h,99,{staffColor:'#fff',markOpacity:100,staffOpacity:100},{w:640,top:0,scale:1,geometry,left},{});return calls.map(c=>c[5])};
  // Far away: opening header plus the moving symbols in the score body.
  assert.deepEqual(draw(0),[10,30,50,500,520]);
  // Arriving: the new key slides over the header but has not locked yet.
  assert.deepEqual(draw(-440),[10,30,50,60,80]);
  // Overlapping boxes do not hide glyphs; only the hand-off distance fades them.
  assert.deepEqual(draw(-468),[10,30,50,32,52]);
  // Locked: the new key/meter replace the old ones at their columns.
  assert.deepEqual(draw(-600),[10,30,50]);
});

test('header glyphs keep transparent whitespace while unchanged signatures retain their opacity',()=>{
  for(const stableKind of ['keySig','meterSig'])for(const kind of ['clef','keySig'].filter(kind=>kind!==stableKind))for(const futureChange of [false,true]){
    const calls=[],clips=[],stack=[];
    let path=[];
    const ctx={globalAlpha:1,save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()},
      beginPath(){path=[]},rect(...args){path.push(args)},clip(rule){clips.push({rule,path:[...path]})},
      moveTo(){},lineTo(){},stroke(){},drawImage(...args){calls.push({sx:args[1],x:args[5],alpha:this.globalAlpha})}};
    const block=(id,x)=>({id,x,y:0,w:8,h:8});
    const opening=[{clef:block('g',0),keySig:block('c',20),meterSig:block('44',40)}];
    const changed=[{...opening[0],[kind]:block('new',500)}];
    const h={width:100,minX:0,lines:[],extras:[],columns:{clef:0,keySig:20,meterSig:40},
      base:opening,transitions:{clef:[],keySig:[],meterSig:[]}};
    h.transitions[kind]=[{x:500,staves:changed,movers:[{kind,staff:0,box:changed[0][kind]}]}];
    if(futureChange){
      const later=[{...changed[0],[stableKind]:block('later',1000)}];
      h.transitions[stableKind]=[{x:1000,staves:later,movers:[{kind:stableKind,staff:0,box:later[0][stableKind]}]}];
    }
    const sourceX=opening[0][stableKind].x,stableX=10+sourceX;
    for(const delta of [-4,0,4]){
      const left=stableX-500+delta;
      calls.length=0;clips.length=0;
      drawStickyHeader(ctx,h,0,{markOpacity:100},{w:640,top:0,scale:1,geometry:{x:10,xScale:1,cutoff:110},left},{});
      assert.deepEqual(calls.filter(call=>call.sx===sourceX),[{sx:sourceX,x:stableX,alpha:1}],`${stableKind}, ${kind}, left=${left}`);
      assert.equal(clips.length,0,'transparent whitespace must not create rectangular cutouts');
      assert.deepEqual(calls.filter(call=>call.sx===500),[{sx:500,x:stableX+delta,alpha:1}],
        'the incoming glyph must remain intact while passing through another glyph box');
    }
  }
});

test('repeated identical meters do not create a header transition on either staff',async()=>{
  const meter=(id,x,topGlyph)=>{
    const bounds={left:x,top:0,width:topGlyph?8:0,height:topGlyph?16:0};
    const glyphs=(topGlyph?[topGlyph,'E084']:[]).map((name,index)=>({
      getAttribute(attr){return attr==='xlink:href'?`#${name}-font`:null},
      getBoundingClientRect(){return {left:x,top:index*8,width:8,height:8}}
    }));
    return {id,parentElement:null,matches(){return true},getBoundingClientRect(){return bounds},
      querySelector(){return glyphs[0]},querySelectorAll(selector){return selector==='use'?glyphs:[]}};
  };
  const measure=(id,x,signatures)=>{
    const staves=signatures.map(([meterId,glyph])=>{
      const symbol=meter(meterId,x,glyph);
      const staff={querySelectorAll(selector){
        if(selector==='g.meterSig')return [symbol];
        return [];
      }};
      symbol.parentElement=staff;
      return staff;
    });
    return {id,getBoundingClientRect(){return {left:x,top:0,width:100,height:100}},
      querySelectorAll(selector){return selector==='g.staff'?staves:[]}};
  };
  const measures=[
    measure('m1',0,[['a1','E084'],['b1','E084']]),
    measure('m2',200,[['a2','E084'],['b2','E083']]),
    measure('empty',250,[['invisible-a',null],['invisible-b',null]]),
    measure('m3',400,[['a3','E083'],['b3','E083']])
  ];
  const svg={querySelectorAll(selector){return selector==='g.measure'?measures:[]},
    cloneNode(){return {querySelectorAll(){return []}}}};
  const h=await prepareStickyHeaders(svg,measures.map((m,i)=>({measureOn:m.id,qstamp:i})),
    {quarterToSeconds:q=>q},async()=>({}),{left:0,top:0},{querySelectorAll(){return []}});
  assert.deepEqual([...h.repeatedMeterIds].sort(),['a2','b3']);
  assert.deepEqual(h.states.map(state=>state.staves.map(staff=>staff.meterSig.id)),
    [['a1','b1'],['a1','b2'],['a1','b2'],['a3','b2']]);
  assert.deepEqual(h.transitions.meterSig.map(t=>t.movers.map(m=>m.box.id)),[['b2'],['a3']]);
});

test('each staff docks its own change symbol when staves engrave it at different x',()=>{
  for(const kind of ['clef','keySig','meterSig']){
  const calls=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},drawImage(...args){calls.push([args[5],args[6]])}};
  const block=(id,x,y)=>({id,x,y,w:8,h:8});
  const opening=[{[kind]:block('c0',20,0)},{[kind]:block('c1',20,50)}];
  const changed=[{[kind]:block('d0',500,0)},{[kind]:block('d1',540,50)}];
  const h={width:100,minX:0,clefX:0,lines:[],extras:[],columns:{[kind]:20},
    states:[{time:0,key:'opening',staves:opening}],base:opening,transitions:{
      [kind]:[{x:500,at:{0:{x:500,moving:true},1:{x:540,moving:true}},staves:changed,
        movers:[{kind,staff:0,box:changed[0][kind]},{kind,staff:1,box:changed[1][kind]}]}]}};
  const draw=left=>{calls.length=0;drawStickyHeader(ctx,h,0,{markOpacity:100},{w:640,top:0,scale:1,geometry:{x:10,xScale:1,cutoff:110},left},{});return calls};
  // Both still sliding toward the key column (x=30).
  assert.deepEqual(draw(-440),[[30,0],[30,50],[60,0],[100,50]]);
  // Staff 1 has docked; staff 2 keeps sliding from its own position instead of jumping to the column.
  assert.deepEqual(draw(-470),[[30,0],[30,50],[70,50]]);
  // Both docked.
  assert.deepEqual(draw(-520),[[30,0],[30,50]]);
  // The same changes can come from independent in-layer events.
  h.transitions[kind]=changed.map((staff,i)=>({
    x:staff[kind].x,at:{[i]:{x:staff[kind].x,moving:true}},
    staves:i?changed:[changed[0],opening[1]],movers:[{kind,staff:i,box:staff[kind]}]
  }));
  assert.deepEqual(draw(-470),[[30,0],[30,50],[70,50]]);
  assert.deepEqual(draw(-520),[[30,0],[30,50]]);
  }
});

test('clefs and changing meters use the same sliding hand-off as keys',()=>{
  const block=(id,x)=>({id,x,y:0,w:8,h:8});
  const trajectories=['keySig','clef','meterSig'].map(kind=>{
    const calls=[],stack=[];
    const ctx={globalAlpha:1,save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()},
      drawImage(...args){calls.push([args[1],args[5],args[7],this.globalAlpha])}};
    const next=block('next',300);
    const h={minX:0,lines:[],extras:[],columns:{[kind]:20},base:[{[kind]:block('old',0)}],
      transitions:{[kind]:[{x:300,at:{0:{x:300,moving:true}},staves:[{[kind]:next}],movers:[{kind,staff:0,box:next}]}]}};
    return [0,-200,-230,-269.999,-270,-350,-230,0].map(left=>{
      calls.length=0;
      drawStickyHeader(ctx,h,0,{markOpacity:100},{w:640,top:0,scale:1,geometry:{x:10,xScale:1,cutoff:110},left},{});
      return [...calls];
    });
  });
  assert.deepEqual(trajectories[1],trajectories[0]);
  assert.deepEqual(trajectories[2],trajectories[0]);
  assert.deepEqual(trajectories[0][1].at(-1),[300,100,8,1]);
  assert.deepEqual(trajectories[0][4],[[300,30,8,1]]);
});

test('closely spaced changes do not jump in opacity when the first glyph docks',()=>{
  for(const kind of ['clef','keySig','meterSig']){
    const calls=[],stack=[];
    const ctx={globalAlpha:1,save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()},
      drawImage(_image,sx){calls.push([sx,this.globalAlpha])}};
    const block=(id,x)=>({id,x,y:0,w:8,h:8});
    const h={minX:0,lines:[],extras:[],columns:{[kind]:20},base:[{[kind]:block('old',0)}],
      transitions:{[kind]:[300,340].map(x=>({
        x,at:{0:{x,moving:true}},staves:[{[kind]:block(`new-${x}`,x)}],movers:[{kind,staff:0,box:block(`new-${x}`,x)}]
      }))}};
    const alpha=left=>{
      calls.length=0;
      drawStickyHeader(ctx,h,0,{markOpacity:100},{w:640,top:0,scale:1,geometry:{x:10,xScale:1,cutoff:110},left},{});
      return calls.find(([sx])=>sx===300)?.[1];
    };
    assert.ok(Math.abs(alpha(-269.999)-alpha(-270))<.0001,kind);
    assert.equal(alpha(-270),.5,kind);
    assert.ok(Math.abs(alpha(-270.001)-alpha(-270))<.0001,kind);
  }
});

test('all in-layer clefs and meters hand off at their printed positions, including the final bar',async()=>{
  const measure=(id,definitions)=>{
    const staff={querySelectorAll(selector){
      if(selector==='g.note')return [{getBoundingClientRect(){return {left:60}}}];
      return symbols.filter(node=>selector===`g.${node.kind}`||selector===`g.layer g.${node.kind}`&&node.inner);
    }};
    const layer={parentElement:staff,matches(selector){return selector.includes('g.layer')}};
    const symbols=definitions.map(([kind,id,x,glyph,inner=false])=>{
      const bounds={left:x,top:0,width:inner?4:8,height:16};
      const use={getAttribute(attr){return attr==='href'?`#${glyph}-font`:null},getBoundingClientRect(){return bounds}};
      return {id,kind,inner,parentElement:inner?layer:staff,matches(selector){return selector.includes(`g.${kind}`)},
        closest(selector){return selector==='g.measure'?result:selector==='g.staff'?staff:null},
        getBoundingClientRect(){return bounds},querySelector(){return use},querySelectorAll(selector){return selector==='use'?[use]:[]}};
    });
    const result={id,getBoundingClientRect(){return {left:0,top:0,width:400,height:100}},
      querySelectorAll(selector){return selector==='g.staff'?[staff]:[]}};
    return result;
  };
  const measures=[
    measure('m1',[['clef','opening-clef',10,'E050'],['meterSig','opening-meter',30,'E084']]),
    measure('m2',[['clef','bass',200,'E07C',true],['meterSig','three',220,'E083',true],
      ['clef','treble',260,'E07A',true],['meterSig','repeat-three',280,'E083',true],['meterSig','two',320,'E082',true]])
  ];
  const svg={querySelectorAll(selector){return selector==='g.measure'?measures:[]},
    cloneNode(){return {querySelectorAll(){return []}}}};
  const h=await prepareStickyHeaders(svg,measures.map((m,i)=>({measureOn:m.id,qstamp:i})),
    {quarterToSeconds:q=>q},async()=>({}),{left:0,top:0},{querySelectorAll(){return []}});
  assert.deepEqual(h.transitions.clef.map(t=>[t.x,t.movers[0].box.id,t.at[0].moving]),[[200,'bass',true],[260,'treble',true]]);
  assert.deepEqual(h.transitions.meterSig.map(t=>[t.x,t.movers[0].box.id]),[[220,'three'],[320,'two']]);
  assert.equal(h.transitions.clef[1].staves[0].clef.w,4,'keep the engraved size when the same glyph docks');
  assert.deepEqual([...h.movingIds].sort(),['bass','three','treble','two']);
  assert.deepEqual([...h.repeatedMeterIds],['repeat-three']);
  assert.equal(h.states[1].staves[0].clef.id,'opening-clef','non-docked measure snapshots keep their existing timing');
});

test('flow header bridge paints only notation symbols without staff lines',()=>{
  const calls=[];
  const ctx={canvas:{width:640,height:200},save(){},restore(){},drawImage(...args){calls.push(args)}};
  const block=(id)=>({id,x:0,y:0,w:8,h:8});
  const h={width:100,minX:0,columns:{clef:0,keySig:20,meterSig:40},states:[
    {time:0,key:'opening',staves:[{clef:block('g'),keySig:block('c'),meterSig:block('44')}]},
  ]};
  drawFlowHeaderSymbols(ctx,h,0,{markOpacity:100},{top:0,scale:1,geometry:stickyGeometry(h,640,1)},{rasterScale:1},1);
  assert.equal(calls.length,3);
});

test('header bridge keeps ledger paths out of the five-line staff bridge',()=>{
  const make=(y,w=100)=>({path:{id:`p${y}`},rect:{top:y,height:1,width:w}});
  const selected=selectStaffLinePaths([make(-12),make(0),make(10),make(20),make(30),make(40),make(52)]);
  assert.deepEqual(selected.map(item=>item.rect.top),[0,10,20,30,40]);
});

test('header bridge accepts zero-height horizontal SVG staff paths',()=>{
  const make=(y,w=100)=>({path:{id:`p${y}`},rect:{top:y,height:0,width:w}});
  const selected=selectStaffLinePaths([make(0),make(10),make(20),make(30),make(40)]);
  assert.equal(selected.length,5);
  assert.deepEqual(selected.map(item=>item.rect.top),[0,10,20,30,40]);
});

test('header bridge reads the SVG stroke width when geometry height is zero',()=>{
  const path={getAttribute(name){return name==='stroke-width'?'13':null}};
  assert.equal(staffStrokeWidth(path,{height:0}),13);
});

test('sticky staff bridge fades across the body seam when a bridge feather is requested',()=>{
  const gradients=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},createLinearGradient(...args){const gradient={args,stops:[],addColorStop(pos,color){this.stops.push([pos,color])}};gradients.push(gradient);return gradient}};
  const h={width:100,minX:0,clefX:0,bridgeStartX:4,lines:[[{y:10,width:1}]],extras:[],columns:{},states:[{time:0,key:'a',staves:[]}]};
  drawStickyHeader(ctx,h,0,{staffColor:'#fff',noteColor:'#fff',markOpacity:100,staffOpacity:100},{w:640,top:0,scale:1,bridgeFadeWidth:20,geometry:{x:10,xScale:1,cutoff:100}},{ });
  assert.equal(gradients.length,1);
  assert.equal(gradients[0].args[0],14);
  assert.equal(gradients[0].args[2],120);
  assert.equal(gradients[0].stops.at(-1)[1],'transparent');
});

test('sticky staff bridge starts at the engraved staff edge, not the clef box',()=>{
  const calls=[];
  const ctx={save(){},restore(){},beginPath(){},moveTo(...args){calls.push(['moveTo',...args])},lineTo(){},stroke(){},drawImage(){}};
  const h={width:100,minX:0,clefX:20,bridgeStartX:4,lines:[[{y:10,width:1}]],extras:[],columns:{},states:[{time:0,key:'a',staves:[]}]};
  drawStickyHeader(ctx,h,0,{staffColor:'#fff',noteColor:'#fff',markOpacity:100,staffOpacity:100},{w:640,top:0,scale:1,geometry:{x:10,xScale:1,cutoff:100}},{ });
  assert.equal(calls.find(call=>call[0]==='moveTo')[1],14);
});
