import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';
import { VstBridge } from '../vst-bridge.mjs';
import { visualStorage } from './visual-storage.mjs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { DEFAULT_PREFERENCES, parsePreferences } from '../src/preferences.mjs';
import { translate } from '../src/i18n.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
app.setName('流谱 Studio');
app.setAppUserModelId('studio.liupu.desktop');
// A separate profile also lets the packaged executable be tested without touching user data.
const profile=app.commandLine.getSwitchValue('user-data-dir');
if(profile)app.setPath('userData',path.resolve(profile));
let window,service,quitting=false;
let preferences={...DEFAULT_PREFERENCES};
const t=text=>translate(text,preferences.language);
const localizedOptions=options=>Object.fromEntries(Object.entries(options).map(([key,value])=>[key,typeof value==='string'?value.split('\n').map(t).join('\n'):value]));
const showMessageBox=(window,options)=>dialog.showMessageBox(window,localizedOptions(options));
if(!app.requestSingleInstanceLock()){
  app.quit();
}else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus()}});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{
    if(service&&!quitting){event.preventDefault();quitting=true;void service.close().finally(()=>app.quit())}
  });
  process.on('exit',()=>{void service?.close()});
  // Electron waits for ESM evaluation before emitting ready: do not await it at module scope.
  app.whenReady().then(async()=>{try{
    const preferenceFile=path.join(app.getPath('userData'),'ui-preferences.json');
    let preferenceError;
    try{preferences=parsePreferences(JSON.parse(await readFile(preferenceFile,'utf8')))}
    catch(error){if(error.code!=='ENOENT')preferenceError=error}
    Menu.setApplicationMenu(null);
    service=await startServer({
      root:app.isPackaged?path.join(process.resourcesPath,'web'):path.join(project,'dist'),
      port:0,
      vst:new VstBridge(app.isPackaged?path.join(process.resourcesPath,'native','LiupuVSTHost.exe'):path.join(project,'native','bin','LiupuVSTHost.exe'))
    });
    window=new BrowserWindow({
      width:1440,height:960,minWidth:960,minHeight:640,show:false,
      title:'流谱 Studio',backgroundColor:'#101415',
      titleBarStyle:'hidden',titleBarOverlay:{color:'#1c1c1c',symbolColor:'#efefeb',height:62},
      icon:path.join(project,'desktop','icon.ico'),
      webPreferences:{preload:path.join(project,'desktop','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}
    });
    window.webContents.setWindowOpenHandler(({url})=>{
      if(url==='https://space.bilibili.com/24340298'){
        void shell.openExternal(url).catch(error=>showMessageBox(window,{
          type:'error',message:'无法打开制作者主页',detail:`请手动在浏览器中打开 ${url}\n${error.message}`
        }));
      }
      return {action:'deny'};
    });
    window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==service.url)event.preventDefault()});
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.webContents.session.setPermissionCheckHandler(()=>false);
    window.webContents.session.on('will-download',(_event,item)=>{
      item.setSaveDialogOptions({title:t('保存导出文件'),defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});
      item.once('done',(_event,state)=>{
        if(state==='interrupted')void showMessageBox(window,{type:'error',message:'文件未能保存',detail:'请检查目标文件夹的写入权限与剩余空间，然后重新导出。'});
      });
    });
    const helpRoot=app.isPackaged?path.join(process.resourcesPath,'documentation'):project;
    const helpMenu=()=>Menu.buildFromTemplate([
        {label:'使用说明',click:()=>shell.openPath(path.join(helpRoot,'README.md'))},
        {label:'开源许可与对应源码',click:()=>shell.openPath(app.isPackaged?path.join(process.resourcesPath,'licenses'):path.join(project,'.desktop-build','licenses'))},
        {label:'关于流谱 Studio',click:()=>showMessageBox(window,{type:'info',title:'关于流谱 Studio',message:`流谱 Studio ${app.getVersion()}`,detail:'MusicXML 乐谱影像工作台\n内置 Salamander Grand Piano · Windows x64 VST3 宿主\n素材在本机处理。'})},
        {type:'separator'},{label:'全屏 / 退出全屏',accelerator:'F11',click:()=>window.setFullScreen(!window.isFullScreen())},
        {label:'放大界面',role:'zoomIn'},{label:'缩小界面',role:'zoomOut'},{label:'实际大小',role:'resetZoom'}
    ].map(item=>({...item,...item.label?{label:t(item.label)}:{}})));
    ipcMain.on('desktop:help',event=>{
      if(event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&new URL(event.senderFrame.url).origin===service.url)helpMenu().popup({window});
    });
    const libraryStore=visualStorage(path.join(app.getPath('userData'),'visual-library'));
    const trusted=event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&new URL(event.senderFrame.url).origin===service.url;
    ipcMain.handle('desktop:read-preferences',event=>trusted(event)?{...preferences,...preferenceError?{error:t('界面设置读取失败，请重新选择并保存。')}:{}}:{error:t('无效来源')});
    let preferenceQueue=Promise.resolve();
    ipcMain.handle('desktop:write-preferences',(event,value)=>{
      if(!trusted(event))return {error:t('无效来源')};
      const save=async()=>{
        try{
          const next=parsePreferences(value);
          await writeFile(preferenceFile+'.tmp',JSON.stringify(next),'utf8');
          await rename(preferenceFile+'.tmp',preferenceFile);
          preferences=next;preferenceError=null;
          window.setTitleBarOverlay({color:'#1c1c1c',symbolColor:'#efefeb'});
          return {ok:true};
        }catch(error){return {error:t('界面设置保存失败')+': '+t(error.message)}}
      };
      const result=preferenceQueue.then(save);preferenceQueue=result.catch(()=>{});return result;
    });
    ipcMain.handle('desktop:read-visual-library',event=>trusted(event)?libraryStore.read():{});
    ipcMain.handle('desktop:write-visual-library',async(event,key,text)=>{
      if(!trusted(event))return {error:'无效来源'};try{await libraryStore.write(key,text);return {ok:true}}catch(e){return {error:e.message}}
    });
    window.on('enter-full-screen',()=>window.webContents.send('desktop:fullscreen',true));
    window.on('leave-full-screen',()=>window.webContents.send('desktop:fullscreen',false));
    window.webContents.on('before-input-event',(event,input)=>{
      if(input.type!=='keyDown'||input.isAutoRepeat)return;
      if(input.key==='F11'){event.preventDefault();window.setFullScreen(!window.isFullScreen())}
      if(input.key==='F1'){event.preventDefault();helpMenu().popup({window})}
      if(input.control&&!input.alt&&['+','=','-','0'].includes(input.key)){
        event.preventDefault();const zoom=window.webContents.getZoomFactor();
        window.webContents.setZoomFactor(input.key==='0'?1:Math.max(.75,Math.min(1.5,zoom*(input.key==='-'?1/1.1:1.1))));
      }
    });
    window.once('ready-to-show',()=>window.show());
    window.webContents.on('render-process-gone',(_event,details)=>{
      if(!quitting)void showMessageBox(window,{type:'error',message:'工作台意外停止',detail:`请关闭并重新打开程序。原因：${details.reason}`});
    });
    await window.loadURL(service.url);
    if(!window.isVisible())window.show();
  }catch(error){
    dialog.showErrorBox(t('流谱 Studio 启动失败'),t(error.message||String(error)));
    app.quit();
  }});
}
