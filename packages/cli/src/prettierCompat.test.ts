import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prettier from 'prettier';
import { transformPackageJson, transformTsconfig } from './utils.ts';
import { addLintTooling, renderEslintConfig, writeLintConfigs } from './lintSetup.ts';

// Mirrors the generated .prettierrc, so drift between stringifyJson's line-fit heuristic and real
// prettier fails here instead of in a fresh scaffold's own `format:check`.
const SCAFFOLD_PRETTIER_OPTIONS = { printWidth: 180, useTabs: false, singleQuote: true, trailingComma: 'all' } as const;

const TEMPLATES_DIR = join(import.meta.dir, '..', '..');

async function expectPrettierClean(source: string, parser: 'json' | 'babel'): Promise<void> {
  expect(await prettier.format(source, { ...SCAFFOLD_PRETTIER_OPTIONS, parser })).toBe(source);
}

describe('generated output matches real prettier', () => {
  for (const template of ['minimal', 'demos'] as const) {
    test(`${template} package.json survives the full transform chain`, async () => {
      const dir = join(TEMPLATES_DIR, template);
      const transformed = transformPackageJson(readFileSync(join(dir, 'package.json'), 'utf8'), { name: 'my-app', mochiVersion: '^0.9.1', dir });
      await expectPrettierClean(addLintTooling(transformed, { eslint: true, prettier: true }), 'json');
    });

    test(`${template} tsconfig.json transform`, async () => {
      await expectPrettierClean(transformTsconfig(readFileSync(join(TEMPLATES_DIR, template, 'tsconfig.json'), 'utf8')), 'json');
    });
  }

  test('generated eslint.config.js, both variants', async () => {
    await expectPrettierClean(renderEslintConfig({ prettier: true }), 'babel');
    await expectPrettierClean(renderEslintConfig({ prettier: false }), 'babel');
  });

  test('generated .prettierrc', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-mochi-prettier-'));
    writeLintConfigs(dir, { eslint: false, prettier: true });
    await expectPrettierClean(readFileSync(join(dir, '.prettierrc'), 'utf8'), 'json');
  });
});
