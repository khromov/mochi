import { createHighlighter as createShiki, createJavaScriptRegexEngine } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';
import { logger } from 'mochi-framework';
import { mochiTheme } from './shiki-theme';

// Use Shiki's JS RegExp engine instead of the default oniguruma WASM engine:
// each compiled SSR bundle that imports this module would otherwise instantiate
// its own oniguruma WebAssembly.Memory (~100–150MB each, never reclaimed). This
// matters only in the deployed Linux container. On Windows the JS engine's
// Oniguruma→RegExp translation hangs (a translated pattern backtracks
// pathologically under Bun on Windows, timing out CI), so fall back to the
// oniguruma WASM engine there — the memory win is irrelevant off the prod host.
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
