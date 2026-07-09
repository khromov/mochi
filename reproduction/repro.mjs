import { AsyncLocalStorage } from 'node:async_hooks';

// Minimal reproduction of a Bun 1.4.0 AsyncLocalStorage regression.
//
// The store returned by `als.getStore()` is dropped inside a promise `.then()`
// continuation. Plain `await`/`Promise.all`/timers propagate the store fine — the
// bug needs the manual `.then()` chaining that Svelte 5's async SSR renderer uses
// (`svelte/internal/server` renderer.run()). Onset is a one-way cliff at a
// run-dependent iteration count (JIT/GC-timing shaped): once the first chain drops
// its store, EVERY later `als.run()` chain in the process drops it too. Even a
// fully sequential loop of scoped chains trips it eventually; the 16 concurrent
// un-scoped churn chains below just force the cliff early so the script fails
// reliably within its 3200 measured renders.
//
// Run:  bun reproduction/repro.mjs
//   Bun 1.3.14 -> PASS   Bun 1.4.0 -> FAIL

const als = new AsyncLocalStorage();

// Faithful model of Svelte's async SSR renderer.run(): a thunk chain where each
// continuation restores a module-level variable and relies on the RUNTIME to keep
// AsyncLocalStorage propagated across the promise `.then()` boundary.
let ssrContext = null;
function runChain(thunks) {
  const captured = ssrContext;
  let p = Promise.resolve(thunks[0]());
  for (const fn of thunks.slice(1)) {
    p = p.then(() => {
      const prev = ssrContext;
      ssrContext = captured;
      try {
        return fn();
      } finally {
        ssrContext = prev;
      }
    });
  }
  return p;
}

// A "render": several sequential async segments; the last reads AsyncLocalStorage,
// exactly like a component reading `url.pathname` after a top-level `await`.
function renderOnce() {
  ssrContext = {};
  return runChain([() => Promise.resolve(), () => Promise.resolve(), () => Promise.resolve(), () => als.getStore()]);
}

let stop = false;
// UN-scoped concurrent renders, like a fire-and-forget background task.
// Not required to trigger the bug — they just generate promise-reaction
// volume so the cliff is hit early and reliably.
async function churn() {
  while (!stop) {
    await renderOnce();
  }
}

let bad = 0;
let ok = 0;
async function scoped(i) {
  const store = await als.run({ v: i }, renderOnce);
  if (!store || store.v !== i) {
    bad++;
  } else {
    ok++;
  }
}

console.log('bun', process.versions.bun);
const bg = Array.from({ length: 16 }, churn);
// Warmup: probe until the one-way cliff is crossed (a probe loses its store), so
// the measured section below fails deterministically on affected versions. On a
// healthy runtime (1.3.14 / Node) no probe ever loses its store, the budget just
// runs out, and the measured section PASSes.
let cliffed = false;
for (let round = 0; round < 2000 && !cliffed; round++) {
  const stores = await Promise.all(Array.from({ length: 16 }, () => als.run({ v: -1 }, renderOnce)));
  cliffed = stores.some((s) => !s || s.v !== -1);
}
for (let round = 0; round < 200; round++) {
  await Promise.all(Array.from({ length: 16 }, (_, k) => scoped(round * 16 + k)));
}
stop = true;
await Promise.allSettled(bg);
console.log(bad === 0 ? `PASS: all ${ok} scoped renders kept their context` : `FAIL: ${bad}/${bad + ok} scoped renders LOST their AsyncLocalStorage context`);
