import type { SourceSpec } from '../../components/utils.ts';

export const files: SourceSpec[] = [
  {
    label: 'ErrorBoundaries.svelte',
    path: './src/demos/error-boundaries/ErrorBoundaries.svelte',
  },
  { label: 'ThrowOnSsr.svelte', path: './src/demos/error-boundaries/ThrowOnSsr.svelte' },
  { label: 'ThrowOnClient.svelte', path: './src/demos/error-boundaries/ThrowOnClient.svelte' },
  {
    label: 'ThrowOnServerIsland.svelte',
    path: './src/demos/error-boundaries/ThrowOnServerIsland.svelte',
  },
  {
    label: 'HealthyServerIsland.svelte',
    path: './src/demos/error-boundaries/HealthyServerIsland.svelte',
  },
  { label: 'routes.ts', path: './src/demos/error-boundaries/routes.ts' },
  { label: 'index.ts', path: './src/demoIndex.ts' },
];
