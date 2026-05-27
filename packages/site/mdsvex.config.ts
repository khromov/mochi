import { compile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import rehypeExternalLinks from './src/lib/rehypeExternalLinks';
import { highlightCode } from './src/lib/highlight.server';
import type { MarkdownConfig } from 'mochi-framework';

export default {
  compile,
  rehypePlugins: [rehypeSlug, rehypeExternalLinks],
  highlight: { highlighter: (code, lang) => highlightCode(code, lang) },
} satisfies MarkdownConfig;
