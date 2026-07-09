// Reproduces a Bun 1.4.0 regression using ONLY Svelte — no framework, no custom
// AsyncLocalStorage. Svelte 5's server renderer keeps its render context in its
// own AsyncLocalStorage; Bun 1.4.0 drops that store across the async-SSR promise
// continuations, so `hydratable()` throws `server_context_required` mid-render.
//
//   cd reproduction-svelte && bun install && bun start
//
//   Bun 1.3.14 -> PASS      Bun 1.4.0 -> FAIL
//
// Switch versions:
//   curl -fsSL https://bun.com/install | bash -s "bun-v1.3.14"
//   bun upgrade --canary

import { plugin } from 'bun';
import { compile } from 'svelte/compiler';
import { readFileSync } from 'node:fs';

// Compile .svelte to server JS on import (generate: 'server', async enabled).
plugin({
  name: 'svelte-server',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, (args) => ({
      contents: compile(readFileSync(args.path, 'utf8'), {
        generate: 'server',
        filename: args.path,
        experimental: { async: true },
      }).js.code,
      loader: 'js',
    }));
  },
});

const { render } = await import('svelte/server');
const App = (await import('./App.svelte')).default as unknown as Parameters<typeof render>[0];
const svelteVersion = (await import('svelte/package.json')).default.version;
console.log(`bun ${Bun.version} | svelte ${svelteVersion}`);

// Background renders with no surrounding context — the concurrent async work that
// makes Bun 1.4.0 bleed the render-context store into the measured renders.
let stop = false;
async function churn() {
  while (!stop) {
    try {
      await render(App);
    } catch {
      // ignore
    }
  }
}

let ok = 0;
let serverContextRequired = 0;
let other = 0;
async function once() {
  try {
    const out = await render(App);
    if (out.body.includes('server-value')) {
      ok++;
    } else {
      other++;
    }
  } catch (e) {
    if (String((e as Error).message).includes('server_context_required')) {
      serverContextRequired++;
    } else {
      other++;
    }
  }
}

const bg = [churn(), churn()];
for (let round = 0; round < 40; round++) {
  await Promise.all(Array.from({ length: 8 }, () => once()));
}
stop = true;
await Promise.allSettled(bg);

console.log(
  serverContextRequired === 0
    ? `PASS: ${ok} renders OK, 0 threw server_context_required`
    : `FAIL: ${serverContextRequired} renders threw Svelte's server_context_required (ok=${ok}, other=${other})`,
);
