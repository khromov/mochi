import { getDoc } from '../lib/docs.ts';
import { getPost } from '../lib/blog.ts';
import { demos } from '../lib/demos.ts';
import { CHANGELOG_TITLE } from '../lib/changelog.ts';
import type { OgSubject } from './render.ts';

const DEVELOPMENT = process.env.MODE === 'development';

/** Pages whose titles are written into a component rather than a registry. */
const FIXED: Record<string, OgSubject> = {
  '/': { kind: 'root', title: 'Mochi' },
  '/blog': { kind: 'page', title: 'Blog' },
  '/docs/changelog': { kind: 'doc', title: CHANGELOG_TITLE },
  '/ci': { kind: 'page', title: 'CI Status' },
};

/**
 * Maps a site path to the card's text. Titles come from the same registries the pages render from,
 * so a card can only ever exist for a real page — which is also what keeps the cache key space
 * finite and the endpoint un-poisonable.
 */
export async function resolveOgSubject(pathname: string): Promise<OgSubject | null> {
  // `/` has no path to mirror, so its card is addressed as `/og/index.jpg`.
  const path = pathname === '/index' ? '/' : pathname.replace(/\/+$/, '') || '/';

  const fixed = FIXED[path];
  if (fixed) {
    return fixed;
  }

  const docSlug = path.match(/^\/docs\/([^/]+)$/)?.[1];
  if (docSlug) {
    const doc = await getDoc(docSlug);
    return doc && { kind: 'doc', title: doc.title };
  }

  const postSlug = path.match(/^\/blog\/([^/]+)$/)?.[1];
  if (postSlug) {
    const post = await getPost(postSlug, { includeDrafts: DEVELOPMENT });
    return post && { kind: 'blog', title: post.title };
  }

  if (path.startsWith('/demos/')) {
    // `href` carries a trailing slash and some demos live under a nested path, so match on prefix
    // the same way DemoPage resolves its own source entry.
    const demo = demos.find((d) => `${path}/` === d.href);
    return demo ? { kind: 'demo', title: demo.title } : null;
  }

  return null;
}
