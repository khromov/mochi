import { describe, expect, test } from 'bun:test';
import { DEFAULT_ASSET_PREFIX, negotiate, normalizeAssetPrefix, normalizeIslandHydrationMarkers, stripHydrationMarkers, toPosixPath } from './utils';

describe('negotiate', () => {
  const types = ['application/json', 'text/html'];

  test('exact match returns that type', () => {
    expect(negotiate('application/json', types)).toBe('application/json');
    expect(negotiate('text/html', types)).toBe('text/html');
  });

  test('prefers higher q-value', () => {
    expect(negotiate('application/json, text/html;q=0.9', types)).toBe('application/json');
    expect(negotiate('text/html, application/json;q=0.9', types)).toBe('text/html');
  });

  test('text/html beats application/json when browser sends typical Accept', () => {
    expect(negotiate('text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8', types)).toBe('text/html');
  });

  test('low-q json is not preferred over higher-q html', () => {
    expect(negotiate('text/html, application/json;q=0.01', types)).toBe('text/html');
  });

  test('wildcard */* matches first candidate in types list', () => {
    expect(negotiate('*/*', types)).toBe('application/json');
  });

  test('returns undefined when no candidate matches', () => {
    expect(negotiate('text/plain', types)).toBeUndefined();
    expect(negotiate('', types)).toBeUndefined();
  });

  test('ignores invalid Accept entries', () => {
    expect(negotiate('application/json, invalid-token', types)).toBe('application/json');
  });
});

describe('normalizeAssetPrefix', () => {
  test('returns the default when input is undefined', () => {
    expect(normalizeAssetPrefix(undefined)).toBe(DEFAULT_ASSET_PREFIX);
  });

  test.each([['/_mochi'], ['/mochi'], ['/static'], ['/a/b/c'], ['/with-dash'], ['/with.dot'], ['/_']])('accepts valid prefix %p', (input) => {
    expect(normalizeAssetPrefix(input)).toBe(input);
  });

  test.each<[unknown, string]>([
    ['', 'non-empty string'],
    [null as unknown, 'non-empty string'],
    [123 as unknown, 'non-empty string'],
    ['mochi', 'must start with "/"'],
    ['./mochi', 'must start with "/"'],
    ['/', 'must not be the root'],
    ['/mochi/', 'must not end with "/"'],
    ['/a/b/', 'must not end with "/"'],
    ['/mochi assets', 'must not contain whitespace'],
    ['/mochi\tassets', 'must not contain whitespace'],
    ['/mochi\nassets', 'must not contain whitespace'],
    ['/../escape', 'must not contain ".." segments'],
    ['/foo/../bar', 'must not contain ".." segments'],
  ])('rejects %p with message containing %p', (input, fragment) => {
    expect(() => normalizeAssetPrefix(input as string | undefined)).toThrow(fragment);
  });
});

describe('stripHydrationMarkers', () => {
  test('removes Svelte markers outside islands', () => {
    const html = '<!--[--><div>page</div><!--]-->';
    expect(stripHydrationMarkers(html)).toBe('<div>page</div>');
  });

  test('does not touch <mochi-server-island> contents', () => {
    const html = '<mochi-server-island id-x><!--[--><div>placeholder</div><!--]--></mochi-server-island>';
    expect(stripHydrationMarkers(html)).toBe(html);
  });
});

describe('normalizeIslandHydrationMarkers', () => {
  test('collapses the doubled-marker bug pattern (open and close)', () => {
    const html = '<mochi-hydratable-island id-x><!--[--><!--[--><div>x</div><!--]--><!--]--></mochi-hydratable-island>';
    const expected = '<mochi-hydratable-island id-x><!--[--><div>x</div><!--]--></mochi-hydratable-island>';
    expect(normalizeIslandHydrationMarkers(html)).toBe(expected);
  });

  test('leaves single-pair wrappers unchanged', () => {
    const html = '<mochi-hydratable-island id-x><!--[--><div>x</div><!--]--></mochi-hydratable-island>';
    expect(normalizeIslandHydrationMarkers(html)).toBe(html);
  });

  test('leaves {#if/:else}-style closes unchanged (close-branch + close-block)', () => {
    // The open side has <!--[--><!--[-1--> (HYDRATION_START + else-branch
    // marker) — distinguishable from the doubled bug because the second
    // marker carries a branch index. The close has <!--]--><!--]--> which
    // would naively look like the bug — the unit-pattern regex must NOT touch
    // this case.
    const html = '<mochi-hydratable-island id-x><!--[--><!--[-1--><p>else</p><!--]--><!--]--></mochi-hydratable-island>';
    expect(normalizeIslandHydrationMarkers(html)).toBe(html);
  });

  test('leaves marker-free wrappers unchanged', () => {
    const html = '<mochi-hydratable-island id-x><div>x</div></mochi-hydratable-island>';
    expect(normalizeIslandHydrationMarkers(html)).toBe(html);
  });

  test('does not touch <mochi-server-island> wrappers', () => {
    const html = '<mochi-server-island id-x><!--[--><!--[--><div>x</div><!--]--><!--]--></mochi-server-island>';
    expect(normalizeIslandHydrationMarkers(html)).toBe(html);
  });

  test('handles multiple islands on a page; collapses only the doubled ones', () => {
    const doubled = '<mochi-hydratable-island a><!--[--><!--[--><p>doubled</p><!--]--><!--]--></mochi-hydratable-island>';
    const single = '<mochi-hydratable-island b><!--[--><p>single</p><!--]--></mochi-hydratable-island>';
    const ifElse = '<mochi-hydratable-island c><!--[--><!--[-1--><p>else</p><!--]--><!--]--></mochi-hydratable-island>';
    const html = `${doubled}\n${single}\n${ifElse}`;
    const expected =
      '<mochi-hydratable-island a><!--[--><p>doubled</p><!--]--></mochi-hydratable-island>\n' +
      '<mochi-hydratable-island b><!--[--><p>single</p><!--]--></mochi-hydratable-island>\n' +
      '<mochi-hydratable-island c><!--[--><!--[-1--><p>else</p><!--]--><!--]--></mochi-hydratable-island>';
    expect(normalizeIslandHydrationMarkers(html)).toBe(expected);
  });
});

describe('toPosixPath', () => {
  test('converts Windows backslash separators to forward slashes', () => {
    expect(toPosixPath('C:\\dev\\app\\node_modules\\mochi-framework\\src\\log.ts')).toBe('C:/dev/app/node_modules/mochi-framework/src/log.ts');
  });

  test('is a no-op on already-POSIX paths', () => {
    const p = '/Users/x/app/src/log.ts';
    expect(toPosixPath(p)).toBe(p);
  });

  test('is idempotent', () => {
    const once = toPosixPath('C:\\a\\b');
    expect(toPosixPath(once)).toBe(once);
  });
});
