import type { SourceSpec } from '../../components/utils.ts';

export const files: SourceSpec[] = [
  { label: 'StaticDirsDemo.svelte', path: './src/demos/static-dirs/StaticDirsDemo.svelte' },
  { label: 'routes.ts', path: './src/demos/static-dirs/routes.ts' },
  { label: 'index.ts', path: './src/demoIndex.ts', showStaticDirs: true },
];
