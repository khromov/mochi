import { getDoc } from '../lib/docs.ts';
import { getPost } from '../lib/blog.ts';
import { demos } from '../lib/demos.ts';
import { CHANGELOG_TITLE } from '../lib/changelog.ts';
import type { OgSubject } from './render.ts';

const DEVELOPMENT = process.env.NODE_ENV === 'development';

/** Pages whose titles are written into a component rather than a registry. */
const FIXED: Record<string, OgSubject> = {
  '/': { kind: 'root', title: 'Mochi' },
  '/blog': { kind: 'page', title: 'Blog' },
  '/docs/changelog': { kind: 'doc', title: CHANGELOG_TITLE },
  '/ci': { kind: 'page', title: 'CI Status' },
};

/** Titles come from the registries the pages render from, so a card exists only for a real page. */
export async function resolveOgSubject(pathname: string): Promise<OgSubject | null> {
  const path = pathname === '/index' ? '/' : pathname.replace(/\/+$/, '') || '/';

  const fixed = FIXED[path];
  if (fixed) {
    return fixed;
  }

  const docSlug = path.match(/^\/docs\/([^/]+)$/)?.[1];
  if (docSlug) {
    const doc = await getDoc(docSlug);
    return doc && { kind: 'doc', title: doc.ogTitle ?? doc.title };
  }

  const postSlug = path.match(/^\/blog\/([^/]+)$/)?.[1];
  if (postSlug) {
    const post = await getPost(postSlug, { includeDrafts: DEVELOPMENT });
    return post && { kind: 'blog', title: post.title, date: post.date };
  }

  if (path.startsWith('/demos/')) {
    const demo = demos.find((d) => `${path}/` === d.href);
    return demo ? { kind: 'demo', title: demo.title } : null;
  }

  return null;
}
