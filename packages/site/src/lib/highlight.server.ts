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
import { escapeHtmlAttr, logger, pinGlobal } from 'mochi-framework';

export type Grammar = () => (code: string) => string;

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

/** Exported for tests; `highlightCode` is the instance the site actually renders through. */
export function createGrammarHighlighter(grammars: Record<string, Grammar>, aliases: Record<string, string>) {
  // Null-proto so a fence named after an Object.prototype member ('constructor', 'toString', …) resolves to
  // nothing rather than to an inherited function.
  const canonical: Record<string, string> = Object.assign(Object.create(null), aliases);
  const instances = new Map<string, (code: string) => string>();
  const warned = new Set<string>();
  const plaintext = (code: string) => `<pre class="twinkleplop"><code>${escapeHtmlAttr(code)}</code></pre>`;

  return createHighlighter((code, lang) => {
    const name = canonical[lang] ?? lang;
    const grammar = Object.hasOwn(grammars, name) ? grammars[name] : undefined;
    if (!grammar) {
      if (!warned.has(lang)) {
        warned.add(lang);
        logger.warn(`[highlight] no twinkleplop grammar for '${lang}'; rendering it unhighlighted.`);
      }
      return plaintext(code);
    }
    let render = instances.get(name);
    if (!render) {
      render = grammar();
      instances.set(name, render);
    }
    try {
      return render(code);
    } catch (err) {
      // twinkleplop is pre-1.0; one snippet it chokes on must not 500 the whole page.
      logger.warn(`[highlight] grammar '${name}' threw; rendering unhighlighted.`, err);
      return plaintext(code);
    }
  });
}

// Pin the highlighter once per process: this module is bundled into every SSR graph that imports it (the
// main server bundle plus each demo/island bundle), so without the guard each copy would build and memoize
// its own grammar instances and snippet cache. `packages/docs/_components/ProtectionShellSource.svelte`
// also reads this exact global by name, so the key is load-bearing.
export const highlightCode = pinGlobal('__mochi_site_highlight__', () => createGrammarHighlighter(GRAMMARS, ALIASES));
