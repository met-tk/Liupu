const desktop=window.liupuDesktop;
if(desktop){
  document.documentElement.classList.add('desktop-app');
  const help=document.getElementById('desktopHelp');
  help.hidden=false;help.onclick=()=>desktop.openHelp();
  desktop.onFullscreen(value=>document.documentElement.classList.toggle('window-fullscreen',value));
}
