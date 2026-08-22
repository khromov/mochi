import { describe, expect, test } from 'bun:test';
import { isSvelteInput } from './utils';
import { cleanInputPath } from '../compiler/bundleInputPaths';

describe('isSvelteInput', () => {
  test('matches svelte under both linker layouts', () => {
    // The regression from #275: the isolated linker's store form kept a `svelte@<version>` prefix, so the old
    // `startsWith('svelte/')` predicate stopped matching and "Hide Svelte" filtered nothing in production.
    expect(isSvelteInput('svelte/src/internal/client/errors.js')).toBe(true);
    expect(isSvelteInput('svelte@5.56.8+7da81a596917ee3f/src/internal/client/errors.js')).toBe(true);
  });

  test('does not match other packages that merely start with svelte', () => {
    expect(isSvelteInput('svelte-toolbelt/dist/index.js')).toBe(false);
    expect(isSvelteInput('svelte-toolbelt@1.0.0/dist/index.js')).toBe(false);
    expect(isSvelteInput('@sveltejs/kit@2.0.0/dist/x.js')).toBe(false);
    expect(isSvelteInput('runed@0.25.0/dist/index.js')).toBe(false);
    expect(isSvelteInput('src/demos/mode-watcher/ModeControls.svelte')).toBe(false);
  });

  // Guards against format drift: cleanInputPath is the producer, isSvelteInput the consumer — if either side's
  // notion of a svelte path changes, this fails. This is the assertion #275 would have tripped.
  test('matches the store-form path cleanInputPath actually produces', () => {
    const cleaned = cleanInputPath('../../node_modules/.bun/svelte@5.56.8+7da81a596917ee3f/node_modules/svelte/src/internal/client/errors.js');

    expect(cleaned).toBe('svelte@5.56.8+7da81a596917ee3f/src/internal/client/errors.js');
    expect(isSvelteInput(cleaned)).toBe(true);
  });
});
