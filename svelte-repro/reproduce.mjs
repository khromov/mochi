// Pure-Svelte reproduction — depends on `svelte` only (no bundler, no LayerChart, no framework).
// Compiles with svelte/compiler and renders with svelte/server. Run: `bun reproduce.mjs` (or node).
//
// The bug: a `{#snippet marks}` whose name collides with a `marks` prop, guarded by
// `{#if typeof marks === 'function'}`, is compiled DIFFERENTLY for server vs client:
//   - client: the guard binds to the PROP  ($$props.marks)          → works
//   - server: the guard is shadowed by the SNIPPET itself           → infinite recursion
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, 'Outer.svelte'), 'utf8');

const region = (code, from, len = 300) => {
  const i = code.indexOf(from);
  return i < 0 ? '(not found)' : code.slice(i, i + len);
};

console.log('======================================================================');
console.log('1. Same source, two compile targets, different meaning for `marks`');
console.log('======================================================================');
console.log('\n--- generate: "server"  (marks() calls ITSELF → infinite recursion) ---');
console.log(region(compile(src, { generate: 'server', filename: 'Outer.svelte' }).js.code, 'function marks('));
console.log('\n--- generate: "client"  (guard binds to $$props.marks → correct) ---');
console.log(region(compile(src, { generate: 'client', filename: 'Outer.svelte' }).js.code, 'marks = ('));

console.log('\n======================================================================');
console.log('2. Server-rendering it for real');
console.log('======================================================================');

// Compile each component to server JS on disk, pointing child `.svelte` imports at the compiled
// `.svelte.js` — no bundler needed. `svelte/internal/server` resolves from node_modules at runtime.
const out = join(dir, '.out');
mkdirSync(out, { recursive: true });
for (const name of ['Inner.svelte', 'Outer.svelte']) {
  const { js } = compile(readFileSync(join(dir, name), 'utf8'), { generate: 'server', filename: name });
  const code = js.code.replace(/(\.\/[A-Za-z0-9_]+\.svelte)(['"])/g, '$1.js$2');
  writeFileSync(join(out, name + '.js'), code);
}

const mod = await import(pathToFileURL(join(out, 'Outer.svelte.js')).href + '?v=' + Date.now());
try {
  const { body } = render(mod.default, { props: {} });
  console.log('rendered OK:', JSON.stringify(body));
} catch (err) {
  console.log(`CRASH → ${err.constructor.name}: ${err.message}`);
  console.log('\n(The client build of the same component renders "default content: 1" fine.)');
}
