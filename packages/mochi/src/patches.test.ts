import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PATCH = 'svelte-check@4.7.3.patch';
const CANONICAL = join(import.meta.dir, '..', 'patches', PATCH);
const TEMPLATE_COPIES = [join(import.meta.dir, '..', '..', 'minimal', 'patches', PATCH), join(import.meta.dir, '..', '..', 'demos', 'patches', PATCH)];

describe('template patch copies match canonical', () => {
  const canonical = readFileSync(CANONICAL);

  for (const copy of TEMPLATE_COPIES) {
    test(copy, () => {
      // Templates can't reference the framework's `patches/` at install time
      // (bun resolves patchedDependencies before unpacking node_modules), so
      // each template ships its own copy. This test guards against drift.
      expect(readFileSync(copy)).toEqual(canonical);
    });
  }
});
