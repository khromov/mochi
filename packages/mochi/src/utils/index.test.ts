import { describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import type { BunRouteValue } from '../types';
import {
  DEFAULT_ASSET_PREFIX,
  error,
  headResponse,
  httpStatusText,
  MochiHttpError,
  negotiate,
  normalizeAssetPrefix,
  normalizeIslandHydrationMarkers,
  relForDisplay,
  stripHydrationMarkers,
  toPosixPath,
  withHead,
} from './index';
import path from 'node:path';

describe('error / MochiHttpError', () => {
  test('message defaults to the canonical status text', () => {
    expect(new MochiHttpError(404).message).toBe('Not Found');
    expect(new MochiHttpError(429).message).toBe('Too Many Requests');
  });

  test('unknown statuses fall back to Error <status>', () => {
    expect(new MochiHttpError(299).message).toBe('Error 299');
    expect(httpStatusText(299)).toBe('Error 299');
  });

  test('statuses outside the common set still get their canonical text', () => {
    expect(httpStatusText(402)).toBe('Payment Required');
    expect(httpStatusText(451)).toBe('Unavailable For Legal Reasons');
  });

  test('an explicit message wins over the default', () => {
    expect(new MochiHttpError(404, 'No such fruit').message).toBe('No such fruit');
  });

  test('error(status) throws a MochiHttpError with the defaulted message', () => {
    try {
      error(404);
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(MochiHttpError);
      expect((err as MochiHttpError).status).toBe(404);
      expect((err as MochiHttpError).message).toBe('Not Found');
    }
  });
});

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

  // The tests below pin the onEndTag depth-counter invariant: an island's end
  // tag must fire before the document handler sees the sibling comment that
  // follows it, and island descendants must count as inside. If a Bun upgrade
  // ever breaks either, these fail loudly instead of hydration breaking
  // silently in production.
  test('does not touch <mochi-hydratable-island> contents', () => {
    const html = '<mochi-hydratable-island id-x><!--[--><div>counter</div><!--]--></mochi-hydratable-island>';
    expect(stripHydrationMarkers(html)).toBe(html);
  });

  test('keeps markers in deep descendants of an island', () => {
    const html = '<mochi-hydratable-island id-x><div><span><!--[--><em>deep</em><!--]--></span></div></mochi-hydratable-island>';
    expect(stripHydrationMarkers(html)).toBe(html);
  });

  test('keeps markers inside nested islands', () => {
    const html = '<mochi-hydratable-island id-outer><!--[--><mochi-server-island id-inner><!--[--><p>inner</p><!--]--></mochi-server-island><!--]--></mochi-hydratable-island>';
    expect(stripHydrationMarkers(html)).toBe(html);
  });

  test('removes markers between two sibling islands', () => {
    const island = (id: string) => `<mochi-hydratable-island ${id}><!--[--><p>x</p><!--]--></mochi-hydratable-island>`;
    const html = `${island('a')}<!--[--><p>between</p><!--]-->${island('b')}`;
    const expected = `${island('a')}<p>between</p>${island('b')}`;
    expect(stripHydrationMarkers(html)).toBe(expected);
  });

  test('removes a marker immediately after an island close tag', () => {
    const html = '<mochi-server-island id-x><!--[--><p>in</p><!--]--></mochi-server-island><!--]-->';
    const expected = '<mochi-server-island id-x><!--[--><p>in</p><!--]--></mochi-server-island>';
    expect(stripHydrationMarkers(html)).toBe(expected);
  });

  test('leaves non-marker comments alone everywhere', () => {
    // <!--note--> is word-only, so it counts as a Svelte hash marker and
    // survives only because it sits inside an island; the outside comments
    // survive because whitespace disqualifies them as markers.
    const html = '<!-- plain --><mochi-hydratable-island id-x><!--note--><p>x</p></mochi-hydratable-island><!-- plain2 -->';
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

describe('relForDisplay', () => {
  test('relativizes against cwd with forward slashes', () => {
    expect(relForDisplay(path.join(process.cwd(), 'src', 'pages', 'Index.svelte'))).toBe('src/pages/Index.svelte');
  });

  test('never emits backslashes, even from backslash-bearing input', () => {
    expect(relForDisplay(path.join(process.cwd(), 'src\\pages\\Index.svelte'))).not.toContain('\\');
  });

  test('returns empty string for the cwd itself (callers fall back with ||)', () => {
    expect(relForDisplay(process.cwd())).toBe('');
  });
});

describe('headResponse', () => {
  test('preserves status, statusText, and headers but empties the body', async () => {
    const src = new Response('hello world', {
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'text/plain', 'X-Custom': 'abc' },
    });
    const head = await headResponse(src);
    expect(head.status).toBe(201);
    expect(head.statusText).toBe('Created');
    expect(head.headers.get('Content-Type')).toBe('text/plain');
    expect(head.headers.get('X-Custom')).toBe('abc');
    expect(await head.text()).toBe('');
  });

  test('sets Content-Length to the finite body byte length', async () => {
    const body = 'héllo'; // multi-byte char → byte length differs from char length
    const head = await headResponse(new Response(body, { headers: { 'Content-Type': 'text/plain' } }));
    expect(head.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body, 'utf8')));
    expect(await head.text()).toBe('');
  });

  test('does not consume a text/event-stream body', async () => {
    // A never-ending stream: if headResponse buffered it, this test would hang.
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // intentionally never enqueue or close
      },
    });
    const head = await headResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe('text/event-stream');
    expect(head.headers.get('Content-Length')).toBeNull();
    expect(head.body).toBeNull();
  });
});

describe('withHead', () => {
  const server = {} as Server<undefined>;
  const get = (url: string, method: string) => new Request(url, { method });

  test('function arm: strips body only for HEAD, passes GET through unchanged', async () => {
    const wrapped = withHead(() => new Response('payload', { headers: { 'Content-Type': 'text/plain' } }));
    if (typeof wrapped !== 'function') {
      throw new Error('expected a function');
    }
    const getRes = await wrapped(get('http://x/', 'GET'), server);
    expect(await getRes.text()).toBe('payload');

    const headRes = await wrapped(get('http://x/', 'HEAD'), server);
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe('');
    expect(headRes.headers.get('Content-Type')).toBe('text/plain');
  });

  test('object arm: adds a HEAD entry that runs GET', async () => {
    type Fn = (req: Request, server: Server<undefined>) => Response | Promise<Response>;
    const GET: Fn = () => new Response('page', { headers: { 'Content-Type': 'text/html' } });
    const POST: Fn = () => new Response('posted');
    const wrapped = withHead({ GET, POST }) as Record<string, Fn | undefined>;
    expect(typeof wrapped.HEAD).toBe('function');
    expect(wrapped.GET).toBe(GET);
    expect(wrapped.POST).toBe(POST);

    const headRes = await wrapped.HEAD!(get('http://x/', 'HEAD'), server);
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe('');
    expect(headRes.headers.get('Content-Type')).toBe('text/html');
  });

  test('object arm: leaves an existing HEAD entry untouched', () => {
    const GET = () => new Response('g');
    const HEAD = () => new Response(null);
    const wrapped = withHead({ GET, HEAD }) as Record<string, unknown>;
    expect(wrapped.HEAD).toBe(HEAD);
  });

  test('BunFile arm: returned untouched (Bun serves its HEAD natively)', () => {
    const file = Bun.file('package.json');
    expect(withHead(file as unknown as BunRouteValue)).toBe(file);
  });

  test('Response arm: returned untouched', () => {
    const res = new Response('static');
    expect(withHead(res as unknown as BunRouteValue)).toBe(res);
  });
});
