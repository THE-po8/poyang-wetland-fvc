#!/usr/bin/env node
import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argument = process.argv[2];
if (!argument) {
  console.error('Usage: node scaffold.mjs <new-or-empty-project-directory>');
  process.exit(1);
}
const source = fileURLToPath(new URL('../assets/site/', import.meta.url));
const target = path.resolve(argument);
const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (target === skillRoot || target.startsWith(skillRoot + path.sep)) {
  throw new Error('Choose a project directory outside the installed skill');
}
let exists = false;
try {
  const entry = await lstat(target);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Target must be a real directory');
  exists = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (exists && (await readdir(target)).length) throw new Error('Refusing to overwrite a nonempty target directory');
await mkdir(target, { recursive: true });
for (const entry of await readdir(source)) {
  if (['node_modules', 'dist', '.git', '.openai'].includes(entry) || entry.startsWith('.env')) continue;
  await cp(path.join(source, entry), path.join(target, entry), {
    recursive: true, force: false, errorOnExist: true,
    filter: input => !['node_modules', 'dist', '.git', '.openai'].includes(path.basename(input)) && !path.basename(input).startsWith('.env'),
  });
}
console.log(`Created FVC source project at ${target}`);
console.log('Next: npm ci && npm test && npm run build');
