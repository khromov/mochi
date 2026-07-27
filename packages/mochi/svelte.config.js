// The compiler options Mochi always applies, mirrored from
// `src/compiler/svelteConfig.ts` (a test asserts the two stay in sync).
//
// Mochi's own pipeline never reads this file — it exists so `svelte-check` and the
// Svelte VS Code extension, which read `svelte.config.js` directly and know nothing
// about Mochi, accept `await` in components. Apps re-export it:
//
//   export { default } from 'mochi-framework/svelte.config.js';
//
// Keep it a dependency-free literal: `svelte-check` loads it under Node, not Bun, so
// it cannot import TypeScript or anything from `src/`.
export default {
  compilerOptions: {
    experimental: {
      async: true,
    },
    discloseVersion: false,
  },
};
