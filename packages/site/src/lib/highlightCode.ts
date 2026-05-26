import { createHighlighter as createShiki } from 'shiki';
import { createHighlighter } from 'mochi-framework/highlight';

const shiki = await createShiki({
  themes: ['vitesse-dark'],
  langs: ['bash', 'css', 'dockerfile', 'html', 'javascript', 'json', 'plaintext', 'svelte', 'typescript', 'xml'],
});

export const highlightCode = createHighlighter((code, lang) =>
  shiki.codeToHtml(code, {
    lang,
    theme: 'vitesse-dark',
    transformers: [
      {
        pre(node) {
          node.properties.style = 'background-color:var(--code-bg);color:var(--code-text)';
        },
      },
    ],
  }),
);
