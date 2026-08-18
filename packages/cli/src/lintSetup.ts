import path from 'node:path';
import fs from 'node:fs';
import { stringifyJson } from './utils.ts';

export interface LintToolingOptions {
  eslint: boolean;
  prettier: boolean;
}

// Caret ranges, refreshed on CLI releases via `bun info <pkg> version`.
const ESLINT_DEV_DEPENDENCIES: Record<string, string> = {
  '@eslint/js': '^10.0.1',
  eslint: '^10.8.1',
  'eslint-plugin-svelte': '^3.23.0',
  'typescript-eslint': '^8.67.0',
};

const PRETTIER_DEV_DEPENDENCIES: Record<string, string> = {
  prettier: '^3.9.6',
  'prettier-plugin-svelte': '^4.1.1',
};

// Bridges the two tools (turns off eslint's stylistic rules) — only wanted when both are chosen.
const ESLINT_PRETTIER_BRIDGE_DEV_DEPENDENCIES: Record<string, string> = {
  'eslint-config-prettier': '^10.1.8',
};

export function renderEslintConfig(opts: { prettier: boolean }): string {
  const prettierImport = opts.prettier ? "import prettier from 'eslint-config-prettier';\n" : '';
  const prettierEntries = opts.prettier ? "  prettier,\n  ...svelte.configs['flat/prettier'],\n" : '';
  const projectRulesComment = opts.prettier ? '  // Keep project rules last so they override prettier configs (which disable `curly`)\n' : '';
  return `import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
${prettierImport}
export default ts.config(
  { ignores: ['.mochi/', '.mochi-*/', 'node_modules/', 'out/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },
  // .svelte.ts/.svelte.js files use Svelte runes ($state, etc.) — let svelte plugin handle them
  {
    files: ['**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parser: svelte.parser,
      parserOptions: { parser: ts.parser },
    },
  },
  // no-undef is redundant with TypeScript — TS already catches undefined variables
  {
    files: ['**/*.ts', '**/*.svelte'],
    rules: { 'no-undef': 'off' },
  },
${prettierEntries}${projectRulesComment}  {
    rules: {
      curly: ['error', 'all'],
      // Allow underscore-prefixed unused vars (common destructuring pattern)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
`;
}

const PRETTIERRC = `{
  "useTabs": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 180,
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [
    {
      "files": ["*.svelte"],
      "options": {
        "parser": "svelte"
      }
    }
  ]
}
`;

const PRETTIERIGNORE = `.mochi/
.mochi-*/
out/
patches/
`;

function lintScripts(opts: LintToolingOptions): Record<string, string> {
  return {
    ...(opts.eslint ? { lint: 'eslint .', 'lint:fix': 'eslint . --fix' } : {}),
    ...(opts.prettier ? { format: 'prettier --write .', 'format:check': 'prettier --check .' } : {}),
  };
}

function lintDevDependencies(opts: LintToolingOptions): Record<string, string> {
  return {
    ...(opts.eslint ? ESLINT_DEV_DEPENDENCIES : {}),
    ...(opts.prettier ? PRETTIER_DEV_DEPENDENCIES : {}),
    ...(opts.eslint && opts.prettier ? ESLINT_PRETTIER_BRIDGE_DEV_DEPENDENCIES : {}),
  };
}

/** Merge lint/format scripts and devDependencies into a scaffold's `package.json` contents. */
export function addLintTooling(contents: string, opts: LintToolingOptions): string {
  if (!opts.eslint && !opts.prettier) {
    return contents;
  }
  const pkg = JSON.parse(contents) as Record<string, unknown>;
  pkg.scripts = { ...(pkg.scripts as Record<string, string> | undefined), ...lintScripts(opts) };
  const devDeps = { ...(pkg.devDependencies as Record<string, string> | undefined), ...lintDevDependencies(opts) };
  pkg.devDependencies = Object.fromEntries(Object.entries(devDeps).sort(([a], [b]) => a.localeCompare(b)));
  return stringifyJson(pkg);
}

export function writeLintConfigs(dir: string, opts: LintToolingOptions): void {
  if (opts.eslint) {
    fs.writeFileSync(path.join(dir, 'eslint.config.js'), renderEslintConfig({ prettier: opts.prettier }));
  }
  if (opts.prettier) {
    fs.writeFileSync(path.join(dir, '.prettierrc'), PRETTIERRC);
    fs.writeFileSync(path.join(dir, '.prettierignore'), PRETTIERIGNORE);
  }
}
