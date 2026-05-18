/**
 * Minimal slice of the highlight.js API we use. Any real `hljs` instance
 * satisfies this — the type exists so consumers can adapt non-hljs engines
 * (shiki, prism, custom) without pulling in highlight.js types.
 */
export type HighlightJsLike = {
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
  getLanguage(name: string): unknown;
};

// Svelte treats raw `{` / `}` as expression delimiters, so braces inside
// highlighted code must be escaped before the HTML is embedded into a
// compiled component.
function escapeForSvelte(html: string): string {
  return html.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

/**
 * Build a `highlightCode(code, lang)` function bound to the consumer's
 * highlight.js instance. The framework supplies only the surrounding markup
 * (code-block wrapper + copy button + Svelte-brace escape); the consumer
 * owns the engine and which languages are registered.
 *
 * ```ts
 * import hljs from 'highlight.js/lib/core';
 * import typescript from 'highlight.js/lib/languages/typescript';
 * import { createHighlighter } from 'mochi-framework/highlight';
 *
 * hljs.registerLanguage('typescript', typescript);
 * export const highlightCode = createHighlighter(hljs);
 * ```
 */
export function createHighlighter(hljs: HighlightJsLike): (code: string, lang?: string | null) => string {
  return (code, lang) => {
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
    const { value } = hljs.highlight(code, { language, ignoreIllegals: true });
    return `<div class="code-block"><button type="button" class="code-copy" aria-label="Copy code">${COPY_ICON_SVG}</button><pre class="hljs language-${language}"><code>${escapeForSvelte(value)}</code></pre></div>`;
  };
}
