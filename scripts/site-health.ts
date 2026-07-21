import { styleText } from 'node:util';
import { launch, type LaunchedChrome } from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import type { Protocol } from 'devtools-protocol';

type Args = {
  base: string;
  concurrency: number;
  report: string;
  timeout: number;
};

const usage = `Usage: bun run check-site [base] [--concurrency N] [--report PATH] [--timeout MS]

Reads <base>/sitemap.xml and loads every listed URL in a real headless Chrome.
A page fails when its main document isn't 2xx, or when it produces any console
error/warning, uncaught exception, or browser-logged subresource failure.
Redirect hops are reported but never fail a page. Catches the client-side
regressions a plain fetch crawl (scripts/check-links.ts) cannot see: hydration
errors, island fetch failures, uncaught exceptions.

The sitemap hardcodes the production origin, so each <loc> is re-pointed at
<base> — pass a local origin to check a dev server.

Writes a human-readable REPORT.md and exits 1 if any page failed.

Chrome is discovered automatically; set CHROME_PATH to pick a specific binary.

Arguments:
  base             Origin to check (default: https://mochi.fast)
  --concurrency N  Max tabs open at once (default: 4)
  --report PATH    Report output path (default: ./REPORT.md)
  --timeout MS     Per-page budget for the load event (default: 30000)

Exits 1 if any page failed, 2 on a setup problem (no sitemap, no Chrome).`;

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = [];
  let concurrency = 4;
  let report = 'REPORT.md';
  let timeout = 30_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(usage);
      process.exit(0);
    } else if (a === '--concurrency' || a === '--report' || a === '--timeout') {
      const next = argv[++i];
      if (!next) {
        console.error(`Missing value for ${a}`);
        process.exit(2);
      }
      if (a === '--report') {
        report = next;
      } else if (a === '--concurrency') {
        concurrency = Number(next);
      } else {
        timeout = Number(next);
      }
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else {
      positional.push(a);
    }
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    console.error('--concurrency must be a positive number');
    process.exit(2);
  }
  if (!Number.isFinite(timeout) || timeout < 1000) {
    console.error('--timeout must be at least 1000 (ms)');
    process.exit(2);
  }
  const base = (positional[0] ?? 'https://mochi.fast').replace(/\/+$/, '');
  if (!URL.canParse(base) || !['http:', 'https:'].includes(new URL(base).protocol)) {
    console.error(`base must be an http(s) origin, got: ${base}`);
    process.exit(2);
  }
  return { base, concurrency, report, timeout };
};

/**
 * Console output that must not fail the run: third-party noise we don't control,
 * and demos whose whole point is to produce an error. Every entry is a check we
 * have stopped performing, so each needs a `reason` saying why the message can't
 * be fixed at the source. `path` scopes an entry to one page — prefer it over a
 * site-wide mute.
 */
const IGNORE_PATTERNS: { message: RegExp; path?: string; reason: string }[] = [
  {
    message: /Deprecated API for given entry type/,
    reason: 'Emitted by the third-party Umami analytics script (u.khromov.se/u.js), not by our code.',
  },
  {
    message: /ThrowOnClient|Client throw from/,
    path: '/demos/error-boundaries/',
    reason: 'The error-boundaries demo throws on the client on purpose to show the boundary catching it.',
  },
];

/** Milliseconds to keep collecting after `load` — deferred/`:visible` islands hydrate late. */
const SETTLE_MS = 1500;

/** Run thunks with a bounded number in flight at once. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const decodeXmlEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

async function fetchSitemap(base: string): Promise<string[]> {
  const url = `${base}/sitemap.xml`;
  let xml: string;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(styleText('red', `GET ${url} → ${res.status}. Is the site up?`));
      process.exit(2);
    }
    xml = await res.text();
  } catch (err) {
    console.error(styleText('red', `Could not reach ${url}`));
    console.error(String(err));
    process.exit(2);
  }
  const origin = new URL(base);
  const urls = new Set<string>();
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const loc = decodeXmlEntities(m[1]);
    // The site bakes its production origin into every <loc>, so a run against a
    // local base would otherwise silently check production instead.
    let rebased: URL;
    try {
      rebased = new URL(loc, `${base}/`);
    } catch {
      console.error(styleText('yellow', `Skipping unparseable <loc>: ${loc}`));
      continue;
    }
    rebased.protocol = origin.protocol;
    rebased.host = origin.host;
    urls.add(rebased.toString());
  }
  if (urls.size === 0) {
    console.error(styleText('red', `${url} listed no <loc> entries.`));
    process.exit(2);
  }
  return [...urls].sort();
}

// ---------------------------------------------------------------------------
// Per-page check
// ---------------------------------------------------------------------------

type Issue = { kind: 'error' | 'warning'; text: string };
/**
 * `status` is the final main-document status; `redirects` are the hops taken to
 * reach it. Hops are informational — some demos land on a redirect on purpose —
 * so only the final status decides pass/fail.
 */
type PageResult = { url: string; status?: number; redirects: string[]; issues: Issue[]; ok: boolean };

/** Flatten a `Runtime.consoleAPICalled` argument list into one readable line. */
function renderArgs(args: Protocol.Runtime.RemoteObject[]): string {
  return args
    .map((arg) => {
      if (arg.value !== undefined) {
        return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
      }
      return arg.description ?? arg.preview?.description ?? arg.unserializableValue ?? '';
    })
    .join(' ')
    .trim();
}

/** The framework's browser logger emits colour codes that render as noise in markdown. */
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

const isIgnored = (url: string, text: string) => IGNORE_PATTERNS.some(({ message, path }) => (!path || new URL(url).pathname === path) && message.test(text));

/**
 * True for the request that fetched the page itself. Chrome reuses the loader id
 * as the request id for a main-frame navigation, so this identifies the main
 * document without having to race `Page.navigate`'s return value against the
 * `Network` events it triggers.
 */
const isMainDocument = (params: { type?: string; requestId: string; loaderId: string }) => params.type === 'Document' && params.requestId === params.loaderId;

async function checkPage(port: number, url: string, timeout: number): Promise<PageResult> {
  const issues: Issue[] = [];
  const redirects: string[] = [];
  const seen = new Set<string>();
  let status: number | undefined;
  // Some demos navigate themselves after load; only the first main-frame load is
  // the page we were asked to check.
  let mainLoaderId: string | undefined;

  const add = (kind: Issue['kind'], text: string) => {
    const clean = stripAnsi(text).trim();
    // Chrome reports some failures through both Runtime and Log — dedupe by text.
    if (!clean || seen.has(`${kind}:${clean}`) || isIgnored(url, clean)) {
      return;
    }
    seen.add(`${kind}:${clean}`);
    issues.push({ kind, text: clean });
  };

  const target = await CDP.New({ port, url: 'about:blank' });
  const client = await CDP({ port, target });
  try {
    const { Page, Network, Runtime, Log } = client;

    Network.requestWillBeSent((params) => {
      if (!isMainDocument(params)) {
        return;
      }
      mainLoaderId ??= params.loaderId;
      // A later self-navigation carries its own loader id; ignore its hops.
      if (params.loaderId !== mainLoaderId) {
        return;
      }
      if (params.redirectResponse) {
        redirects.push(`${params.redirectResponse.status} ${params.redirectResponse.url}`);
      }
    });
    Network.responseReceived((params) => {
      if (isMainDocument(params) && params.loaderId === mainLoaderId && status === undefined) {
        status = params.response.status;
      }
    });
    Runtime.consoleAPICalled((params) => {
      if (params.type === 'error' || params.type === 'assert') {
        add('error', renderArgs(params.args));
      } else if (params.type === 'warning') {
        add('warning', renderArgs(params.args));
      }
    });
    Runtime.exceptionThrown(({ exceptionDetails }) => {
      add('error', exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'Uncaught exception');
    });
    Log.entryAdded(({ entry }) => {
      if (entry.level === 'error' || entry.level === 'warning') {
        add(entry.level, entry.url ? `${entry.text} (${entry.url})` : entry.text);
      }
    });

    await Promise.all([Page.enable(), Network.enable(), Runtime.enable(), Log.enable()]);

    const timedOut = Symbol('timeout');
    const loaded = Page.loadEventFired();
    const navigation = await Page.navigate({ url });
    if (navigation.errorText) {
      add('error', `Navigation failed: ${navigation.errorText}`);
    }
    if ((await Promise.race([loaded, sleep(timeout).then(() => timedOut)])) === timedOut) {
      add('error', `Page did not finish loading within ${timeout}ms`);
    }
    await sleep(SETTLE_MS);
  } catch (err) {
    add('error', `Navigation failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.close().catch(() => {});
    // A leaked tab starves the pool and keeps burning CPU in the background.
    await CDP.Close({ port, id: target.id }).catch(() => {});
  }

  if (status === undefined) {
    add('error', 'No response received for the main document');
  } else if (status < 200 || status >= 300) {
    add('error', `Main document responded ${status}`);
  }

  return { url, status, redirects, issues, ok: issues.length === 0 };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ↵ ');

const redirectNote = (result: PageResult) => (result.redirects.length === 0 ? '' : ` (via ${result.redirects.join(' → ')})`);

function buildReport(base: string, results: PageResult[], startedAt: Date, durationMs: number): string {
  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const lines: string[] = [
    '# Site health report',
    '',
    `- **Base:** ${base}`,
    `- **Checked:** ${startedAt.toISOString()}`,
    `- **Pages:** ${results.length} — ✅ ${passed.length} passed, ❌ ${failed.length} failed`,
    `- **Duration:** ${(durationMs / 1000).toFixed(1)}s`,
    '',
  ];

  if (failed.length > 0) {
    lines.push(`## ❌ Failures (${failed.length})`, '');
    for (const result of failed) {
      lines.push(`### ${result.url}`, '', `Status: \`${result.status ?? 'no response'}\`${redirectNote(result)}`, '', '| Kind | Detail |', '| --- | --- |');
      for (const issue of result.issues) {
        lines.push(`| ${issue.kind} | ${escapeCell(issue.text)} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('## ✅ No errors or warnings detected', '');
  }

  lines.push(`## ✅ Passed (${passed.length})`, '', '<details><summary>Show all</summary>', '');
  for (const result of passed) {
    lines.push(`- \`${result.status}\` ${result.url}${redirectNote(result)}`);
  }
  lines.push('', '</details>', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

async function main() {
  const { base, concurrency, report, timeout } = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const started = performance.now();

  const urls = await fetchSitemap(base);
  console.log(styleText('dim', `Checking ${urls.length} pages from ${base}/sitemap.xml …\n`));

  let chrome: LaunchedChrome;
  try {
    chrome = await launch({
      chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    console.error(styleText('red', `Could not launch Chrome: ${err instanceof Error ? err.message : String(err)}`));
    console.error(styleText('dim', 'Set CHROME_PATH to a Chrome/Chromium executable.'));
    process.exit(2);
  }

  const results: PageResult[] = [];
  try {
    await pool(urls, concurrency, async (url) => {
      const result = await checkPage(chrome.port, url, timeout);
      results.push(result);
      const errors = result.issues.filter((i) => i.kind === 'error').length;
      const warnings = result.issues.length - errors;
      const label = result.ok ? styleText('green', '✓') : styleText('red', `✗ ${errors} error(s), ${warnings} warning(s)`);
      console.log(`${label}  ${styleText('dim', `[${results.length}/${urls.length}]`)} ${url}`);
    });
  } finally {
    await chrome.kill();
  }

  results.sort((a, z) => a.url.localeCompare(z.url));
  const durationMs = performance.now() - started;
  await Bun.write(report, buildReport(base, results, startedAt, durationMs));

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(styleText('dim', `Report written to ${report}`));
  if (failed.length === 0) {
    console.log(styleText('green', `✓ All ${results.length} pages returned 2xx with a clean console.`));
    process.exit(0);
  }
  console.log(styleText('red', `\n✗ ${failed.length} of ${results.length} page(s) failed:\n`));
  for (const result of failed) {
    console.log(styleText('red', result.url));
    for (const issue of result.issues) {
      console.log(`  ${styleText(issue.kind === 'error' ? 'red' : 'yellow', issue.kind)}  ${issue.text}`);
    }
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(styleText('red', `Site health check aborted: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
  process.exit(2);
});
