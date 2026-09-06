import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Scaffolds pair the templates with the published framework, so each template keeps its own
// svelte-check patch until the release whose ambient types cover the directives is on npm.
const PATCH = 'svelte-check@4.7.4.patch';
const [reference, ...copies] = ['minimal', 'demos'].map((name) => join(import.meta.dir, '..', '..', name, 'patches', PATCH));

describe('template svelte-check patches stay identical', () => {
  const expected = readFileSync(reference!);

  for (const copy of copies) {
    test(copy, () => {
      expect(readFileSync(copy)).toEqual(expected);
    });
  }
});
