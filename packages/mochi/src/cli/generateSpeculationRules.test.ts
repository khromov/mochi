import { describe, it, expect } from 'bun:test';
import { Mochi } from '../Mochi';
import type { MochiRouteValue } from '../types';
import type { SpeculationDocumentRule } from '../runtime/speculationRules';
import { collapsePatterns, applyTrailingSlash, generateSpeculationRules } from './generateSpeculationRules';

const page = () => Mochi.page('X.svelte');

describe('collapsePatterns', () => {
  it('drops patterns already covered by a wildcard', () => {
    expect(collapsePatterns(['/docs/*', '/docs/changelog', '/blog'])).toEqual(['/docs/*', '/blog']);
  });

  it('keeps patterns that are not subsumed (e.g. /blog vs /blog/*)', () => {
    expect(collapsePatterns(['/blog', '/blog/*'])).toEqual(['/blog', '/blog/*']);
  });

  it('collapses a :param under a wildcard but not the reverse', () => {
    expect(collapsePatterns(['/docs/*', '/docs/:slug'])).toEqual(['/docs/*']);
    expect(collapsePatterns(['/docs/:slug', '/docs/hello'])).toEqual(['/docs/:slug']);
    expect(collapsePatterns(['/docs/:slug', '/docs/a/b'])).toEqual(['/docs/:slug', '/docs/a/b']);
  });

  it('keeps one of two interchangeable :param patterns', () => {
    expect(collapsePatterns(['/blog/:slug', '/blog/:id'])).toEqual(['/blog/:slug']);
  });
});

describe('applyTrailingSlash', () => {
  it('adds, strips, or leaves the slash per policy and never touches root', () => {
    expect(applyTrailingSlash('/about', 'always')).toBe('/about/');
    expect(applyTrailingSlash('/about/', 'never')).toBe('/about');
    expect(applyTrailingSlash('/', 'always')).toBe('/');
    expect(applyTrailingSlash('/about')).toBe('/about');
  });

  it('leaves paths with a file extension alone, matching the server redirect', () => {
    expect(applyTrailingSlash('/sitemap.xml', 'always')).toBe('/sitemap.xml');
    expect(applyTrailingSlash('/feed.rss', 'always')).toBe('/feed.rss');
  });
});

describe('generateSpeculationRules', () => {
  it('only page routes contribute; api/ws/sse/file are ignored', () => {
    const routes: Record<string, MochiRouteValue> = {
      '/': page(),
      '/blog/:slug': page(),
      '/api/x': Mochi.api(() => Response.json({})),
      '/ws': Mochi.ws({ message() {} }),
      '/sse': Mochi.sse(() => {}),
      '/robots.txt': Mochi.file('robots.txt'),
    };
    const rules = generateSpeculationRules(routes);
    const json = JSON.stringify(rules);
    expect(json).toContain('/blog/:slug');
    // /api/x is never a positive href_matches — only the /api/* exclusion appears.
    expect(json).not.toContain('/api/x');
    expect(json).toContain('/api/*');
  });

  it('keeps :param segments verbatim rather than widening them to a cross-segment *', () => {
    const json = JSON.stringify(generateSpeculationRules({ '/blog/:slug': page() }));
    expect(json).toContain('/blog/:slug');
    expect(json).not.toContain('/blog/*');
  });

  it('emits a bare href_matches (no `or`) for a single page pattern', () => {
    const rules = generateSpeculationRules({ '/': page() });
    const rule = rules.prefetch?.[0] as SpeculationDocumentRule | undefined;
    expect(rule?.where).toEqual({
      and: [
        { href_matches: '/' },
        { not: { href_matches: '/_*' } },
        { not: { href_matches: '/api/*' } },
        { not: { selector_matches: '[target=_blank]' } },
        { not: { selector_matches: '[rel~=nofollow]' } },
      ],
    });
  });

  it('normalizes patterns to the trailing-slash policy (root untouched)', () => {
    const json = JSON.stringify(generateSpeculationRules({ '/': page(), '/about': page() }, { trailingSlash: 'always' }));
    expect(json).toContain('"/about/"');
    expect(json).toContain('"/"');
    expect(json).not.toContain('"/about"');
  });

  it('does not slash a page whose path has a file extension', () => {
    const json = JSON.stringify(generateSpeculationRules({ '/sitemap.xml': page() }, { trailingSlash: 'always' }));
    expect(json).toContain('"/sitemap.xml"');
    expect(json).not.toContain('/sitemap.xml/');
  });

  it('dedupes patterns that only become identical after normalization', () => {
    const rules = generateSpeculationRules({ '/about': page(), '/about/': page() }, { trailingSlash: 'always' });
    const rule = rules.prefetch?.[0] as SpeculationDocumentRule | undefined;
    expect(rule?.where).toEqual({
      and: [
        { href_matches: '/about/' },
        { not: { href_matches: '/_*' } },
        { not: { href_matches: '/api/*' } },
        { not: { selector_matches: '[target=_blank]' } },
        { not: { selector_matches: '[rel~=nofollow]' } },
      ],
    });
  });

  it('limits prerender to static pages and sets eagerness moderate', () => {
    const rules = generateSpeculationRules({ '/': page(), '/about': page(), '/blog/:slug': page() });
    const prerender = JSON.stringify(rules.prerender);
    expect(prerender).toContain('/about');
    expect(prerender).not.toContain('/blog/:slug');
    expect(rules.prerender?.[0]?.eagerness).toBe('moderate');
  });

  it('applies the framework-path exclusions to prerender, not just prefetch', () => {
    const rules = generateSpeculationRules({ '/api/report': page(), '/_internal': page(), '/about': page() });
    for (const rule of [rules.prefetch?.[0], rules.prerender?.[0]] as (SpeculationDocumentRule | undefined)[]) {
      expect(rule?.where).toMatchObject({ and: expect.arrayContaining([{ not: { href_matches: '/api/*' } }, { not: { href_matches: '/_*' } }]) });
    }
  });

  it('omits prerender when there are no static pages', () => {
    const rules = generateSpeculationRules({ '/blog/:slug': page() });
    expect(rules.prefetch).toBeDefined();
    expect(rules.prerender).toBeUndefined();
  });

  it('returns {} when there are no page routes', () => {
    const rules = generateSpeculationRules({ '/api/x': Mochi.api(() => Response.json({})) });
    expect(rules).toEqual({});
  });
});
