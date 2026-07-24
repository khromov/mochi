function escapeForSvelte(html: string): string {
  return html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

/**
 * Wrap already-highlighted HTML in the standard code-block shell
 * (copy button + Svelte-brace escape). The engine is responsible
 * for the `<pre><code>…</code></pre>` structure; this adds the
 * outer `<div class="code-block">` wrapper.
 */
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
 * Build a `highlightCode(code, lang)` function from any highlighting
 * engine. The consumer supplies `highlight` — a function that turns
 * source code into themed HTML (e.g. Shiki's `codeToHtml`). The
 * returned function composes it with the code-block wrapper, copy
 * button, and Svelte-brace escape. Results are memoized per `(code, lang)`, so a
 * page that highlights the same snippets on every SSR render pays for one pass.
 *
 * ```ts
 * import { createHighlighter as createShiki } from 'shiki';
 * import { createHighlighter } from 'mochi-framework/highlight';
 *
 * const shiki = await createShiki({ themes: ['vitesse-dark'], langs: ['typescript'] });
 * export const highlightCode = createHighlighter((code, lang) =>
 *   shiki.codeToHtml(code, { lang, theme: 'vitesse-dark' }),
 * );
 * ```
 */
export function createHighlighter(
  highlight: (code: string, lang: string) => string | Promise<string>,
  options: CreateHighlighterOptions = {},
): (code: string, lang?: string | null) => string | Promise<string> {
  const max = options.cacheSize ?? DEFAULT_HIGHLIGHT_CACHE_SIZE;
  // Highlighting is a pure function of (code, lang), but a TextMate grammar pass
  // costs milliseconds per snippet — enough that a page re-highlighting its own
  // code blocks on every SSR render spends more time in the highlighter than in
  // Svelte. Memoize the wrapped HTML, storing the in-flight promise so concurrent
  // callers for the same snippet share one pass. Insertion-ordered eviction keeps
  // an app that highlights unbounded input (user content) from growing forever.
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
