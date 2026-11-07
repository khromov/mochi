import { describe, expect, test } from 'bun:test';
import { resolveComponentUrl } from './resolveComponentUrl';

describe('resolveComponentUrl', () => {
  test('an absolute path resolves against the origin regardless of the page depth', () => {
    expect(resolveComponentUrl('/_mochi/client/_hydrate-X-abc.js', 'https://example.com/writing/post/')).toBe('https://example.com/_mochi/client/_hydrate-X-abc.js');
  });

  test('a prefixed path (assetPrefix) is left alone', () => {
    expect(resolveComponentUrl('/my-app/_mochi/client/_hydrate-X-abc.js', 'https://example.com/my-app/writing/')).toBe(
      'https://example.com/my-app/_mochi/client/_hydrate-X-abc.js',
    );
  });

  test('a relative path resolves against the document, not the loader module', () => {
    // A static export that rewrote every URL to be page-relative expects `../_mochi/client/` from `/my-app/writing/`
    // to land in `/my-app/_mochi/client/` — the same place `<link href="../_mochi/css/…">` on that page lands.
    expect(resolveComponentUrl('../_mochi/client/_hydrate-X-abc.js', 'https://example.com/my-app/writing/')).toBe('https://example.com/my-app/_mochi/client/_hydrate-X-abc.js');
  });

  test('honours a <base href> through the document baseURI', () => {
    expect(resolveComponentUrl('_mochi/client/_hydrate-X-abc.js', 'https://example.com/my-app/')).toBe('https://example.com/my-app/_mochi/client/_hydrate-X-abc.js');
  });

  test('a full URL passes through untouched', () => {
    expect(resolveComponentUrl('https://cdn.example.com/x.js', 'https://example.com/')).toBe('https://cdn.example.com/x.js');
  });
});
