import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

export default ts.config(
  {
    ignores: [
      '**/.mochi/',
      '**/.mochi-*/',
      '.claude/',
      'node_modules/',
      'out/',
      '**/CHANGELOG.md',
      '**/locales/.wuchale/',
      '**/*.loader.svelte.js',
      '**/*.loader.server.svelte.js',
      '**/locales/data.js',
    ],
  },
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
