import hljs from 'highlight.js/lib/core';
import hljsBash from 'highlight.js/lib/languages/bash';
import hljsTypescript from 'highlight.js/lib/languages/typescript';
import hljsJavascript from 'highlight.js/lib/languages/javascript';
import hljsJson from 'highlight.js/lib/languages/json';
import hljsXml from 'highlight.js/lib/languages/xml';
import hljsCss from 'highlight.js/lib/languages/css';
import hljsPlaintext from 'highlight.js/lib/languages/plaintext';
import { createHighlighter } from 'mochi-framework/highlight';

hljs.registerLanguage('bash', hljsBash);
hljs.registerLanguage('sh', hljsBash);
hljs.registerLanguage('shell', hljsBash);
hljs.registerLanguage('typescript', hljsTypescript);
hljs.registerLanguage('ts', hljsTypescript);
hljs.registerLanguage('javascript', hljsJavascript);
hljs.registerLanguage('js', hljsJavascript);
hljs.registerLanguage('json', hljsJson);
hljs.registerLanguage('xml', hljsXml);
hljs.registerLanguage('html', hljsXml);
hljs.registerLanguage('svelte', hljsXml);
hljs.registerLanguage('css', hljsCss);
hljs.registerLanguage('plaintext', hljsPlaintext);

export const highlightCode = createHighlighter(hljs);
