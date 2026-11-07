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

// Local raster image imports (`import hero from './hero.png'`) resolve to an
// `ImportedImage` object served from a content-hashed URL. SVG is intentionally
// omitted — it can't be decoded for metadata/transforms; use a `public/` asset.
declare module '*.png' {
  const image: import('mochi-framework/image').ImportedImage;
  export default image;
}
declare module '*.jpg' {
  const image: import('mochi-framework/image').ImportedImage;
  export default image;
}
declare module '*.jpeg' {
  const image: import('mochi-framework/image').ImportedImage;
  export default image;
}
declare module '*.webp' {
  const image: import('mochi-framework/image').ImportedImage;
  export default image;
}
declare module '*.avif' {
  const image: import('mochi-framework/image').ImportedImage;
  export default image;
}
declare module '*.gif' {
  const image: import('mochi-framework/image').ImportedImage;
  export default image;
}
