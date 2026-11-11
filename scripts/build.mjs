import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PIANO_SAMPLES } from '../src/assets/piano/manifest.mjs';
const checksums=JSON.parse(await readFile('src/assets/piano/checksums.json','utf8'));
await Promise.all(PIANO_SAMPLES.map(async sample=>{
  const bytes=await readFile(`src/assets/piano/${sample.file}`);
  const expected=checksums.find(entry=>entry.file===sample.file);
  if(!expected||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error(`Piano sample missing or corrupt: ${sample.file}`);
}));
// Keep deleted source modules out of packaged web resources as well as adding new ones.
await rm('dist', { recursive: true, force: true });
await mkdir('dist/vendor', { recursive: true });
await cp('src', 'dist', { recursive: true });
await cp('Chopin_Nocturne_Op9_No2.musicxml','dist/assets/Chopin_Nocturne_Op9_No2.musicxml');
for (const file of ['verovio-module.mjs', 'verovio.mjs']) {
  await cp(`node_modules/verovio/dist/${file}`, `dist/vendor/${file}`);
}
await writeFile('dist/vendor/NOTICE.txt', [
  'Verovio 6.3.0 — LGPL-3.0-or-later',
  'https://github.com/rism-digital/verovio',
  'Source for this release: https://github.com/rism-digital/verovio/tree/version-6.3.0',
  'Distributed unmodified as a separately loaded JavaScript library.',
  'License: https://www.gnu.org/licenses/lgpl-3.0.html'
].join('\n'));
console.log('Built dist/ with local Verovio and 90 verified Salamander piano samples.');
