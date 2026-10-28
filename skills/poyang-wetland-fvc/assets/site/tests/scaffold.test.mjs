import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This test runs when the site is still bundled in its skill. Standalone
// scaffolded websites do not carry the parent skill's generation script.
const script = fileURLToPath(new URL('../../../scripts/scaffold.mjs', import.meta.url));
let bundled = true;
try {
  await access(script);
  const skill = await readFile(new URL('../../../SKILL.md', import.meta.url), 'utf8');
  bundled = /^name: poyang-wetland-fvc$/m.test(skill);
} catch { bundled = false; }
test('scaffold copies source only and rejects overwriting an existing project', {skip:!bundled}, async t => {
  const root=await mkdtemp(path.join(tmpdir(),'fvc-scaffold-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const target=path.join(root,'project');
  const created=spawnSync(process.execPath,[script,target],{encoding:'utf8'});
  assert.equal(created.status,0,created.stderr);
  assert.ok((await readFile(path.join(target,'src/experiment.js'),'utf8')).includes('runExperiment'));
  await assert.rejects(access(path.join(target,'node_modules')));
  await assert.rejects(access(path.join(target,'dist')));
  await assert.rejects(access(path.join(target,'.openai')));
  await writeFile(path.join(target,'sentinel.txt'),'preserve me');
  const refused=spawnSync(process.execPath,[script,target],{encoding:'utf8'});
  assert.notEqual(refused.status,0);
  assert.equal(await readFile(path.join(target,'sentinel.txt'),'utf8'),'preserve me');
});
