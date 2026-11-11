import { builtinPresets,makePreset,parsePreset,applyVisualPreset,presetFingerprint,selectedNode,selectNode,groupNodes,splitElements,makeLayer,nodeId,nodeParts,nodeType,resolveLayerConfig,templateConfig,identityTransform,LAYOUT_KEYS,CONFIG_LIMITS,MAX_LAYERS,MAX_NODES } from './composition.mjs';
import { effectPresets,presetPhase } from './effect-library.mjs';
import { parseMotionProgram } from './motion-program.mjs';
import { t } from './i18n.mjs';

const $=id=>document.getElementById(id),clone=v=>structuredClone(v);
const element=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e};
const button=(text,fn,cls='outline')=>{const b=element('button',cls,text);b.type='button';b.onclick=fn;return b};
const STORAGE='liupu.visual-presets.v5';
const systemNames=new Set(['主谱面','谱面','谱头与谱面','乐谱组合','组合','完整谱面','背景','标题与署名','五线谱线','记谱标记','符杠','音符','演奏光效','谱头','扫描线']);
const isUserName=node=>node.userNamed||!systemNames.has(node.name);
const displayName=node=>isUserName(node)?node.name:t(node.name);

export function bindStudioEditor(settings,defaults,{changed,syncStyle,effectEditor,download,locked,getThumbnail,initialLibrary}){
  const builtins=builtinPresets(defaults),checks=new Set();let saved=[],applied='纯净流动',savedFingerprint=presetFingerprint(settings),history=[],future=[],stable=makePreset(settings,applied),updating=false,libraryKind='preset',libraryPhase='enter',librarySelection=null,importedEffects=[];
  let canvasMode=false,multiSelect=false,appliedCustom=false;const collapsed=new Set();
  // Keep the old library intact so earlier desktop versions cannot overwrite new designs.
  let libraryError;
  const stored=key=>initialLibrary?initialLibrary[key]:localStorage.getItem(key);
  try{saved=JSON.parse(stored(STORAGE)??stored('liupu.visual-presets.v4')??stored('liupu.visual-presets.v3')??stored('liupu.visual-presets.v2')??stored('liupu.visual-presets.v1')??'[]').map(p=>parsePreset(JSON.stringify(p),defaults)).slice(0,50)}catch(error){libraryError=error;saved=[]}
  try{importedEffects=JSON.parse(stored('liupu.ae-effects.v1')||'[]').slice(0,50).map(e=>({...e,program:parseMotionProgram(JSON.stringify(e.program))}))}catch(error){libraryError=error;importedEffects=[]}
  async function persist(key,value){const text=JSON.stringify(value);if(window.liupuDesktop?.writeVisualLibrary){const result=await window.liupuDesktop.writeVisualLibrary(key,text);if(result.error)throw Error(result.error)}else localStorage.setItem(key,text)}
  let savedWrites=Promise.resolve();
  function updateSaved(change){
    const result=savedWrites.then(async()=>{const next=change(saved);if(next.length>50)throw Error('我的预设最多 50 套，请先删除不用的预设');await persist(STORAGE,next);saved=next});
    savedWrites=result.catch(()=>{});return result;
  }
  function report(text,error=false){$('studioStatus').textContent=text;$('studioStatus').dataset.error=String(error)}
  function refreshDirty(){const dirty=presetFingerprint(settings)!==savedFingerprint;$('presetName').dataset.userContent='';$('presetName').textContent=(appliedCustom?applied:t(applied))+(dirty?t(' · 已修改'):'');$('undoVisual').disabled=!history.length||locked();$('redoVisual').disabled=!future.length||locked()}
  function checkpoint(){if(updating||locked())return;const current=makePreset(settings,applied);if(presetFingerprint(current)!==presetFingerprint(stable)){history.push(stable);if(history.length>30)history.shift();future=[];stable=current}refreshDirty()}
  function run(fn){if(locked())return;const before=makePreset(settings,applied);try{checkpoint();fn();parsePreset(JSON.stringify(makePreset(settings,applied)),defaults);checkpoint();syncAll();changed()}catch(e){applyVisualPreset(settings,before);syncAll();changed();report(e.message,true)}}
  function restore(p){updating=true;applyVisualPreset(settings,p);applied=p.name;appliedCustom=!builtins.some(x=>x.name===p.name);stable=makePreset(settings,applied);checks.clear();effectEditor.reset();syncAll();changed();updating=false;refreshDirty()}

  const effects=$('effectsPanel'),appearance=$('appearancePanel');
  const banner=element('section','studio-preset');banner.innerHTML='<label class="quiet">完整效果预设</label><strong id="presetName"></strong><div class="studio-actions"><button id="browsePresets" class="outline">浏览预设</button><button id="exportVisual" class="outline">导出预设包</button><button id="saveVisual" class="outline">另存为…</button><button id="undoVisual" class="icon-button" aria-label="撤销视觉修改">↶</button><button id="redoVisual" class="icon-button" aria-label="重做视觉修改">↷</button></div><div id="saveVisualForm" hidden><label class="field"><span>预设名称</span><input id="visualName" type="text" maxlength="80"></label><div class="studio-actions"><button id="confirmVisualSave" class="primary">保存到我的预设</button></div><p class="help">预设包是可迁移的完整视觉方案（.liupu-preset），包含布局、编组和效果参数；乐谱、录音、背景图片仍是当前作品素材。</p></div><p class="help">导出当前方案后可在另一台设备的「浏览预设 → 导入预设包」中读取；动画 JSON 只保存单个对象的关键帧。</p>';
  effects.prepend(banner);
  const icon=(path)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  $('undoVisual').innerHTML=icon('M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12');$('redoVisual').innerHTML=icon('m15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12');
  const makeSection=(id,title,summary)=>{const d=element('details','studio-section');d.id=id;const s=element('summary');s.append(element('b','',title),element('small','',summary));d.append(s);effects.append(d);return d};
  const layout=makeSection('layoutSection','布局与镜头','自由组合排版与镜头规则');
  const transform=makeSection('transformSection','位置与合成','当前元素的变换与混合');
  const animation=$('motionEditor');animation.className='studio-section';effects.append(animation);animation.open=false;animation.querySelector('summary').textContent='动画与消解';
  const header=makeSection('headerSection','谱头','独立控制或与谱面编组');
  const scan=makeSection('scanSection','扫描线','形状、方向与独立光晕');
  const light=makeSection('lightSection','演奏高光','只影响音符的高光与光粒');
  const style=makeSection('styleSection','元素外观','当前元素的颜色与不透明度');
  const canvasStyle=makeSection('canvasSection','画布与背景','画幅、背景图片与作品标题');
  const move=(node,target)=>{if(node)target.append(node)};
  move($('staticControls'),layout);move($('anchorField'),layout);move($('zoom').closest('.slider-field'),layout);move($('staticZoomHint'),layout);
  $('motion').closest('.field').hidden=true;
  move($('motion').closest('.field'),layout);
  move($('decayHeading').closest('section'),animation);$('decayHeading').textContent='出场消解';
  $('decayDelay').closest('.field').hidden=true;
  $('legacyMotionControls')?.remove();
  for(const id of ['glow','glowMode','glowShape','glowSweepControls','glowOffsetControls','glowRadius','glowFeather','glowTargetControls','bloom','particles','trail'])move($(id).closest('.slider-field,.field,div,fieldset')||$(id),light);
  move(document.querySelector('.color-section'),light);
  move(document.querySelector('.scanline-section'),scan);
  move($('showTitle').closest('label'),canvasStyle);
  while(appearance.firstChild)style.append(appearance.firstChild);
  for(const id of ['aspect','theme','backgroundColor','backgroundImport','backgroundName','backgroundDim','titleInput'])move($(id).closest('.field,.palette-field,.background-actions,.slider-field')||$(id),canvasStyle);
  // Explanatory paragraphs belong to their controls, not to every element.
  for(const p of style.querySelectorAll(':scope > p'))p.hidden=true;
  $('appearanceTab').hidden=true;$('effectsTab').textContent='效果';
  $('motionProgramActive').checked=settings.motionProgramActive;
  $('effectTarget').add(new Option('当前组 / 图层 · 所有元素','group'));
  $('importMotion').textContent='导入动画 JSON';$('exportMotion').textContent='导出此对象动画';
  $('motionEditor').querySelector('.json-editor summary').textContent='动画数据导入与导出';
  const choices={
    layout:['排版结构',[['strip','连续长卷'],['rows','多行排版']]],camera:['镜头规则',[['follow','连续跟随'],['stationary','固定画面'],['page','分段 / 翻页']]],headerMode:['谱头行为',[['dock','随谱移动后停靠'],['flow','随谱面移动'],['row','每行独立谱头'],['hidden','不显示谱头']]],headerExit:['行首出场',[['retain','保持可见'],['measure','跟随首小节消解']]]
  };
  $('staticControls').setAttribute('aria-label','多行排版设置');
  function field(target,id,label,input){const l=element('label','field');l.append(element('span','',label),input);input.id=id;target.append(l);return input}
  for(const [key,[label,options]] of Object.entries(choices)){const input=document.createElement('select');for(const [value,name] of options)input.add(new Option(name,value));field(key.startsWith('header')?header:layout,`studio-${key}`,label,input);input.onchange=()=>run(()=>{const n=selectedNode(settings),owner=settings.composition.nodes.find(x=>x.id===n.layoutLink);if(key==='headerMode'&&owner)owner.config[key]=input.value;else settings[key]=input.value;if(key==='layout'&&settings.headerMode!=='hidden')settings.headerMode=input.value==='rows'?'row':'flow'})}
  // 谱头与谱线始终使用连续桥接；旧预设中的 headerBridge 字段仍保留，
  // 但不再暴露一个会产生边界重叠的可切换选项。
  {const fadeLabel=element('label','switch-row');fadeLabel.append(element('span','','谱头处淡出'));const fadeInput=document.createElement('input');fadeInput.type='checkbox';fadeInput.id='studio-headerNoteFade';fadeInput.setAttribute('role','switch');fadeLabel.append(fadeInput);header.append(fadeLabel);fadeInput.onchange=()=>run(()=>{const node=selectedNode(settings),owner=node?.layoutLink&&settings.composition.nodes.find(x=>x.id===node.layoutLink&&x.kind==='score');if(owner)owner.config.headerNoteFade=fadeInput.checked;else settings.headerNoteFade=fadeInput.checked})}
  {const symbolsLabel=element('label','switch-row');symbolsLabel.append(element('span','','随谱面移动时保留谱号、调号与拍号'));const symbolsInput=document.createElement('input');symbolsInput.type='checkbox';symbolsInput.id='studio-headerFlowSymbols';symbolsInput.setAttribute('role','switch');symbolsLabel.append(symbolsInput);header.append(symbolsLabel);symbolsInput.onchange=()=>run(()=>{const node=selectedNode(settings),owner=node?.layoutLink&&settings.composition.nodes.find(x=>x.id===node.layoutLink&&x.kind==='score');if(owner)owner.config.headerFlowSymbols=symbolsInput.checked;else settings.headerFlowSymbols=symbolsInput.checked})}
  function numberField(target,key,label,min,max,step=1,kind='config'){
    const input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;field(target,`studio-${key}`,label,input);
    input.onchange=()=>{if(!input.checkValidity()||!Number.isFinite(input.valueAsNumber)){input.reportValidity();syncAll();return}run(()=>{if(kind==='transform')selectedNode(settings).transform[key]=input.valueAsNumber/(key==='opacity'?100:1);else if(kind==='node')selectedNode(settings)[key]=input.valueAsNumber;else if(kind==='header'){const n=selectedNode(settings),owner=n?.layoutLink&&settings.composition.nodes.find(x=>x.id===n.layoutLink&&x.kind==='score');if(owner)owner.config[key]=input.valueAsNumber;else settings[key]=input.valueAsNumber}else settings[key]=input.valueAsNumber})};return input;
  }
  numberField(header,'headerOpeningGap','开头淡出空间（画面 px）',0,240,1,'header');
  numberField(header,'headerNoteFadeOffset','淡出时间偏移（秒）',-120,120,.1,'header');
  const templates=element('div','studio-actions');layout.prepend(templates);
  for(const [key,name] of [['sticky','固定谱头'],['flow','横向长卷'],['page','分段扫描'],['static','静态谱页']])templates.append(button(name,()=>run(()=>{Object.assign(settings,templateConfig(key));settings.headerExit=key==='static'?'measure':'retain'}),'text-button'));
  layout.prepend(element('p','help','以下四项是起始模板。排版、镜头、位置和图层组合均可继续修改。'));
  const customLayout=element('div','studio-field-grid');layout.append(customLayout);
  for(const [key,label,step] of [['layoutY','垂直位置（%）',.5],['cameraAmount','跟随幅度（%）',1],['pageSpan','分段宽度（%）',1],['rowGap','行距（画幅 %）',.5],['pageMargin','左右边距（%）',.5],['cameraTransition','换行过渡（秒）',.05]])numberField(customLayout,key,label,...CONFIG_LIMITS[key],step);
  for(const [id,min,max] of [['pageBars',1,12],['pageRows',1,8]]){const old=$(id),input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=1;input.id=id;input.value=settings[id];input.onchange=()=>{if(input.checkValidity())run(()=>settings[id]=input.valueAsNumber);else{input.reportValidity();syncAll()}};old.replaceWith(input)}
  for(const [key,range] of Object.entries(CONFIG_LIMITS)){const input=$(key);if(input&&['range','number'].includes(input.type)){input.min=range[0];input.max=range[1]}}
  const sliderValues=[];
  for(const input of effects.querySelectorAll('input[type="range"]')){
    const output=$(input.id+'Out');if(!output)continue;output.hidden=true;
    const value=document.createElement('input');value.type='number';value.id=input.id+'Value';value.min=input.min;value.max=input.max;value.step=input.step||1;value.value=input.value;value.setAttribute('aria-label',output.parentElement.textContent.trim().replace(/\s+[\d.]+%$/,'')+'数值');
    const unit=element('span','slider-number');unit.append(value,element('span','','%'));output.after(unit);sliderValues.push([input,value]);
    input.addEventListener('input',()=>value.value=input.value);
    value.onchange=()=>{if(!value.checkValidity()||!Number.isFinite(value.valueAsNumber)){value.reportValidity();value.value=input.value;return}input.value=value.value;input.dispatchEvent(new Event('input',{bubbles:true}));checkpoint()};
  }
  const transformGrid=element('div','studio-field-grid');transform.append(transformGrid);
  for(const args of [['x','水平位移（%）',-1000,1000,.5],['y','垂直位移（%）',-1000,1000,.5],['scaleX','水平缩放（倍）',.01,20,.05],['scaleY','垂直缩放（倍）',.01,20,.05],['rotation','旋转（度）',-7200,7200,1],['opacity','不透明度（%）',0,100,1]])numberField(transformGrid,...args,'transform');
  numberField(transform,'timeOffset','整个元素的视觉偏移（秒）',-120,120,.05,'node');
  const blend=document.createElement('select');for(const [v,n] of [['source-over','正常'],['screen','滤色'],['multiply','正片叠底'],['lighter','叠加发光']])blend.add(new Option(n,v));field(transform,'studio-blend','混合方式',blend);blend.onchange=()=>run(()=>selectedNode(settings).transform.blend=blend.value);
  transform.append(button('恢复此元素变换',()=>run(()=>{selectedNode(settings).transform=identityTransform();selectedNode(settings).timeOffset=0}),'text-button'));
  header.append(element('p','help','停靠谱头先随谱移动，再在左侧固定。可单独控制谱头边界的音符淡出；随谱面移动时可保留谱号、调号和拍号，让谱头与主体连续衔接。多行谱头可以跟随首小节消解。通过左侧拆分元素，可独立设计谱头。'));
  const unlink=button('解除排版关联',()=>run(()=>{const n=selectedNode(settings),owner=settings.composition.nodes.find(x=>x.id===n.layoutLink);if(owner)for(const key of LAYOUT_KEYS)n.config[key]=owner.config[key];n.layoutLink=null}),'text-button');unlink.id='unlinkLayout';header.append(unlink);
  numberField(light,'decayParticles','消解余烬密度（%）',0,300);move($('studio-decayParticles').closest('label'),$('decayHeading').closest('section'));
  const scanExtra=element('div','studio-field-grid');scan.append(scanExtra);
  for(const [key,label,step] of [['scanWidth','线条宽度（%）',10],['scanAngle','旋转（度）',1],['scanOffsetX','水平偏移（%）',.5],['scanOffsetY','垂直偏移（%）',.5]])numberField(scanExtra,key,label,...CONFIG_LIMITS[key],step);
  const scanColor=document.createElement('input');scanColor.type='color';field(scan,'studio-scanColor','扫描线颜色',scanColor);scanColor.oninput=()=>{settings.scanColor=scanColor.value;changed();refreshDirty()};
  const libraryOpen=button('效果库与导入…',()=>openLibrary('effect','enter'),'outline full');libraryOpen.id='openEffectLibrary';effects.append(libraryOpen);
  const status=element('p','help');status.id='studioStatus';status.setAttribute('role','status');effects.append(status);
  const choose=element('div','studio-actions');choose.append(button('从效果库选择入场',()=>openLibrary('effect','enter'),'text-button'),button('从效果库选择出场',()=>openLibrary('effect','exit'),'text-button'));animation.querySelector('#effectHint').before(choose);

  const tree=element('section','composition-tree');tree.innerHTML='<div class="section-heading"><h2>画面元素</h2><span id="nodeCount" class="quiet"></span></div><button id="selectCanvas" class="canvas-pick">画布与背景设置</button><div class="tree-tools"><button id="splitElements" class="outline">拆分全部元素</button><button id="multiSelect" class="text-button" aria-pressed="false">选择多个</button></div><p class="help" id="treeHint">选中元素后，右侧只显示适用设置。</p><div id="nodeList" role="list" aria-label="画面元素"></div><div id="multiActions" class="studio-actions" hidden><span id="selectionCount" role="status"></span><button id="groupSelected" class="outline">合为一组</button></div><div id="nodeActions" class="studio-actions"><button id="duplicateNode" class="text-button">复制</button><button id="ungroupNode" class="text-button">解除组合</button><button id="deleteNode" class="text-button">删除</button><button id="moveNodeUp" class="text-button">上移</button><button id="moveNodeDown" class="text-button">下移</button></div><div class="studio-actions"><button id="addScoreLayer" class="text-button">添加完整谱面</button></div><label class="field" id="nodeNameField"><span>元素名称 · 双击列表名称也可修改</span><input id="nodeName" type="text" maxlength="80"></label>';
  const scoreInfo=document.querySelector('.score-info');scoreInfo.before(tree);const infoDisclosure=element('details','score-insights');infoDisclosure.append(element('summary','','乐谱信息'));scoreInfo.before(infoDisclosure);infoDisclosure.append(scoreInfo);scoreInfo.querySelector('h2').hidden=true;document.querySelector('.workflow-note').hidden=true;
  const scope=element('div','selection-scope');scope.id='selectionScope';banner.after(scope);
  const linkNotice=element('div','layout-link-notice');linkNotice.id='layoutLinkNotice';linkNotice.append(element('p','help'),button('编辑关联排版',()=>{const owner=settings.composition.nodes.find(n=>n.id===selectedNode(settings).layoutLink);if(owner){pickNode(owner);layout.open=true}} ,'text-button'),unlink);scope.after(linkNotice);
  const titleColor=document.createElement('input');titleColor.type='color';field(canvasStyle,'titleColor','标题颜色',titleColor);titleColor.oninput=()=>{settings.titleColor=titleColor.value;changed();refreshDirty()};
  function pickNode(node){canvasMode=false;selectNode(settings,node.id);const p=node.parts;effectEditor.selectTarget(node.kind!=='score'?'group':p.notes||p.beams||p.effects?'note':p.staff?'score':p.marks?'mark':'group');syncAll();$('nodeList').querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'})}
  $('selectCanvas').onclick=()=>{canvasMode=true;syncAll();canvasStyle.open=true};
  $('multiSelect').onclick=()=>{multiSelect=!multiSelect;if(!multiSelect)checks.clear();syncTree()};
  $('splitElements').onclick=()=>run(()=>{splitElements(settings);canvasMode=false;collapsed.delete(settings.composition.activeId);effectEditor.selectTarget('group');report('已拆分全部元素，并保留原组合效果。选中组统一调整，展开后可编辑每个元素。')});
  $('nodeName').onchange=()=>run(()=>{const value=$('nodeName').value.trim();if(!value)throw Error('名称不能为空');selectedNode(settings).name=value;selectedNode(settings).userNamed=true});
  $('groupSelected').onclick=()=>run(()=>{const group=groupNodes(settings,[...checks]);checks.clear();multiSelect=false;canvasMode=false;collapsed.delete(group.id);effectEditor.selectTarget('group')});
  $('duplicateNode').onclick=()=>run(()=>{
    const scene=settings.composition,selected=selectedNode(settings);if(['background','title'].includes(selected.kind))throw Error('背景与标题只保留一个，可调整或隐藏');
    const ids=new Set([selected.id]);let size;do{size=ids.size;for(const n of scene.nodes)if(ids.has(n.parent))ids.add(n.id)}while(size!==ids.size);
    const originals=scene.nodes.filter(n=>ids.has(n.id));if(originals.some(n=>['background','title'].includes(n.kind)))throw Error('此组包含背景或标题，请先将其移出再复制');
    if(scene.nodes.length+originals.length>MAX_NODES||scene.nodes.filter(n=>n.kind==='score').length+originals.filter(n=>n.kind==='score').length>MAX_LAYERS)throw Error('元素数量已达上限');
    const mapping=new Map(originals.map(n=>[n.id,nodeId()])),copies=originals.map(n=>{const copy=clone(n);copy.id=mapping.get(n.id);copy.parent=mapping.get(n.parent)||n.parent;if(copy.layoutLink)copy.layoutLink=mapping.get(copy.layoutLink)||copy.layoutLink;return copy});
    const first=copies.find(n=>n.id===mapping.get(selected.id));first.name+=' 副本';first.transform.x=Math.min(1000,first.transform.x+3);scene.nodes.splice(scene.nodes.indexOf(originals.at(-1))+1,0,...copies);pickNode(first);
  });
  $('addScoreLayer').onclick=()=>run(()=>{const scene=settings.composition;if(scene.nodes.filter(n=>n.kind==='score').length>=MAX_LAYERS||scene.nodes.length>=MAX_NODES)throw Error('元素数量已达上限');const n=makeLayer(defaults,'新谱面');const title=scene.nodes.findIndex(x=>x.kind==='title'&&x.parent===null);scene.nodes.splice(title<0?scene.nodes.length:title,0,n);pickNode(n)});
  $('ungroupNode').onclick=()=>run(()=>{const scene=settings.composition,n=selectedNode(settings);if(n.kind!=='group')throw Error('请选择一个组');const children=scene.nodes.filter(x=>x.parent===n.id);if(!children.length)throw Error('组内没有元素');for(const c of children)c.parent=n.parent;scene.nodes=scene.nodes.filter(x=>x!==n);pickNode(children[0]);report('已解组，组级变换和动画已移除；可撤销恢复。')});
  $('deleteNode').onclick=()=>run(()=>{
    const scene=settings.composition,ids=new Set([scene.activeId]);let length;do{length=ids.size;for(const n of scene.nodes)if(ids.has(n.parent))ids.add(n.id)}while(ids.size!==length);
    if(scene.nodes.some(n=>ids.has(n.id)&&['background','title'].includes(n.kind)))throw Error('背景与标题可隐藏，请先移出组合再删除其他元素');
    if(!scene.nodes.some(n=>n.kind==='score'&&!ids.has(n.id)))throw Error('至少保留一个谱面元素');
    for(const n of scene.nodes)if(n.layoutLink&&ids.has(n.layoutLink)){const owner=scene.nodes.find(x=>x.id===n.layoutLink);for(const k of LAYOUT_KEYS)n.config[k]=owner.config[k];n.layoutLink=null}
    scene.nodes=scene.nodes.filter(n=>!ids.has(n.id));selectNode(settings,scene.nodes.find(n=>n.kind==='score').id);checks.clear();
  });
  for(const [id,delta] of [['moveNodeUp',-1],['moveNodeDown',1]])$(id).onclick=()=>run(()=>{const scene=settings.composition,n=selectedNode(settings),siblings=scene.nodes.filter(x=>x.parent===n.parent),other=siblings[siblings.indexOf(n)+delta];if(!other)return;const a=scene.nodes.indexOf(n),b=scene.nodes.indexOf(other);[scene.nodes[a],scene.nodes[b]]=[scene.nodes[b],scene.nodes[a]]});

  const library=element('dialog','effect-library-dialog');library.id='effectLibrary';library.innerHTML='<div class="dialog-heading"><h2 id="libraryTitle">效果库</h2><button id="closeLibrary" class="icon-button" aria-label="关闭效果库">×</button></div><p id="libraryScope" class="help"></p><div class="studio-actions"><button id="importPresetPack" class="outline">导入预设包</button><button id="legacyJSON" class="text-button">动画 JSON</button></div><p id="libraryStatus" class="help" role="status"></p><div id="libraryItems" class="library-items"></div><div class="dialog-actions"><button id="applyLibrary" class="primary" disabled>应用</button></div><input id="presetPackFile" type="file" accept=".liupu-preset,.json" hidden>';
  document.body.append(library);
  library.setAttribute('aria-labelledby','libraryTitle');$('closeLibrary').innerHTML='<svg aria-hidden="true"><use href="#i-close"/></svg>';
  function libraryScope(){
    $('libraryScope').dataset.userContent='';
    $('libraryScope').textContent=t(libraryKind==='preset'?'应用整个视觉方案，保留当前乐谱、音频、画幅与导出设置。':`仅应用到「${displayName(selectedNode(settings))}」的${t($('effectTarget').selectedOptions[0].textContent)} · ${libraryPhase==='enter'?'入场':'出场'}阶段。其他阶段与对象保持。`);
  }
  function drawLibrary(){
    librarySelection=null;libraryScope();$('applyLibrary').disabled=true;
    const list=$('libraryItems');list.replaceChildren();
    const items=libraryKind==='preset'?[...builtins,...saved]:[...effectPresets.map(([id,name])=>({id,name})),...importedEffects.filter(e=>e.phase===libraryPhase)];
    for(const item of items){const entry=element('div','library-entry');const b=button('',()=>{librarySelection=item;for(const button of list.querySelectorAll('.library-item'))button.setAttribute('aria-pressed',String(button===b));$('applyLibrary').disabled=false;$('libraryStatus').textContent=item.message||''},'library-item');b.setAttribute('aria-pressed','false');
      if(libraryKind==='preset'){const preview=getThumbnail?.(item);if(preview)b.append(preview);const name=element('b','',item.name);if(saved.includes(item))name.dataset.userContent='';b.append(name,element('small','',saved.includes(item)?'我的完整预设':'内置完整预设'))}
      else {const name=element('b','',item.program?item.name:item.name.replace(' / 淡出',libraryPhase==='exit'?'':'').replace('淡入',libraryPhase==='exit'?'淡出':'淡入'));if(item.program)name.dataset.userContent='';b.append(name,element('small','',item.program?'已保存动画':item.id==='classic'?'最初的效果 · 长卷边缘聚散':'内置 · 实时可用'))}
      entry.append(b);
      if(libraryKind==='preset'&&saved.includes(item)){
        const remove=button('删除',async()=>{
          if(locked())return;
          remove.disabled=true;
          try{await updateSaved(current=>current.filter(p=>p!==item));drawLibrary();$('libraryStatus').textContent='已删除预设，当前画面不变。';$('libraryStatus').dataset.error='false'}
          catch(error){$('libraryStatus').textContent=error.message;$('libraryStatus').dataset.error='true';remove.disabled=false}
        },'text-button library-delete');
        remove.setAttribute('aria-label',`删除预设 ${item.name}`);entry.append(remove);
      }
      list.append(entry);
    }
  }
  function openLibrary(kind,phase='enter'){
    if(locked())return;libraryKind=kind;libraryPhase=phase;librarySelection=null;$('applyLibrary').disabled=true;
    $('libraryTitle').textContent=kind==='preset'?'完整效果预设':`${phase==='enter'?'入场':'出场'}效果库`;
    $('libraryScope').textContent=kind==='preset'?'应用整个视觉方案，保留当前乐谱、音频、画幅与导出设置。':`应用到「${selectedNode(settings).name}」的${$('effectTarget').selectedOptions[0].textContent}。其他阶段与对象保持。`;
    $('libraryStatus').textContent='';drawLibrary();library.showModal();
  }
  $('closeLibrary').onclick=()=>library.close();$('browsePresets').onclick=()=>openLibrary('preset');
  $('applyLibrary').onclick=()=>{if(!librarySelection||locked())return;run(()=>{if(libraryKind==='preset'){applyVisualPreset(settings,librarySelection);applied=librarySelection.name;appliedCustom=saved.includes(librarySelection);savedFingerprint=presetFingerprint(settings);checks.clear();effectEditor.reset()}else{const phase=librarySelection.program?librarySelection.program[libraryPhase]:presetPhase(librarySelection.id,libraryPhase);effectEditor.applyPhase(clone(phase),libraryPhase)}library.close()})};
  $('importPresetPack').onclick=()=>$('presetPackFile').click();
  $('presetPackFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>2_000_000)throw Error('预设包最多 2 MB');const p=parsePreset(await file.text(),defaults);if(locked())return;await updateSaved(current=>[...current.filter(x=>x.name!==p.name),p]);libraryKind='preset';librarySelection=null;drawLibrary();$('libraryTitle').textContent='完整效果预设';$('libraryScope').dataset.userContent='';$('libraryScope').textContent=t('已读取完整方案，请选择后应用。');$('libraryStatus').textContent='预设已导入。'}catch(error){$('libraryStatus').textContent=error.message}};
  $('legacyJSON').onclick=()=>{library.close();animation.open=true;animation.querySelector('.json-editor').open=true;$('importMotion').click()};
  $('saveVisual').onclick=()=>{$('saveVisualForm').hidden=!$('saveVisualForm').hidden;$('visualName').value=applied==='自定义组合'?'我的效果':applied;$('visualName').focus()};
  const namedPreset=()=>{const name=$('visualName').value.trim();if(!name)throw Error('请填写预设名称');return parsePreset(JSON.stringify(makePreset(settings,name)),defaults)};
  $('confirmVisualSave').onclick=async()=>{if(locked())return;$('confirmVisualSave').disabled=true;try{const p=namedPreset();await updateSaved(current=>[...current.filter(x=>x.name!==p.name),p]);applied=p.name;appliedCustom=true;savedFingerprint=presetFingerprint(p);$('saveVisualForm').hidden=true;report('完整预设已保存到本机。');refreshDirty()}catch(e){report(`保存失败：${e.message}`,true)}finally{$('confirmVisualSave').disabled=false}};
  $('exportVisual').onclick=()=>{try{const name=applied==='自定义组合'?'我的效果':applied;const p=parsePreset(JSON.stringify(makePreset(settings,name)),defaults);download(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),p.name.replace(/[\\/:*?"<>|]/g,'_')+'.liupu-preset');report('已导出当前完整预设包。')}catch(e){report(e.message,true)}};
  $('undoVisual').onclick=()=>{if(locked()||!history.length)return;future.push(makePreset(settings,applied));restore(history.pop())};
  $('redoVisual').onclick=()=>{if(locked()||!future.length)return;history.push(makePreset(settings,applied));restore(future.pop())};

  function syncTree(){
    const scene=settings.composition,list=$('nodeList'),focus=document.activeElement,focusedRow=focus?.closest('.composition-node'),focusId=focusedRow?.dataset.nodeId,focusAction=focus?.dataset.action;list.replaceChildren();
    const symbols={group:'M3 7h7l2 2h9v11H3ZM3 7V4h7l2 3',background:'M3 4h18v16H3ZM3 17l6-7 4 4 3-3 5 6',title:'M4 5h16M12 5v15M8 20h8',notes:'M10 17V5l10-2v12M10 17c0 3-6 4-6 1s6-4 6-1M20 15c0 3-6 4-6 1s6-4 6-1',beams:'M5 18V7l14-3v11M5 10l14-3',staff:'M3 5h18M3 9h18M3 13h18M3 17h18M3 21h18',marks:'M5 19V6h7M5 12h6M14 20l4-12 3 12',header:'M6 3v18M10 6h10M10 12h10M10 18h10',cursor:'M12 2v20M7 5l5-3 5 3',effects:'m12 2 2 7 7 3-7 2-2 8-2-8-7-2 7-3Z',score:'M4 3h16v18H4ZM7 8h10M7 12h10M7 16h7'};
    const toggleCheck=node=>{if(checks.has(node.id))checks.delete(node.id);else checks.add(node.id);syncTree()};
    const visit=(parent,depth)=>{for(const node of scene.nodes.filter(n=>n.parent===parent)){
      const row=element('div','composition-node');row.style.setProperty('--depth',depth);row.setAttribute('role','listitem');row.dataset.active=String(!canvasMode&&node.id===scene.activeId);row.dataset.checked=String(checks.has(node.id));row.dataset.muted=String(!node.enabled);row.dataset.nodeId=node.id;
      const fold=button('',()=>{if(collapsed.has(node.id))collapsed.delete(node.id);else collapsed.add(node.id);syncTree()},'node-fold');fold.innerHTML=icon(collapsed.has(node.id)?'m9 5 7 7-7 7':'m5 9 7 7 7-7');fold.dataset.action='fold';fold.hidden=node.kind!=='group';fold.setAttribute('aria-label',`${collapsed.has(node.id)?'展开':'折叠'} ${node.name}`);fold.setAttribute('aria-expanded',String(!collapsed.has(node.id)));
      const check=document.createElement('input');check.type='checkbox';check.hidden=!multiSelect;check.checked=checks.has(node.id);check.setAttribute('aria-label',`选择 ${node.name}`);check.onchange=()=>toggleCheck(node);
      const type=nodeType(node),symbol=element('span','node-type-icon');symbol.innerHTML=icon(symbols[nodeParts(node).length===1?nodeParts(node)[0]:node.kind]||symbols.score);
      const pick=button('',()=>multiSelect?toggleCheck(node):pickNode(node),'node-pick');pick.dataset.name=node.name;pick.setAttribute('aria-label',`编辑 ${node.name}`);pick.setAttribute('aria-pressed',String(!canvasMode&&node.id===scene.activeId));pick.title=type;
      const name=element('span','',node.name);if(isUserName(node))name.dataset.userContent='';pick.append(name);const detail=node.kind==='group'?`${scene.nodes.filter(n=>n.parent===node.id).length} 个子元素`:node.layoutLink?'关联排版':node.name!==type?type:'';if(detail)pick.append(element('small','',detail));
      pick.ondblclick=()=>{if(!multiSelect){pickNode(node);$('nodeName').focus();$('nodeName').select()}};
      const visible=button('',()=>run(()=>node.enabled=!node.enabled),'node-visible');visible.innerHTML=icon(node.enabled?'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0':'m3 3 18 18M2 12s4-7 10-7c2 0 4 1 6 3M22 12s-4 7-10 7c-3 0-6-2-8-5');visible.setAttribute('aria-label',`${node.enabled?'隐藏':'显示'} ${node.name}`);visible.title=node.enabled?'隐藏元素':'显示元素';
      const nameForLabel=displayName(node);
      for(const [control,label] of [[fold,collapsed.has(node.id)?'展开':'折叠'],[check,'选择'],[pick,'编辑'],[visible,node.enabled?'隐藏':'显示']]){
        control.dataset.userAttributes='';control.setAttribute('aria-label',t(label)+' '+nameForLabel);if(control.title)control.title=t(control.title);
      }
      check.dataset.action='check';pick.dataset.action='pick';visible.dataset.action='visible';row.append(check,fold,symbol,pick,visible);list.append(row);if(node.kind==='group'&&!collapsed.has(node.id))visit(node.id,depth+1);
    }};visit(null,0);$('nodeCount').textContent=`${scene.nodes.length} 项`;
    const n=selectedNode(settings),siblings=scene.nodes.filter(x=>x.parent===n.parent),selected=scene.nodes.filter(x=>checks.has(x.id));
    $('multiSelect').textContent=multiSelect?'完成多选':'选择多个';$('multiSelect').setAttribute('aria-pressed',String(multiSelect));$('multiActions').hidden=!multiSelect;$('selectionCount').textContent=`已选 ${selected.length} 项`;$('nodeActions').hidden=multiSelect||canvasMode;$('nodeNameField').hidden=multiSelect||canvasMode;
    const groupSiblings=scene.nodes.filter(x=>x.parent===selected[0]?.parent),positions=selected.map(x=>groupSiblings.indexOf(x));$('groupSelected').disabled=selected.length<2||selected.some(x=>x.parent!==selected[0].parent)||Math.max(...positions)-Math.min(...positions)+1!==selected.length;
    $('treeHint').textContent=multiSelect?'选择相邻的同级元素，再点击「合为一组」。':'选中元素后，右侧只显示适用设置。';
    $('splitElements').hidden=canvasMode||multiSelect||nodeParts(n).length<2;$('ungroupNode').hidden=n.kind!=='group';$('duplicateNode').hidden=['background','title'].includes(n.kind);$('deleteNode').hidden=['background','title'].includes(n.kind);
    $('moveNodeUp').disabled=siblings.indexOf(n)===0;$('moveNodeDown').disabled=siblings.indexOf(n)===siblings.length-1;$('selectCanvas').setAttribute('aria-pressed',String(canvasMode));
    if(focusId){const row=[...list.children].find(r=>r.dataset.nodeId===focusId)||[...list.children].find(r=>r.dataset.active==='true');row?.querySelector(`[data-action="${focusAction||'pick'}"]`)?.focus({preventScroll:true})}
  }
  const hideField=(id,hidden)=>{const input=$(id);if(input)(input.closest('.slider-field,.field,.palette-field,.switch-row')||input).hidden=hidden};
  function syncContext(){
    const n=selectedNode(settings);if(!n)return;const p=n.parts||{},score=n.kind==='score'&&!canvasMode,config=n.kind==='score'?resolveLayerConfig(n,settings.composition):settings,rows=config.layout==='rows',linked=score&&!!n.layoutLink;
    const note=score&&(p.notes||p.beams||p.effects),staff=score&&(p.staff||p.header&&rows&&settings.headerExit==='measure'),marks=score&&p.marks,structure=staff||marks;
    $('selectionScope').dataset.userContent='';
    $('selectionScope').textContent=canvasMode?t('正在编辑：全局画布'):t('正在编辑：')+' '+displayName(n)+(n.name!==nodeType(n)?' · '+t(nodeType(n)):'');
    layout.hidden=!score||linked;transform.hidden=animation.hidden=libraryOpen.hidden=canvasMode;
    header.hidden=!score||!p.header;scan.hidden=!score||!p.cursor;light.hidden=!score||!p.effects;
    style.hidden=!score||!p.notes&&!p.beams&&!p.staff&&!p.marks&&!p.header;
    canvasStyle.hidden=!canvasMode&&!['background','title'].includes(n.kind);
    const background=canvasMode||n.kind==='background',title=canvasMode||n.kind==='title';
    for(const id of ['aspect','theme'])hideField(id,!canvasMode);
    for(const id of ['backgroundColor','backgroundDim'])hideField(id,!background);
    document.querySelector('.background-actions').hidden=$('backgroundName').hidden=!background;
    for(const id of ['showTitle','titleInput','titleColor'])hideField(id,!title);
    for(const key of ['note','staff','beam','mark']){
      const visible=score&&(key==='note'?p.notes:key==='staff'?p.staff||p.header&&rows:key==='beam'?p.beams:p.marks||p.header);
      const group=$(`${key}Color`).closest('.component-control');if(group)group.hidden=!visible;else{hideField(`${key}Color`,!visible);hideField(`${key}Opacity`,!visible)}
    }
    const components=$('componentControls').closest('details');components.hidden=!score||!p.staff&&!p.beams&&!p.marks&&!p.header;
    components.querySelector('summary').textContent='元素颜色与透明度';$('overlayImport').closest('details').hidden=!score||!p.marks;
    linkNotice.hidden=!linked;if(linked){const owner=settings.composition.nodes.find(x=>x.id===n.layoutLink),text=linkNotice.querySelector('p');text.dataset.userContent='';text.textContent=t(`排版与镜头跟随「${owner?displayName(owner):t('关联元素')}」。`)}
    for(const control of layout.querySelectorAll('input,select,button'))control.disabled=linked;
    hideField('studio-headerMode',false);$('studio-headerMode').disabled=false;$('studio-headerMode').value=config.headerMode;
    for(const option of $('studio-headerMode').options)option.hidden=option.disabled=rows?['flow','dock'].includes(option.value):option.value==='row';
    const whole=n.kind!=='score'||!note&&!structure;
    for(const option of $('effectTarget').options){option.hidden=option.disabled=option.value==='note'?!note:option.value==='score'?!staff:option.value==='mark'?!marks:!whole;if(option.value==='group')option.textContent=n.kind==='group'?'整个组合':'入场与出场特效';else if(option.value==='note')option.textContent=`${p.notes&&p.beams?'音符与符杠':p.notes?'音符':p.beams?'符杠':'演奏光效'} · 按音符`;else option.textContent=`${option.value==='mark'?'记谱标记':p.staff?'五线谱线':'行首谱头'} · 按小节`}
    if($('effectTarget').selectedOptions[0]?.disabled)effectEditor.selectTarget(note?'note':staff?'score':marks?'mark':'group');
    hideField('effectTarget',[...$('effectTarget').options].filter(o=>!o.hidden).length===1);
    $('decayHeading').closest('section').hidden=!structure||!['score','mark'].includes($('effectTarget').value);
    $('studio-decayParticles').closest('label').hidden=$('effectTarget').value==='mark'||!['burn','dissolve'].includes(settings.pageDecay)||!p.staff&&!p.header;
    $('scanlineControls').hidden=scanExtra.hidden=!settings.showLine;hideField('studio-scanColor',!settings.showLine);
    $('staticControls').hidden=!rows;hideField('studio-pageSpan',config.camera!=='page'||rows);hideField('studio-rowGap',!rows);hideField('studio-cameraTransition',!rows||config.camera!=='follow');
    hideField('studio-headerExit',!rows);$('studio-headerNoteFade').checked=config.headerNoteFade!==false;$('studio-headerNoteFade').closest('.switch-row').hidden=config.headerMode!=='dock'||rows;$('studio-headerFlowSymbols').checked=config.headerFlowSymbols!==false;$('studio-headerFlowSymbols').closest('.switch-row').hidden=config.headerMode!=='flow'||rows;$('studio-headerOpeningGap').value=config.headerOpeningGap??64;hideField('studio-headerOpeningGap',config.headerMode!=='dock'||rows);$('studio-headerNoteFadeOffset').value=config.headerNoteFadeOffset??0;hideField('studio-headerNoteFadeOffset',config.headerMode!=='dock'||rows||config.headerNoteFade===false);hideField('studio-cameraAmount',config.camera!=='follow');hideField('studio-pageMargin',!rows);$('trailField').hidden=rows;
    $('staticZoomHint').textContent='100% 为完整适配，可放大至 1000% 并调整位置。';
    for(const [input,value] of sliderValues)value.value=input.value;
  }
  function syncAll(){
    syncStyle();const n=selectedNode(settings);if(!n)return;$('nodeName').value=displayName(n);
    for(const key of Object.keys(choices))$(`studio-${key}`).value=settings[key];
    for(const key of ['layoutY','cameraAmount','pageSpan','rowGap','pageMargin','cameraTransition','decayParticles','scanWidth','scanAngle','scanOffsetX','scanOffsetY','scanColor'])$(`studio-${key}`).value=settings[key];
    for(const key of ['x','y','scaleX','scaleY','rotation','opacity'])$(`studio-${key}`).value=n.transform[key]*(key==='opacity'?100:1);
    $('studio-timeOffset').value=n.timeOffset;$('studio-blend').value=n.transform.blend;
    $('titleColor').value=settings.titleColor;syncContext();syncTree();refreshDirty();
  }
  $('effectTarget').addEventListener('change',syncContext);
  document.querySelector('.inspector').addEventListener('change',()=>{checkpoint();syncContext()});
  document.querySelector('.inspector').addEventListener('input',()=>refreshDirty());
  document.addEventListener('localechange',()=>{syncContext();syncTree();refreshDirty();if(document.activeElement!==$('nodeName'))$('nodeName').value=displayName(selectedNode(settings));if(library.open)drawLibrary()});
  syncAll();report(libraryError?'预设库未能读取，可继续设计并导出预设包。':'选择预设开始创作；拆分全部元素后，可逐项设计或合为一组。',Boolean(libraryError));
  return {sync:syncAll,syncContext,refreshDirty,reset(){canvasMode=false;restore(builtins[0]);savedFingerprint=presetFingerprint(settings)},openLibrary};
}
