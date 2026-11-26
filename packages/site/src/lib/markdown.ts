import { compile as mdsvexCompile } from 'mdsvex';
import { toHtml } from 'hast-util-to-html';
import { decodeHTML } from 'entities';
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
    // mdsvex entity-encodes text inside code spans (`<` → `&lt;`, `{` → `&#123;`) so
    // the compiled Svelte stays valid; decode it back for use as a plain-text title.
    return decodeHTML(node.value ?? '');
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

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeUrl(url: string): boolean {
  try {
    return SAFE_URL_PROTOCOLS.has(new URL(url, 'https://mochi.fast/').protocol);
  } catch {
    return false;
  }
}

// Runtime markdown isn't hand-authored (the changelog is release-please output built from PR titles), so a `javascript:` link in it must not reach the page.
function stripUnsafeUrls(node: HastNode): void {
  for (const key of ['href', 'src']) {
    const value = node.properties?.[key];
    if (typeof value === 'string' && !isSafeUrl(value)) {
      delete node.properties?.[key];
    }
  }
  node.children?.forEach(stripUnsafeUrls);
}

/** Renders markdown that arrives at runtime (so it can't go through the `*.prerender.ts` `.md` → Svelte map) to plain HTML, using the same mdsvex + rehype pipeline as the docs. */
export async function renderMarkdown(markdown: string): Promise<string> {
  let html = '';
  // Stringify inside the plugin: mdsvex keeps transforming the tree afterwards on its
  // way to Svelte source, so a reference captured here is stale by the time it resolves.
  const capture = () => (tree: HastNode) => {
    stripUnsafeUrls(tree);
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
