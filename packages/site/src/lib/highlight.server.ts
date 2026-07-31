import { createHighlighter as createShiki, createJavaScriptRegexEngine } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';
import { logger } from 'mochi-framework';
import { mochiTheme } from './shiki-theme';

// Use Shiki's JS RegExp engine instead of oniguruma WASM: each SSR bundle importing this
// module would otherwise instantiate its own ~100-150MB oniguruma WebAssembly.Memory that's
// never reclaimed, which matters only on the deployed Linux container. On Windows the JS
// engine's translated patterns backtrack pathologically under Bun (hanging CI), so fall
// back to oniguruma WASM there instead.
logger.warn(`[highlight] shiki engine for platform '${process.platform}': ${process.platform === 'win32' ? 'oniguruma WASM' : 'JS RegExp'}`);
const engine = process.platform === 'win32' ? undefined : createJavaScriptRegexEngine({ forgiving: true });
const shiki = await createShiki({
  ...(engine ? { engine } : {}),
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
