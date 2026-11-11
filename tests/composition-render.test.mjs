import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionRenderer } from '../src/composition-render.mjs';
import { createStudioSettings, makeSurface, splitHeader, selectedNode } from '../src/composition.mjs';
import { visualDefaults } from '../src/visual-defaults.mjs';

function fixture(){
  const calls=[],ctx={};
  for(const name of ['resetTransform','clearRect','fillRect','save','restore','translate','rotate','scale','drawImage','fillText'])ctx[name]=()=>{};
  const renderer=Object.assign(Object.create(CompositionRenderer.prototype),{canvas:{width:960,height:540},ctx,pool:new Map(),score:{duration:10},background:{id:'background'}});
  renderer.fallback={score:renderer.score,setBackground(image){calls.push(['background',image])},render(time,settings){calls.push(['direct',time,settings])}};
  renderer.surface=(id,score)=>{calls.push(['surface',id]);return {ctx,canvas:{},renderer:score?{render(time,settings){calls.push(['layer',time,settings])}}:null}};
  const settings=createStudioSettings(visualDefaults);settings.showTitle=false;
  return {renderer,settings,calls};
}

test('identity single-layer scenes draw directly with the same export, background and layout options',()=>{
  const {renderer,settings,calls}=fixture();settings.transparent=true;settings.exportCursor=false;settings.layoutTitle=true;
  renderer.render(2,settings);
  assert.equal(calls.some(c=>c[0]==='surface'),false);
  const [,time,style]=calls.find(c=>c[0]==='direct');
  assert.equal(time,2);assert.equal(style.transparent,true);assert.equal(style.showLine,false);
  assert.equal(style.layoutTitle,true);assert.equal(style.composition,undefined);
  assert.deepEqual(style.parts,selectedNode(settings).parts);
  assert.equal(calls[0][1],renderer.background);
});

test('transformed, timed and split layers keep the composition path',()=>{
  for(const modify of [s=>selectedNode(s).transform.x=2,s=>selectedNode(s).timeOffset=1,s=>splitHeader(s)]){
    const {renderer,settings,calls}=fixture();modify(settings);renderer.render(2,settings);
    assert.equal(calls.some(c=>c[0]==='direct'),false);
    assert.ok(calls.some(c=>c[0]==='layer'));
  }
});

test('invisible layers and irrelevant export parts allocate no rendering surfaces and return when visible',()=>{
  const {renderer,settings,calls}=fixture();
  settings.composition.nodes.push(makeSurface('title'),makeSurface('background'));settings.transparent=true;
  const layer=selectedNode(settings);layer.transform.opacity=0;renderer.render(2,settings);
  assert.equal(calls.length,0);
  layer.transform.opacity=1;settings.outputPart='title';renderer.render(2,settings);assert.equal(calls.length,0);
  settings.outputPart='notes';renderer.render(2,settings);
  const [,time,style]=calls.find(c=>c[0]==='layer');assert.equal(time,2);
  assert.deepEqual(Object.entries(style.parts).filter(([,visible])=>visible).map(([key])=>key),['notes']);
});

test('split flowing header owns its glyphs in both preview and header-only export',()=>{
  const {renderer,settings,calls}=fixture();splitHeader(settings);
  const body=settings.composition.nodes.find(n=>n.name==='谱面'),header=settings.composition.nodes.find(n=>n.name==='谱头');
  body.config.headerMode='flow';body.config.headerFlowSymbols=true;
  renderer.render(2,settings);
  const preview=calls.filter(c=>c[0]==='layer').map(c=>c[2]);
  assert.ok(preview.some(style=>style.parts.marks&&!style.parts.header));
  assert.ok(preview.some(style=>style.parts.header&&!style.parts.marks&&!style.suppressFlowHeaderCopy));
  calls.length=0;settings.outputPart='header';renderer.render(2,settings);
  const exported=calls.filter(c=>c[0]==='layer').map(c=>c[2]);
  assert.ok(exported.some(style=>style.parts.header&&!style.suppressFlowHeaderCopy));
});
