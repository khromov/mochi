type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const INTERNAL_DOMAIN = 'mochi.fast';

function isInternalLink(href: string): boolean {
  if (href.startsWith('/') || href.startsWith('#')) {
    return true;
  }
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return true;
    }
    const host = url.hostname;
    return host === INTERNAL_DOMAIN || host.endsWith(`.${INTERNAL_DOMAIN}`);
  } catch {
    return true;
  }
}

function processLink(node: HastNode): void {
  const props = node.properties;
  if (!props) {
    return;
  }

  const href = typeof props.href === 'string' ? props.href : '';
  if (!href || isInternalLink(href)) {
    return;
  }

  props.target = '_blank';

  const required = ['noopener', 'noreferrer', 'nofollow'];
  const existing = typeof props.rel === 'string' ? props.rel.split(/\s+/).filter(Boolean) : [];
  const merged = new Set([...existing, ...required]);
  props.rel = [...merged].join(' ');
}

function visitLinks(node: HastNode): void {
  if (node.type === 'element' && node.tagName === 'a') {
    processLink(node);
  }
  if (node.children) {
    for (const child of node.children) {
      visitLinks(child);
    }
  }
}

export default function rehypeExternalLinks(): (tree: HastNode) => void {
  return (tree) => {
    visitLinks(tree);
  };
}
