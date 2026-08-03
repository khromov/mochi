// Reproduction through a real Vite SSR pipeline (Vite + @sveltejs/vite-plugin-svelte) — the same
// toolchain SvelteKit uses. Vite compiles `Outer.svelte` with the Svelte server target via the
// plugin; we then render it with svelte/server. Run: `node reproduce.mjs`.
//
// Both modes fail to server-render, with different symptoms:
//   - dev:  invalid_snippet_arguments  (Svelte's dev runtime catches the malformed self-call)
//   - prod: RangeError: Maximum call stack size exceeded  (the self-call recurses forever)
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { render } from 'svelte/server';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

async function ssrRender(dev) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    plugins: [svelte({ compilerOptions: { dev } })],
  });
  try {
    // ssrLoadModule runs Outer.svelte through the Svelte plugin's SSR transform (generate: 'server').
    const mod = await server.ssrLoadModule('./Outer.svelte');
    const { body } = render(mod.default, { props: {} });
    return `rendered OK: ${JSON.stringify(body)}`;
  } catch (err) {
    return `CRASH → ${err.constructor.name}: ${err.message.split('\n')[0]}`;
  } finally {
    await server.close();
  }
}

console.log('Server-rendering Outer.svelte through Vite + @sveltejs/vite-plugin-svelte:\n');
console.log(`  dev build  (dev: true)  → ${await ssrRender(true)}`);
console.log(`  prod build (dev: false) → ${await ssrRender(false)}`);
console.log('\n(The browser/client build of the same component renders "default content: 1" fine.)');
