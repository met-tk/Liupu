import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {extractFile,listPackage} from '@electron/asar';

// Static release validation; does not launch Electron or touch user profiles.
const pkg=JSON.parse(await readFile('package.json','utf8'));
const output=process.argv[2]||`release/${pkg.version}`;
const root=path.join(output,'win-unpacked'),resources=path.join(root,'resources');
const archive=path.join(resources,'app.asar');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=async(a,b)=>assert.equal(sha(await readFile(a)),sha(await readFile(b)),`${a} differs from ${b}`);
const files=listPackage(archive).map(p=>p.replaceAll('\\','/').replace(/^\//,''));
assert.equal(JSON.parse(extractFile(archive,'package.json')).version,pkg.version);
let modules=0;
for(const file of files.filter(f=>/\.(mjs|cjs|jsx)$/.test(f))){
  const bytes=extractFile(archive,file);
  if(file.startsWith('desktop/')||file==='server.mjs'||file==='vst-bridge.mjs'){
  assert.equal(sha(bytes),sha(await readFile(file)),`ASAR source mismatch: ${file}`);
  }else{
    const source=file.startsWith('src/')?file:path.join('src',file);
    assert.equal(sha(bytes),sha(await readFile(source)),`ASAR source mismatch: ${source}`);
  }
  for(const [,dependency] of bytes.toString().matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),dependency));
    assert.ok(files.includes(target),`Missing packaged dependency: ${file} → ${target}`);
  }
  modules++;
}
async function walk(directory,prefix=''){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const name=prefix+entry.name;
    if(entry.isDirectory())result.push(...await walk(path.join(directory,entry.name),name+'/'));
    else result.push(name);
  }
  return result;
}
const web=path.join(resources,'web'),webFiles=await walk(web);
for(const file of webFiles)await same(path.join(web,file),path.join('dist',file));
for(const file of ['index.html','style.css','app.mjs','studio-editor.mjs','composition.mjs','composition-render.mjs','fragment-render.mjs','mark-render.mjs','effect-editor.mjs','effect-library.mjs','motion-program.mjs','visual-defaults.mjs','ae-package.mjs'])assert.ok(webFiles.includes(file),`Missing web entry: ${file}`);
for(const file of ['i18n.mjs','i18n-catalog.mjs','preferences.mjs','ui-settings.mjs','assets/Chopin_Nocturne_Op9_No2.musicxml'])assert.ok(webFiles.includes(file),`Missing web resource: ${file}`);
await same(path.join(web,'assets','Chopin_Nocturne_Op9_No2.musicxml'),'Chopin_Nocturne_Op9_No2.musicxml');
const samples=JSON.parse(await readFile('src/assets/piano/checksums.json','utf8'));
assert.equal(samples.length,90);
for(const sample of samples)assert.equal(sha(await readFile(path.join(web,'assets/piano',sample.file))),sample.sha256,`Piano mismatch: ${sample.file}`);
const docs=['README.md','EFFECTS.md','DESKTOP.md','AE-EXPORT.md','MOTION-DESIGN.md','COMPOSITION.md'];
for(const file of docs)await same(path.join(resources,'documentation',file),file);
const manifest=JSON.parse(await readFile(path.join(resources,'licenses/build-manifest.json'),'utf8'));
assert.equal(manifest.version,pkg.version);
assert.equal(sha(await readFile(path.join(resources,'native/LiupuVSTHost.exe'))),manifest.nativeHost.sha256);
await same(path.join(resources,'native/LiupuVSTHost.exe'),'native/bin/LiupuVSTHost.exe');
assert.equal(sha(await readFile(path.join(resources,'licenses/native-source/.deps/juce.zip'))),manifest.juce.sha256);
assert.equal(sha(await readFile(path.join(resources,'licenses/verovio/verovio-6.3.0-source.zip'))),manifest.verovio.sha256);
const names=[`Liupu-Studio-${pkg.version}-Setup-x64.exe`,`Liupu-Studio-${pkg.version}-win-x64.zip`];
const artifacts=[];
for(const name of names){const bytes=await readFile(path.join(output,name));artifacts.push({name,bytes:bytes.length,sha256:sha(bytes)})}
await writeFile(path.join(output,'SHA256SUMS.txt'),artifacts.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
const report={version:pkg.version,asarModules:modules,webFiles:webFiles.length,pianoSamples:samples.length,documents:docs,artifacts,guiTested:false};
await writeFile(path.join(output,'integrity-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
