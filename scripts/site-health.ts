import { styleText } from 'node:util';

// Hand-written types for the CDP slice this script reads — Bun.WebView's `cdp()`/`addEventListener()` are untyped, so
// this is cheaper than a dependency on the full protocol types.
type RemoteObject = { value?: unknown; description?: string; unserializableValue?: string; preview?: { description?: string } };
type RequestWillBeSent = { requestId: string; loaderId: string; type?: string; request: { url: string }; redirectResponse?: { status: number; url: string } };
type ResponseReceived = { requestId: string; loaderId: string; type?: string; response: { status: number } };
type LoadingDone = { requestId: string };
type ExceptionThrown = { exceptionDetails: { text?: string; exception?: { description?: string } } };
type LogEntryAdded = { entry: { level: string; text: string; url?: string } };
type NavigateResult = { errorText?: string };
type LifecycleEvent = { name: string; frameId: string };
type FrameTree = { frameTree: { frame: { id: string } } };

type Args = {
  base: string;
  concurrency: number;
  report: string;
  timeout: number;
};

const usage = `Usage: bun run check-site [base] [--concurrency N] [--report PATH] [--timeout MS]

Reads <base>/sitemap.xml and loads every listed URL in a real headless Chrome.
A page fails when its main document isn't 2xx (unless the path is allow-listed
for an expected non-2xx status), or when it produces any console error/warning,
uncaught exception, or browser-logged subresource failure. A page whose load
event doesn't fire within the budget is retried once; only a second timeout
fails it, and the report then names every request still in flight. Redirect hops
are reported but never fail a page. Catches the client-side regressions a plain
fetch crawl (scripts/check-links.ts) cannot see: hydration errors, island fetch
failures, uncaught exceptions.

The sitemap hardcodes the production origin, so each <loc> is re-pointed at
<base> — pass a local origin to check a dev server.

Writes a human-readable REPORT.md and exits 1 if any page failed.

Chrome is discovered automatically; set BUN_CHROME_PATH to pick a specific binary.

Arguments:
  base             Origin to check (default: https://mochi.fast)
  --concurrency N  Max tabs open at once (default: 4)
  --report PATH    Report output path (default: ./REPORT.md)
  --timeout MS     Per-page budget for the load event (default: 60000)

Exits 1 if any page failed, 2 on a setup problem (no sitemap, no Chrome).`;

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = [];
  let concurrency = 4;
  let report = 'REPORT.md';
  let timeout = 60_000;
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

/**
 * Paths whose main document is expected to answer with a specific non-2xx status.
 * A match makes that status a pass (and mutes the matching subresource-load error
 * Chrome logs for it). `reason` documents why the non-2xx is correct at the source.
 */
const EXPECTED_STATUS: { path: string; status: number; reason: string }[] = [
  {
    path: '/demos/protection/',
    status: 403,
    reason: 'The protection demo gates access behind a proof-of-work clearance cookie; an un-cleared probe correctly receives 403.',
  },
];

const expectedStatusFor = (url: string) => EXPECTED_STATUS.find((e) => e.path === new URL(url).pathname)?.status;

/** Milliseconds to keep collecting after `load` — deferred/`:visible` islands hydrate late. */
const SETTLE_MS = 1500;

/** Load attempts per page: a flaky first timeout is retried once before the page fails. */
const LOAD_ATTEMPTS = 2;

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
type PageResult = { url: string; status?: number; redirects: string[]; issues: Issue[]; ok: boolean; retried: boolean };

/**
 * Flatten one console call into a readable line; Bun unwraps primitives to raw values but hands objects over as the
 * CDP `RemoteObject` descriptor, so both shapes arrive in the same array.
 */
function renderArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg !== 'object' || arg === null) {
        return String(arg);
      }
      const remote = arg as RemoteObject;
      if (remote.value !== undefined) {
        return typeof remote.value === 'string' ? remote.value : JSON.stringify(remote.value);
      }
      return remote.description ?? remote.preview?.description ?? remote.unserializableValue ?? JSON.stringify(arg);
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

async function checkPage(url: string, timeout: number): Promise<PageResult> {
  const issues: Issue[] = [];
  const redirects: string[] = [];
  const seen = new Set<string>();
  // In-flight requests by id, so a load timeout can name what's still pending.
  const inflight = new Map<string, string>();
  let status: number | undefined;
  // Some demos navigate themselves after load; only the first main-frame load is
  // the page we were asked to check.
  let mainLoaderId: string | undefined;
  let retried = false;
  // Re-pointed at each attempt's resolver, so a late load event from a previous
  // attempt cannot settle the current one.
  let onLoad: (() => void) | undefined;
  // Declared before the listeners rather than at its assignment, so an event arriving mid-setup reads an
  // empty string (and is ignored) instead of hitting the temporal dead zone.
  let mainFrameId = '';

  const expected = expectedStatusFor(url);

  const add = (kind: Issue['kind'], text: string) => {
    const clean = stripAnsi(text).trim();
    // Chrome reports some failures through both Runtime and Log — dedupe by text.
    if (!clean || seen.has(`${kind}:${clean}`) || isIgnored(url, clean)) {
      return;
    }
    seen.add(`${kind}:${clean}`);
    issues.push({ kind, text: clean });
  };

  // Console output must come through this option, not a `Runtime.consoleAPICalled` listener: Bun consumes that CDP
  // event internally to implement the option and never re-dispatches it, so a listener silently sees nothing.
  const view = new Bun.WebView({
    backend: 'chrome',
    console: (type: string, ...args: unknown[]) => {
      if (type === 'error' || type === 'assert') {
        add('error', renderArgs(args));
      } else if (type === 'warn' || type === 'warning') {
        add('warning', renderArgs(args));
      }
    },
  });
  try {
    // cdp() needs a session, and the first navigate is what establishes one.
    await view.navigate('about:blank');

    view.addEventListener<RequestWillBeSent>('Network.requestWillBeSent', ({ data }) => {
      inflight.set(data.requestId, data.request.url);
      if (!isMainDocument(data)) {
        return;
      }
      mainLoaderId ??= data.loaderId;
      // A later self-navigation carries its own loader id; ignore its hops.
      if (data.loaderId !== mainLoaderId) {
        return;
      }
      if (data.redirectResponse) {
        redirects.push(`${data.redirectResponse.status} ${data.redirectResponse.url}`);
      }
    });
    view.addEventListener<LoadingDone>('Network.loadingFinished', ({ data }) => void inflight.delete(data.requestId));
    view.addEventListener<LoadingDone>('Network.loadingFailed', ({ data }) => void inflight.delete(data.requestId));
    view.addEventListener<ResponseReceived>('Network.responseReceived', ({ data }) => {
      if (isMainDocument(data) && data.loaderId === mainLoaderId && status === undefined) {
        status = data.response.status;
      }
    });
    view.addEventListener<ExceptionThrown>('Runtime.exceptionThrown', ({ data }) => {
      add('error', data.exceptionDetails.exception?.description ?? data.exceptionDetails.text ?? 'Uncaught exception');
    });
    view.addEventListener<LogEntryAdded>('Log.entryAdded', ({ data: { entry } }) => {
      if (entry.level !== 'error' && entry.level !== 'warning') {
        return;
      }
      // The main document at its expected non-2xx status also surfaces here as a
      // subresource-load failure — don't double-report what the status check owns.
      if (entry.url === url && expected !== undefined && /Failed to load resource/.test(entry.text)) {
        return;
      }
      add(entry.level as Issue['kind'], entry.url ? `${entry.text} (${entry.url})` : entry.text);
    });
    // Not `Page.loadEventFired`: Bun.WebView consumes that internally to resolve its own navigate() and never
    // re-dispatches it, so use the frame-scoped main-frame `load` event, which also ignores cross-origin iframe loads
    // like the blog's newsletter embed.
    view.addEventListener<LifecycleEvent>('Page.lifecycleEvent', ({ data }) => {
      if (data.name === 'load' && data.frameId === mainFrameId) {
        onLoad?.();
      }
    });

    // Sequential, not Promise.all: a view allows one cdp() call in flight at a time.
    for (const domain of ['Page', 'Network', 'Runtime', 'Log']) {
      await view.cdp(`${domain}.enable`);
    }
    await view.cdp('Page.setLifecycleEventsEnabled', { enabled: true });
    // Read once, before any attempt: the tab's main frame id is stable across navigations, so resolving it up front
    // removes the race where a lifecycle event lands before Page.navigate has returned the id.
    mainFrameId = (await view.cdp<FrameTree>('Page.getFrameTree')).frameTree.frame.id;

    const timedOut = Symbol('timeout');
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      // Only the winning attempt's observations should count; a flaky first
      // attempt must leave no stale issues, redirects, or in-flight entries.
      issues.length = 0;
      seen.clear();
      redirects.length = 0;
      inflight.clear();
      status = undefined;
      mainLoaderId = undefined;

      const loaded = new Promise<void>((resolve) => (onLoad = resolve));
      // Driven through cdp() rather than view.navigate(): navigate() has no timeout and
      // permits only one in flight, so a timed-out attempt would make the retry throw.
      const navigation = await view.cdp<NavigateResult>('Page.navigate', { url });
      if (navigation.errorText) {
        add('error', `Navigation failed: ${navigation.errorText}`);
      }
      if ((await Promise.race([loaded, sleep(timeout).then(() => timedOut)])) !== timedOut) {
        break;
      }
      if (attempt < LOAD_ATTEMPTS) {
        retried = true;
        continue;
      }
      const pending = [...inflight.values()];
      add(
        'error',
        pending.length
          ? `Page did not finish loading within ${timeout}ms after ${LOAD_ATTEMPTS} attempts; ${pending.length} request(s) still pending: ${pending.join(', ')}`
          : `Page did not finish loading within ${timeout}ms after ${LOAD_ATTEMPTS} attempts (no requests pending — a script or event handler is blocking load)`,
      );
    }
    await sleep(SETTLE_MS);
  } catch (err) {
    add('error', `Navigation failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // A leaked tab starves the pool and keeps burning CPU in the background.
    view.close();
  }

  if (status === undefined) {
    add('error', 'No response received for the main document');
  } else if (expected !== undefined ? status !== expected : status < 200 || status >= 300) {
    add('error', `Main document responded ${status}`);
  }

  return { url, status, redirects, issues, ok: issues.length === 0, retried };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ↵ ');

const redirectNote = (result: PageResult) => (result.redirects.length === 0 ? '' : ` (via ${result.redirects.join(' → ')})`);

const retriedNote = (result: PageResult) => (result.retried && result.ok ? ' _(passed on retry)_' : '');

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
    lines.push(`- \`${result.status}\` ${result.url}${redirectNote(result)}${retriedNote(result)}`);
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

  // Preflight so a missing browser exits 2 (a setup problem) instead of reporting every page as a failure.
  try {
    const probe = new Bun.WebView({ backend: 'chrome' });
    try {
      await probe.navigate('about:blank');
    } finally {
      probe.close();
    }
  } catch (err) {
    console.error(styleText('red', `Could not launch Chrome: ${err instanceof Error ? err.message : String(err)}`));
    console.error(styleText('dim', 'Set BUN_CHROME_PATH to a Chrome/Chromium executable.'));
    process.exit(2);
  }

  const results: PageResult[] = [];
  try {
    await pool(urls, concurrency, async (url) => {
      const result = await checkPage(url, timeout);
      results.push(result);
      const errors = result.issues.filter((i) => i.kind === 'error').length;
      const warnings = result.issues.length - errors;
      const label = result.ok ? styleText('green', '✓') : styleText('red', `✗ ${errors} error(s), ${warnings} warning(s)`);
      console.log(`${label}  ${styleText('dim', `[${results.length}/${urls.length}]`)} ${url}`);
    });
  } finally {
    Bun.WebView.closeAll();
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
