import { language as bash } from '@twinkleplop/bash';
import { language as css } from '@twinkleplop/css';
import { language as html } from '@twinkleplop/html';
import { language as javascript } from '@twinkleplop/javascript';
import { language as json } from '@twinkleplop/json';
import { language as svelte } from '@twinkleplop/svelte';
import { language as toml } from '@twinkleplop/toml';
import { language as typescript } from '@twinkleplop/typescript';
import { language as yaml } from '@twinkleplop/yaml';
import { createTwinkleplopHighlighter } from 'mochi-framework/highlight';
import { pinGlobal } from 'mochi-framework';

// Pin the highlighter once per process: this module is bundled into every SSR graph that imports it (the main
// server bundle plus each demo/island bundle), so without the guard each copy would build and memoize its own
// grammar instances and snippet cache. `packages/docs/_components/ProtectionShellSource.svelte` also reads this
// exact global by name, so the key is load-bearing.
export const highlightCode = pinGlobal('__mochi_site_highlight__', () =>
  createTwinkleplopHighlighter({
    languages: { bash, css, html, javascript, json, svelte, toml, typescript, yaml },
  }),
);
