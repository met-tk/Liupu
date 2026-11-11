// Reuse the protocol/audio checks against the executable actually shipped in the package.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source=await readFile(new URL('../native/smoke-test.mjs',import.meta.url),'utf8');
const host=fileURLToPath(new URL('../release/win-unpacked/resources/native/LiupuVSTHost.exe',import.meta.url));
const check=source.replace("fileURLToPath(new URL('./bin/LiupuVSTHost.exe',import.meta.url))",JSON.stringify(host));
if(check===source)throw new Error('Native smoke test entry point changed; update packaged host runner.');
await import('data:text/javascript;base64,'+Buffer.from(check).toString('base64'));
