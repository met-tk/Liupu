import test from 'node:test';
import assert from 'node:assert/strict';
import {ScoreRenderer,maskScrollLayer,drawRepeatedMeters} from '../src/render.mjs';

function canvasMock(width=1000,height=1000){
  const canvas={width,height,commands:[],recordPartial:false},stack=[];
  const ctx={canvas,globalAlpha:1,globalCompositeOperation:'source-over',
    save(){stack.push({globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation})},
    restore(){Object.assign(this,stack.pop())},
    clearRect(x,y,w,h){if(x===0&&y===0&&w===width&&h===height)canvas.commands=[];else if(canvas.recordPartial)canvas.commands.push({kind:'clear',end:w})},
    rect(){},clip(){},
    createLinearGradient(x,y,endX,endY){return {x,endX,addColorStop(){}}},
    fillRect(){assert.equal(this.globalCompositeOperation,'destination-out','strip masks must preserve pixels outside the strip');canvas.commands.push({kind:'mask',start:this.fillStyle.x,end:this.fillStyle.endX})},
    beginPath(){},moveTo(x,y){this.start={x,y}},lineTo(x,y){this.end={x,y}},
    stroke(){canvas.commands.push({kind:'staff',start:this.start,end:this.end})},
    drawImage(image){canvas.commands.push({kind:'image',id:image.id,content:image.commands?.slice()})},
  };
  canvas.getContext=()=>ctx;
  return canvas;
}

function renderBridge(bridge,pageDecay,header,glowRegions=[],recordPartial=false,options={}){
  const canvas=canvasMock(),layer=canvasMock(),noteLayer=canvasMock(),renderer=Object.create(ScoreRenderer.prototype);
  const {cameraPosition,firstPosition,...settings}=options;
  const visit={id:'m1',x:200,endX:600,start:0,end:10,decayEnd:10,sourceIndex:0,occurrence:0};
  layer.recordPartial=recordPartial;noteLayer.recordPartial=recordPartial;
  Object.assign(renderer,{canvas,ctx:canvas.getContext(),layer,layerCtx:layer.getContext(),noteLayer,noteLayerCtx:noteLayer.getContext(),
    score:{width:600,height:235.63636363636363,boxes:new Map(),beams:[],glowRegions,header:{bridgeStartX:200,clefX:0,minX:0,lines:[[{y:50,width:1}]],extras:[],columns:{},states:[{time:0,key:'a',staves:[]}]},measureRegions:[visit]},
    measureTimeline:[visit],measureVisits:new Map([['m1',[visit]]]),headerInk:{},staffInk:{id:'staffInk'},stickyInk:{id:'marksInk'},
    updateColors(){},backgroundFrame(){},haloRadius(){return 0},
    cameraFrame(time){return {left:time*20,anchor:400,xPosition:400,cameraPosition,firstPosition,sticky:true,cutoff:100,headerFrame:{x:0,xScale:1,cutoff:100}}},
  });
  renderer.render(0,{motion:'sticky',headerBridge:bridge,zoom:100,pageDecay,glow:0,particles:0,outputLayer:'notation',showLine:false,showTitle:false,staffOpacity:75,
    parts:{staff:true,marks:true,header,notes:false,beams:false,effects:false,cursor:false},...settings});
  return canvas.commands;
}

test('connected scrolling staff bypasses the note fade with and without measure effects and a separate header',t=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>canvasMock()};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous});
  for(const pageDecay of ['none','burn'])for(const header of [false,true]){
    const commands=renderBridge(true,pageDecay,header),layers=commands.filter(c=>c.kind==='image');
    assert.equal(layers.length,3);
    if(pageDecay==='none')assert.ok(layers[0].content.some(c=>c.kind==='image'&&c.id==='staffInk'),'the static staff raster travels with the moving body');
    else assert.equal(layers[0].content.filter(c=>c.kind==='image'&&c.id==='staffInk').length,0,'animated measure tiles own the staff raster');
    assert.deepEqual(layers[0].content.filter(c=>c.kind==='mask').map(c=>c.start),[960],'staff has only the right edge fade');
    assert.deepEqual(layers[1].content.filter(c=>c.kind==='mask').map(c=>c.start),[960],'opening marks stay whole together with the notes');
    assert.deepEqual(layers[2].content.filter(c=>c.kind==='mask').map(c=>c.start),[960],'opening frame keeps notes fully opaque; only the right edge mask is active');
    if(header){
      const end=commands.find(c=>c.kind==='staff').end.x;
      assert.ok(end>=100,'header bridge reaches the body seam');
      assert.ok(end<160,'header bridge feather remains local to the seam');
    }
    if(pageDecay==='burn'){
      const staffTile=layers[0].content.find(c=>c.kind==='image');
      const markTile=layers[1].content.find(c=>c.kind==='image');
      assert.equal(layers[0].content.filter(c=>c.kind==='image').length,1,'animated staff has no full-score overlay');
      assert.deepEqual(staffTile.content.map(c=>c.id),['staffInk']);
      assert.deepEqual(markTile.content.map(c=>c.id),['marksInk']);
    }
    // The legacy switch is no longer exposed: both saved values render the
    // same continuous staff bridge to avoid a one-pixel overlap at the seam.
    const legacyValue=renderBridge(false,pageDecay,header).filter(c=>c.kind==='image');
    assert.equal(legacyValue.length,3);
    assert.deepEqual(legacyValue.map(layer=>layer.content.filter(c=>c.kind==='mask').map(c=>Math.round(c.start))),[[960],[960],[960]]);
  }
});

test('left note fade feathers the dock edge instead of leaving a hard vertical contour',()=>{
  const canvas=canvasMock();canvas.recordPartial=true;
  maskScrollLayer(canvas.getContext(),1000,1000,100,20);
  const clear=canvas.commands.find(command=>command.kind==='clear');
  const masks=canvas.commands.filter(command=>command.kind==='mask');
  assert.equal(clear.end,96);
  assert.equal(masks[0].start,96);
  assert.equal(masks[0].end,120);
});

test('repeated meters preserve the header when the body fade is shifted left',()=>{
  const draws=[],stops=[],operations=[];
  const ink={rasterScale:2},ctx={drawImage(...args){draws.push(args)}};
  const sc={save(){},restore(){},clearRect(){},drawImage(){},fillRect(){operations.push(this.globalCompositeOperation)},
    createLinearGradient(x,y,endX){return {x,endX,addColorStop(...args){stops.push(args)}}}};
  const scratch={width:1,height:1,getContext(){return sc}};
  const settings={left:0,top:0,scale:1,w:600,cutoff:100,fadeWidth:20,protect:1};
  drawRepeatedMeters(ctx,ink,[{x:60,y:0,w:8,h:16},{x:98,y:0,w:8,h:16},{x:150,y:0,w:8,h:16}],settings,scratch);
  assert.equal(draws.length,2,'a repeated meter behind the header is fully masked');
  assert.equal(draws[0][0],scratch,'the crossing meter receives a spatial fade');
  assert.equal(draws[1][0],ink,'a meter outside the fade stays unchanged');
  assert.deepEqual(stops,[[0,'rgba(0,0,0,0)'],[1,'#000']]);
  assert.deepEqual(operations,['destination-in']);
  draws.length=0;
  drawRepeatedMeters(ctx,ink,[{x:60,y:0,w:8,h:16}],{...settings,protect:0},scratch);
  assert.equal(draws[0][0],ink,'opening frames remain unmasked until travel is established');
});

test('marks use one spatial mask regardless of glyph width, without raw-raster restoration',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>canvasMock()};
  try{
    const masks=layer=>layer.content.filter(c=>c.kind==='clear'||c.kind==='mask');
    let expected;
    for(const pageDecay of ['none','burn'])for(const width of [10,400,1200]){
      const commands=renderBridge(true,pageDecay,true,[{part:'marks',kind:'hairpin',x:40,y:0,w:width,h:20}],true,{cameraPosition:200,firstPosition:100});
      const layers=commands.filter(c=>c.kind==='image');
      assert.equal(layers.length,3,'no unmasked mark crop is painted over the composite');
      expected??=masks(layers[1]);
      assert.deepEqual(masks(layers[1]),expected);
      assert.equal(Math.round(expected.find(c=>c.kind==='clear').end),94);
    }
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});

test('marks and notes share one header fade edge, switch and offset',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>canvasMock()};
  try{
    const leftMasks=layer=>layer.content.filter(c=>c.kind==='mask'&&c.start<900).map(c=>[c.start,c.end]);
    for(const settings of [{},{headerNoteFadeOffset:1},{headerNoteFadeOffset:-1}]){
      const layers=renderBridge(true,'none',false,[],true,{cameraPosition:200,firstPosition:100,...settings}).filter(c=>c.kind==='image');
      assert.equal(leftMasks(layers[1]).length,1);
      assert.deepEqual(leftMasks(layers[1]),leftMasks(layers[2]),'beams, rests and noteheads fade at the same pixels');
    }
    const shifted=renderBridge(true,'none',false,[],true,{cameraPosition:200,firstPosition:100,headerNoteFadeOffset:1}).filter(c=>c.kind==='image');
    const base=renderBridge(true,'none',false,[],true,{cameraPosition:200,firstPosition:100}).filter(c=>c.kind==='image');
    assert.equal(Math.round(leftMasks(shifted[1])[0][0]-leftMasks(base[1])[0][0]),20);
    assert.deepEqual(shifted[0].content.filter(c=>c.kind==='clear').map(c=>c.end),[100],'the staff seam does not move');
    // The retired mark switch no longer changes anything.
    const legacy=renderBridge(true,'none',false,[],true,{cameraPosition:200,firstPosition:100,headerMarkFade:false,headerMarkFadeOffset:3}).filter(c=>c.kind==='image');
    assert.deepEqual(leftMasks(legacy[1]),leftMasks(base[1]));
    const disabled=renderBridge(true,'none',false,[],true,{cameraPosition:200,firstPosition:100,headerNoteFade:false,headerNoteFadeOffset:1}).filter(c=>c.kind==='image');
    for(const layer of disabled.slice(1)){
      assert.deepEqual(layer.content.filter(c=>c.kind==='clear').map(c=>c.end),[100],'disabled fade clips both layers at the boundary');
      assert.deepEqual(layer.content.filter(c=>c.kind==='mask').map(c=>c.start),[960]);
    }
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});

test('opening and stationary cameras do not prematurely fade the first marks',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>canvasMock()};
  try{
    for(const cameraPosition of [100,105]){
      const layers=renderBridge(true,'none',false,[],true,{cameraPosition,firstPosition:100}).filter(c=>c.kind==='image');
      assert.deepEqual(layers[1].content.filter(c=>c.kind==='clear'),[]);
      assert.deepEqual(layers[1].content.filter(c=>c.kind==='mask').map(c=>c.start),[960]);
    }
    const established=renderBridge(true,'none',false,[],true,{cameraPosition:200,firstPosition:100}).filter(c=>c.kind==='image');
    assert.deepEqual(established[1].content.filter(c=>c.kind==='mask').map(c=>Math.round(c.start)),[94,960]);
    // Unknown opening travel: marks reaching past the edge stay whole, exactly like notes.
    const unknown=renderBridge(true,'none',false,[],true).filter(c=>c.kind==='image');
    for(const layer of unknown.slice(1)){
      assert.deepEqual(layer.content.filter(c=>c.kind==='clear'),[]);
      assert.deepEqual(layer.content.filter(c=>c.kind==='mask').map(c=>c.start),[960]);
    }
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
});
