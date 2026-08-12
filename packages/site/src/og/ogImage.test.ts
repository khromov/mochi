import { describe, expect, test } from 'bun:test';
import { ogImageFor } from '../lib/ogImageUrl.ts';
import { getDoc, loadDocs } from '../lib/docs.ts';
import { loadPosts } from '../lib/blog.ts';
import { demos } from '../lib/demos.ts';
import { resolveOgSubject } from './resolve.ts';

const pathOf = (url: string) => new URL(url).pathname;

/** The endpoint strips the extension and hands the rest to the resolver — mirror that here. */
const resolveFromImageUrl = (url: string) =>
  resolveOgSubject(
    pathOf(url)
      .replace(/^\/og/, '')
      .replace(/\.jpg$/, ''),
  );

describe('ogImageFor', () => {
  test('maps the site paths that have a card', () => {
    expect(ogImageFor('https://mochi.fast/')).toBe('https://mochi.fast/og/index.jpg');
    expect(ogImageFor('https://mochi.fast/docs/intro')).toBe('https://mochi.fast/og/docs/intro.jpg');
    expect(ogImageFor('https://mochi.fast/blog/')).toBe('https://mochi.fast/og/blog.jpg');
    expect(ogImageFor('https://mochi.fast/demos/hello-world/')).toBe('https://mochi.fast/og/demos/hello-world.jpg');
  });

  test('falls back to the static card for paths the endpoint cannot resolve', () => {
    expect(ogImageFor(undefined)).toBe('https://mochi.fast/og-default.jpg');
    expect(ogImageFor('https://mochi.fast/support')).toBe('https://mochi.fast/og-default.jpg');
    expect(ogImageFor('https://mochi.fast/docs/intro/llms.txt')).toBe('https://mochi.fast/og-default.jpg');
  });
});

// `ogImageFor` (client-safe patterns) and `resolveOgSubject` (registry lookups) are deliberately
// separate, so nothing but this test stops them drifting into a meta tag that points at a 404.
// These touch the real registries, and loadDocs() mdsvex-compiles every page — well past bun test's
// 5s default on a loaded machine.
const REGISTRY_TIMEOUT = 60_000;

describe('every emitted card URL resolves', () => {
  test(
    'docs, posts and demos',
    async () => {
      const canonicals = [
        'https://mochi.fast/',
        'https://mochi.fast/blog',
        ...(await loadDocs()).map((doc) => `https://mochi.fast/docs/${doc.slug}`),
        ...(await loadPosts()).map((post) => `https://mochi.fast/blog/${post.slug}`),
        ...demos.filter((demo) => demo.href.startsWith('/')).map((demo) => `https://mochi.fast${demo.href}`),
      ];

      // The contract is one-directional: a dynamic URL must always resolve. Falling back to the static
      // card is allowed — that is the safe branch for a page outside the registries' path shapes.
      const broken: string[] = [];
      const fellBack: string[] = [];
      for (const canonical of canonicals) {
        const url = ogImageFor(canonical);
        if (url.endsWith('og-default.jpg')) {
          fellBack.push(new URL(canonical).pathname);
        } else if (!(await resolveFromImageUrl(url))) {
          broken.push(`${canonical} → ${url}`);
        }
      }
      expect(broken).toEqual([]);
      // Pinned so a new off-pattern page shows up here rather than silently losing its card.
      expect(fellBack).toEqual(['/cookie-vary-test/']);
    },
    REGISTRY_TIMEOUT,
  );

  test(
    'an unknown slug resolves to nothing',
    async () => {
      expect(await resolveOgSubject('/docs/definitely-not-a-doc')).toBeNull();
      expect(await resolveOgSubject('/demos/definitely-not-a-demo')).toBeNull();
      expect(await resolveOgSubject('/somewhere-else')).toBeNull();
    },
    REGISTRY_TIMEOUT,
  );

  test('the root card is addressed as /og/index.jpg', async () => {
    expect(await resolveOgSubject('/index')).toEqual({ kind: 'root', title: 'Mochi' });
  });

  test(
    'a doc card prefers ogTitle, leaving the sidebar label alone',
    async () => {
      const intro = await getDoc('intro');
      expect(intro?.title).toBe('Welcome');
      expect(await resolveOgSubject('/docs/intro')).toEqual({ kind: 'doc', title: 'Welcome to Mochi' });

      // A doc without the override still cards under its own title.
      const plain = (await loadDocs()).find((doc) => !doc.ogTitle);
      expect(plain).toBeDefined();
      expect(await resolveOgSubject(`/docs/${plain!.slug}`)).toEqual({ kind: 'doc', title: plain!.title });
    },
    REGISTRY_TIMEOUT,
  );
});
