// Ambient module declarations for asset imports Mochi handles natively.
// This file is intentionally a *script* (no top-level import/export) so the
// wildcard `declare module '*.x'` forms register as ambient declarations
// rather than module augmentations. Pulled in via the triple-slash reference
// in `index.ts`, so any consumer importing from `mochi-framework` gets these
// for free and doesn't need its own `global.d.ts`.

// Pull in the `mochi:*` Svelte attribute whitelist so any consumer that
// already references `mochi-framework/ambient` gets editor/typecheck support
// for hydration/defer directives without a separate file.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./mochi-svelte.d.ts" />

// Bun resolves `.css` side-effect imports natively.
declare module '*.css';

// Mochi compiles `.md` via mdsvex into Svelte components.
declare module '*.md' {
  const component: import('svelte').Component;
  export default component;
}

// Mochi's image asset loader rewrites image imports to their served URL string.
// Keep in sync with IMAGE_FILE_FILTER in imageAssets.ts.
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.jpeg' {
  const src: string;
  export default src;
}
declare module '*.gif' {
  const src: string;
  export default src;
}
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.avif' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.ico' {
  const src: string;
  export default src;
}
declare module '*.bmp' {
  const src: string;
  export default src;
}
