import {copyFile} from 'node:fs/promises';
for(const name of ['browser-qa.html','browser-qa.mjs','static-browser-checks.mjs','playback-audit.html','playback-audit.mjs'])await copyFile(`tests/${name}`,`dist/${name}`);
await copyFile('tests/fixtures/notation-marks.musicxml','dist/notation-marks.musicxml');
await copyFile('tests/fixtures/tied-chords.musicxml','dist/tied-chords.musicxml');
console.log('Browser QA: http://127.0.0.1:4173/browser-qa.html');
