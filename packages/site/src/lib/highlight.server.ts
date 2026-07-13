import { createHighlighter as createShiki, createJavaScriptRegexEngine } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';
import { mochiTheme } from './shiki-theme';

// Use Shiki's JS RegExp engine instead of the default oniguruma WASM engine:
// each compiled SSR bundle that imports this module would otherwise instantiate
// its own oniguruma WebAssembly.Memory (~100–150MB each, never reclaimed).
const shiki = await createShiki({
  engine: createJavaScriptRegexEngine({ forgiving: true }),
  themes: [mochiTheme],
  langs: ['bash', 'css', 'dockerfile', 'html', 'javascript', 'json', 'plaintext', 'svelte', 'toml', 'typescript', 'xml'],
});

export const highlightCode = createHighlighter((code, lang) =>
  shiki.codeToHtml(code, {
    lang,
    theme: 'mochi',
    transformers: [
      {
        pre(node) {
          node.properties.style = 'background-color:var(--code-bg);color:var(--code-text)';
        },
      },
    ],
  }),
);
