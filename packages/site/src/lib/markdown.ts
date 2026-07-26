import { compile as mdsvexCompile } from 'mdsvex';
import { toHtml } from 'hast-util-to-html';
import rehypeSlug from 'rehype-slug';
import rehypeExternalLinks from './rehypeExternalLinks';
import type { TocEntry } from './toc';

export type MdsvexRehypePlugin = NonNullable<NonNullable<Parameters<typeof mdsvexCompile>[1]>['rehypePlugins']>[number];

export type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export function hastText(node: HastNode): string {
  if (node.type === 'text') {
    return node.value ?? '';
  }
  if (!node.children) {
    return '';
  }
  return node.children.map(hastText).join('');
}

/** Top-level headings of a hast tree, carrying the ids rehype-slug assigned. */
export function collectHeadings(tree: HastNode): TocEntry[] {
  const toc: TocEntry[] = [];
  for (const node of tree.children ?? []) {
    if (node.type !== 'element' || !node.tagName) {
      continue;
    }
    const match = /^h([1-6])$/.exec(node.tagName);
    if (!match) {
      continue;
    }
    toc.push({
      level: Number(match[1]),
      text: hastText(node),
      slug: String(node.properties?.id ?? ''),
    });
  }
  return toc;
}

/**
 * Markdown to plain HTML, for content that arrives at runtime and so can't go through
 * the build-time `.md` → Svelte component barrel. Runs the same mdsvex + rehype pipeline
 * the docs use, then stringifies the hast tree instead of letting mdsvex emit Svelte source.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  let html = '';
  // Stringify inside the plugin: mdsvex keeps transforming the tree afterwards on its
  // way to Svelte source, so a reference captured here is stale by the time it resolves.
  const capture = () => (tree: HastNode) => {
    html = toHtml(tree as Parameters<typeof toHtml>[0]);
  };
  await mdsvexCompile(markdown, {
    extensions: ['.md', '.svx'],
    // Same pair (and order) the authored docs are built with in index.ts, so runtime
    // markdown gets the same heading ids and the same new-tab treatment on outbound links.
    rehypePlugins: [rehypeSlug as unknown as MdsvexRehypePlugin, rehypeExternalLinks as unknown as MdsvexRehypePlugin, capture as unknown as MdsvexRehypePlugin],
    highlight: false,
  });
  return html;
}
