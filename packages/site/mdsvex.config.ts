import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import rehypeExternalLinks from './src/lib/rehypeExternalLinks';
import { highlightCode } from './src/lib/highlight.server';
import type { MarkdownConfig } from 'mochi-framework';

const markdownConfig: MarkdownConfig = {
  compile: mdsvexCompile,
  rehypePlugins: [rehypeSlug, rehypeExternalLinks],
  highlight: { highlighter: (code, lang) => highlightCode(code, lang) },
};

export default markdownConfig;
