import type { SourceSpec } from '../../components/utils.ts';

export const files: SourceSpec[] = [
  { label: 'Varlock.svelte', path: './src/demos/varlock/Varlock.svelte' },
  { label: 'env.ts', path: './src/demos/varlock/env.ts' },
  { label: 'routes.ts', path: './src/demos/varlock/routes.ts' },
  { label: '.env.schema', path: './src/demos/varlock/.env.schema', lang: 'bash' },
  { label: 'index.ts', path: './src/demos/varlock/index.ts' },
];
