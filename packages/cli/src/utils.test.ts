import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveMochiVersionRange, setDefaultPort, stringifyJson, transformPackageJson, transformTsconfig, validatePackageName } from './utils.ts';

/** A scaffold dir whose `patches/` folder holds the given `name@version.patch` files (none → no `patches/` dir). */
function scaffoldDir(patchFiles: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-mochi-test-'));
  if (patchFiles.length > 0) {
    const patchesDir = join(dir, 'patches');
    mkdirSync(patchesDir);
    for (const file of patchFiles) {
      writeFileSync(join(patchesDir, file), '');
    }
  }
  return dir;
}

describe('validatePackageName', () => {
  test('accepts simple names', () => {
    expect(validatePackageName('my-app')).toBeNull();
    expect(validatePackageName('hello_world')).toBeNull();
    expect(validatePackageName('a')).toBeNull();
  });

  test('accepts scoped names', () => {
    expect(validatePackageName('@scope/pkg')).toBeNull();
    expect(validatePackageName('@my-org/my-app')).toBeNull();
  });

  test('rejects invalid names', () => {
    expect(validatePackageName('')).not.toBeNull();
    expect(validatePackageName('My-App')).not.toBeNull();
    expect(validatePackageName('.hidden')).not.toBeNull();
    expect(validatePackageName('a/b')).not.toBeNull();
    expect(validatePackageName('a'.repeat(215))).not.toBeNull();
  });
});

describe('resolveMochiVersionRange', () => {
  test('caret-prefixes a real version', () => {
    expect(resolveMochiVersionRange('0.2.0')).toBe('^0.2.0');
    expect(resolveMochiVersionRange('1.0.0')).toBe('^1.0.0');
  });

  test('falls back to the pinned floor when version is null', () => {
    expect(resolveMochiVersionRange(null)).toBe('^0.1.1');
  });
});

describe('transformPackageJson', () => {
  test('replaces name and workspace deps', () => {
    const input = JSON.stringify({
      name: 'mochi-minimal',
      private: true,
      dependencies: {
        'mochi-framework': 'workspace:*',
        svelte: '^5.55.1',
      },
      devDependencies: {
        '@types/bun': '1.4.0',
      },
    });

    const out = JSON.parse(transformPackageJson(input, { name: 'my-app', mochiVersion: '^0.2.5', dir: scaffoldDir() }));
    expect(out.name).toBe('my-app');
    expect(out.private).toBe(true);
    expect(out.dependencies['mochi-framework']).toBe('^0.2.5');
    expect(out.dependencies.svelte).toBe('^5.55.1');
    expect(out.devDependencies['@types/bun']).toBe('1.4.0');
  });

  test('replaces workspace:* deps for non-mochi packages with "latest"', () => {
    const input = JSON.stringify({
      name: 'pkg',
      dependencies: { 'some-internal-lib': 'workspace:*' },
    });
    const out = JSON.parse(transformPackageJson(input, { name: 'p', mochiVersion: '^0.1.0', dir: scaffoldDir() }));
    expect(out.dependencies['some-internal-lib']).toBe('latest');
  });

  test('handles missing dependency fields', () => {
    const input = JSON.stringify({ name: 'pkg' });
    const out = JSON.parse(transformPackageJson(input, { name: 'my-app', mochiVersion: '^0.1.0', dir: scaffoldDir() }));
    expect(out.name).toBe('my-app');
  });

  test('output ends with a newline', () => {
    const input = JSON.stringify({ name: 'x' });
    expect(transformPackageJson(input, { name: 'y', mochiVersion: '^0.1.0', dir: scaffoldDir() }).endsWith('\n')).toBe(true);
  });

  // Derived from the patch files the template ships — not a hardcoded list — so a
  // published CLI never drifts behind a template's svelte-check bump.
  test('derives patchedDependencies from the template patches/ dir', () => {
    const dir = scaffoldDir(['svelte-check@4.7.3.patch', 'svelte-check@4.7.4.patch']);
    const out = JSON.parse(transformPackageJson(JSON.stringify({ name: 'mochi-minimal' }), { name: 'my-app', mochiVersion: '^0.1.0', dir }));
    expect(out.patchedDependencies).toEqual({
      'svelte-check@4.7.3': 'patches/svelte-check@4.7.3.patch',
      'svelte-check@4.7.4': 'patches/svelte-check@4.7.4.patch',
    });
  });

  test('omits patchedDependencies when the template ships no patches/ dir', () => {
    const out = JSON.parse(transformPackageJson(JSON.stringify({ name: 'mochi-minimal' }), { name: 'my-app', mochiVersion: '^0.1.0', dir: scaffoldDir() }));
    expect(out.patchedDependencies).toBeUndefined();
  });

  test('ignores non-.patch files in patches/', () => {
    const dir = scaffoldDir(['svelte-check@4.7.4.patch', 'README.md']);
    const out = JSON.parse(transformPackageJson(JSON.stringify({ name: 'mochi-minimal' }), { name: 'my-app', mochiVersion: '^0.1.0', dir }));
    expect(out.patchedDependencies).toEqual({ 'svelte-check@4.7.4': 'patches/svelte-check@4.7.4.patch' });
  });
});

describe('transformTsconfig', () => {
  test('inlines base tsconfig when extending it', () => {
    const input = JSON.stringify({
      extends: '../../tsconfig.base.json',
      compilerOptions: { types: ['bun'] },
      include: ['src/**/*'],
    });
    const out = JSON.parse(transformTsconfig(input));
    expect(out.extends).toBeUndefined();
    expect(out.compilerOptions.target).toBe('ESNext');
    expect(out.compilerOptions.types).toEqual(['bun']);
    expect(out.compilerOptions.strict).toBe(true);
    expect(out.include).toEqual(['src/**/*']);
  });

  test('leaves unrelated tsconfigs untouched', () => {
    const input = JSON.stringify({ compilerOptions: { strict: true } });
    const out = JSON.parse(transformTsconfig(input));
    expect(out.compilerOptions.strict).toBe(true);
  });

  test('drops only the base extends, not other extensions', () => {
    const input = JSON.stringify({ extends: 'some-other-config' });
    const out = JSON.parse(transformTsconfig(input));
    expect(out.extends).toBe('some-other-config');
  });
});

describe('stringifyJson', () => {
  test('collapses short primitive arrays onto one line, like prettier does', () => {
    const out = stringifyJson({ lib: ['ESNext', 'DOM', 'DOM.Iterable'], strict: true });
    expect(out).toContain('"lib": ["ESNext", "DOM", "DOM.Iterable"]');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('keeps arrays with object elements expanded', () => {
    const out = stringifyJson({ overrides: [{ files: ['*.svelte'] }] });
    expect(out).toContain('"overrides": [\n');
    expect(out).toContain('"files": ["*.svelte"]');
  });

  test('keeps very long primitive arrays expanded', () => {
    const out = stringifyJson({ items: Array.from({ length: 40 }, (_, i) => `entry-number-${i}`) });
    expect(out).toContain('"items": [\n');
  });

  test('round-trips values and drops undefined like JSON.stringify', () => {
    const value = { a: 1, b: 'x', c: null, d: undefined, e: [], f: {} };
    expect(JSON.parse(stringifyJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });

  test('serializes undefined array elements as null, like JSON.stringify', () => {
    const out = stringifyJson({ a: [1, undefined, 3] });
    expect(out).not.toContain('undefined');
    expect(JSON.parse(out)).toEqual({ a: [1, null, 3] });
  });

  // The inline-vs-expand decision must mirror prettier's, which fits the whole `"key": […],` line into printWidth 180.
  test('counts the key prefix when deciding whether an array fits inline', () => {
    const shortKeyLongArray = stringifyJson({ k: Array.from({ length: 12 }, () => 'x'.repeat(10)) });
    expect(shortKeyLongArray).toContain('"k": ["xxxxxxxxxx", ');
    const longKeySameArray = stringifyJson({ ['k'.repeat(170)]: Array.from({ length: 12 }, () => 'x'.repeat(10)) });
    expect(longKeySameArray).toContain('": [\n');
  });

  test('transformTsconfig output keeps the inlined base arrays prettier-clean', () => {
    const out = transformTsconfig(JSON.stringify({ extends: '../../tsconfig.base.json', compilerOptions: { types: ['bun'] }, include: ['src/**/*'] }));
    expect(out).toContain('"lib": ["ESNext", "DOM", "DOM.Iterable"]');
    expect(out).toContain('"types": ["bun"]');
    expect(out).toContain('"include": ["src/**/*"]');
  });
});

describe('setDefaultPort', () => {
  test('replaces a non-3333 port and preserves surrounding context', () => {
    const input = `import { Mochi } from 'mochi-framework';\n\nconst PORT = Number(process.env.PORT) || 3335;\n\nawait Mochi.serve({ port: PORT });\n`;
    const out = setDefaultPort(input, 3333);
    expect(out).toContain('const PORT = Number(process.env.PORT) || 3333;');
    expect(out).not.toContain('3335');
    expect(out).toContain("import { Mochi } from 'mochi-framework';");
    expect(out).toContain('await Mochi.serve({ port: PORT });');
  });

  test('is idempotent when the port already matches', () => {
    const input = `const PORT = Number(process.env.PORT) || 3333;\n`;
    expect(setDefaultPort(input, 3333)).toBe(input);
  });

  test('returns input unchanged when the pattern is absent', () => {
    const input = `const port = 4000;\nconsole.log(port);\n`;
    expect(setDefaultPort(input, 3333)).toBe(input);
  });
});
