// Renders a Svelte email template through the real ComponentRegistry (no
// Mochi.serve — email rendering never needs a server) and asserts the
// scoped CSS is inlined into style="" attributes with no client JS or <link>.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';
import { requestContext } from '../runtime/requestContext';
import type { MochiRequestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';
import { renderEmailComponent } from './render';

const WELCOME = path.join(import.meta.dir, '..', '__fixtures__', 'email', 'Welcome.svelte');
const WITH_SCRIPT = path.join(import.meta.dir, '..', '__fixtures__', 'email', 'WithScript.svelte');
const USES_REQUEST_CONTEXT = path.join(import.meta.dir, '..', '__fixtures__', 'email', 'UsesRequestContext.svelte');

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
    await registry.compile(USES_REQUEST_CONTEXT);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  // Called bare (no requestContext.run) — this IS the queue-job / no-active-ctx
  // path; email must render fine without any ambient request context.
  test('inlines scoped CSS into style attributes and ships no client JS', async () => {
    const html = await renderEmailComponent(registry, WELCOME, { name: 'Ada' });

    expect(html).toContain('Hello Ada');
    // css-inline moved the scoped rules onto the elements as inline styles.
    expect(html).toContain('style="');
    expect(html).toContain('#6b46c1'); // h1 color, now inline
    expect(html).toContain('padding: 24px');
    // No hydration/client assets in an email body.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
  });

  test('strips <script> and <style> tags emitted by the template body', async () => {
    const html = await renderEmailComponent(registry, WITH_SCRIPT, { name: 'Ada' });

    expect(html).toContain('Hello Ada'); // template still rendered
    expect(html).not.toContain('<script');
    expect(html).not.toContain('window.tracked');
    // The body-injected <style> is stripped; its rules never reach the output.
    expect(html).not.toContain('hotpink');
    // But the component's own scoped CSS still inlines onto elements.
    expect(html).toContain('padding: 24px');
  });

  // Statelessness regression (replaces the old nested-render workaround): even
  // inside an active request context, an email render never touches
  // `ctx.islandProps` and emits no `mochi-props` blocks.
  test('does not touch ctx.islandProps when run inside a request context', async () => {
    const ctx = makeCtx();
    ctx.islandProps.set('seed', { id: 'mochi-props-0', emitCount: 1 });

    const html = await requestContext.run(ctx, () => renderEmailComponent(registry, WELCOME, { name: 'Ada' }));

    expect(html).toContain('Hello Ada');
    expect(html).not.toContain('mochi-props');
    // The pre-seeded entry survives untouched — the email render ran isolated.
    expect(ctx.islandProps.get('seed')).toEqual({ id: 'mochi-props-0', emitCount: 1 });
    expect(ctx.islandProps.size).toBe(1);
  });

  // Isolation: even inside requestContext.run, the template renders via
  // requestContext.exit, so getRequestContext() throws for the template.
  test('template calling getRequestContext() rejects even inside a request context', async () => {
    await expect(requestContext.run(makeCtx(), () => renderEmailComponent(registry, USES_REQUEST_CONTEXT))).rejects.toThrow(/getRequestContext\(\) called outside of a request/);
  });
});

// Email clients either ignore @font-face or clip the message over their size limit, and the `/_mochi/fonts/*` URLs
// font extraction leaves in imported CSS have no origin to resolve against, so the faces go entirely.
describe('renderEmailComponent — imported fonts', () => {
  let tmp: string;
  let registry: ComponentRegistry;
  let emailPath: string;
  const fontBytes = new Uint8Array(9_000);
  for (let i = 0; i < fontBytes.length; i++) {
    fontBytes[i] = (i * 31 + 9) % 256;
  }
  const smallFontBytes = new Uint8Array(512).fill(7);

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-email-fonts-'));
    mkdirSync(path.join(tmp, 'files'));
    writeFileSync(path.join(tmp, 'files', 'brand.woff2'), fontBytes);
    writeFileSync(path.join(tmp, 'files', 'icons.woff2'), smallFontBytes);
    writeFileSync(
      path.join(tmp, 'fonts.css'),
      `@font-face { font-family: 'Brand'; src: url('./files/brand.woff2') format('woff2'); }\n` +
        `@font-face { font-family: 'Icons'; src: url('./files/icons.woff2') format('woff2'); }\n` +
        `h1 { font-family: 'Brand', serif; }`,
    );
    emailPath = path.join(tmp, 'FontEmail.svelte');
    writeFileSync(emailPath, `<script>\n  import './fonts.css';\n<` + `/script>\n\n<h1>font email</h1>\n`);
    registry = new ComponentRegistry({ development: true, outDir: path.join(tmp, 'out') });
    await registry.compile(emailPath);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('drops @font-face rules, extracted or inlined, and keeps the family fallback', async () => {
    const html = await renderEmailComponent(registry, emailPath);
    expect(html).not.toContain('@font-face');
    expect(html).not.toContain('/_mochi/fonts/');
    expect(html).not.toContain('data:font');
    expect(html).not.toContain(Buffer.from(smallFontBytes).toString('base64'));
    expect(html).toContain('serif');
  });
});
