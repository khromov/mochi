import { createHighlighter as createShiki, createJavaScriptRegexEngine } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';
import { logger, pinGlobal } from 'mochi-framework';
import { mochiTheme } from './shiki-theme';

// Pin the highlighter once per process: this module is bundled into every SSR graph that
// imports it (the main server bundle plus each demo/island bundle), so without the guard each
// copy would run `createShiki` again — loading ~11 TextMate grammars and, on Windows, its own
// ~100-150MB oniguruma WebAssembly.Memory that's never reclaimed. On Linux/macOS we use Shiki's
// JS RegExp engine; on Windows the JS engine's translated patterns backtrack pathologically
// under Bun (hanging CI), so fall back to oniguruma WASM there instead.
export const highlightCode = pinGlobal('__mochi_site_highlight__', () => {
  logger.warn(`[highlight] shiki engine for platform '${process.platform}': ${process.platform === 'win32' ? 'oniguruma WASM' : 'JS RegExp'}`);
  const engine = process.platform === 'win32' ? undefined : createJavaScriptRegexEngine({ forgiving: true });
  const shiki = createShiki({
    ...(engine ? { engine } : {}),
    themes: [mochiTheme],
    langs: ['bash', 'css', 'dockerfile', 'html', 'javascript', 'json', 'plaintext', 'sql', 'svelte', 'toml', 'typescript', 'xml', 'yaml'],
  });
  return createHighlighter((code, lang) =>
    shiki.then((s) =>
      s.codeToHtml(code, {
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
    ),
  );
});
