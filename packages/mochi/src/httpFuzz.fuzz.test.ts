// Property-based fuzzing of the HTTP request pipeline against a real
// `Mochi.serve()`. The five sibling `*.fuzz.test.ts` suites fuzz parsers as pure
// functions; this one fuzzes them *composed*, over the wire, plus the framework's
// own `/_mochi/*` endpoints. Four invariants hold for every generated request:
// no unexpected 5xx, no hang, no info leak, and a well-formed response.
//
// Re-running a reported counterexample:
//
//   # fast-check printed:  Seed: 1734182 / Path: 12:3:0
//   MOCHI_FUZZ_SEED=1734182 MOCHI_FUZZ_PATH=12:3:0 \
//     bun test packages/mochi/src/httpFuzz.fuzz.test.ts -t "sealed envelopes"
//
// Soak (same as `bun run fuzz:soak`, ~200k requests, ~17s):
//   MOCHI_FUZZ_RUNS=20000 bun test --timeout 900000 src/httpFuzz.fuzz.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import fc from 'fast-check';
import { stringify as devalueStringify } from 'devalue';
import { Mochi } from './Mochi';
import { fail, success } from './runtime/forms';
import { trailingSlashRedirect } from './runtime/trailingSlash';
import { buildPublicUrl } from './runtime/proxy';
import { encryptProps } from './islands/serverIslandCrypto';
import { registerLocalImageAsset } from './image/localAssetRegistry';
import { getImageUrl } from './image/imageApi';
import { toPosixPath } from './utils';
import { setLogLevel } from './utils/log';

const FIXTURES = path.join(import.meta.dir, '__fixtures__', 'http-fuzz');
const PAGE = path.join(FIXTURES, 'Page.svelte');
const FORM = path.join(FIXTURES, 'Form.svelte');

// Measured on an M-series mac: boot dominates (~0.45s), then roughly 10k
// requests/sec, so 1000 runs across these properties costs ~1.2s total against
// the 60s per-file cap `run-tests.ts` enforces (cli/testing.ts:144). 20000 runs
// (~200k requests) takes ~17s, which is what the soak script uses. Keep the
// default low enough that the ceiling stays far away on a slower machine.
const NUM_RUNS = Number(process.env.MOCHI_FUZZ_RUNS ?? 1000);
const TIMEOUT_MS = Number(process.env.MOCHI_FUZZ_TIMEOUT_MS ?? 5_000);

const RUNS: fc.Parameters<unknown> = {
  numRuns: NUM_RUNS,
  ...(process.env.MOCHI_FUZZ_SEED ? { seed: Number(process.env.MOCHI_FUZZ_SEED) } : {}),
  ...(process.env.MOCHI_FUZZ_PATH ? { path: process.env.MOCHI_FUZZ_PATH } : {}),
  // Shrinking an HTTP property re-issues requests, so cap it well inside the 30s
  // per-test budget `bun test --timeout 30000` imposes (cli/testing.ts:177).
  interruptAfterTimeLimit: 10_000,
  markInterruptAsFailure: true,
};

/* ------------------------------------------------------------------ *
 * Grammar
 * ------------------------------------------------------------------ */

// Bun's `fetch()` silently rewrites an unrecognised method to GET, so generating
// junk methods here would only dilute the distribution. Wire-level junk methods
// are the ffuf sweep's job (packages/site/scripts/fuzz-http.ts).
const arbMethod = fc.constantFrom('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS');

const arbPathSegment = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom('_mochi', 'island', 'image', 'asset', 'client', 'image-cache', 'entry', 'api', 'echo', 'form', 'Echo', 'Counter', '', '.', '..') },
  {
    weight: 3,
    arbitrary: fc.constantFrom('%2e%2e', '%2f', '%5c', '%00', '%c0%af', '..%2f', '....//', '%', '%zz', '.git', '.env', 'node_modules', 'fuzz-1x1.png', 'x.js', 'x.css'),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 12 }) },
  { weight: 1, arbitrary: fc.string({ minLength: 300, maxLength: 900 }) },
);

const arbPath = fc.array(arbPathSegment, { minLength: 1, maxLength: 5 }).map((segs) => '/' + segs.join('/'));

const arbForwardedFor = fc
  .array(fc.oneof(fc.ipV4(), fc.ipV6(), fc.constantFrom('unknown', '', '::1', '127.0.0.1, 10.0.0.1', 'not-an-ip', '999.999.999.999')), { maxLength: 6 })
  .map((xs) => xs.join(', '));

const arbCookieHeader = fc
  .array(
    fc.oneof(
      fc.tuple(fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/), fc.string({ maxLength: 24 })).map(([k, v]) => `${k}=${v}`),
      fc.constantFrom('=', ';;', 'a', 'a=b=c', '__Host-x=1; Path=/', 'a=%ZZ', 'a="quoted; value"', `sid=${'x'.repeat(4096)}`),
    ),
    { maxLength: 8 },
  )
  .map((parts) => parts.join('; '));

// `requiredKeys: []` makes every header independently present-or-absent, so the
// generator explores the whole presence lattice rather than always setting all of them.
const arbHeaders = fc.record(
  {
    cookie: arbCookieHeader,
    origin: fc.constantFrom('', 'null', 'http://localhost', 'https://evil.test', 'http://localhost:1', 'not a url', '://', 'http://localhost:%'),
    'content-type': fc.constantFrom(
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'multipart/form-data; boundary=',
      'text/plain',
      'application/json',
      'APPLICATION/JSON;charset=utf-8',
      '',
      ';',
      'text/plain;;;',
    ),
    accept: fc.constantFrom('*/*', 'application/json', 'text/html,application/json;q=0.01', 'application/json;q=0', 'q=1', ''),
    'x-forwarded-for': arbForwardedFor,
    'x-forwarded-host': fc.constantFrom('', 'evil.test', 'evil.test:99999', 'localhost:', '[::1]:80', 'a'.repeat(300)),
    'x-forwarded-proto': fc.constantFrom('http', 'https', 'HTTPS', 'javascript', '', 'https, http'),
    forwarded: fc.constantFrom('', 'for=1.2.3.4;proto=https;host=evil.test', 'for="[2001:db8::1]:8080"', 'garbage'),
    'x-mochi-action': fc.constantFrom('true', 'false', '', '1'),
    'if-none-match': fc.constantFrom('', '*', '"x"', 'W/"y"', '"'),
  },
  { requiredKeys: [] },
);

const arbBody = fc.oneof(
  fc.string({ maxLength: 256 }),
  fc.array(fc.tuple(fc.string({ maxLength: 8 }), fc.string({ maxLength: 16 })), { maxLength: 5 }).map((kv) => new URLSearchParams(kv).toString()),
  fc.json({ maxDepth: 3 }),
);

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

interface FuzzResult {
  status: number;
  headers: Headers;
  body: string;
  ms: number;
}

interface SendInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

// `fetch()` rejects a body on GET/HEAD/OPTIONS before the request is ever sent,
// which is a client-side constraint, not a server behaviour worth fuzzing.
function methodAllowsBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

// Every assertion failure carries a ready-to-paste reproduction.
function repro(url: string, init: SendInit): string {
  const headerArgs = Object.entries(init.headers ?? {}).map(([k, v]) => `-H ${shq(`${k}: ${v}`)}`);
  const bodyArg = init.body === undefined ? [] : [`--data-binary ${shq(init.body)}`];
  return ['REPRO:', 'curl -isS', `-X ${init.method ?? 'GET'}`, ...headerArgs, ...bodyArg, shq(url)].join(' ');
}

let maxObservedMs = 0;

async function send(url: string, init: SendInit): Promise<FuzzResult | 'timeout'> {
  // An explicit controller (rather than `AbortSignal.timeout()`) is what makes a
  // client-side deadline distinguishable from a server-side abort, and the
  // `clearTimeout` keeps a pending timer from outliving the test file.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: ac.signal,
      // Load-bearing: the default `follow` swallows every trailing-slash redirect
      // and makes the well-formedness invariant untestable.
      redirect: 'manual',
    });
    // Draining is not optional -- an unconsumed body pins the keep-alive socket
    // and the next iteration queues behind it, surfacing as a phantom hang.
    const body = await res.text();
    const ms = performance.now() - started;
    maxObservedMs = Math.max(maxObservedMs, ms);
    return { status: res.status, headers: res.headers, body, ms };
  } catch (err) {
    if (ac.signal.aborted) {
      return 'timeout';
    }
    // A client-side failure that isn't our abort (connection reset, a response
    // Bun can't parse) is itself a finding -- surface it rather than swallowing.
    throw new Error(`fetch failed, not a timeout: ${String(err)}\n${repro(url, init)}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Invariants
 * ------------------------------------------------------------------ */

// (a) The fixture is authored so that no generated input can *legitimately* 5xx:
// every framework reject is a 4xx or a 200 stub. So there is no allow-list here --
// an allow-list would only be somewhere for a real bug to hide.
function assertNo5xx(r: FuzzResult, ctx: string): void {
  if (r.status >= 500) {
    throw new Error(`unexpected ${r.status}\n${ctx}\n--- body ---\n${r.body.slice(0, 800)}`);
  }
}

// packages/mochi/src -> packages/mochi -> packages -> repo root
const REPO_ROOT = toPosixPath(path.resolve(import.meta.dir, '..', '..', '..'));

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LEAKS: ReadonlyArray<readonly [string, RegExp]> = [
  ['stack frame', /\n\s+at\s+[\w$.<>[\]/]+\s*[(:]/],
  ['at Object.', /\bat (?:Object|Module|Function|new )\./],
  ['node internals', /\bnode:internal\//],
  ['bun internals', /\bbun:(?:jsc|ffi|internal)\b/],
  ['posix home path', /(?:^|[\s"'(=`])\/(?:Users|home|root|private\/(?:var|tmp)|var\/folders)\//],
  ['windows path', /[A-Za-z]:[\\/]{1,2}(?:Users|home)[\\/]/i],
  ['node_modules', /node_modules[/\\]/],
  ['file url', /\bfile:\/\//],
  ['repo root', new RegExp(escapeRegExp(REPO_ROOT))],
  ['svelte-compile artifact', /svelte-compile[/\\][\w.-]+\.server\.js/],
  ['mochi outDir', /\.mochi-http-fuzz-[\w]+/],
];

// (c) Scans the body *and every header value* -- Location, Set-Cookie and
// anything a middleware added are just as capable of leaking as the body.
//
// A match that also appears in the request URL is the caller's own input coming
// back (a canonicalisation redirect echoes the path it rewrote), which is a
// different class from disclosing server-side state. Reflection safety is the
// CRLF/well-formedness invariant's job, so skip those here rather than reporting
// every request for `/node_modules/...` as a leak.
function assertNoLeak(r: FuzzResult, requestUrl: URL, ctx: string): void {
  let reflected = requestUrl.pathname + requestUrl.search;
  try {
    reflected += '\n' + decodeURIComponent(reflected);
  } catch {
    // A malformed escape means there is nothing extra to compare against.
  }
  const raw = [r.body, ...[...r.headers].map(([k, v]) => `${k}: ${v}`)];
  // Normalise separators so the same patterns catch Windows-shaped output; the
  // repo convention (toPosixPath) is forward slashes in every user-facing string.
  const haystacks = raw.flatMap((s) => [s, s.replaceAll('\\', '/')]);
  for (const h of haystacks) {
    for (const [name, re] of LEAKS) {
      const m = re.exec(h);
      // Trailing separators are stripped before the comparison: a
      // canonicalisation redirect appends the `/` that the request lacked, so
      // `node_modules/` must still count as an echo of `/node_modules`.
      if (m && !reflected.includes(m[0].replace(/[/\\]+$/, ''))) {
        throw new Error(`info leak (${name})\n${ctx}\n--- matched ${JSON.stringify(m[0])} in ---\n${h.slice(0, 800)}`);
      }
    }
  }
}

const TOKEN = String.raw`[!#$%&'*+\-.^_\`|~0-9A-Za-z]+`;
const CONTENT_TYPE_RE = new RegExp(`^${TOKEN}/${TOKEN}\\s*(;.*)?$`);
const COOKIE_PAIR_RE = new RegExp(`^${TOKEN}=[^\\s,;\\\\"]*`);

// (d) Protocol well-formedness.
function assertWellFormed(r: FuzzResult, requestUrl: URL, ctx: string): void {
  for (const [k, v] of r.headers) {
    if (/[\r\n]/.test(`${k}${v}`)) {
      throw new Error(`CRLF in header ${k}\n${ctx}`);
    }
  }

  const ct = r.headers.get('content-type');
  if (ct !== null && !CONTENT_TYPE_RE.test(ct)) {
    throw new Error(`unparseable Content-Type: ${ct}\n${ctx}`);
  }

  for (const sc of r.headers.getSetCookie()) {
    if (!COOKIE_PAIR_RE.test(sc)) {
      throw new Error(`unparseable Set-Cookie: ${sc}\n${ctx}`);
    }
    const pathAttr = /;\s*Path=([^;]*)/i.exec(sc);
    if (pathAttr && !pathAttr[1]!.startsWith('/')) {
      throw new Error(`Set-Cookie Path is not absolute: ${sc}\n${ctx}`);
    }
  }

  if (r.status >= 300 && r.status < 400 && r.status !== 304) {
    const loc = r.headers.get('location');
    if (loc === null) {
      throw new Error(`${r.status} with no Location\n${ctx}`);
    }
    let target: URL;
    try {
      // trailingSlash.ts:16 emits a *relative* Location, so resolve against the
      // request URL rather than demanding an absolute one.
      target = new URL(loc, requestUrl);
    } catch {
      throw new Error(`unparseable Location: ${loc}\n${ctx}`);
    }
    if (target.origin !== requestUrl.origin) {
      throw new Error(`off-origin redirect to ${loc}\n${ctx}`);
    }
    // The policy must be a fixed point: re-feeding the target must produce no
    // further redirect. A non-null here is a redirect loop -- the sharpest bug
    // trailingSlashRedirect/alternateSlashPattern can have, and the one
    // assertion the framework cannot satisfy by accident.
    if (trailingSlashRedirect('GET', target, 'always') !== null) {
      throw new Error(`redirect loop: ${requestUrl.pathname} -> ${loc} -> ...\n${ctx}`);
    }
  }

  if ((r.status === 204 || r.status === 304) && r.body !== '') {
    throw new Error(`${r.status} must be bodyless, got ${r.body.length} bytes\n${ctx}`);
  }
}

// Drift detector: not a correctness rule, but a new status appearing here means
// a code path nobody meant to add became reachable. 414/431 come from Bun's own
// HTTP layer rejecting the oversized paths and cookie headers the grammar emits,
// before Mochi ever sees the request.
const EXPECTED_STATUSES = new Set([200, 204, 301, 302, 303, 304, 308, 400, 403, 404, 405, 410, 413, 414, 415, 429, 431]);

function checkAll(r: FuzzResult | 'timeout', url: string, init: SendInit, seen?: Set<number>): void {
  const ctx = repro(url, init);
  if (r === 'timeout') {
    throw new Error(`no response within ${TIMEOUT_MS}ms\n${ctx}`);
  }
  seen?.add(r.status);
  const requestUrl = new URL(url);
  assertNo5xx(r, ctx);
  assertNoLeak(r, requestUrl, ctx);
  assertWellFormed(r, requestUrl, ctx);
}

/* ------------------------------------------------------------------ *
 * Suite
 * ------------------------------------------------------------------ */

describe('HTTP pipeline fuzzing', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let port: number;
  let echoKey: string;
  let validPropsToken: string;
  let clientBundleUrl: string;
  let imageUrl: string;

  beforeAll(async () => {
    // `Mochi.serve()`'s outDir must live inside the project tree: the on-demand
    // server-island path imports `<outDir>/svelte-compile/<Name>.server.js`, whose
    // deps resolve relative to outDir. One `..` -- this file sits at `src/`.
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-http-fuzz-'));

    // `proxy.origin` has to be known before boot, so claim a port up front rather
    // than using `port: 0`. Without a configured origin `csrfCheckDefault` takes
    // its "not configured" branch and half the CSRF surface goes untested.
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
    port = probe.port!;
    probe.stop(true);

    server = await Mochi.serve({
      port,
      // REQUIRED for the info-leak invariant: `runtime/errors.ts` attaches
      // `stack` to the error payload only when development is true.
      development: false,
      logger: { enabled: false },
      outDir,
      trailingSlash: 'always',
      proxy: { origin: `http://localhost:${port}` },
      image: { sizes: { thumb: { width: 32, height: 32, fit: 'inside' } } },
      routes: {
        '/': Mochi.page(PAGE, { serverProps: () => ({ imageUrl }) }),
        '/form': Mochi.page(FORM, {
          actions: {
            // Defensive on purpose: an action that throws is *documented* to
            // render the 500 error page, so letting `formData()` reject on a
            // malformed multipart body would make the no-5xx invariant assert
            // against the fixture's own error handling instead of the framework.
            default: async ({ request }) => {
              try {
                const data = await request.formData();
                return success({ message: String(data.get('q') ?? '') });
              } catch {
                return fail(400, { message: 'unparseable body' });
              }
            },
          },
        }),
        // An `api` route so KIND_POLICY's api row (csrf + trailingSlash on,
        // timeout off -- requestSetup.ts:57) is exercised distinctly from `page`.
        '/api/echo/:id': Mochi.api(({ method, params, url, cookies }) => Response.json({ method, id: params.id, q: url.searchParams.get('q'), c: cookies.get('sid') ?? null })),
        // Positive controls for the leak invariant, hit only by their own test.
        // A page is the load-bearing one: it renders DefaultError.svelte, whose
        // `{#if error.stack}` branch is the only place a stack can reach the
        // wire. An api route returns a fixed JSON envelope and cannot leak.
        '/boom': Mochi.page(PAGE, {
          serverProps: () => {
            throw new Error('deliberate fuzz-harness self-test failure');
          },
        }),
        '/api/boom': Mochi.api(() => {
          throw new Error('deliberate fuzz-harness self-test failure');
        }),
      },
    });
    base = `http://localhost:${server.port}`;

    // After serve(), which installs its own level. Rejecting a bad Origin is the
    // behaviour under test, so its warning is expected output here -- thousands
    // of them would bury a real failure.
    setLogLevel('error');

    // A local asset resolves through the registry, so the image endpoint is
    // exercised with zero network. Byte literal lifted from image/imageApi.test.ts.
    const png1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const diskPath = path.join(outDir, 'fuzz-1x1.png');
    await Bun.write(diskPath, await new Bun.Image(png1x1).resize(32, 32, { fit: 'fill' }).png().bytes());
    registerLocalImageAsset('/_mochi/asset/fuzz-1x1.png', { diskPath, contentType: 'image/png' });
    imageUrl = getImageUrl('/_mochi/asset/fuzz-1x1.png', 'thumb');

    // Islands are keyed `<localName>_<hash>`, never the bare import name, so
    // recover the concrete key and a real token from the rendered wrapper.
    const html = await (await fetch(`${base}/`)).text();
    const wrappers = [...html.matchAll(/<mochi-server-island\b[^>]*>/g)].map((m) => m[0]);
    const echoWrapper = wrappers.find((w) => /component-name="(Echo_\w+)"/.test(w));
    if (!echoWrapper) {
      throw new Error(`fixture page did not render an Echo <mochi-server-island> wrapper.\n${html.slice(0, 2000)}`);
    }
    echoKey = echoWrapper.match(/component-name="([^"]+)"/)![1]!;
    validPropsToken = echoWrapper.match(/signed-props="([^"]+)"/)![1]!;
    clientBundleUrl = html.match(/\/_mochi\/client\/[^"'\s]+\.js/)?.[0] ?? '';
    if (!clientBundleUrl) {
      throw new Error(`fixture page did not emit a client bundle URL.\n${html.slice(0, 2000)}`);
    }
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    // Surfaces a creeping latency regression long before it trips the deadline.
    console.log(`[fuzz] slowest response observed: ${maxObservedMs.toFixed(1)}ms (deadline ${TIMEOUT_MS}ms)`);
  });

  test('fixture boots and exposes every fuzz target', () => {
    expect(echoKey).toMatch(/^Echo_\w+$/);
    expect(validPropsToken.length).toBeGreaterThan(0);
    expect(clientBundleUrl).toStartWith('/_mochi/client/');
    expect(imageUrl).toStartWith('/_mochi/image/');
  });

  // The one place a 5xx is the *expected* result, so these are checked on their
  // own rather than through checkAll. The page case doubles as the
  // fault-injection target proving the leak deny-list actually fires.
  test('a thrown handler renders an error response that leaks nothing', async () => {
    // These routes throw on purpose, so their server-side stack traces are
    // expected output rather than a signal -- printing them would only teach
    // whoever reads this suite's output to ignore stack traces.
    setLogLevel('silent');
    try {
      for (const p of ['/boom/', '/api/boom/']) {
        const url = `${base}${p}`;
        const r = await send(url, {});
        if (r === 'timeout') {
          throw new Error(`no response from ${url}`);
        }
        expect(r.status).toBe(500);
        assertNoLeak(r, new URL(url), repro(url, {}));
      }
    } finally {
      setLogLevel('error');
    }
  });

  test('arbitrary requests hold all four invariants', async () => {
    const seen = new Set<number>();
    await fc.assert(
      fc.asyncProperty(arbMethod, arbPath, arbHeaders, arbBody, async (method, p, headers, body) => {
        const url = new URL(base);
        // Assigning pathname (rather than concatenating onto `base`) is what
        // preserves `//`-prefixed shapes -- string concat collapses them.
        url.pathname = p;
        const init: SendInit = { method, headers, ...(methodAllowsBody(method) ? { body } : {}) };
        checkAll(await send(url.toString(), init), url.toString(), init, seen);
      }),
      RUNS,
    );
    const unexpected = [...seen].filter((s) => !EXPECTED_STATUSES.has(s)).sort();
    if (unexpected.length > 0) {
      throw new Error(`status drift: ${unexpected.join(', ')} not in the expected set (all seen: ${[...seen].sort((a, b) => a - b).join(', ')})`);
    }
  });

  test('island endpoint survives junk component names and unsealed tokens', async () => {
    const arbName = fc.oneof(
      fc.constant(''),
      fc.constantFrom('Echo', 'Counter', 'Unknown_0000', '..', '%2e%2e', 'a'.repeat(500)),
      fc.string({ maxLength: 40 }),
      fc.constant(echoKey),
    );
    const arbToken = fc.oneof(fc.constant(''), fc.string({ maxLength: 200 }), fc.base64String({ maxLength: 200 }));
    await fc.assert(
      fc.asyncProperty(arbName, arbToken, async (name, token) => {
        const url = `${base}/_mochi/island/${encodeURIComponent(name)}?props=${encodeURIComponent(token)}`;
        checkAll(await send(url, {}), url, {});
      }),
      RUNS,
    );
  });

  test('island endpoint survives arbitrary sealed envelopes', async () => {
    // The point of this property: a random `?props=` string dies at the 403 in
    // Mochi.ts, so the *real* parser is only reachable by minting tokens with the
    // server's own key. Without this the envelope path is never tested at all.
    // devalue refuses to stringify a `__proto__` key, which fc.jsonValue does
    // generate. The server can only ever mint envelopes devalue *can* produce,
    // so those values aren't reachable inputs -- substitute rather than crash.
    const safeStringify = (v: unknown): string => {
      try {
        return devalueStringify(v);
      } catch {
        return devalueStringify({ name: 'unstringifiable' });
      }
    };
    const arbEnvelope = fc.oneof(
      { weight: 3, arbitrary: fc.jsonValue({ maxDepth: 4 }).map(safeStringify) },
      {
        weight: 3,
        arbitrary: fc
          .record(
            {
              islandId: fc.oneof(fc.string(), fc.constant('s--1'), fc.constant('a'.repeat(500))),
              __mochi_ah: fc.constantFrom('eager', 'visible', 'idle', 'nonsense'),
              name: fc.string(),
            },
            { requiredKeys: [] },
          )
          .map(safeStringify),
      },
      { weight: 2, arbitrary: fc.constantFrom(devalueStringify(null), devalueStringify(undefined), '{}', 'hello', '[', '', '[-1]', '[[]]') },
    );
    await fc.assert(
      fc.asyncProperty(arbEnvelope, fc.constantFrom(0, 1), async (envelope, aadPick) => {
        const aad = aadPick === 0 ? echoKey : 'Unknown_0000';
        const token = encryptProps(envelope, aad);
        const url = `${base}/_mochi/island/${aad}?props=${encodeURIComponent(token)}`;
        checkAll(await send(url, {}), url, {});
      }),
      RUNS,
    );
  });

  test('island endpoint survives bit-flipped real tokens', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: 40 }), fc.integer({ min: 1, max: 25 }), async (idx, shift) => {
        const i = idx % validPropsToken.length;
        const ch = validPropsToken.charCodeAt(i);
        const flipped = validPropsToken.slice(0, i) + String.fromCharCode(((ch - 32 + shift) % 95) + 32) + validPropsToken.slice(i + 1);
        const url = `${base}/_mochi/island/${echoKey}?props=${encodeURIComponent(flipped)}`;
        checkAll(await send(url, {}), url, {});
      }),
      RUNS,
    );
  });

  test('image endpoint survives arbitrary filenames and payloads', async () => {
    const validPayload = new URL(imageUrl, base).searchParams.get('p') ?? '';
    const arbFilename = fc.oneof(fc.constantFrom('fuzz-1x1.png', 'fuzz-1x1-thumb.webp', '..', '%2e%2e', '', 'a'.repeat(300), 'x.png'), fc.string({ maxLength: 30 }));
    const arbPayload = fc.oneof(fc.constant(''), fc.constant(validPayload), fc.string({ maxLength: 150 }), fc.base64String({ maxLength: 150 }));
    await fc.assert(
      fc.asyncProperty(arbFilename, arbPayload, async (filename, p) => {
        const url = `${base}/_mochi/image/${encodeURIComponent(filename)}?p=${encodeURIComponent(p)}`;
        checkAll(await send(url, {}), url, {});
      }),
      RUNS,
    );
  });

  test('asset endpoint never escapes the registry', async () => {
    const arbFilename = fc.oneof(fc.constantFrom('fuzz-1x1.png', '../../../etc/passwd', '..%2f..%2fetc%2fpasswd', '%00', '.env', 'package.json', ''), fc.string({ maxLength: 40 }));
    await fc.assert(
      fc.asyncProperty(arbFilename, async (filename) => {
        const url = `${base}/_mochi/asset/${encodeURIComponent(filename)}`;
        const r = await send(url, {});
        checkAll(r, url, {});
        // The handler uses the pathname purely as a Map key, so anything that
        // isn't the one registered URL must be a flat 404 -- never a partial read.
        if (r !== 'timeout' && r.status !== 404 && filename !== 'fuzz-1x1.png') {
          throw new Error(`asset endpoint returned ${r.status} for ${filename}, expected 404\n${repro(url, {})}`);
        }
      }),
      RUNS,
    );
  });

  test('client bundle route falls through the middleware chain cleanly', async () => {
    const arbSuffix = fc.oneof(fc.constant(''), fc.constantFrom('.map', '.js', '/', '..', '%00'), fc.string({ maxLength: 20 }));
    await fc.assert(
      fc.asyncProperty(arbSuffix, async (suffix) => {
        const url = `${base}${clientBundleUrl}${suffix}`;
        checkAll(await send(url, {}), url, {});
      }),
      RUNS,
    );
  });

  test('cookie, CSRF and proxy header handling', async () => {
    const targets = fc.constantFrom('/form/', '/api/echo/1/', '/api/echo/%2e%2e/');
    await fc.assert(
      fc.asyncProperty(arbMethod, targets, arbHeaders, arbBody, async (method, target, headers, body) => {
        const url = `${base}${target}`;
        const init: SendInit = { method, headers, ...(methodAllowsBody(method) ? { body } : {}) };
        checkAll(await send(url, init), url, init);
      }),
      RUNS,
    );
  });

  // Fuzzed as a pure function rather than over the wire because the served
  // fixture's proxy origin necessarily equals its request origin, so
  // buildPublicUrl early-returns and the URL-rebuilding branch is unreachable
  // from any HTTP request this suite can make. Production is the other shape:
  // behind a TLS-terminating proxy the configured origin differs, and every
  // request goes through the branch. A `/..//` request normalizes to a pathname
  // of `//`, which `new URL('//', origin)` rejects outright.
  test('buildPublicUrl never throws under a mismatched proxy origin', () => {
    fc.assert(
      fc.property(arbPath, (p) => {
        const url = new URL(base);
        url.pathname = p;
        buildPublicUrl(new Request(url.toString()), { origin: 'https://public.example' });
      }),
      RUNS,
    );
  });

  test('trailing-slash policy never loops', async () => {
    await fc.assert(
      fc.asyncProperty(arbPath, async (p) => {
        const url = new URL(base);
        url.pathname = p;
        checkAll(await send(url.toString(), {}), url.toString(), {});
      }),
      // Cheap (no render, no crypto), so it can afford a wider search.
      { ...RUNS, numRuns: NUM_RUNS * 4 },
    );
  });
});
