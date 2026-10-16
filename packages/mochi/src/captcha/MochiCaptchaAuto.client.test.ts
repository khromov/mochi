// The auto-solving widget's reload loop is entirely client-side: it solves, POSTs, and reloads, and the only thing that
// can stop it re-solving forever is what it leaves in sessionStorage across that reload. So it is driven here through a
// real DOM with `fetch` and `location.reload` stubbed, the way the same-directory MochiCaptcha client test drives its own.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { compile, preprocess } from 'svelte/compiler';

const CAPTCHA_DIR = import.meta.dir;
const tmpDir = mkdtempSync(path.join(CAPTCHA_DIR, '..', '..', '.mochi-captcha-auto-client-'));

const sveltePkgPath = Bun.resolveSync('svelte/package.json', CAPTCHA_DIR);
const sveltePkg = (await Bun.file(sveltePkgPath).json()) as { exports: { '.': { browser: string } } };
const SVELTE_CLIENT = path.join(path.dirname(sveltePkgPath), sveltePkg.exports['.'].browser);

const tsTranspiler = new Bun.Transpiler({ loader: 'ts' });

const source = await Bun.file(path.join(CAPTCHA_DIR, 'MochiCaptchaAuto.svelte')).text();
const preprocessed = await preprocess(
  source,
  [{ name: 'ts', script: ({ content, attributes }) => (attributes.lang === 'ts' ? { code: tsTranspiler.transformSync(content) } : undefined) }],
  { filename: 'MochiCaptchaAuto.svelte' },
);
const clientJs = compile(preprocessed.code, { filename: 'MochiCaptchaAuto.svelte', generate: 'client', dev: false, css: 'injected', discloseVersion: false }).js.code;

const logs: string[] = [];
(globalThis as unknown as { __captchaAutoLogs: string[] }).__captchaAutoLogs = logs;

const envModule = path.join(tmpDir, 'env.js');
writeFileSync(
  envModule,
  `const push = (level) => (...args) => { globalThis.__captchaAutoLogs.push(level + ': ' + args.join(' ')); };
export const isDev = true;
export const logger = { log: push('log'), warn: push('warn'), error: push('error') };
`,
);

const componentFile = path.join(tmpDir, 'MochiCaptchaAuto.js');
writeFileSync(
  componentFile,
  clientJs
    .replace(/from ["']\.\/pow["']/g, `from ${JSON.stringify(path.join(CAPTCHA_DIR, 'pow.ts'))}`)
    .replace(/from ["']mochi-framework["']/g, `from ${JSON.stringify(envModule)}`)
    .replace(/from ["']svelte["']/g, `from ${JSON.stringify(SVELTE_CLIENT)}`),
);

const CaptchaAuto = (await import(componentFile)).default;
const { mount, unmount, flushSync } = (await import(SVELTE_CLIENT)) as typeof import('svelte');

const VERIFIED_KEY = 'mochi-protection-verified';
const BOUNCES_KEY = 'mochi-protection-bounces';

let reloads = 0;
let verifyCalls = 0;
let verifyOk = true;
Object.defineProperty(globalThis.location, 'reload', { configurable: true, value: () => void reloads++ });
globalThis.fetch = (async () => {
  verifyCalls++;
  return verifyOk ? Response.json({ ok: true }) : Response.json({ ok: false, error: 'nope' }, { status: 403 });
}) as unknown as typeof fetch;

const current: { instance: Record<string, unknown> | null; host: HTMLElement | null } = { instance: null, host: null };

/** Mounts the widget and lets the solve slices run to completion; `bits: 1` keeps that to a handful of hashes. */
async function mountWidget(props: Record<string, unknown> = {}): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  current.host = host;
  current.instance = mount(CaptchaAuto, {
    target: host,
    props: { token: 'test-token', bits: 1, solveBudgetMs: 5000, verifyUrl: '/verify', maxAttempts: 5, ...props },
  }) as Record<string, unknown>;
  flushSync();
  for (let i = 0; i < 50 && reloads === 0 && !host.querySelector('.errored'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  }
  return host;
}

function statusText(host: HTMLElement): string {
  return host.querySelector('.status')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('MochiCaptchaAuto reload loop', () => {
  beforeEach(() => {
    reloads = 0;
    verifyCalls = 0;
    verifyOk = true;
    logs.length = 0;
    sessionStorage.clear();
  });

  afterEach(() => {
    if (current.instance) {
      unmount(current.instance);
      current.instance = null;
    }
    current.host?.remove();
    document.body.innerHTML = '';
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a successful verification reloads once and leaves the marker behind', async () => {
    await mountWidget();
    expect(verifyCalls).toBe(1);
    expect(reloads).toBe(1);
    expect(Number(sessionStorage.getItem(VERIFIED_KEY))).toBeGreaterThan(0);
  });

  test('coming back to the interstitial after a fresh verification stops instead of re-solving', async () => {
    sessionStorage.setItem(VERIFIED_KEY, String(Date.now()));
    const host = await mountWidget();
    expect(verifyCalls).toBe(0);
    expect(reloads).toBe(0);
    expect(statusText(host)).toContain('still gated');
    // The marker is consumed, so the next mount is judged on its own.
    expect(sessionStorage.getItem(VERIFIED_KEY)).toBeNull();
    expect(sessionStorage.getItem(BOUNCES_KEY)).toBe('1');
  });

  test('a second bounce is terminal, so a misconfigured gate cannot loop the visitor forever', async () => {
    sessionStorage.setItem(BOUNCES_KEY, '1');
    sessionStorage.setItem(VERIFIED_KEY, String(Date.now()));
    const host = await mountWidget();
    expect(verifyCalls).toBe(0);
    expect(reloads).toBe(0);
    expect(statusText(host)).toContain("couldn't verify your browser");
    expect(logs.some((line) => line.includes('still gated'))).toBe(true);
  });

  test('a stale marker from a verification that did land is ignored', async () => {
    sessionStorage.setItem(VERIFIED_KEY, String(Date.now() - 120_000));
    await mountWidget();
    expect(verifyCalls).toBe(1);
    expect(reloads).toBe(1);
  });

  test('an unrelated challenge after a clean load resets the bounce count', async () => {
    sessionStorage.setItem(BOUNCES_KEY, '1');
    await mountWidget();
    expect(sessionStorage.getItem(BOUNCES_KEY)).toBe('0');
    expect(reloads).toBe(1);
  });
});
