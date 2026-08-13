import { describe, it, expect } from 'bun:test';
import { Mochi } from '../Mochi';
import type { MochiRouteValue } from '../types';
import type { SpeculationDocumentRule } from '../runtime/speculationRules';
import { patternToGlob, isStaticPattern, collapseGlobs, generateSpeculationRules } from './generateSpeculationRules';

const page = () => Mochi.page('X.svelte');

describe('patternToGlob', () => {
  it.each([
    ['/', '/'],
    ['/about', '/about'],
    ['/blog/:slug', '/blog/*'],
    ['/docs/*', '/docs/*'],
    ['/blog/:slug/:id', '/blog/*/*'],
  ])('%s -> %s', (input, expected) => {
    expect(patternToGlob(input)).toBe(expected);
  });
});

describe('isStaticPattern', () => {
  it('is true for patterns with no dynamic segments', () => {
    expect(isStaticPattern('/about')).toBe(true);
    expect(isStaticPattern('/blog/:slug')).toBe(false);
    expect(isStaticPattern('/docs/*')).toBe(false);
  });
});

describe('collapseGlobs', () => {
  it('drops globs already covered by a wildcard glob', () => {
    expect(collapseGlobs(['/docs/*', '/docs/changelog', '/blog'])).toEqual(['/docs/*', '/blog']);
  });

  it('keeps globs that are not subsumed (e.g. /blog vs /blog/*)', () => {
    expect(collapseGlobs(['/blog', '/blog/*'])).toEqual(['/blog', '/blog/*']);
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
    expect(json).toContain('/blog/*');
    // /api/x is never a positive href_matches — only the /api/* exclusion appears.
    expect(json).not.toContain('/api/x');
    expect(json).toContain('/api/*');
  });

  it('emits a bare href_matches (no `or`) for a single page glob', () => {
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

  it('normalizes static globs to the trailing-slash policy (root untouched)', () => {
    const json = JSON.stringify(generateSpeculationRules({ '/': page(), '/about': page() }, { trailingSlash: 'always' }));
    expect(json).toContain('"/about/"');
    expect(json).toContain('"/"');
    expect(json).not.toContain('"/about"');
  });

  it('limits prerender to static pages and sets eagerness moderate', () => {
    const rules = generateSpeculationRules({ '/': page(), '/about': page(), '/blog/:slug': page() });
    const prerender = JSON.stringify(rules.prerender);
    expect(prerender).toContain('/about');
    expect(prerender).not.toContain('/blog/*');
    expect(rules.prerender?.[0]?.eagerness).toBe('moderate');
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
