import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addLintTooling, renderEslintConfig, writeLintConfigs, type LintToolingOptions } from './lintSetup.ts';

const BOTH: LintToolingOptions = { eslint: true, prettier: true };
const ESLINT_ONLY: LintToolingOptions = { eslint: true, prettier: false };
const PRETTIER_ONLY: LintToolingOptions = { eslint: false, prettier: true };
const NEITHER: LintToolingOptions = { eslint: false, prettier: false };

describe('renderEslintConfig', () => {
  test('with prettier includes the bridge config entries', () => {
    const out = renderEslintConfig({ prettier: true });
    expect(out).toContain("import prettier from 'eslint-config-prettier';");
    expect(out).toContain('\n  prettier,\n');
    expect(out).toContain("...svelte.configs['flat/prettier'],");
  });

  test('without prettier omits every bridge entry', () => {
    const out = renderEslintConfig({ prettier: false });
    expect(out).not.toContain('eslint-config-prettier');
    expect(out).not.toContain('\n  prettier,\n');
    expect(out).not.toContain("['flat/prettier']");
  });

  test('always carries the base setup and project rules', () => {
    for (const prettier of [true, false]) {
      const out = renderEslintConfig({ prettier });
      expect(out).toContain("{ ignores: ['.mochi/', '.mochi-*/', 'node_modules/', 'out/'] },");
      expect(out).toContain('js.configs.recommended');
      expect(out).toContain('...ts.configs.recommended');
      expect(out).toContain("...svelte.configs['flat/recommended']");
      expect(out).toContain("curly: ['error', 'all']");
      expect(out).toContain("'no-undef': 'off'");
      expect(out).toContain('@typescript-eslint/no-unused-vars');
    }
  });
});

describe('addLintTooling', () => {
  const input = JSON.stringify({
    name: 'my-app',
    scripts: { dev: 'bun src/index.ts' },
    devDependencies: { typescript: '^6.0.3' },
  });

  test('both tools add all scripts, deps, and the bridge', () => {
    const out = JSON.parse(addLintTooling(input, BOTH));
    expect(out.scripts).toMatchObject({
      dev: 'bun src/index.ts',
      lint: 'eslint .',
      'lint:fix': 'eslint . --fix',
      format: 'prettier --write .',
      'format:check': 'prettier --check .',
    });
    for (const dep of ['@eslint/js', 'eslint', 'eslint-plugin-svelte', 'typescript-eslint', 'prettier', 'prettier-plugin-svelte', 'eslint-config-prettier', 'typescript']) {
      expect(out.devDependencies[dep]).toBeString();
    }
    expect(Object.keys(out.devDependencies)).toEqual([...Object.keys(out.devDependencies)].sort((a, b) => a.localeCompare(b)));
  });

  test('eslint only: no prettier deps or scripts, no bridge', () => {
    const out = JSON.parse(addLintTooling(input, ESLINT_ONLY));
    expect(out.scripts.lint).toBe('eslint .');
    expect(out.scripts.format).toBeUndefined();
    expect(out.devDependencies.eslint).toBeString();
    expect(out.devDependencies.prettier).toBeUndefined();
    expect(out.devDependencies['eslint-config-prettier']).toBeUndefined();
  });

  test('prettier only: no eslint deps or scripts, no bridge', () => {
    const out = JSON.parse(addLintTooling(input, PRETTIER_ONLY));
    expect(out.scripts.format).toBe('prettier --write .');
    expect(out.scripts.lint).toBeUndefined();
    expect(out.devDependencies.prettier).toBeString();
    expect(out.devDependencies.eslint).toBeUndefined();
    expect(out.devDependencies['eslint-config-prettier']).toBeUndefined();
  });

  test('neither returns the input untouched', () => {
    expect(addLintTooling(input, NEITHER)).toBe(input);
  });

  test('output ends with a newline', () => {
    expect(addLintTooling(input, BOTH).endsWith('\n')).toBe(true);
  });

  test('handles a package.json without scripts or devDependencies', () => {
    const out = JSON.parse(addLintTooling(JSON.stringify({ name: 'bare' }), BOTH));
    expect(out.scripts.lint).toBe('eslint .');
    expect(out.devDependencies.prettier).toBeString();
  });
});

describe('writeLintConfigs', () => {
  function writtenFiles(opts: LintToolingOptions): { dir: string; eslint: boolean; prettierrc: boolean; prettierignore: boolean } {
    const dir = mkdtempSync(join(tmpdir(), 'create-mochi-lint-'));
    writeLintConfigs(dir, opts);
    return {
      dir,
      eslint: existsSync(join(dir, 'eslint.config.js')),
      prettierrc: existsSync(join(dir, '.prettierrc')),
      prettierignore: existsSync(join(dir, '.prettierignore')),
    };
  }

  test('both writes all three files', () => {
    const { dir, eslint, prettierrc, prettierignore } = writtenFiles(BOTH);
    expect(eslint).toBe(true);
    expect(prettierrc).toBe(true);
    expect(prettierignore).toBe(true);
    const rc = JSON.parse(readFileSync(join(dir, '.prettierrc'), 'utf8'));
    expect(rc.plugins).toEqual(['prettier-plugin-svelte']);
    expect(rc.printWidth).toBe(180);
  });

  test('eslint only writes just the eslint config', () => {
    const files = writtenFiles(ESLINT_ONLY);
    expect(files.eslint).toBe(true);
    expect(files.prettierrc).toBe(false);
    expect(files.prettierignore).toBe(false);
  });

  test('prettier only writes just the prettier files', () => {
    const files = writtenFiles(PRETTIER_ONLY);
    expect(files.eslint).toBe(false);
    expect(files.prettierrc).toBe(true);
    expect(files.prettierignore).toBe(true);
  });

  test('neither writes nothing', () => {
    const files = writtenFiles(NEITHER);
    expect(files.eslint).toBe(false);
    expect(files.prettierrc).toBe(false);
    expect(files.prettierignore).toBe(false);
  });
});
