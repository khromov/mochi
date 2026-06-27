import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'client-only', 'Page.svelte');

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

describe('mochi:clientOnly rendering', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-client-only-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('SSR emits the wrapper with fallback content but never the component HTML', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    const wrapper = result.body.match(/<mochi-hydratable-island[^>]*>([\s\S]*?)<\/mochi-hydratable-island>/);
    expect(wrapper).not.toBeNull();
    expect(wrapper![0]).toContain('client-only');
    expect(wrapper![1]).toContain('<p data-fallback="">loading</p>');

    // The component never renders server-side
    expect(result.body).not.toContain('data-widget-rendered');
  });

  test('props are serialized into a shared JSON block without islandId', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    expect(result.body).toContain('props-ref="mochi-props-0"');
    const propsScript = result.body.match(/<script type="application\/json" id="mochi-props-0">([\s\S]*?)<\/script>/);
    expect(propsScript).not.toBeNull();
    expect(propsScript![1]).toContain('label');
    expect(propsScript![1]).toContain('hi');
    expect(propsScript![1]).not.toContain('islandId');
  });

  test('mochi:clientOnly:visible emits hydrate-on/options and a resolved css-url, still no SSR render', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    const visible = result.body.match(/<mochi-hydratable-island[^>]*hydrate-on="visible"[^>]*>([\s\S]*?)<\/mochi-hydratable-island>/);
    expect(visible).not.toBeNull();
    expect(visible![0]).toContain('client-only');
    expect(visible![0]).toContain('hydrate-options=');
    expect(visible![0]).toContain('150px');
    // Lazy CSS URL is substituted to a real path, not left as a placeholder
    expect(visible![0]).toMatch(/css-url="[^"]*\/css\/[^"]+\.css"/);
    expect(visible![0]).not.toContain('__MOCHI_CSS_URL__');
    // Fallback ships; the component itself never renders server-side
    expect(visible![1]).toContain('<p data-fallback-visible="">loading lazily</p>');
    expect(result.body).not.toContain('data-widget-lazy-rendered');
  });

  test('client bundle URL is substituted and bootstrap/CSS are exposed', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    expect(result.body).not.toContain('__MOCHI_COMPONENT_URL__');
    expect(result.body).toMatch(/component-url="[^"]*\/client\/[^"]+"/);
    expect(result.bootstrapUrl).not.toBeNull();
    expect(result.cssUrls.length).toBeGreaterThan(0);
  });
});
