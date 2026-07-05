// Renders a Svelte email template through the real ComponentRegistry (no
// Mochi.serve — a single registry build avoids the double-build EISDIR hazard
// under `bun test`, same rationale as serverIslandCss.test.ts) and asserts the
// scoped CSS is inlined into style="" attributes with no client JS or <link>.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../ComponentRegistry';
import { requestContext } from '../requestContext';
import type { MochiRequestContext } from '../requestContext';
import { MochiCookieJar } from '../cookies';
import { renderEmailComponent } from './render';

const WELCOME = path.join(import.meta.dir, '..', '__fixtures__', 'email', 'Welcome.svelte');
const WITH_SCRIPT = path.join(import.meta.dir, '..', '__fixtures__', 'email', 'WithScript.svelte');

function makeCtx(): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    getClientAddress: () => null,
  };
}

describe('renderEmailComponent', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-email-render-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(WELCOME);
    await registry.compile(WITH_SCRIPT);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('inlines scoped CSS into style attributes and ships no client JS', async () => {
    const html = await requestContext.run(makeCtx(), () => renderEmailComponent(registry, WELCOME, { name: 'Ada' }));

    expect(html).toContain('Hello Ada');
    // css-inline moved the scoped rules onto the elements as inline styles.
    expect(html).toContain('style="');
    expect(html).toContain('#6b46c1'); // h1 color, now inline
    expect(html).toContain('padding: 24px');
    // No hydration/client assets in an email body.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
  });

  test('strips <script> tags emitted by the template', async () => {
    const html = await requestContext.run(makeCtx(), () => renderEmailComponent(registry, WITH_SCRIPT, { name: 'Ada' }));

    expect(html).toContain('Hello Ada'); // template still rendered
    expect(html).not.toContain('<script');
    expect(html).not.toContain('window.tracked');
  });
});
