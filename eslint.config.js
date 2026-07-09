import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

export default ts.config(
  // `reproduction-svelte/` is a self-contained repro with its own install and uses
  // Svelte's experimental async syntax (`await` in `$derived`) that the root config
  // doesn't enable — it has its own toolchain, so keep it out of the repo lint.
  { ignores: ['**/.mochi/', '**/.mochi-*/', '.claude/', 'node_modules/', 'out/', '**/CHANGELOG.md', 'reproduction-svelte/'] },
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
  // .cjs files are CommonJS — expose module/require/exports globals
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  // Standalone Bun/Node scripts (e.g. the Bun-bug reproduction) use runtime globals
  {
    files: ['reproduction/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  prettier,
  ...svelte.configs['flat/prettier'],
  // Keep project rules last so they override prettier configs (which disable `curly`)
  {
    rules: {
      curly: ['error', 'all'],
      // Allow underscore-prefixed unused vars (common destructuring pattern)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
