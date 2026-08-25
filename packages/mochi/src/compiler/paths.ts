import path from 'node:path';

/**
 * The framework `src/` root — one level up from `src/compiler/`, where this file must stay for the climb to hold.
 * `SRC_DIR` deliberately means `src/`: subsystem files are addressed relative to it (`utils/log.ts`,
 * `components/index.ts`, …), matching the layout on disk and in the published package.
 */
export const SRC_DIR = path.join(path.dirname(Bun.fileURLToPath(import.meta.url)), '..');

/** URL form of the same root for `new URL(relPath, SRC_URL)` joins — the trailing slash is load-bearing there. */
export const SRC_URL = new URL('../', import.meta.url);
