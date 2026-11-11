import { copyFile,cp,mkdir,readFile,stat,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const at=(...parts)=>path.join(root,...parts);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const host=at('native/bin/LiupuVSTHost.exe');
let hostInfo;
try{hostInfo=await stat(host)}catch{throw new Error('Missing VST3 host. Run npm run build:native first.')}
for(const file of ['native/Host.cpp','native/CMakeLists.txt']){
  if((await stat(at(file))).mtimeMs>hostInfo.mtimeMs)throw new Error(`${file} is newer than the host. Run npm run build:native first.`);
}
const downloads=at('.desktop-build/downloads');
const licenses=at('.desktop-build/licenses');
await mkdir(downloads,{recursive:true});
await mkdir(path.join(licenses,'native-source','.deps'),{recursive:true});
await mkdir(path.join(licenses,'verovio'),{recursive:true});
const juce=await readFile(at('native/.deps/juce.zip'));
if(sha(juce)!=='8714e396c7fa30b692e47529d5e0d8b242e22c937e564410c361e4d443ea1621')throw new Error('JUCE source archive checksum mismatch.');
await writeFile(path.join(licenses,'native-source','.deps','juce.zip'),juce);
for(const file of ['Host.cpp','CMakeLists.txt','build.mjs','smoke-test.mjs','README.md','LICENSE.txt','JUCE-LICENSE.md','VST3-LICENSE.txt']){
  await copyFile(at('native',file),path.join(licenses,'native-source',file));
}
const verovioArchive=path.join(downloads,'verovio-6.3.0-source.zip');
try{await stat(verovioArchive)}catch{
  console.log('Downloading matching Verovio source for redistribution...');
  const response=await fetch('https://codeload.github.com/rism-digital/verovio/zip/refs/tags/version-6.3.0',{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error(`Verovio source download failed: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha(bytes)!=='c6d64d024febd233152c69a7ed9cb67f1a2bae0c15d2248f6ac1727f96dff25a')throw new Error('Verovio source checksum mismatch.');
  await writeFile(verovioArchive,bytes);
}
const verovio=await readFile(verovioArchive);
if(sha(verovio)!=='c6d64d024febd233152c69a7ed9cb67f1a2bae0c15d2248f6ac1727f96dff25a')throw new Error('Verovio source checksum mismatch.');
await writeFile(path.join(licenses,'verovio','verovio-6.3.0-source.zip'),verovio);
for(const file of ['COPYING','COPYING.LESSER'])await copyFile(at('src/vendor',file),path.join(licenses,'verovio',file));
await cp(at('src/assets/piano'),path.join(licenses,'piano'),{recursive:true,filter:file=>!file.endsWith('.mp3')});
await copyFile(at('desktop/THIRD-PARTY-NOTICES.md'),path.join(licenses,'README.md'));
await writeFile(path.join(licenses,'build-manifest.json'),JSON.stringify({
  version:JSON.parse(await readFile(at('package.json'),'utf8')).version,
  nativeHost:{file:'../native/LiupuVSTHost.exe',sha256:sha(await readFile(host)),runtime:'MSVC static (/MT)'},
  juce:{version:'8.0.12',commit:'29396c22c93392d6738e021b83196283d6e4d850',sha256:sha(juce)},
  verovio:{version:'6.3.0',sha256:sha(verovio)},
  electron:JSON.parse(await readFile(at('node_modules/electron/package.json'),'utf8')).version
},null,2));
console.log('Prepared complete VST3 host/JUCE and Verovio source archives, licenses and piano attribution.');
