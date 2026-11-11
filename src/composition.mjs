import { parseMotionProgram, defaultMotionProgram } from './motion-program.mjs';
import { defaultScoreProgram, presetPhase } from './effect-library.mjs';

export const GLOBAL_KEYS=['backgroundColor','backgroundDim','showTitle','theme','titleColor'];
// Layout options are shared by layers that link their layout to an owner. The
// header bridge changes the geometry of that layout, so linked header layers
// must inherit it together with the other layout controls.
export const LAYOUT_KEYS=['layout','camera','headerMode','headerBridge','headerNoteFade','headerNoteFadeOffset','headerMarkFade','headerMarkFadeOffset','headerFlowSymbols','headerOpeningGap','anchor','zoom','pageBars','pageRows','layoutY','cameraAmount','pageSpan','rowGap','pageMargin','cameraTransition'];
export const COMPOSITION_DEFAULTS={layout:'strip',camera:'follow',headerMode:'dock',headerExit:'retain',headerBridge:false,layoutY:54,cameraAmount:100,pageSpan:80,rowGap:4.5,pageMargin:5.5,cameraTransition:.6,decayParticles:35,scanWidth:100,scanAngle:0,scanOffsetX:0,scanOffsetY:0,scanColor:'#fff2d6'};
export const identityTransform=()=>({x:0,y:0,scaleX:1,scaleY:1,rotation:0,opacity:1,blend:'source-over'});
export const emptyProgram=()=>({version:1,name:'整体动画',enter:{...presetPhase('none','enter'),duration:.6},exit:{...presetPhase('none','exit'),delay:0,duration:1}});
export const PARTS=[['staff','五线谱线'],['marks','记谱标记'],['beams','符杠'],['notes','音符'],['effects','演奏光效'],['header','谱头'],['cursor','扫描线']];
export const MAX_LAYERS=24,MAX_NODES=64;
export const allParts=()=>Object.fromEntries(PARTS.map(([key])=>[key,true]));
export const nodeParts=node=>node?.kind==='score'?PARTS.filter(([key])=>node.parts[key]).map(([key])=>key):[];
export const nodeType=node=>node.kind==='group'?'组合':node.kind==='background'?'背景':node.kind==='title'?'标题':nodeParts(node).length===1?PARTS.find(([k])=>node.parts[k])[1]:'完整谱面';
const clone=value=>structuredClone(value);
const finite=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`${label} 必须在 ${min}～${max} 之间`);return v};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const safeObject=v=>{if(!object(v)||Object.keys(v).some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('无效配置对象');return v};
let serial=0;
export const nodeId=()=>`node-${Date.now().toString(36)}-${++serial}`;
export function modeOf(config){return config.layout==='rows'?'static':config.camera==='page'?'page':config.headerMode==='dock'?'sticky':'flow'}
export function templateConfig(mode){
  return {layout:mode==='static'?'rows':'strip',camera:mode==='static'?'page':mode==='page'?'page':'follow',headerMode:mode==='static'?'row':mode==='sticky'?'dock':'flow'};
}
export function layerConfig(defaults){
  const c={...clone(defaults),...COMPOSITION_DEFAULTS,...templateConfig(defaults.motion||'sticky')};
  for(const key of [...GLOBAL_KEYS,'aspect','title','reducedMotion','transparent','outputLayer','layoutTitle','composition'])delete c[key];
  c.motionProgram=clone(defaults.motionProgram||defaultMotionProgram);c.scoreMotionProgram=clone(defaults.scoreMotionProgram||defaultScoreProgram);
  c.markMotionProgram=clone(defaults.markMotionProgram||c.scoreMotionProgram);
  if(c.glowMode==='soft')c.glowMode='sweep';
  migrateAnimation(c);
  return c;
}
function migrateAnimation(config){
  if(config.animationModel!==undefined&&config.animationModel!==2)throw Error('不支持的动画模型版本');
  if(config.motionProgramActive!==undefined&&typeof config.motionProgramActive!=='boolean')throw Error('无效动画开关');
  for(const key of ['fly','scatter'])if(config[key]!==undefined)finite(config[key],0,5000,key);
  if(config.animationModel!==2&&!config.motionProgramActive){
    config.motionProgram=clone(config.motionProgram||defaultMotionProgram);
    for(const [phase,key] of [['enter','fly'],['exit','scatter']])config.motionProgram[phase]=presetPhase(config[key]>0?'classic':'none',phase,{...config.motionProgram[phase],strength:config[key]||0});
    config.motionProgramActive=true;if(config.fly>0)config.noteArrival='assemble';
  }
  config.animationModel=2;delete config.fly;delete config.scatter;
}
export function makeLayer(defaults,name='主谱面'){
  return {id:nodeId(),kind:'score',name,parent:null,enabled:true,transform:identityTransform(),timeOffset:0,animationEnabled:false,program:emptyProgram(),parts:allParts(),layoutLink:null,config:layerConfig(defaults)};
}
export function makeSurface(kind){return {id:nodeId(),kind,name:kind==='background'?'背景':'标题与署名',parent:null,enabled:true,transform:identityTransform(),timeOffset:0,animationEnabled:false,program:emptyProgram()}}
export function makeComposition(defaults){const node=makeLayer(defaults);return {version:1,nodes:[node],activeId:node.id,editLayerId:node.id}}
export function selectedNode(settings){return settings.composition.nodes.find(n=>n.id===settings.composition.activeId)}
export function selectedLayer(settings){const s=settings.composition;return s.nodes.find(n=>n.id===s.editLayerId&&n.kind==='score')||s.nodes.find(n=>n.kind==='score')}
export function selectNode(settings,id){const node=settings.composition.nodes.find(n=>n.id===id);if(!node)return;settings.composition.activeId=id;if(node.kind==='score')settings.composition.editLayerId=id}

// Existing parameter controls edit the selected score layer. Rendering and export
// consume the full composition, never a collection of hidden mode overrides.
export function createStudioSettings(defaults){
  const data={...clone(defaults),...COMPOSITION_DEFAULTS,groupMotionProgram:emptyProgram(),groupProgramActive:false,composition:makeComposition(defaults)};
  const globals=new Set([...GLOBAL_KEYS,'aspect','title','reducedMotion','transparent','outputLayer','layoutTitle','composition']);
  return new Proxy(data,{
    get(target,key){
      if(key==='groupMotionProgram')return selectedNode(target)?.program;
      if(key==='groupProgramActive')return selectedNode(target)?.animationEnabled;
      if(typeof key==='string'&&!globals.has(key)&&Object.hasOwn(target,key)){
        const config=selectedLayer(target)?.config;
        return key==='motion'?modeOf(config):config?.[key]??target[key];
      }
      return target[key];
    },
    set(target,key,value){
      if(key==='groupMotionProgram'){selectedNode(target).program=value;return true}
      if(key==='groupProgramActive'){selectedNode(target).animationEnabled=value;return true}
      if(typeof key==='string'&&!globals.has(key)&&Object.hasOwn(target,key)){
        const config=selectedLayer(target).config;
        if(key==='motion')Object.assign(config,templateConfig(value));
        config[key]=value;return true;
      }
      target[key]=value;return true;
    }
  });
}
export function resolveLayerConfig(node,composition){
  const config={...node.config};
  const linked=composition.nodes.find(n=>n.id===node.layoutLink&&n.kind==='score');
  if(linked)for(const key of LAYOUT_KEYS)config[key]=linked.config[key];
  config.motion=modeOf(config);return config;
}
export function visualSnapshot(settings){
  const composition=clone(settings.composition);for(const n of composition.nodes)if(n.kind==='score')n.config.motion=modeOf(n.config);
  return {globals:Object.fromEntries(GLOBAL_KEYS.map(k=>[k,settings[k]])),composition};
}
export function presetFingerprint(value){
  const snapshot=clone(value.globals?{globals:value.globals,composition:value.composition}:visualSnapshot(value));
  delete snapshot.composition.activeId;delete snapshot.composition.editLayerId;
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  return JSON.stringify(ordered(snapshot));
}
export function makePreset(settings,name){return {type:'liupu-visual-preset',version:5,name,...visualSnapshot(settings)}}

export const CONFIG_LIMITS={animationModel:[2,2],glow:[0,500],bloom:[0,500],particles:[0,300],decayParticles:[0,300],trail:[0,300],anchor:[0,100],zoom:[10,1000],pageBars:[1,12],pageRows:[1,8],decayOffset:[-120,120],decayDelay:[0,60],decayDuration:[.05,60],scanLength:[1,1000],scanGlow:[0,300],scanBloom:[0,1000],scanWidth:[1,3000],scanAngle:[-720,720],scanOffsetX:[-300,300],scanOffsetY:[-300,300],noteOpacity:[0,100],staffOpacity:[0,100],beamOpacity:[0,100],markOpacity:[0,100],headerNoteFadeOffset:[-120,120],headerMarkFadeOffset:[-120,120],headerOpeningGap:[0,240],layoutY:[-100,200],cameraAmount:[0,500],pageSpan:[5,500],rowGap:[0,100],pageMargin:[0,40],cameraTransition:[0,60],glowRange:[.1,12],glowOffset:[-12,12],glowPeak:[0,200],glowValley:[0,100],glowRadius:[10,400],glowFeather:[0,100]};
const numeric=CONFIG_LIMITS;
const choices={motion:['sticky','flow','page','static'],layout:['strip','rows'],camera:['follow','stationary','page'],headerMode:['dock','flow','hidden','row'],headerExit:['retain','measure'],pageDecay:['none','burn','dissolve','fade'],decayTrigger:['measure','progress'],noteArrival:['visible','assemble'],noteExitTrigger:['note','measure'],glowMode:['pulse','sweep'],glowShape:['halo','edge']};
function validateConfig(value,defaults){
  safeObject(value);value=clone(value);migrateAnimation(value);const baseline=layerConfig(defaults),result={};
  for(const [mark,staff] of [['markMotionProgram','scoreMotionProgram'],['markProgramActive','scoreProgramActive'],['markPageDecay','pageDecay'],['markDecayTrigger','decayTrigger'],['markDecayOffset','decayOffset'],['markDecayDelay','decayDelay'],['markDecayDuration','decayDuration']]){
    if(!Object.hasOwn(value,mark)&&Object.hasOwn(value,staff))value[mark]=clone(value[staff]);
  }
  if(value.glowMode==='soft')value.glowMode='sweep';
  for(const key of Object.keys(value))if(!Object.hasOwn(baseline,key))throw Error(`未知图层参数：${key}`);
  for(const [key,fallback] of Object.entries(baseline)){
    const v=Object.hasOwn(value,key)?value[key]:fallback;
    if(key==='motionProgram'||key==='scoreMotionProgram'||key==='markMotionProgram'){result[key]=parseMotionProgram(JSON.stringify(v));continue}
    const sharedKey=key.startsWith('markDecay')?'decay'+key.slice('markDecay'.length):key==='markPageDecay'?'pageDecay':key;
    if(sharedKey!==key&&numeric[sharedKey]){result[key]=finite(v,...numeric[sharedKey],key);continue}
    if(sharedKey!==key&&choices[sharedKey]){if(!choices[sharedKey].includes(v))throw Error(`不支持的 ${key}`);result[key]=v;continue}
    if(numeric[key]){result[key]=finite(v,...numeric[key],key);if(['pageBars','pageRows'].includes(key)&&!Number.isInteger(v))throw Error(`${key} 必须为整数`);continue}
    if(choices[key]){if(!choices[key].includes(v))throw Error(`不支持的 ${key}`);result[key]=v;continue}
    if(/Color$/.test(key)||key==='color'){if(typeof v!=='string'||!/^#[\da-f]{6}$/i.test(v))throw Error(`无效颜色：${key}`)}
    else if(typeof fallback==='boolean'){if(typeof v!=='boolean')throw Error(`无效开关：${key}`)}
    else if(typeof v!==typeof fallback)throw Error(`无效参数：${key}`);
    result[key]=v;
  }
  result.decayOffset=Math.max(-120,Math.min(120,result.decayOffset+result.decayDelay+(result.scoreMotionProgram.exit.offset??0)));result.decayDelay=0;result.scoreMotionProgram.exit.delay=0;delete result.scoreMotionProgram.exit.offset;
  result.markDecayOffset=Math.max(-120,Math.min(120,result.markDecayOffset+result.markDecayDelay+(result.markMotionProgram.exit.offset??0)));result.markDecayDelay=0;result.markMotionProgram.exit.delay=0;delete result.markMotionProgram.exit.offset;
  result.motion=modeOf(result);return result;
}
export function parsePreset(text,defaults){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>2_000_000)throw Error('预设包最多 2 MB');
  let p;try{p=JSON.parse(text)}catch{throw Error('预设文件不是有效 JSON')}
  safeObject(p);
  if(p.type!=='liupu-visual-preset'||![1,2,3,4,5].includes(p.version))throw Error('请选择受支持的完整流谱预设包；动画 JSON 请从效果库导入');
  if(typeof p.name!=='string'||!p.name.trim()||p.name.length>80)throw Error('预设名称需要 1～80 个字符');
  const globals={};safeObject(p.globals);
  for(const k of GLOBAL_KEYS){const v=Object.hasOwn(p.globals,k)?p.globals[k]:k==='titleColor'?(p.composition?.nodes?.find(n=>n.kind==='score')?.config?.noteColor||defaults.titleColor):undefined;if(/Color$/.test(k)&&!/^#[\da-f]{6}$/i.test(v))throw Error('无效画面颜色');if(k==='backgroundDim')finite(v,0,100,k);if(k==='showTitle'&&typeof v!=='boolean')throw Error('无效标题开关');if(k==='theme'&&!['dark','paper','custom'].includes(v))throw Error('无效配色主题');globals[k]=v}
  const scene=safeObject(p.composition);
  if(scene.version!==1||!Array.isArray(scene.nodes)||!scene.nodes.length||scene.nodes.length>MAX_NODES)throw Error(`组合需要 1～${MAX_NODES} 个元素或组`);
  if(scene.nodes.filter(n=>n.kind==='score').length>MAX_LAYERS)throw Error(`最多 ${MAX_LAYERS} 个乐谱元素`);
  for(const kind of ['background','title'])if(scene.nodes.filter(n=>n.kind===kind).length>1)throw Error('背景与标题分别只能有一个元素');
  const ids=new Set(),nodes=scene.nodes.map(n=>{
    safeObject(n);
    if(typeof n.id!=='string'||n.id.length>100||ids.has(n.id)||!['score','group','background','title'].includes(n.kind))throw Error('无效或重复的图层');ids.add(n.id);
    if(typeof n.name!=='string'||!n.name.trim()||n.name.length>80)throw Error('图层名称需要 1～80 个字符');
    const t=safeObject(n.transform),transform={};
    for(const [key,min,max] of [['x',-1000,1000],['y',-1000,1000],['scaleX',.01,20],['scaleY',.01,20],['rotation',-7200,7200],['opacity',0,1]])transform[key]=finite(t[key],min,max,key);
    if(!['source-over','screen','multiply','lighter'].includes(t.blend))throw Error('无效混合方式');transform.blend=t.blend;
    if(typeof n.enabled!=='boolean'||typeof n.animationEnabled!=='boolean')throw Error('无效图层开关');
    const node={id:n.id,kind:n.kind,name:n.name.trim(),parent:n.parent??null,enabled:n.enabled,transform,timeOffset:finite(n.timeOffset,-120,120,'视觉时间偏移'),animationEnabled:n.animationEnabled,program:parseMotionProgram(JSON.stringify(n.program))};
    if(n.userNamed===true)node.userNamed=true;
    if(n.kind==='score'){
      node.parts={};for(const k of Object.keys(allParts())){const v=n.parts&&Object.hasOwn(n.parts,k)?n.parts[k]:['beams','effects'].includes(k)?n.parts?.notes:undefined;if(typeof v!=='boolean')throw Error('无效元素开关');node.parts[k]=v}
      node.layoutLink=n.layoutLink??null;node.config=validateConfig(n.config,defaults);
    }
    return node;
  });
  if(!nodes.some(n=>n.kind==='score'))throw Error('至少保留一个谱面图层');
  for(const node of nodes){
    const visited=new Set([node.id]);let parent=node.parent;
    while(parent!==null){const p=nodes.find(n=>n.id===parent);if(!p||p.kind!=='group'||visited.has(parent)||visited.size>8)throw Error('图层分组存在循环、缺失父级或层级过深');visited.add(parent);parent=p.parent}
    if(node.layoutLink){const owner=nodes.find(n=>n.id===node.layoutLink);if(!owner||owner.kind!=='score'||owner.id===node.id||owner.layoutLink)throw Error('关联排版必须指向未关联的谱面图层')}
  }
  return {type:p.type,version:5,name:p.name.trim(),globals,composition:{version:1,nodes,activeId:ids.has(scene.activeId)?scene.activeId:nodes[0].id,editLayerId:nodes.some(n=>n.id===scene.editLayerId&&n.kind==='score')?scene.editLayerId:nodes.find(n=>n.kind==='score').id}};
}
export function applyVisualPreset(settings,preset){
  settings.composition=clone(preset.composition);for(const k of GLOBAL_KEYS)settings[k]=preset.globals[k];
}
export function groupNodes(settings,ids,name='组合'){
  const scene=settings.composition,chosen=scene.nodes.filter(n=>ids.includes(n.id));
  if(chosen.length<2)throw Error('请勾选至少两个同级元素');
  if(chosen.some(n=>n.parent!==chosen[0].parent))throw Error('请先选择同一组内的元素');
  const siblings=scene.nodes.filter(n=>n.parent===chosen[0].parent),positions=chosen.map(n=>siblings.indexOf(n));
  if(Math.max(...positions)-Math.min(...positions)+1!==chosen.length)throw Error('请先调整图层顺序，再勾选相邻的同级元素编组');
  if(scene.nodes.length>=MAX_NODES)throw Error(`最多 ${MAX_NODES} 个元素或组`);
  const group={id:nodeId(),kind:'group',name,parent:chosen[0].parent,enabled:true,transform:identityTransform(),timeOffset:0,animationEnabled:false,program:emptyProgram()};
  const index=scene.nodes.indexOf(chosen[0]);scene.nodes.splice(index,0,group);for(const n of chosen)n.parent=group.id;selectNode(settings,group.id);return group;
}
export function splitHeader(settings){
  const scene=settings.composition,node=selectedNode(settings);
  if(node?.kind!=='score'||!node.parts.header)throw Error('请选择包含谱头的谱面图层');
  if(scene.nodes.filter(n=>n.kind==='score').length>=MAX_LAYERS||scene.nodes.length>MAX_NODES-2)throw Error('图层数量已达上限');
  const body=clone(node),header=clone(node);
  body.id=nodeId();header.id=nodeId();body.name='谱面';header.name='谱头';
  delete body.userNamed;delete header.userNamed;
  body.transform=identityTransform();header.transform=identityTransform();body.timeOffset=header.timeOffset=0;body.animationEnabled=header.animationEnabled=false;body.program=emptyProgram();header.program=emptyProgram();
  body.parts.header=false;header.parts=Object.fromEntries(PARTS.map(([k])=>[k,k==='header']));header.layoutLink=body.id;
  if(body.layoutLink){const owner=scene.nodes.find(n=>n.id===body.layoutLink);if(owner)for(const key of LAYOUT_KEYS)body.config[key]=owner.config[key];body.layoutLink=null}
  for(const n of scene.nodes)if(n.layoutLink===node.id)n.layoutLink=body.id;
  const group={id:node.id,kind:'group',name:'谱头与谱面',parent:node.parent,enabled:node.enabled,transform:clone(node.transform),timeOffset:node.timeOffset,animationEnabled:node.animationEnabled,program:clone(node.program)};
  body.parent=header.parent=group.id;
  scene.nodes.splice(scene.nodes.indexOf(node),1,group,body,header);scene.editLayerId=body.id;selectNode(settings,group.id);return group;
}
export function splitElements(settings){
  const scene=settings.composition,node=selectedNode(settings),enabled=nodeParts(node);
  if(enabled.length<2)throw Error('当前已经是独立元素');
  const missing=['background','title'].filter(kind=>!scene.nodes.some(n=>n.kind===kind));
  if(scene.nodes.filter(n=>n.kind==='score').length+enabled.length-1>MAX_LAYERS||scene.nodes.length+enabled.length+missing.length>MAX_NODES)throw Error('元素数量已达上限，请先删除不用的图层');
  const resolved=resolveLayerConfig(node,scene),children=enabled.map(key=>{
    const child=clone(node);delete child.userNamed;Object.assign(child,{id:nodeId(),parent:node.id,name:PARTS.find(([k])=>k===key)[1],transform:identityTransform(),timeOffset:0,animationEnabled:false,program:emptyProgram(),layoutLink:null,config:clone(resolved),parts:Object.fromEntries(PARTS.map(([k])=>[k,k===key]))});return child;
  });
  const owner=children.find(n=>n.parts.staff)||children[0];
  for(const child of children)if(child!==owner)child.layoutLink=owner.id;
  for(const dependent of scene.nodes)if(dependent.layoutLink===node.id)dependent.layoutLink=owner.id;
  const group={id:node.id,kind:'group',name:'乐谱组合',parent:node.parent,enabled:node.enabled,transform:clone(node.transform),timeOffset:node.timeOffset,animationEnabled:node.animationEnabled,program:clone(node.program)};
  scene.nodes.splice(scene.nodes.indexOf(node),1,group,...children);
  if(missing.includes('background'))scene.nodes.unshift(makeSurface('background'));
  if(missing.includes('title'))scene.nodes.push(makeSurface('title'));
  scene.editLayerId=owner.id;selectNode(settings,group.id);return group;
}
export function compositionTail(settings,scoreDuration){
  const scene=settings.composition;if(!scene)return scoreDuration;
  const endOf=(node,offset=0)=>{
    if(!node.enabled)return 0;offset+=node.timeOffset;
    let end=scoreDuration;
    if(node.kind==='score'){
      const c=resolveLayerConfig(node,scene),p=c.motionProgramActive?c.motionProgram:null;
      const parts=node.parts,hasNotes=parts.notes||parts.beams||parts.effects,hasStructure=parts.staff||parts.header&&c.layout==='rows'&&c.headerExit==='measure';
      const note=hasNotes&&p&&p.exit.enabled!==false?(p.exit.offset??0)+(c.layout==='strip'&&['classic-fragments','flyin'].includes(p.exit.renderer)?0:p.exit.delay+p.exit.duration):0;
      const arrival=hasNotes&&p&&p.enter.enabled!==false&&c.noteArrival==='assemble'?(p.enter.offset??0):0;
      const structureArrival=hasStructure&&c.scoreProgramActive&&c.scoreMotionProgram.enter.enabled!==false?(c.scoreMotionProgram.enter.offset??0):0;
      const decay=hasStructure&&(c.pageDecay!=='none'||c.scoreProgramActive&&c.scoreMotionProgram.exit.enabled!==false)?Math.max(0,c.decayOffset+(c.decayTrigger==='progress'?0:c.decayDelay+c.decayDuration)):0;
      const markDecay=parts.marks&&(c.markPageDecay!=='none'||c.markProgramActive&&c.markMotionProgram.exit.enabled!==false)?Math.max(0,c.markDecayOffset+(c.markDecayTrigger==='progress'?0:c.markDecayDelay+c.markDecayDuration)):0;
      const markArrival=parts.marks&&c.markProgramActive&&c.markMotionProgram.enter.enabled!==false?(c.markMotionProgram.enter.offset??0):0;
      end+=Math.max(0,note,decay,arrival,structureArrival,markDecay,markArrival);
    }else if(node.kind==='group')end=Math.max(scoreDuration,...scene.nodes.filter(n=>n.parent===node.id).map(n=>endOf(n,0)));
    if(node.animationEnabled){
      if(node.program.exit.enabled!==false)end=Math.max(end,scoreDuration+node.program.exit.delay+(node.program.exit.offset??0)+node.program.exit.duration);
      if(node.program.enter.enabled!==false)end=Math.max(end,Math.min(node.program.enter.duration,scoreDuration)+(node.program.enter.offset??0));
    }
    return end+offset;
  };
  return Math.max(scoreDuration,...scene.nodes.filter(n=>n.parent===null).map(n=>endOf(n)))+.1;
}
export function builtinPresets(defaults){
  const build=(name,configure)=>{
    const s=createStudioSettings(defaults);
    Object.assign(s,{motion:'sticky',motionProgramActive:true,noteArrival:'visible',pageDecay:'none',scoreProgramActive:false,glow:0,bloom:0,particles:0,trail:0,decayParticles:0,scanGlow:0,scanBloom:0,showLine:true,headerExit:'retain'});
    s.motionProgram={...clone(defaultMotionProgram),enter:presetPhase('none','enter'),exit:presetPhase('none','exit')};
    configure(s);s.markPageDecay=s.pageDecay;s.markDecayTrigger=s.decayTrigger;return makePreset(s,name);
  };
  return [
    build('纯净流动',()=>{}),
    build('纸页演奏',s=>{s.theme='paper';s.motion='static';s.backgroundColor='#f2efe6';s.titleColor=s.noteColor=s.beamColor=s.markColor='#272b2c';s.staffColor='#686b70';s.glow=15;s.color=s.scanColor='#917255'}),
    build('柔光长卷',s=>{s.motion='flow';s.glowMode='sweep';s.glow=30;s.bloom=20;s.scanGlow=10;s.scanBloom=50}),
    build('音符聚散',s=>{s.noteArrival='assemble';s.motionProgram.enter=presetPhase('flyin','enter');s.motionProgram.exit=presetPhase('flyin','exit');s.glow=35;s.bloom=25;s.particles=8;s.trail=10;s.scanGlow=15;s.scanBloom=60}),
    build('碎片聚散',s=>{s.noteArrival='assemble';s.motionProgram.enter=presetPhase('classic','enter');s.motionProgram.exit=presetPhase('classic','exit');s.glow=40;s.bloom=30;s.particles=15;s.trail=20;s.scanGlow=25;s.scanBloom=70}),
    build('纵向行进',s=>{s.layout='rows';s.camera='follow';s.headerMode='row';s.pageBars=3;s.pageRows=3;s.layoutY=34;s.headerExit='measure';s.pageDecay='fade';s.noteArrival='assemble';s.motionProgram.enter=presetPhase('rise','enter');s.motionProgram.exit=presetPhase('rise','exit');s.glow=45;s.bloom=35;s.particles=20;s.trail=0;s.scanGlow=35;s.scanBloom=80}),
    build('星尘流动',s=>{s.noteArrival='assemble';s.motionProgram.enter=presetPhase('rise','enter');s.motionProgram.exit=clone(defaultMotionProgram.exit);s.pageDecay='dissolve';s.particles=35;s.trail=45;s.decayParticles=35;s.glow=60;s.bloom=45;s.scanGlow=45;s.scanBloom=90}),
    build('余烬扫描',s=>{s.motion='static';s.headerExit='measure';s.decayTrigger='progress';s.pageDecay='burn';s.noteArrival='assemble';s.motionProgram.enter=presetPhase('scatter','enter');s.motionProgram.exit=presetPhase('fade','exit');s.decayParticles=60;s.particles=50;s.trail=0;s.glow=75;s.bloom=60;s.scanGlow=60;s.scanBloom=100;s.scanColor='#f5a768'})
  ];
}
