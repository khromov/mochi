// Minimal, dependency-free (Svelte only) reproduction of the root cause:
// Svelte's SERVER compiler and CLIENT compiler resolve a `{#snippet marks}` whose name collides
// with a `marks` prop DIFFERENTLY. The server shadows the prop with the snippet (→ infinite
// recursion); the client binds to the prop (→ correct). Run: `bun reproduce-svelte.ts`
import { compile } from 'svelte/compiler';
import { buildServer, renderToString } from './harness.ts';
import { join } from 'node:path';

const OUTER = join(import.meta.dir, 'pattern', 'Outer.svelte');
const src = await Bun.file(OUTER).text();

function region(code: string, from: string, len = 320): string {
  const i = code.indexOf(from);
  return i < 0 ? '(not found)' : code.slice(i, i + len);
}

console.log('======================================================================');
console.log('1. How each compiler resolves `marks` inside `{#snippet marks}`');
console.log('======================================================================');
console.log('\n--- generate: "server" (marks() calls ITSELF → infinite recursion) ---');
console.log(region(compile(src, { generate: 'server', filename: 'Outer.svelte' }).js.code, 'function marks('));
console.log('\n--- generate: "client" (guard binds to $$props.marks → correct) ---');
console.log(region(compile(src, { generate: 'client', filename: 'Outer.svelte' }).js.code, 'marks = ('));

console.log('\n======================================================================');
console.log('2. Actually server-rendering it');
console.log('======================================================================');
const built = await buildServer(OUTER, join(import.meta.dir, '.out', 'pattern'));
try {
  const html = await renderToString(built, 'pattern');
  console.log('Rendered OK:', JSON.stringify(html));
} catch (err) {
  console.log(`CRASH → ${(err as Error).constructor.name}: ${(err as Error).message}`);
  console.log('\n(The client build of the same component renders "default content: 1" fine.)');
}
