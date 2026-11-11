export const DEFAULT_PREFERENCES={language:'zh',theme:'mono'};
export const UI_THEMES=['mono','coral','sage','blue'];
export const LANGUAGES=['zh','ja','en'];
export function parsePreferences(value){
  if(!value||typeof value!=='object'||!LANGUAGES.includes(value.language)||!UI_THEMES.includes(value.theme))throw Error('无效的界面设置');
  return {language:value.language,theme:value.theme};
}
