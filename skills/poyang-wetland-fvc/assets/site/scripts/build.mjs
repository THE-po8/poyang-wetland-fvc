import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sourceFiles = ['index.html', 'styles.css', 'package.json', 'package-lock.json', 'scripts/build.mjs', ...(await readdir('src')).filter(f => f.endsWith('.js')).map(f => `src/${f}`)].sort();
const digest = createHash('sha256');
for (const file of sourceFiles) { digest.update(file + '\0'); digest.update(await readFile(file)); digest.update('\0'); }
const sourceSha256 = digest.digest('hex');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  outfile: 'dist/app.js',
  target: ['es2022'],
  define: { __SOURCE_SHA256__: JSON.stringify(sourceSha256) },
});

await Promise.all([
  cp('index.html', 'dist/index.html'),
  cp('styles.css', 'dist/styles.css'),
]);
