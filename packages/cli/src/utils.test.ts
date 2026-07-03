import { describe, expect, test } from 'bun:test';
import { resolveMochiVersionRange, setDefaultPort, transformPackageJson, transformTsconfig, validatePackageName } from './utils.ts';

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
        '@types/bun': '1.3.14',
      },
    });

    const out = JSON.parse(transformPackageJson(input, { name: 'my-app', mochiVersion: '^0.2.5' }));
    expect(out.name).toBe('my-app');
    expect(out.private).toBe(true);
    expect(out.dependencies['mochi-framework']).toBe('^0.2.5');
    expect(out.dependencies.svelte).toBe('^5.55.1');
    expect(out.devDependencies['@types/bun']).toBe('1.3.14');
  });

  test('replaces workspace:* deps for non-mochi packages with "latest"', () => {
    const input = JSON.stringify({
      name: 'pkg',
      dependencies: { 'some-internal-lib': 'workspace:*' },
    });
    const out = JSON.parse(transformPackageJson(input, { name: 'p', mochiVersion: '^0.1.0' }));
    expect(out.dependencies['some-internal-lib']).toBe('latest');
  });

  test('handles missing dependency fields', () => {
    const input = JSON.stringify({ name: 'pkg' });
    const out = JSON.parse(transformPackageJson(input, { name: 'my-app', mochiVersion: '^0.1.0' }));
    expect(out.name).toBe('my-app');
  });

  test('output ends with a newline', () => {
    const input = JSON.stringify({ name: 'x' });
    expect(transformPackageJson(input, { name: 'y', mochiVersion: '^0.1.0' }).endsWith('\n')).toBe(true);
  });

  test('wires up the svelte-check patch', () => {
    const input = JSON.stringify({ name: 'mochi-minimal' });
    const out = JSON.parse(transformPackageJson(input, { name: 'my-app', mochiVersion: '^0.1.0' }));
    expect(out.patchedDependencies).toEqual({
      'svelte-check@4.4.7': 'patches/svelte-check@4.4.7.patch',
      'svelte-check@4.6.0': 'patches/svelte-check@4.6.0.patch',
    });
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
