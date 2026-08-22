import type { SourceSpec } from '../../components/utils.ts';

export const files: SourceSpec[] = [
  {
    label: 'ServerRenderedParent.svelte',
    path: './src/demos/island-props/ServerRenderedParent.svelte',
  },
  {
    label: 'ClientRenderedChild.svelte',
    path: './src/demos/island-props/ClientRenderedChild.svelte',
  },
  { label: 'devalueTypeOf.ts', path: './src/demos/island-props/devalueTypeOf.ts' },
  { label: 'routes.ts', path: './src/demos/island-props/routes.ts' },
  { label: 'index.ts', path: './src/demoIndex.ts' },
];
