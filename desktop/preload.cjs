const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('liupuDesktop',{
  readVisualLibrary:()=>ipcRenderer.invoke('desktop:read-visual-library'),
  writeVisualLibrary:(key,text)=>ipcRenderer.invoke('desktop:write-visual-library',key,text),
  openHelp:()=>ipcRenderer.send('desktop:help'),
  readPreferences:()=>ipcRenderer.invoke('desktop:read-preferences'),
  writePreferences:value=>ipcRenderer.invoke('desktop:write-preferences',value),
  onFullscreen:callback=>{
    if(typeof callback!=='function')return;
    const listener=(_event,value)=>callback(Boolean(value));
    ipcRenderer.on('desktop:fullscreen',listener);
    return ()=>ipcRenderer.removeListener('desktop:fullscreen',listener);
  }
});
