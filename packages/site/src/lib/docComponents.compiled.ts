import { compiled, moduleRef } from 'mochi-framework';
import type { Component } from 'svelte';
import { loadDocs } from './docs';

/**
 * Every doc under `packages/docs`, keyed by slug.
 *
 * The map is resolved at build time and each entry becomes a real `import` of the `.md` file, so this replaces the
 * generated barrel that used to be written into the source tree before every build, typecheck, and container start.
 */
export const docComponents: Record<string, Component> = await compiled(async () => {
  const docs = await loadDocs();
  return Object.fromEntries(docs.map((doc) => [doc.slug, moduleRef<Component>(`../../../docs/${doc.filename}`)]));
});
