import { escapeHtmlAttr } from './utils/htmlEscape';

function escapeForSvelte(html: string): string {
  return html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

/** Wrap already-highlighted HTML in the standard code-block shell — copy button and Svelte-brace escape — around the `<pre><code>` structure the engine produced. */
export function wrapCodeBlock(highlightedHtml: string): string {
  return `<div class="code-block"><button type="button" class="code-copy" aria-label="Copy code">${COPY_ICON_SVG}</button>${escapeForSvelte(highlightedHtml)}</div>`;
}

/** Memoized snippets per highlighter before insertion-ordered eviction kicks in. */
const DEFAULT_HIGHLIGHT_CACHE_SIZE = 1000;

export interface CreateHighlighterOptions {
  /** Max memoized snippets. `0` disables memoization. Default: 1000. */
  cacheSize?: number;
}

/**
 * Build a `highlightCode(code, lang)` function from any highlighting engine. You supply `highlight`, turning source into
 * themed HTML, and the result composes it with the code-block wrapper, copy button, and Svelte-brace escape.
 * Results memoize per `(code, lang)`, so a page re-highlighting the same snippets pays once.
 *
 * For twinkleplop grammars, reach for {@link createTwinkleplopHighlighter} instead — it wires the language map
 * and alias resolution on top of this.
 *
 * ```ts
 * import hljs from 'highlight.js';
 * import { createHighlighter } from 'mochi-framework/highlight';
 *
 * export const highlightCode = createHighlighter((code, lang) =>
 *   hljs.highlight(code, { language: lang }).value,
 * );
 * ```
 */
export function createHighlighter(
  highlight: (code: string, lang: string) => string | Promise<string>,
  options: CreateHighlighterOptions = {},
): (code: string, lang?: string | null) => string | Promise<string> {
  const max = options.cacheSize ?? DEFAULT_HIGHLIGHT_CACHE_SIZE;
  // Highlighting is pure in (code, lang) but a tokenizer pass costs milliseconds per snippet, enough that a page
  // re-highlighting its own code blocks each SSR render spends longer in the highlighter than in Svelte. The in-flight
  // promise is stored so concurrent callers share one pass, and insertion-ordered eviction bounds an app highlighting
  // user content.
  const cache = new Map<string, string | Promise<string>>();
  return (code, lang) => {
    const language = lang ?? 'plaintext';
    if (max <= 0) {
      return finish(highlight(code, language));
    }
    const key = `${language}\0${code}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const value = finish(highlight(code, language));
    if (cache.size >= max) {
      cache.delete(cache.keys().next().value!);
    }
    cache.set(key, value);
    // A failed pass must not be cached — the next call should retry rather than
    // replay a rejected promise forever. Guard on identity so a later retry that
    // has already re-populated this key isn't evicted by the original's rejection.
    if (typeof value !== 'string') {
      void value.catch(() => {
        if (cache.get(key) === value) {
          cache.delete(key);
        }
      });
    }
    return value;
  };
}

function finish(result: string | Promise<string>): string | Promise<string> {
  return typeof result === 'string' ? wrapCodeBlock(result) : result.then(wrapCodeBlock);
}

/** A twinkleplop grammar factory — the `language` export of any `@twinkleplop/<lang>` package. */
export type TwinkleplopLanguage = () => (code: string, options?: { line_numbers?: boolean }) => string;

export interface CreateTwinkleplopHighlighterOptions extends CreateHighlighterOptions {
  /** Grammar factories keyed by canonical language name, e.g. `{ typescript, svelte }`. */
  languages: Record<string, TwinkleplopLanguage>;
  /** Extra name → canonical-name mappings, merged over the built-in table. */
  aliases?: Record<string, string>;
  /** Emit `<span class="ln">` gutter numbers. Default: `false`. */
  lineNumbers?: boolean;
}

// Each twinkleplop grammar is its own package and carries no alias table, so the names markdown fences and
// file extensions actually use have to be mapped here or every ```ts block falls through to plaintext.
const TWINKLEPLOP_ALIASES: Record<string, string> = {
  cjs: 'javascript',
  console: 'bash',
  cts: 'typescript',
  dockerfile: 'bash',
  js: 'javascript',
  json5: 'json',
  jsonc: 'json',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  xml: 'html',
  yml: 'yaml',
  zsh: 'bash',
};

/**
 * Build a `highlightCode(code, lang)` function from twinkleplop grammars. Pass the `language` export of each
 * `@twinkleplop/<lang>` package you want; the result resolves aliases, instantiates each grammar on first use,
 * and composes the same code-block wrapper, copy button, and memoization as {@link createHighlighter}. A
 * language with no grammar renders escaped and unhighlighted rather than throwing.
 *
 * twinkleplop emits token classes (`<span class="tok keyword">`) rather than inline colours, so the theme is a
 * stylesheet you supply.
 *
 * ```ts
 * import { language as typescript } from '@twinkleplop/typescript';
 * import { language as svelte } from '@twinkleplop/svelte';
 * import { createTwinkleplopHighlighter } from 'mochi-framework/highlight';
 *
 * export const highlightCode = createTwinkleplopHighlighter({ languages: { typescript, svelte } });
 * ```
 */
export function createTwinkleplopHighlighter(options: CreateTwinkleplopHighlighterOptions): (code: string, lang?: string | null) => string {
  const { languages, aliases, lineNumbers, ...cacheOptions } = options;
  const canonical = { ...TWINKLEPLOP_ALIASES, ...aliases };
  const renderOptions = lineNumbers ? { line_numbers: true } : undefined;
  const instances = new Map<string, ReturnType<TwinkleplopLanguage>>();

  return createHighlighter((code, lang) => {
    const name = canonical[lang] ?? lang;
    const factory = languages[name];
    if (!factory) {
      return `<pre class="twinkleplop"><code>${escapeHtmlAttr(code)}</code></pre>`;
    }
    let render = instances.get(name);
    if (!render) {
      render = factory();
      instances.set(name, render);
    }
    return render(code, renderOptions);
  }, cacheOptions) as (code: string, lang?: string | null) => string;
}
