import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import deepmerge from 'deepmerge';
import type { CompileOptions } from 'svelte/compiler';
import { FRAMEWORK_COMPILER_DEFAULTS, FRAMEWORK_FORCED_COMPILER_OPTIONS, loadSvelteConfig, mergeCompilerOptions } from './svelteConfig';
import shippedSvelteConfig from '../../svelte.config.js';

/** Stand-in for the framework-owned overrides a real call site would pass. */
const forced = (extra: CompileOptions = {}): CompileOptions => ({
  generate: 'server',
  filename: 'a.svelte',
  ...extra,
});

describe('mergeCompilerOptions', () => {
  test('applies framework defaults when nothing else provides them', () => {
    const out = mergeCompilerOptions(undefined, forced());
    expect(out.experimental?.async).toBe(true);
    expect(out.generate).toBe('server');
    expect(out.filename).toBe('a.svelte');
  });

  test('user can override a framework default', () => {
    const out = mergeCompilerOptions({ discloseVersion: true }, forced());
    expect(out.discloseVersion).toBe(true);
  });

  test('forced fields always win over user', () => {
    const out = mergeCompilerOptions({ generate: 'client', filename: 'user-says.svelte' }, forced({ filename: 'forced.svelte' }));
    expect(out.generate).toBe('server');
    expect(out.filename).toBe('forced.svelte');
  });

  test('forced fields win over defaults', () => {
    const out = mergeCompilerOptions(undefined, forced({ discloseVersion: true }));
    expect(out.discloseVersion).toBe(true);
  });

  test('experimental.async cannot be turned off by the user', () => {
    const out = mergeCompilerOptions({ experimental: { async: false } }, forced());
    expect(out.experimental?.async).toBe(true);
  });

  test('experimental.async cannot be turned off by a call site either', () => {
    const out = mergeCompilerOptions(undefined, forced({ experimental: { async: false } }));
    expect(out.experimental?.async).toBe(true);
  });

  test('user adds sibling keys without losing framework defaults', () => {
    // The user adds an unrelated experimental flag; `async: true` from defaults must survive.
    const out = mergeCompilerOptions({ experimental: { async: true, somethingElse: true } as Record<string, unknown> }, forced());
    expect(out.experimental?.async).toBe(true);
    expect((out.experimental as Record<string, unknown>).somethingElse).toBe(true);
  });

  test('discloseVersion defaults to false but the user can override it', () => {
    const def = mergeCompilerOptions(undefined, forced());
    expect(def.discloseVersion).toBe(false);

    const overridden = mergeCompilerOptions({ discloseVersion: true }, forced());
    expect(overridden.discloseVersion).toBe(true);
  });

  test('user arrays replace framework arrays rather than concatenating', () => {
    // `CompileOptions` has no array-valued field to assert on, so we use a made-up
    // `someArray` key and cast past the type checker. `deepmerge`'s `arrayMerge`
    // runs on any array value regardless of key, so this still exercises the real
    // merge behavior.
    const out = mergeCompilerOptions(
      { someArray: ['user'] } as unknown as CompileOptions,
      {
        ...forced(),
        someArray: ['default'],
      } as unknown as CompileOptions,
    );
    expect((out as unknown as Record<string, unknown>).someArray).toEqual(['default']);

    const out2 = mergeCompilerOptions({ someArray: ['user'] } as unknown as CompileOptions, forced());
    expect((out2 as unknown as Record<string, unknown>).someArray).toEqual(['user']);
  });

  test('preserves unrelated top-level user options', () => {
    const out = mergeCompilerOptions({ runes: false, preserveComments: true }, forced());
    expect(out.runes).toBe(false);
    expect(out.preserveComments).toBe(true);
    // Defaults still flow through.
    expect(out.experimental?.async).toBe(true);
  });

  test('does not mutate the inputs', () => {
    const user = { experimental: { async: false } };
    const forcedArg = forced();
    const snapshot = () =>
      JSON.stringify({
        user,
        forced: forcedArg,
        defaults: FRAMEWORK_COMPILER_DEFAULTS,
        frameworkForced: FRAMEWORK_FORCED_COMPILER_OPTIONS,
      });
    const before = snapshot();
    mergeCompilerOptions(user, forcedArg);
    expect(snapshot()).toBe(before);
  });
});

describe('shipped svelte.config.js', () => {
  // The published config is a dependency-free literal (svelte-check loads it under Node,
  // so it cannot import from `src/`). This guards the two copies against drifting apart.
  test('mirrors the framework compiler options', () => {
    expect(shippedSvelteConfig.compilerOptions as CompileOptions).toEqual(deepmerge(FRAMEWORK_COMPILER_DEFAULTS, FRAMEWORK_FORCED_COMPILER_OPTIONS));
  });
});

describe('loadSvelteConfig', () => {
  test('returns {} when the file is missing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-svelte-config-'));
    try {
      const cfg = await loadSvelteConfig(path.join(dir, 'svelte.config.js'));
      expect(cfg).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reads compilerOptions from an ESM config file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-svelte-config-'));
    try {
      const file = path.join(dir, 'svelte.config.js');
      writeFileSync(file, `export default { compilerOptions: { runes: false, experimental: { async: false } } };\n`);
      const cfg = await loadSvelteConfig(file);
      expect(cfg.compilerOptions?.runes).toBe(false);
      expect(cfg.compilerOptions?.experimental?.async).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('honors a non-default config filename', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-svelte-config-'));
    try {
      const file = path.join(dir, 'svelte.staging.config.js');
      writeFileSync(file, `export default { compilerOptions: { runes: false } };\n`);
      const cfg = await loadSvelteConfig(file);
      expect(cfg.compilerOptions?.runes).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('merges loaded user config with framework defaults end-to-end', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-svelte-config-'));
    try {
      const file = path.join(dir, 'svelte.config.js');
      writeFileSync(file, `export default { compilerOptions: { runes: false } };\n`);
      const cfg = await loadSvelteConfig(file);
      const merged = mergeCompilerOptions(cfg.compilerOptions, forced());
      // user's runes carries through
      expect(merged.runes).toBe(false);
      // framework default for experimental.async still applies
      expect(merged.experimental?.async).toBe(true);
      // forced fields applied
      expect(merged.generate).toBe('server');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
