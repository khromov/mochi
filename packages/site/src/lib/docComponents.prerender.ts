import { moduleRef } from 'mochi-framework';
import type { Component } from 'svelte';
import { loadDocs } from './docs';

/** Each entry becomes a real `import` of the `.md` file, so no barrel has to be generated into the source tree before a build. */
export const docComponents: Record<string, Component> = Object.fromEntries((await loadDocs()).map((doc) => [doc.slug, moduleRef<Component>(`../../../docs/${doc.filename}`)]));
