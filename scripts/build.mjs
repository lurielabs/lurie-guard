// Builds dist/: the action entry (dist/main.js), the CLI (dist/cli.js) and the
// WebAssembly files next to them. Deterministic: the same commit gives the same
// bytes, and CI diffs a fresh build against the committed dist/.
//
//   node scripts/build.mjs
import { build } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

execFileSync(process.execPath, [join(root, 'scripts', 'gen-rules-index.mjs')], { stdio: 'inherit' });

const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

// The bundle is ESM because @actions/core 3 and @actions/github 9 are ESM-only.
// CommonJS dependencies (libpg-query's loader, yaml, picomatch, the Anthropic SDK)
// still reference require/__dirname, so the banner provides them.
const banner = `import { createRequire as __lgCreateRequire } from 'node:module';
import { fileURLToPath as __lgFileURLToPath } from 'node:url';
import { dirname as __lgDirname } from 'node:path';
const require = __lgCreateRequire(import.meta.url);
const __filename = __lgFileURLToPath(import.meta.url);
const __dirname = __lgDirname(__filename);`;

await build({
  entryPoints: {
    main: join(root, 'src', 'main.ts'),
    cli: join(root, 'src', 'cli.ts'),
  },
  outdir: dist,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: banner },
  define: { 'process.env.LURIE_GUARD_VERSION': JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
  // Keep the WebAssembly files as separate files: the emscripten loaders read them from disk.
  external: [],
});

const wasm = [
  ['libpg-query.wasm', require.resolve('libpg-query/wasm/libpg-query.wasm')],
  ['web-tree-sitter.wasm', require.resolve('web-tree-sitter/web-tree-sitter.wasm')],
  ['tree-sitter-ruby.wasm', require.resolve('tree-sitter-ruby/tree-sitter-ruby.wasm')],
  ['tree-sitter-python.wasm', require.resolve('tree-sitter-python/tree-sitter-python.wasm')],
];
let total = 0;
for (const [name, from] of wasm) {
  copyFileSync(from, join(dist, name));
  // copyFileSync keeps the source mode, and some packages ship their .wasm as 0755:
  // pin 0644 so a build on Linux matches the committed dist/.
  chmodSync(join(dist, name), 0o644);
  total += statSync(join(dist, name)).size;
}
for (const f of ['main.js', 'cli.js']) total += statSync(join(dist, f)).size;
console.log(`dist/: ${(total / 1024 / 1024).toFixed(2)} MB (budget 10 MB)`);
if (total > 10 * 1024 * 1024) {
  console.error('dist/ is over the 10 MB budget');
  process.exit(1);
}
