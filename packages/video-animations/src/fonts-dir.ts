import { resolve } from 'node:path';

// Instanced .otf fonts are generated (not committed) — see prepare-fonts.ts.
// They live in a gitignored cache at the package root.
export const FONTS_DIR = resolve(import.meta.dir, '..', '.fonts');
