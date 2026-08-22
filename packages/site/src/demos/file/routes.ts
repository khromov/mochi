import { Mochi, error } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Only these names map to a fixture on disk; anything else 404s from the
// resolver itself rather than probing the filesystem.
const ALLOWED = new Set(['sample', 'notes']);

export const routes: Record<string, MochiRouteValue> = {
  '/demos/file': Mochi.page('./src/demos/file/File.svelte'),

  // String form — serve one fixed file from disk.
  '/demos/file/download': Mochi.file('./src/demos/file/sample.txt'),

  // Resolver form — pick the file per request from the route param.
  '/demos/file/dynamic/:name': Mochi.file((_req, params) => {
    const name = params.name ?? '';
    if (!ALLOWED.has(name)) {
      error(404, `No file named "${name}"`);
    }
    return `./src/demos/file/${name}.txt`;
  }),
};
