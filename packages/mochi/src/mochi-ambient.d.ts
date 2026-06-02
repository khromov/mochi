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

// `leb` (LEB128 varint codec used by the image-request wire format) ships no
// types and has no `@types/leb`; declare only what `image/imageCodec.ts` uses.
declare module 'leb' {
  export function encodeUInt64(value: number): Buffer;
  export function decodeUInt64(buffer: Uint8Array, index?: number): { value: number; nextIndex: number; lossy: boolean };
}
