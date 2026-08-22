import { describe, it, expect } from 'bun:test';
import { buildSitemapXml } from './docs';
import { demos } from './demos';

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);
}

describe('buildSitemapXml', () => {
  it('emits a well-formed urlset with one <loc> per <url>', async () => {
    const xml = await buildSitemapXml();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('</urlset>');
    const urlCount = (xml.match(/<url>/g) ?? []).length;
    expect(locs(xml).length).toBe(urlCount);
  });

  // Parsing it back is the check string-joining could never pass: Bun.XML.stringify escapes every value,
  // so a stray & or < in a slug no longer breaks the document.
  it('round-trips through an XML parser', async () => {
    const xml = await buildSitemapXml();
    const parsed = Bun.XML.parse(xml) as { urlset: { url: { loc: string }[] } };
    expect(parsed.urlset.url.length).toBe(locs(xml).length);
    expect(parsed.urlset.url[0]!.loc).toBe('https://mochi.fast/');
  });

  it('never produces a double slash in the path (regression: …/request-id//)', async () => {
    const xml = await buildSitemapXml();
    for (const loc of locs(xml)) {
      // Skip the protocol's `//`; only the path portion is checked.
      const { pathname } = new URL(loc);
      expect(pathname).not.toContain('//');
    }
  });

  it('every <loc> is an absolute https URL ending in exactly one trailing slash', async () => {
    const xml = await buildSitemapXml();
    const urls = locs(xml);
    expect(urls.length).toBeGreaterThan(0);
    for (const loc of urls) {
      expect(loc.startsWith('https://mochi.fast/')).toBe(true);
      expect(() => new URL(loc)).not.toThrow();
      expect(loc.endsWith('/')).toBe(true);
      expect(loc.endsWith('//')).toBe(false);
    }
  });

  it('includes the home page, the docs, and every internal demo', async () => {
    const xml = await buildSitemapXml();
    const urls = new Set(locs(xml));
    expect(urls.has('https://mochi.fast/')).toBe(true);

    const internalDemos = demos.filter((d) => d.href.startsWith('/'));
    for (const demo of internalDemos) {
      const expected = `https://mochi.fast${demo.href.replace(/\/+$/, '')}/`;
      expect(urls.has(expected)).toBe(true);
    }

    // External demos (absolute hrefs) must not leak into the sitemap.
    for (const loc of urls) {
      expect(loc).not.toContain('demos.mochi.fast');
    }

    // At least one docs URL of the expected shape is present.
    expect([...urls].some((u) => /^https:\/\/mochi\.fast\/docs\/[^/]+\/$/.test(u))).toBe(true);
  });

  it('includes the blog index and published posts, never drafts', async () => {
    const xml = await buildSitemapXml();
    const urls = new Set(locs(xml));
    expect(urls.has('https://mochi.fast/blog/')).toBe(true);
    expect(urls.has('https://mochi.fast/blog/hello-world/')).toBe(true);
    for (const loc of urls) {
      expect(loc).not.toContain('mochi-on-bun-1-4');
    }
  });
});
