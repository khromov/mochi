import { language as bash } from '@twinkleplop/bash';
import { language as css } from '@twinkleplop/css';
import { language as html } from '@twinkleplop/html';
import { language as javascript } from '@twinkleplop/javascript';
import { language as json } from '@twinkleplop/json';
import { language as svelte } from '@twinkleplop/svelte';
import { language as toml } from '@twinkleplop/toml';
import { language as typescript } from '@twinkleplop/typescript';
import { language as yaml } from '@twinkleplop/yaml';
import { createHighlighter } from 'mochi-framework/highlight';
import { escapeHtmlAttr, pinGlobal } from 'mochi-framework';

type Grammar = () => (code: string) => string;

const GRAMMARS: Record<string, Grammar> = { bash, css, html, javascript, json, svelte, toml, typescript, yaml };

// twinkleplop ships one package per language and carries no alias table of its own, so the names our
// fences and file extensions actually use have to be mapped here or every ts block renders as plaintext.
const ALIASES: Record<string, string> = {
  dockerfile: 'bash',
  js: 'javascript',
  jsonc: 'json',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  xml: 'html',
  yml: 'yaml',
};

const instances = new Map<string, (code: string) => string>();

// Pin the highlighter once per process: this module is bundled into every SSR graph that imports it (the
// main server bundle plus each demo/island bundle), so without the guard each copy would build and memoize
// its own grammar instances and snippet cache. `packages/docs/_components/ProtectionShellSource.svelte`
// also reads this exact global by name, so the key is load-bearing.
export const highlightCode = pinGlobal('__mochi_site_highlight__', () =>
  createHighlighter((code, lang) => {
    const name = ALIASES[lang] ?? lang;
    const grammar = GRAMMARS[name];
    if (!grammar) {
      return `<pre class="twinkleplop"><code>${escapeHtmlAttr(code)}</code></pre>`;
    }
    let render = instances.get(name);
    if (!render) {
      render = grammar();
      instances.set(name, render);
    }
    return render(code);
  }),
);
