// End-to-end state machine for the <MochiCaptcha /> widget, driven through a
// real DOM. The widget is pure client behaviour — a pointer drag advancing a
// hash chain, then an interruptible proof-of-work — so none of it is reachable
// from the server-side tests in captcha.test.ts. Here the component is compiled
// the way the client bundle compiles it, mounted into happy-dom, and driven with
// synthetic pointer/keyboard events; the fields it produces are handed to the
// real `verifyCaptcha()` at the end, so the client and server halves are checked
// against each other rather than against a mock.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { compile, preprocess } from 'svelte/compiler';
import { render } from 'svelte/server';
import { mintCaptcha, verifyCaptcha } from './captcha';
import { CAPTCHA_STEPS } from './pow';
import type { MochiCaptchaOptions } from './types';

/* ------------------------------------------------------------------ *
 * Compiling the component
 * ------------------------------------------------------------------ */

const CAPTCHA_DIR = import.meta.dir;
// A sibling of the package, so the emitted modules resolve `svelte` and
// `@noble/hashes` through the project's own node_modules chain.
const tmpDir = mkdtempSync(path.join(CAPTCHA_DIR, '..', '..', '.mochi-captcha-client-'));

// Bun resolves the bare `svelte` specifier through the `bun`/`default`
// condition, which is Svelte's *server* entry — its `onMount` is a no-op and
// `mount()` throws. The compiled component and this test both have to reach the
// browser entry the real client bundle gets, and both have to reach the *same*
// copy of it, so the path is resolved once and substituted into every import.
const sveltePkgPath = Bun.resolveSync('svelte/package.json', CAPTCHA_DIR);
const sveltePkg = (await Bun.file(sveltePkgPath).json()) as { exports: { '.': { browser: string } } };
const SVELTE_CLIENT = path.join(path.dirname(sveltePkgPath), sveltePkg.exports['.'].browser);

const tsTranspiler = new Bun.Transpiler({ loader: 'ts' });

async function compileCaptcha(generate: 'client' | 'server'): Promise<string> {
  const source = await Bun.file(path.join(CAPTCHA_DIR, 'MochiCaptcha.svelte')).text();
  // Mirrors ComponentRegistry's builtin `mochi-ts` preprocessor: Bun strips the
  // TypeScript, `lang="ts"` stays on the tag.
  const preprocessed = await preprocess(
    source,
    [{ name: 'ts', script: ({ content, attributes }) => (attributes.lang === 'ts' ? { code: tsTranspiler.transformSync(content) } : undefined) }],
    {
      filename: 'MochiCaptcha.svelte',
    },
  );
  return compile(preprocessed.code, { filename: 'MochiCaptcha.svelte', generate, dev: false, css: 'injected', discloseVersion: false }).js.code;
}

/**
 * Stands in for the `mochi-env:mochi-framework` virtual module the real build
 * substitutes. `isDev` is a build-time constant there (`__MOCHI_DEV__`), so the
 * two builds below are how production and development actually differ — not a
 * flag flipped at runtime. `logger` records instead of printing: every failure
 * path in the widget is required to leave a console record, which is otherwise
 * unobservable.
 */
function writeEnvModule(name: string, isDev: boolean): string {
  const file = path.join(tmpDir, name);
  writeFileSync(
    file,
    `const push = (level) => (...args) => { globalThis.__captchaLogs.push(level + ': ' + args.join(' ')); };
export const isDev = ${isDev};
export const logger = { log: push('log'), warn: push('warn'), error: push('error') };
`,
  );
  return file;
}

function writeComponentModule(name: string, js: string, envModule: string | null): string {
  const file = path.join(tmpDir, name);
  let code = js.replace(/from ["']\.\/pow["']/g, `from ${JSON.stringify(path.join(CAPTCHA_DIR, 'pow.ts'))}`);
  if (envModule) {
    code = code.replace(/from ["']mochi-framework["']/g, `from ${JSON.stringify(envModule)}`).replace(/from ["']svelte["']/g, `from ${JSON.stringify(SVELTE_CLIENT)}`);
  } else {
    // The SSR build keeps the bare `svelte` specifier (the server entry is the
    // right one there) and only needs the env module's shape.
    code = code.replace(/from ["']mochi-framework["']/g, `from ${JSON.stringify(writeEnvModule('env.ssr.js', false))}`);
  }
  writeFileSync(file, code);
  return file;
}

const captured: string[] = [];
(globalThis as unknown as { __captchaLogs: string[] }).__captchaLogs = captured;

const clientJs = await compileCaptcha('client');
const DevCaptcha = (await import(writeComponentModule('MochiCaptcha.dev.js', clientJs, writeEnvModule('env.dev.js', true)))).default;
const ProdCaptcha = (await import(writeComponentModule('MochiCaptcha.prod.js', clientJs, writeEnvModule('env.prod.js', false)))).default;
const SsrCaptcha = (await import(writeComponentModule('MochiCaptcha.ssr.js', await compileCaptcha('server'), null))).default;

// Same physical copy of the runtime the components import, so `mount()` drives
// the effects they registered.
const { mount, unmount, flushSync } = (await import(SVELTE_CLIENT)) as typeof import('svelte');

/* ------------------------------------------------------------------ *
 * The bits of a browser happy-dom doesn't have
 * ------------------------------------------------------------------ */

const HANDLE = 44;
const TRACK_WIDTH = 344;
/** What the widget derives from the track: `clientWidth - handle`. */
const MAX_OFFSET = TRACK_WIDTH - HANDLE;

// happy-dom does no layout, so every element measures 0 — which the widget
// correctly refuses to treat as a solvable track. Give the track (and only the
// track) a width.
Object.defineProperty(globalThis.HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains('track') ? TRACK_WIDTH : 0;
  },
});

// happy-dom's ResizeObserver never invokes its callback, and the widget takes
// its only measurement from one. Real browsers fire once on `observe()`, which
// is the behaviour the widget's attachment is written against.
class ImmediateResizeObserver {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    this.#callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ImmediateResizeObserver as unknown as typeof ResizeObserver;

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

type WidgetState = 'hidden' | 'idle' | 'verifying' | 'verified' | 'error' | 'error-fatal';

interface CaptchaProps {
  token?: string;
  bits?: number;
  solveBudgetMs?: number;
}

const current: { instance: Record<string, unknown> | null; host: HTMLElement | null } = { instance: null, host: null };

class Widget {
  constructor(private readonly host: HTMLElement) {}

  private el(selector: string): HTMLElement | null {
    return this.host.querySelector(selector);
  }

  /** The widget's observable state, read the way a visitor would see it. */
  state(): WidgetState {
    if (!this.el('.captcha')) {
      return 'hidden';
    }
    if (this.el('button.error-box')) {
      return 'error';
    }
    if (this.el('.error-box')) {
      return 'error-fatal';
    }
    return this.el('.captcha.verified') ? 'verified' : this.el('.captcha.solved') ? 'verifying' : 'idle';
  }

  hint(): string {
    return this.el('.captcha-hint')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  /** The `(N attempts)` counter, which only appears once a solve runs long. */
  progress(): string | null {
    const node = this.el('.captcha-hint [aria-hidden="true"]');
    return node ? node.textContent!.replace(/\s+/g, ' ').trim() : null;
  }

  fields(): { captcha_token: string; captcha_pow: string } {
    const value = (name: string) => (this.host.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? null;
    return { captcha_token: value('captcha_token') ?? '', captcha_pow: value('captcha_pow') ?? '' };
  }

  /** Handle position in px, parsed back out of the inline transform. */
  offset(): number {
    const style = this.el('.handle')?.getAttribute('style') ?? '';
    return Number(/translateX\((-?[\d.]+)px\)/.exec(style)?.[1] ?? NaN);
  }

  private handle(): HTMLElement {
    const handle = this.el('.handle');
    if (!handle) {
      throw new Error(`No slider handle — widget is in state "${this.state()}"`);
    }
    return handle;
  }

  pointer(type: string, clientX: number, pointerId = 1): void {
    this.handle().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, pointerId }));
    flushSync();
  }

  /** A complete gesture: press at 0, move through each x, lift at the last. */
  drag(...positions: number[]): void {
    this.pointer('pointerdown', 0);
    for (const x of positions) {
      this.pointer('pointermove', x);
    }
    this.pointer('pointerup', positions.at(-1)!);
  }

  /** A gesture that is never lifted, so the widget solves with the pointer still down. */
  dragHolding(...positions: number[]): void {
    this.pointer('pointerdown', 0);
    for (const x of positions) {
      this.pointer('pointermove', x);
    }
  }

  key(key: string, times = 1): void {
    for (let i = 0; i < times; i++) {
      this.handle().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    flushSync();
  }

  /**
   * Cross the whole track — ArrowRight advances a tenth at a time, so ten
   * presses is exactly one traverse. Used wherever the test is about what
   * happens *after* the slide; the pointer tests below are the ones about
   * dragging itself.
   */
  slideToEnd(): void {
    this.key('ArrowRight', 10);
  }

  clickRetry(): void {
    const button = this.el('button.error-box');
    if (!button) {
      throw new Error(`No retry button — widget is in state "${this.state()}"`);
    }
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    flushSync();
  }

  async waitForState(want: WidgetState, timeoutMs = 30_000): Promise<void> {
    await waitUntil(
      () => this.state() === want,
      () => `state stuck at "${this.state()}" waiting for "${want}"`,
      timeoutMs,
    );
  }

  async waitForProgress(timeoutMs = 30_000): Promise<string> {
    await waitUntil(
      () => this.progress() !== null,
      () => 'no attempt counter appeared',
      timeoutMs,
    );
    return this.progress()!;
  }
}

function renderWidget(Component: unknown, props: CaptchaProps): Widget {
  const host = document.createElement('div');
  document.body.appendChild(host);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  current.instance = mount(Component as any, { target: host, props }) as Record<string, unknown>;
  current.host = host;
  flushSync();
  return new Widget(host);
}

/** Tear the widget down mid-flight, the way navigating away from the page does. */
function unmountWidget(): void {
  if (current.instance) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void unmount(current.instance as any, { outro: false });
    current.instance = null;
    flushSync();
  }
}

async function waitUntil(predicate: () => boolean, explain: () => string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    flushSync();
    if (predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms: ${explain()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const logsMatching = (pattern: RegExp): string[] => captured.filter((line) => pattern.test(line));

/* ------------------------------------------------------------------ *
 * Server-side captcha config, for the end-to-end verification
 * ------------------------------------------------------------------ */

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_RUNTIME_KEY = '__mochi_captcha_runtime__';

function installConfig(captcha: MochiCaptchaOptions = { bits: 8, minAgeMs: 0 }): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: { captcha },
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  unmountWidget();
  current.host?.remove();
  current.host = null;
  document.body.innerHTML = '';
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_RUNTIME_KEY];
});

afterAll(async () => {
  rmSync(tmpDir, { recursive: true, force: true });
  await GlobalRegistrator.unregister();
});

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('MochiCaptcha — the empty entry state', () => {
  test('the server renders only a blank spacer, so an unhydrated widget is empty space rather than a dead slider', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { body } = render(SsrCaptcha as any, { props: { token: 'server-token', bits: 4 } });
    expect(body).toContain('captcha-placeholder');
    // Nothing to drag, no fields, and no token leaked into markup nobody can use.
    expect(body).not.toContain('handle');
    expect(body).not.toContain('captcha_token');
    expect(body).not.toContain('server-token');
  });

  test('the spacer reserves the height the slider takes, so mounting shifts nothing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { head } = render(SsrCaptcha as any, { props: { token: 'server-token', bits: 4 } });
    // `css: 'injected'`, so the component's (minified) stylesheet comes back
    // with the render. Comments survive minification and would match as
    // selectors, so they go first.
    const css = head.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string) => new RegExp(`${selector}[^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('\\.captcha-placeholder')).toContain('min-height:44px');
    // Svelte scoping sits between the two class names, hence the gap.
    expect(rule('\\.captcha[^{]*\\.track')).toContain('height:44px');
    // The track has a border, so the spacer needs one too — otherwise it is 2px
    // short of what replaces it under a content-box reset.
    expect(rule('\\.captcha-placeholder')).toContain('border:1px solid transparent');
    // The <noscript> must go entirely unstyled: a scripting-enabled parser keeps
    // its content as raw text that only the UA's `display: none` hides, so an
    // author `display` would put that text on screen for everyone.
    expect(css).not.toContain('noscript');
  });

  test('the spacer carries a <noscript> explaining why the widget is missing without JavaScript', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { body } = render(SsrCaptcha as any, { props: { token: 'server-token', bits: 4, noscriptLabel: 'Turn on JS' } });
    expect(body).toContain('<noscript>Turn on JS</noscript>');
  });

  test('the slider only appears once the component mounts in the browser', () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });
    expect(widget.state()).toBe('idle');
    expect(widget.hint()).toBe('Slide to verify');
    expect(widget.fields()).toEqual({ captcha_token: '', captcha_pow: '' });
  });
});

describe('MochiCaptcha — idle → verifying → verified', () => {
  test('a partial drag advances the hash chain one link per step crossed and stays idle', () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });

    widget.pointer('pointerdown', 0);
    widget.pointer('pointermove', MAX_OFFSET * 0.35);

    expect(widget.state()).toBe('idle');
    expect(widget.hint()).toBe('Slide to verify');
    expect(logsMatching(/link \d+\/10 minted/)).toHaveLength(3);
    expect(logsMatching(/chain complete/)).toHaveLength(0);
    expect(widget.fields().captcha_token).toBe('');
  });

  test('a drag that stops short releases back to the start, minting no further links', () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });

    widget.drag(MAX_OFFSET * 0.5, MAX_OFFSET - 40);

    expect(widget.state()).toBe('idle');
    expect(widget.offset()).toBe(0);
    // Links already minted are not un-minted; the chain simply stops advancing.
    expect(logsMatching(/link \d+\/10 minted/)).toHaveLength(8);
    expect(logsMatching(/chain complete/)).toHaveLength(0);
  });

  test('a cancelled gesture resets instead of settling, where a lift-off that close would have solved', () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });

    // The cancel carries a position past the end of the track — the same input
    // a pointerup would settle on. A cancelled gesture is one the visitor did
    // not complete, so neither its position nor the snap may be consumed.
    widget.pointer('pointerdown', 0);
    widget.pointer('pointermove', MAX_OFFSET - 3);
    widget.pointer('pointercancel', MAX_OFFSET + 50);

    expect(widget.state()).toBe('idle');
    expect(widget.offset()).toBe(0);
    expect(logsMatching(/chain complete/)).toHaveLength(0);
  });

  test('a lift-off a pixel short of the end still settles, using the release position rather than the last move', () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });

    widget.pointer('pointerdown', 0);
    // Moves coalesce, so the last move can sit well behind where the finger
    // actually lifted; only the pointerup position gets close enough to snap.
    widget.pointer('pointermove', MAX_OFFSET - 60);
    expect(widget.state()).toBe('idle');
    widget.pointer('pointerup', MAX_OFFSET - 1);

    expect(widget.state()).toBe('verifying');
    expect(widget.offset()).toBe(MAX_OFFSET);
  });

  test('a stray second pointer mid-drag is ignored instead of reseating the handle', () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });

    widget.pointer('pointerdown', 0, 1);
    widget.pointer('pointerdown', 250, 2);
    widget.pointer('pointermove', 100, 1);

    expect(widget.offset()).toBe(100);
  });

  test('a completed drag runs the whole machine: chain → proof-of-work → fields the server accepts', async () => {
    installConfig({ bits: 8, minAgeMs: 0 });
    const minted = mintCaptcha();
    const widget = renderWidget(DevCaptcha, { token: minted.token, bits: minted.bits });

    widget.drag(MAX_OFFSET * 0.5, MAX_OFFSET + 50);

    // The whole chain is minted at once when the handle settles, and the widget
    // is committed but not yet verified: submitting here must carry nothing.
    expect(widget.state()).toBe('verifying');
    expect(widget.hint()).toBe('Verifying…');
    expect(logsMatching(/link \d+\/10 minted/)).toHaveLength(CAPTCHA_STEPS);
    expect(widget.fields()).toEqual({ captcha_token: '', captcha_pow: '' });

    await widget.waitForState('verified');

    expect(widget.hint()).toBe('Verified — thanks!');
    expect(widget.offset()).toBe(MAX_OFFSET);
    const fields = widget.fields();
    expect(fields.captcha_token).toBe(minted.token);
    expect(fields.captcha_pow).toMatch(/^\d+$/);

    // The real verifier, re-deriving the chain with node:crypto: the drag the
    // browser just performed is what makes this pass.
    const form = new FormData();
    form.set('captcha_token', fields.captcha_token);
    form.set('captcha_pow', fields.captcha_pow);
    expect(await verifyCaptcha(form)).toMatchObject({ ok: true });
  });

  test('the keyboard reaches the same verified state as a drag', async () => {
    installConfig({ bits: 8, minAgeMs: 0 });
    const minted = mintCaptcha();
    const widget = renderWidget(DevCaptcha, { token: minted.token, bits: minted.bits });

    widget.slideToEnd();
    expect(widget.state()).toBe('verifying');

    await widget.waitForState('verified');

    const form = new FormData();
    form.set('captcha_token', widget.fields().captcha_token);
    form.set('captcha_pow', widget.fields().captcha_pow);
    expect(await verifyCaptcha(form)).toMatchObject({ ok: true });
  });

  test('ArrowLeft walks the handle back without ever solving', () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });

    widget.key('ArrowRight', 9);
    expect(widget.state()).toBe('idle');
    widget.key('ArrowLeft', 9);

    expect(widget.offset()).toBe(0);
    expect(widget.state()).toBe('idle');
    expect(logsMatching(/chain complete/)).toHaveLength(0);
  });

  test('a solved widget ignores further input', async () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 4 });
    widget.slideToEnd();
    await widget.waitForState('verified');
    const fields = widget.fields();

    widget.pointer('pointerdown', 0);
    widget.pointer('pointermove', 0);
    widget.pointer('pointerup', 0);
    widget.key('ArrowLeft', 5);

    expect(widget.state()).toBe('verified');
    expect(widget.offset()).toBe(MAX_OFFSET);
    expect(widget.fields()).toEqual(fields);
  });
});

describe('MochiCaptcha — a solve that cannot finish', () => {
  // 32 bits is the configurable ceiling and needs ~4 billion hashes; paired with
  // a budget under one slice, the widget gives up on its first yield.
  const impossible = { token: 'token', bits: 32, solveBudgetMs: 1 };

  test('an exhausted budget lands in a retryable error instead of stranding on "Verifying…"', async () => {
    const widget = renderWidget(DevCaptcha, impossible);

    widget.slideToEnd();
    expect(widget.state()).toBe('verifying');

    await widget.waitForState('error');

    expect(widget.hint()).toContain('Verification failed — tap to try again');
    // The diagnostic is developer-facing and only shown in a dev build.
    expect(widget.hint()).toContain('Proof-of-work gave up');
    expect(widget.fields()).toEqual({ captcha_token: '', captcha_pow: '' });
    // Every failure has to leave a record at `error` level, which survives the
    // production log default.
    expect(logsMatching(/^error: captcha: Proof-of-work gave up/)).toHaveLength(1);
  });

  test('retrying resumes the nonce search rather than replaying the attempts that just failed', async () => {
    // The reported count is the absolute nonce reached, so two budget-equal
    // attempts land at ~1× the same number if the search restarts and ~2× it if
    // it resumes. A budget spanning many slices keeps the two comparable enough
    // for the 1.5× threshold below to separate the two behaviours cleanly.
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 32, solveBudgetMs: 100 });
    const attemptsFrom = (line: string) => Number(/and (\d+) attempts/.exec(line)![1]);

    widget.slideToEnd();
    await widget.waitForState('error');
    const first = attemptsFrom(logsMatching(/gave up/)[0]!);

    widget.clickRetry();
    expect(widget.state()).toBe('idle');
    expect(widget.offset()).toBe(0);
    expect(widget.hint()).toBe('Slide to verify');

    widget.slideToEnd();
    await widget.waitForState('error');
    const second = attemptsFrom(logsMatching(/gave up/)[1]!);

    expect(first).toBeGreaterThan(0);
    // The token never changes, so restarting at zero would re-run exactly the
    // nonces that already failed and the budget could never resolve itself.
    expect(second).toBeGreaterThan(first * 1.5);
  });

  test('a widget that failed with the pointer still down accepts a fresh drag after retrying', async () => {
    const widget = renderWidget(DevCaptcha, impossible);

    // The error UI swaps the handle out, so the pointerup that would have
    // released this drag is never delivered.
    widget.dragHolding(MAX_OFFSET + 50);
    await widget.waitForState('error');

    widget.clickRetry();
    widget.pointer('pointerdown', 0);
    widget.pointer('pointermove', MAX_OFFSET * 0.35);

    expect(widget.offset()).toBeCloseTo(MAX_OFFSET * 0.35, 5);
  });

  test('a long solve starts announcing its attempt count, out of the live region', async () => {
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 32, solveBudgetMs: 60_000 });

    widget.slideToEnd();
    expect(widget.progress()).toBeNull();

    const progress = await widget.waitForProgress();

    expect(progress).toMatch(/^\([\d,\s]+ attempts\)$/);
    expect(widget.state()).toBe('verifying');
  });

  test('unmounting mid-solve abandons the work instead of burning the main thread on a dead widget', async () => {
    // Solvable, and quickly: 16 bits is ~65k hashes, so the wait below is many
    // times over what an unabandoned solve needs to announce a nonce.
    const widget = renderWidget(DevCaptcha, { token: 'token', bits: 16, solveBudgetMs: 60_000 });

    widget.slideToEnd();
    expect(widget.state()).toBe('verifying');

    // The first slice is scheduled but has not run yet, so nothing races here.
    unmountWidget();
    const afterUnmount = captured.length;
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(captured.slice(afterUnmount)).toEqual([]);
    expect(logsMatching(/solved in/)).toHaveLength(0);
  });
});

describe('MochiCaptcha — misconfiguration', () => {
  const cases: Array<[name: string, props: CaptchaProps, expected: RegExp]> = [
    ['a missing token', { token: '', bits: 4 }, /No token — spread the result of mintCaptcha\(\)/],
    ['a non-integer bits', { token: 'token', bits: 8.5 }, /Bits must be an integer between 1 and 32, got 8\.5/],
    ['bits above the ceiling', { token: 'token', bits: 64 }, /Bits must be an integer between 1 and 32, got 64/],
    ['a zero solve budget', { token: 'token', bits: 4, solveBudgetMs: 0 }, /Solve budget must be a positive finite number/],
  ];

  for (const [name, props, expected] of cases) {
    test(`${name} fails at mount, before the visitor drags anything`, () => {
      const widget = renderWidget(DevCaptcha, props);

      // No retry affordance: re-running reproduces the mistake exactly.
      expect(widget.state()).toBe('error-fatal');
      expect(widget.hint()).toMatch(expected);
      expect(logsMatching(/^error: captcha:/)).toHaveLength(1);
    });
  }

  test('a production build hides the diagnostic and degrades to an empty slot, leaving the cause in the console', () => {
    const widget = renderWidget(ProdCaptcha, { token: '', bits: 4 });

    expect(widget.state()).toBe('hidden');
    expect(widget.fields()).toEqual({ captcha_token: '', captcha_pow: '' });
    expect(logsMatching(/^error: captcha: No token/)).toHaveLength(1);
  });

  test('a production build still shows the retryable error, since a visitor can act on it', async () => {
    const widget = renderWidget(ProdCaptcha, { token: 'token', bits: 32, solveBudgetMs: 1 });

    widget.slideToEnd();
    await widget.waitForState('error');

    expect(widget.hint()).toBe('Verification failed — tap to try again');
    // The developer-facing cause is dev-only, unlike in the DevCaptcha case above.
    expect(widget.hint()).not.toContain('Proof-of-work gave up');
  });
});
