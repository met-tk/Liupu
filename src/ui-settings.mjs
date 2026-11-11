import { DEFAULT_PREFERENCES, parsePreferences } from './preferences.mjs';
import { observeLocalization, localizeDocument, translate } from './i18n.mjs';

const STORAGE='liupu.ui-preferences.v1';
export async function bindPreferences(){
  const $=id=>document.getElementById(id);
  let preferences={...DEFAULT_PREFERENCES},sequence=0;
  const report=message=>{$('preferencesStatus').textContent=message;$('preferencesStatus').dataset.error='true'};
  try{
    const stored=window.liupuDesktop?await window.liupuDesktop.readPreferences():JSON.parse(localStorage.getItem(STORAGE)||'null');
    if(stored?.error)throw Error(stored.error);
    if(stored)preferences=parsePreferences(stored);
  }catch(error){report('界面设置读取失败，请重新选择并保存。');console.error(error)}
  let committed={...preferences};
  const apply=()=>{
    document.documentElement.dataset.uiTheme=preferences.theme;
    $('uiLanguage').value=preferences.language;$('uiTheme').value=preferences.theme;
    localizeDocument(preferences.language);
    window.dispatchEvent(new Event('uithemechange'));
  };
  observeLocalization(()=>preferences.language);apply();
  const dialog=$('appSettingsDialog');
  $('appSettings').onclick=()=>dialog.showModal();
  $('closeAppSettings').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>$('appSettings').focus());
  async function save(){
    const request=++sequence;
    preferences=parsePreferences({language:$('uiLanguage').value,theme:$('uiTheme').value});apply();
    const next={...preferences};
    $('preferencesStatus').textContent='正在保存…';$('preferencesStatus').dataset.error='false';
    try{
      if(window.liupuDesktop){const result=await window.liupuDesktop.writePreferences(next);if(result.error)throw Error(result.error)}
      else localStorage.setItem(STORAGE,JSON.stringify(next));
      committed=next;
      if(request===sequence)$('preferencesStatus').textContent='已保存';
    }catch(error){
      if(request===sequence){preferences={...committed};apply();report(translate('界面设置保存失败',preferences.language)+': '+error.message)}
    }
  }
  $('uiLanguage').onchange=save;$('uiTheme').onchange=save;
}
