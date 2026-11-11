// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('The VST host currently requires Windows x64.');
const root = path.dirname(fileURLToPath(import.meta.url));
const commit = '29396c22c93392d6738e021b83196283d6e4d850';
const archiveHash = '8714e396c7fa30b692e47529d5e0d8b242e22c937e564410c361e4d443ea1621';
const source = path.join(root, '.deps', `JUCE-${commit}`);
const archive = path.join(root, '.deps', 'juce.zip');
// Windows environment keys are case-insensitive. Duplicate PATH/Path breaks MSBuild.
const env = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value]));
const run = (command, args) => {
  const result = spawnSync(command, args, {cwd:root, env, stdio:'inherit', windowsHide:true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with code ${result.status}`);
};
if (!existsSync(path.join(source, 'CMakeLists.txt'))) {
  await mkdir(path.dirname(archive), {recursive:true});
  if (!existsSync(archive)) {
    console.log('Downloading JUCE 8.0.12 source (AGPLv3)...');
    const response = await fetch(`https://codeload.github.com/juce-framework/JUCE/zip/${commit}`);
    if (!response.ok) throw new Error(`JUCE download failed: ${response.status}`);
    await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
  }
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (actual !== archiveHash) throw new Error('JUCE source checksum mismatch. Remove native/.deps/juce.zip and retry.');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  run('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
    `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(path.dirname(archive))} -Force`]);
}
const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
if (!existsSync(vswhere)) throw new Error('Install Visual Studio 2022 C++ Desktop tools and the Windows SDK first.');
const vs = execFileSync(vswhere, ['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'], {env,encoding:'utf8',windowsHide:true}).trim();
if (!vs) throw new Error('Visual Studio C++ Desktop tools were not found.');
const bundledCmake = path.join(vs, 'Common7','IDE','CommonExtensions','Microsoft','CMake','CMake','bin','cmake.exe');
const cmake = existsSync(bundledCmake) ? bundledCmake : 'cmake';
run(cmake, ['-S',root,'-B',path.join(root,'build'),'-G','Visual Studio 17 2022','-A','x64',`-DJUCE_SOURCE_DIR=${source}`]);
run(cmake, ['--build',path.join(root,'build'),'--config','Release','--target','LiupuVSTHost','--parallel','4']);
await mkdir(path.join(root,'bin'), {recursive:true});
await copyFile(path.join(root,'build','LiupuVSTHost_artefacts','Release','LiupuVSTHost.exe'),path.join(root,'bin','LiupuVSTHost.exe'));
await copyFile(path.join(source,'LICENSE.md'),path.join(root,'JUCE-LICENSE.md'));
console.log('Built native/bin/LiupuVSTHost.exe. Full matching JUCE source: native/.deps/JUCE-' + commit);
