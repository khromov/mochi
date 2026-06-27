import { createHighlighter as createShiki } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';
import { mochiTheme } from './shiki-theme';

const shiki = await createShiki({
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
