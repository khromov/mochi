import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

// Hybrid lint setup: oxlint owns all .ts/.js linting (see .oxlintrc.json); ESLint is kept
// solely for Svelte-template rules (eslint-plugin-svelte), which oxlint has no equivalent for.
export default ts.config(
  { ignores: ['**/.mochi/', '**/.mochi-*/', '.claude/', 'node_modules/', 'out/', '**/CHANGELOG.md', '**/virtual-modules/'] },
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
  prettier,
  ...svelte.configs['flat/prettier'],
  // Keep project rules last so they override prettier configs (which disable `curly`)
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    rules: {
      curly: ['error', 'all'],
    },
  },
);
