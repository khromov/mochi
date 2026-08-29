import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { setFeatureOverride } from './features';

describe('Mochi.feature() per-user flags', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-features-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      features: {
        always: { rollout: 1 },
        never: { rollout: 0 },
        half: { rollout: 0.5 },
        staff: {
          rollout: 0,
          target: (ctx) => (ctx.url.searchParams.get('staff') === '1' ? true : undefined),
        },
      },
      routes: {
        '/api/flag/:name': Mochi.api(({ params }) => Response.json({ on: Mochi.feature(params.name ?? '') })),
        // No flag checked → the cookie jar is never touched.
        '/api/none': Mochi.api(() => Response.json({ ok: true })),
        '/api/override': Mochi.api(({ url }) => {
          const name = url.searchParams.get('name') ?? '';
          const val = url.searchParams.get('val');
          setFeatureOverride(name, val === null ? null : val === 'true');
          return Response.json({ ok: true });
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('rollout extremes: 1 is always on, 0 is always off', async () => {
    const on = (await (await fetch(`${base}/api/flag/always`)).json()) as { on: boolean };
    const off = (await (await fetch(`${base}/api/flag/never`)).json()) as { on: boolean };
    expect(on.on).toBe(true);
    expect(off.on).toBe(false);
  });

  test('undeclared flag resolves to false', async () => {
    const res = (await (await fetch(`${base}/api/flag/does-not-exist`)).json()) as { on: boolean };
    expect(res.on).toBe(false);
  });

  test('mints an opaque, HttpOnly cookie and sets Vary: Cookie', async () => {
    const res = await fetch(`${base}/api/flag/half`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('mochi_ff=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    // The cookie must not leak the flag list.
    expect(setCookie).not.toContain('half');
    expect(res.headers.get('vary')?.toLowerCase()).toContain('cookie');
  });

  test('a route that checks no flag neither sets the cookie nor forces Vary', async () => {
    const res = await fetch(`${base}/api/none`);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('mochi_ff');
    expect(res.headers.get('vary')?.toLowerCase() ?? '').not.toContain('cookie');
  });

  test('same user (same cookie) deterministically gets the same state', async () => {
    const first = await fetch(`${base}/api/flag/half`);
    const firstState = ((await first.json()) as { on: boolean }).on;
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0]!;

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/api/flag/half`, { headers: { cookie } });
      expect(((await res.json()) as { on: boolean }).on).toBe(firstState);
      // A stable, already-minted cookie is not re-issued.
      expect(res.headers.get('set-cookie') ?? '').not.toContain('mochi_ff=');
    }
  });

  test('target predicate overrides bucketing', async () => {
    const off = (await (await fetch(`${base}/api/flag/staff`)).json()) as { on: boolean };
    const on = (await (await fetch(`${base}/api/flag/staff?staff=1`)).json()) as { on: boolean };
    expect(off.on).toBe(false);
    expect(on.on).toBe(true);
  });

  test('a tampered cookie is replaced with a fresh seed (no throw)', async () => {
    const res = await fetch(`${base}/api/flag/half`, { headers: { cookie: 'mochi_ff=not-a-valid-token' } });
    expect(res.status).toBe(200);
    // A fresh, valid cookie is issued to replace the garbage one.
    expect(res.headers.get('set-cookie') ?? '').toContain('mochi_ff=');
  });

  test('sticky override survives across requests via the encrypted cookie', async () => {
    // Override the always-off flag to on for this user.
    const setRes = await fetch(`${base}/api/override?name=never&val=true`);
    const cookie = (setRes.headers.get('set-cookie') ?? '').split(';')[0]!;
    expect(cookie).toContain('mochi_ff=');

    const after = (await (await fetch(`${base}/api/flag/never`, { headers: { cookie } })).json()) as { on: boolean };
    expect(after.on).toBe(true);

    // Clearing the override falls back to bucketing (rollout 0 → off).
    const clearRes = await fetch(`${base}/api/override?name=never`, { headers: { cookie } });
    const cleared = (clearRes.headers.get('set-cookie') ?? '').split(';')[0] || cookie;
    const back = (await (await fetch(`${base}/api/flag/never`, { headers: { cookie: cleared } })).json()) as { on: boolean };
    expect(back.on).toBe(false);
  });

  test('a 50% rollout enables roughly half of distinct users', async () => {
    let on = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      // No cookie → a fresh random seed per request, i.e. an independent user.
      const res = (await (await fetch(`${base}/api/flag/half`)).json()) as { on: boolean };
      if (res.on) {
        on++;
      }
    }
    const fraction = on / n;
    expect(fraction).toBeGreaterThan(0.3);
    expect(fraction).toBeLessThan(0.7);
  });
});
