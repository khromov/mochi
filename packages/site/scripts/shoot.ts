/**
 * Capture a component shot from `/shot/:name` without a browser MCP session.
 *
 *   bun --cwd=packages/site scripts/shoot.ts captcha --out shot.png
 *   bun --cwd=packages/site scripts/shoot.ts like --w 1280 --h 360 --theme minimal
 *
 * Boots its own dev server on a free port unless `--base` names a running one, measures the render before capturing
 * (a mis-scaled subject or a failed hydration is invisible in the image itself), and fails loudly on a console error.
 */
import { parseArgs, styleText } from 'node:util';
import path from 'node:path';
import type { Subprocess } from 'bun';
import { DEFAULT_WIDTH, subjects } from '../src/shot/registry.ts';

const SUBJECT_NAMES = Object.keys(subjects);

// macOS keeps the zero-install WebKit default; elsewhere Chrome is the default anyway, and a CI/Docker runner can't
// initialize its sandbox without these flags.
const CHROME_BACKEND = process.platform === 'darwin' ? undefined : ({ type: 'chrome', argv: ['--no-sandbox', '--disable-dev-shm-usage'] } as const);

const usage = `Usage: bun --cwd=packages/site scripts/shoot.ts <subject> [options]

Subjects: ${SUBJECT_NAMES.join(', ')}

Options:
  --out PATH     Output file (default: <subject>.png)
  --w N          Frame width (default: ${DEFAULT_WIDTH}); height follows 16:9
  --h N          Frame height (default: 16:9 off the width)
  --scheme S     'light' (default) or 'dark' — pinned so a URL yields the same image anywhere
  --theme T      Passed through to the subject (the captcha reads it)
  --base URL     Shoot against an already-running server instead of booting one
  --keep-open    Leave the dev server running (only meaningful without --base)`;

type Args = { subject: string; out: string; w?: number; h?: number; scheme: string; theme?: string; base?: string; keepOpen: boolean };

function parseCliArgs(): Args {
  // `-h` is help, `--h` is height — parseArgs keeps the short and long namespaces separate, so they don't clash.
  const { values, positionals } = (() => {
    try {
      return parseArgs({
        args: process.argv.slice(2),
        allowPositionals: true,
        options: {
          help: { type: 'boolean', short: 'h', default: false },
          out: { type: 'string' },
          w: { type: 'string' },
          h: { type: 'string' },
          scheme: { type: 'string', default: 'light' },
          theme: { type: 'string' },
          base: { type: 'string' },
          'keep-open': { type: 'boolean', default: false },
        },
        strict: true,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      console.log(usage);
      process.exit(2);
    }
  })();

  if (values.help) {
    console.log(usage);
    process.exit(0);
  }

  const subject = positionals[0];
  if (!subject) {
    console.log(usage);
    process.exit(2);
  }
  if (!(subject in subjects)) {
    console.error(`No subject '${subject}'. Known: ${SUBJECT_NAMES.join(', ')}`);
    process.exit(2);
  }

  const toNumber = (raw: string | undefined, flag: string): number | undefined => {
    if (raw === undefined) {
      return undefined;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      console.error(`${flag} must be a number`);
      process.exit(2);
    }
    return n;
  };

  return {
    subject,
    out: values.out ?? `${subject}.png`,
    w: toNumber(values.w, '--w'),
    h: toNumber(values.h, '--h'),
    scheme: values.scheme ?? 'light',
    theme: values.theme,
    base: values.base?.replace(/\/+$/, ''),
    keepOpen: values['keep-open'] ?? false,
  };
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = probe.port;
  probe.stop(true);
  return port;
}

/** Boot `bun run dev` for this package and resolve once it is answering. */
async function startDevServer(): Promise<{ base: string; stop: () => void }> {
  const port = await freePort();
  const proc: Subprocess = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: path.join(import.meta.dir, '..'),
    env: { ...process.env, PORT: String(port), MOCHI_PORT: String(port), NODE_ENV: 'development' },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Dev server exited with code ${proc.exitCode} before it started answering.`);
    }
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) {
        return { base, stop: () => proc.kill() };
      }
    } catch {
      // Not up yet.
    }
    await Bun.sleep(500);
  }
  proc.kill();
  throw new Error(`Dev server did not start answering on ${base} within 120s.`);
}

/**
 * The union of every rendered descendant of `.fit` — `.fit`'s own box is the *unscaled* natural box, and its first
 * child is a 0x0 Svelte-injected script, so neither measures what the image will actually show.
 */
const MEASURE = `(() => {
  const subjectBox = (fit) => {
    const rects = [...fit.querySelectorAll('*')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  };
  const shotEl = document.querySelector('.shot');
  const fitEl = document.querySelector('.fit');
  if (!shotEl || !fitEl) return { error: 'no .shot/.fit in the page — is this the shot route?' };
  const shot = shotEl.getBoundingClientRect();
  const b = subjectBox(fitEl);
  if (!b) return { error: 'the subject rendered nothing' };
  return {
    frame: { w: shot.width, h: shot.height },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    gapLeft: +(b.left - shot.left).toFixed(1),
    gapRight: +(shot.right - b.right).toFixed(1),
    gapTop: +(b.top - shot.top).toFixed(1),
    gapBottom: +(shot.bottom - b.bottom).toFixed(1),
    pctW: +((b.width / shot.width) * 100).toFixed(1),
    pctH: +((b.height / shot.height) * 100).toFixed(1),
    hydrated: !!document.querySelector('mochi-hydratable-island'),
  };
})()`;

type Measurement = {
  error?: string;
  frame: { w: number; h: number };
  viewport: { w: number; h: number };
  gapLeft: number;
  gapRight: number;
  gapTop: number;
  gapBottom: number;
  pctW: number;
  pctH: number;
  hydrated: boolean;
};

const ASPECT = 9 / 16;

/** Mirrors FILL in src/shot/registry.ts — the fraction of the limiting axis fitScale() aims to fill. */
const EXPECTED_FILL_PCT = 90;

async function main(): Promise<void> {
  const args = parseCliArgs();
  const width = args.w ?? DEFAULT_WIDTH;
  const height = args.h ?? Math.round(width * ASPECT);

  let stopServer: (() => void) | undefined;
  let base = args.base;
  if (!base) {
    console.log(styleText('dim', 'Starting a dev server…'));
    const started = await startDevServer();
    base = started.base;
    if (!args.keepOpen) {
      stopServer = started.stop;
    }
  }

  const query = new URLSearchParams({ scheme: args.scheme, w: String(width), h: String(height) });
  if (args.theme) {
    query.set('theme', args.theme);
  }
  const url = `${base}/shot/${args.subject}/?${query}`;

  const consoleErrors: string[] = [];
  const view = new Bun.WebView({
    backend: CHROME_BACKEND,
    width,
    height,
    console: (type: string, ...rest: unknown[]) => {
      if (type === 'error' || type === 'assert') {
        consoleErrors.push(rest.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
      }
    },
  });

  try {
    // The constructor sizes the *window*, leaving the viewport short by the browser chrome; resize() sets the
    // viewport, which is what the screenshot captures. It needs a CDP session, so a navigation has to come first.
    await view.navigate('about:blank');
    await view.resize(width, height);
    console.log(styleText('dim', `Loading ${url}`));
    await view.navigate(url);
    // Deferred and :visible islands hydrate after load.
    await Bun.sleep(750);

    const measured = (await view.evaluate(MEASURE)) as Measurement;
    if (measured.error) {
      throw new Error(measured.error);
    }
    // A mis-scaled or off-centre subject is invisible in the PNG, so it is checked here rather than by eye.
    const problems: string[] = [];
    if (measured.frame.w !== width || measured.frame.h !== height) {
      problems.push(`frame is ${measured.frame.w}x${measured.frame.h}, expected ${width}x${height}`);
    }
    if (measured.viewport.w !== width || measured.viewport.h !== height) {
      problems.push(`viewport is ${measured.viewport.w}x${measured.viewport.h}, expected ${width}x${height} — the shot would be cropped or letterboxed`);
    }
    if (Math.abs(measured.gapLeft - measured.gapRight) > 1 || Math.abs(measured.gapTop - measured.gapBottom) > 1) {
      problems.push(`subject is off-centre (gaps L${measured.gapLeft} R${measured.gapRight} T${measured.gapTop} B${measured.gapBottom})`);
    }
    const fill = Math.max(measured.pctW, measured.pctH);
    // fitScale() targets FILL (90%) of the limiting axis; a large miss means `natural` in the registry is wrong.
    if (Math.abs(fill - EXPECTED_FILL_PCT) > 5) {
      problems.push(`subject fills ${fill}% of the limiting axis, expected ~90% — check \`natural\` for '${args.subject}' in src/shot/registry.ts`);
    }
    if (consoleErrors.length > 0) {
      problems.push(`console errors: ${consoleErrors.join(' | ')}`);
    }
    if (problems.length > 0) {
      console.error(styleText('red', 'Refusing to save a bad shot:'));
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exitCode = 1;
      return;
    }

    await Bun.write(args.out, await view.screenshot({ format: 'png' }));
    const bytes = await Bun.file(args.out).size;
    console.log(styleText('green', `✓ ${args.out}  ${width}x${height}  ${bytes} B`));
    console.log(styleText('dim', `  fill ${fill}% · hydrated ${measured.hydrated}`));
  } finally {
    view.close();
    stopServer?.();
  }
}

await main();
