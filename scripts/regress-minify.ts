#!/usr/bin/env bun
/**
 * Browser regression check for `minifier: 'oxc'`.
 *
 * For every app, every static route, in both production and dev, under both minifiers: load the page in headless
 * Chromium, collect everything that can go wrong (console errors/warnings, `pageerror`, unhandled rejections, failed
 * requests, `window.__mochi_warnings`), look for hydration damage, exercise the page, and then diff the `bun` run
 * against the `oxc` run — normalized DOM and full-page screenshot.
 *
 * Dev mode matters as much as production: the oxc pass runs there too, and dev is the only mode where Svelte is
 * compiled with `dev: true`, so it is the only place hydration-mismatch warnings are reported at all.
 *
 * Usage:
 *   bun scripts/regress-minify.ts                              # everything
 *   bun scripts/regress-minify.ts --apps minimal --modes dev   # a slice
 *   bun scripts/regress-minify.ts --max-routes 10              # cap routes per app
 *   bun scripts/regress-minify.ts --out report.md
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dir, '..');
const APPS = ['site', 'demos', 'support', 'minimal'] as const;
const MINIFIERS = ['bun', 'oxc'] as const;
const MODES = ['prod', 'dev'] as const;

type Mode = (typeof MODES)[number];
type Minifier = (typeof MINIFIERS)[number];

// Three runs per cell: bun, bun again, then oxc. The repeat is the determinism baseline.
const RUNS = ['bun', 'bun-repeat', 'oxc'] as const;
type RunKey = (typeof RUNS)[number];
const runMinifier = (run: RunKey): Minifier => (run === 'oxc' ? 'oxc' : 'bun');

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    apps: { type: 'string' },
    modes: { type: 'string' },
    'max-routes': { type: 'string' },
    concurrency: { type: 'string' },
    out: { type: 'string' },
  },
});
const apps = values.apps ? values.apps.split(',').map((s) => s.trim()) : [...APPS];
const modes = (values.modes ? values.modes.split(',').map((s) => s.trim()) : [...MODES]) as Mode[];
const maxRoutes = Number(values['max-routes'] ?? 500);
// Routes per cell visited at once. Each gets its own isolated page, so this is wall-clock only.
const concurrency = Number(values.concurrency ?? 6);

// The apps that refuse to boot without them; harmless elsewhere.
const APP_ENV = { ADMIN_PASSWORD: 'regress', SMTP_HOST: 'localhost', MOCHI_KEY: 'ZGV2LW9ubHktcmVncmVzc2lvbi1rZXktMzJieXRlcw' };

/** Ask the app's own entry for its route table, so the harness can never drift from what the app actually serves. */
async function routesOf(appDir: string): Promise<string[]> {
  const probe = `
    import { extractServeOptions } from ${JSON.stringify(path.join(ROOT, 'packages/mochi/src/cli/extractServeOptions.ts'))};
    import { markBuilding } from ${JSON.stringify(path.join(ROOT, 'packages/mochi/src/utils/buildFlag.ts'))};
    markBuilding();
    const opts = await extractServeOptions(${JSON.stringify(path.join(appDir, 'src/index.ts'))});
    console.log(JSON.stringify(Object.keys(opts?.routes ?? {})));
    process.exit(0);
  `;
  const proc = Bun.spawn(['bun', '-e', probe], { cwd: appDir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...APP_ENV } });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(`route extraction failed for ${path.basename(appDir)}:\n${err}`);
  }
  const all = JSON.parse(out.trim().split('\n').at(-1)!) as string[];
  // Parameterised and wildcard routes have no canonical concrete URL to visit; `/_mochi/*` is framework-internal and
  // is exercised indirectly by every page that loads an asset or a server island.
  return all
    .filter((p) => !p.includes(':') && !p.includes('*') && !p.startsWith('/_mochi'))
    .sort()
    .slice(0, maxRoutes);
}

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...APP_ENV, ...env } });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(`${cmd.join(' ')} failed in ${cwd}:\n${out}\n${err}`);
  }
}

interface Server {
  origin: string;
  alive: () => Promise<boolean>;
  stop: () => Promise<void>;
}

async function startApp(appDir: string, mode: Mode, minifier: Minifier, port: number): Promise<Server> {
  const env: Record<string, string> = {
    PORT: String(port),
    MOCHI_ORIGIN: `http://localhost:${port}`,
    // The dev server has no build step to pass `--minifier` to, so it is selected the same way the Svelte backend is.
    MOCHI_MINIFIER: minifier,
    NODE_ENV: mode === 'prod' ? 'production' : 'development',
  };
  if (mode === 'prod') {
    rmSync(path.join(appDir, '.mochi'), { recursive: true, force: true });
    await run(['bun', 'run', 'build', '--', '--minifier', minifier], appDir, { NODE_ENV: 'production' });
  }
  const proc = Bun.spawn(['bun', 'src/index.ts'], { cwd: appDir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...APP_ENV, ...env } });
  const origin = `http://localhost:${port}`;
  for (let i = 0; i < 200; i++) {
    await Bun.sleep(150);
    if (proc.exitCode !== null) {
      throw new Error(`${path.basename(appDir)} (${mode}/${minifier}) exited during boot:\n${await new Response(proc.stderr).text()}`);
    }
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        // A dev server compiles the first page lazily; give the watcher a beat to finish its initial build.
        if (mode === 'dev') {
          await Bun.sleep(1500);
        }
        return {
          origin,
          alive: async () => {
            if (proc.exitCode !== null) {
              return false;
            }
            return fetch(`${origin}/health`).then(
              (r) => r.ok,
              () => false,
            );
          },
          stop: async () => {
            proc.kill();
            await proc.exited;
          },
        };
      }
    } catch {
      // not listening yet
    }
  }
  proc.kill();
  throw new Error(`${path.basename(appDir)} (${mode}/${minifier}) never became healthy`);
}

interface RouteObservation {
  route: string;
  status: number;
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  mochiWarnings: string[];
  /** Nodes hydration replaced or reordered relative to the server-rendered markup. */
  hydrationDamage: string[];
  domAfterHydration: string;
  domAfterInteraction: string;
  screenshot: Buffer;
  /** Second shot of the same page: the route's own frame-to-frame instability. */
  screenshotSelf: Buffer;
}

/** Strip everything that legitimately differs run to run, so a diff means a real structural change. */
function normalizeDom(html: string): string {
  return (
    html
      // The bar renders live request timings inside this div. Bounded at the next `<script>` (or `</body>`) so the rest
      // of the document — including every script tag — still takes part in the diff.
      .replace(/<div id="mochi-dev-toolbar"[\s\S]*?(?=<script|<\/body>|$)/, '<div id="mochi-dev-toolbar"><!--elided--></div>')
      // The debug bar's seed payload reports real chunk sizes and request timings, so it differs by design once oxc has
      // shrunk the bundle — that is the feature working, not a DOM regression.
      .replace(/window\.__mochi_debug=[\s\S]*?<\/script>/, 'window.__mochi_debug=<elided></script>')
      .replace(/"sizeBytes":\d+/g, '"sizeBytes":<n>')
      .replace(/https?:\/\/localhost:\d+/g, 'http://host')
      .replace(/localhost:\d+/g, 'localhost:<port>')
      .replace(/(_mochi\/client\/)[\w.-]+/g, '$1<hashed>')
      .replace(/\bprops=[A-Za-z0-9_-]+/g, 'props=<enc>')
      .replace(/\b(island-id|data-mochi-id|id)="[^"]*s\d+[^"]*"/g, '$1="<uid>"')
      // Inline script *bodies* are minified framework code, so they differ between the two modes by definition — that is
      // the feature. Their tags stay in the diff so a missing or extra script is still caught; their contents are
      // compared instead by `check-minify-structure.ts` and the classic-script tests.
      .replace(/(<script(?![^>]*\bsrc=)[^>]*>)[\s\S]*?(<\/script>)/g, '$1<!--code-->$2')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// Dev chrome that is appended to `<body>` by the client, so it is in the hydrated DOM but never in the server HTML.
// Comparing it would report a mismatch on every dev page; it is identical between the two builds either way.
const IGNORED_TAGS = "['SCRIPT','STYLE','LINK','MOCHI-LIVE-RELOAD']";

/** Tag/structure skeleton, for comparing server HTML against the hydrated DOM. */
const SKELETON = `() => {
  const ignored = new Set(${IGNORED_TAGS});
  const walk = (el, depth, out) => {
    if (depth > 12) return;
    for (const child of el.children) {
      if (ignored.has(child.tagName) || child.id === 'mochi-dev-toolbar') continue;
      out.push(' '.repeat(depth) + child.tagName.toLowerCase());
      walk(child, depth + 1, out);
    }
  };
  const out = [];
  walk(document.body, 0, out);
  return out;
}`;

// Routes where hydration never settled within the budget. Reported separately: it is a real symptom, but it is also
// what a page with no islands at all would look like if the marker ever changed, so it must not be silent.
const hydrationTimedOut: string[] = [];

async function observe(browser: Browser, origin: string, route: string): Promise<RouteObservation> {
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const clean = (s: string) => s.replace(/https?:\/\/localhost:\d+/g, 'http://host').replace(/[\u001b]\[\d+m/g, '');

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(clean(m.text()));
    if (m.type() === 'warning') consoleWarnings.push(clean(m.text()));
  });
  page.on('pageerror', (e) => pageErrors.push(clean(e.message)));
  page.on('requestfailed', (r) => failedRequests.push(clean(`${r.url()} ${r.failure()?.errorText ?? ''}`)));
  page.on('response', (r) => r.status() >= 400 && failedRequests.push(clean(`${r.url()} -> ${r.status()}`)));

  try {
    // The server-rendered markup, fetched without a browser so nothing has hydrated yet.
    const ssrResponse = await fetch(origin + route, { redirect: 'follow' });
    const ssrHtml = await ssrResponse.text();
    // A JSON/text route renders through the browser's built-in viewer, whose wrapper markup is not in the response;
    // comparing it against the raw body would report a mismatch that has nothing to do with hydration.
    const isHtml = (ssrResponse.headers.get('content-type') ?? '').includes('text/html');

    const response = await page.goto(origin + route, { waitUntil: 'load', timeout: 30_000 });
    // `_unmount` is set on the custom element the moment `hydrate()` returns, so it is the real completion marker —
    // there is no `hydrated` attribute. `:visible` islands are excluded (they wait for the scroll below), and a failed
    // island renders `<mochi-island-failure>` and never sets `_unmount`, so it counts as settled too.
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('mochi-hydratable-island')].every(
            (el) =>
              (el as unknown as { _unmount?: unknown })._unmount !== undefined || el.getAttribute('hydrate-on') === 'visible' || el.querySelector('mochi-island-failure') !== null,
          ),
        null,
        { timeout: 10_000 },
      )
      .catch(() => hydrationTimedOut.push(route));
    await page.waitForLoadState('networkidle', { timeout: 1_200 }).catch(() => {});

    const ssrSkeleton = await page.evaluate(
      ([html, fn]) => {
        const doc = new DOMParser().parseFromString(html as string, 'text/html');
        // eslint-disable-next-line no-new-func
        return new Function('document', `return (${fn})()`)(doc) as string[];
      },
      [ssrHtml, SKELETON] as const,
    );
    const liveSkeleton = (await page.evaluate(`(${SKELETON})()`)) as string[];
    const hydrationDamage: string[] = [];
    if (isHtml) {
      for (let i = 0; i < Math.max(ssrSkeleton.length, liveSkeleton.length); i++) {
        if (ssrSkeleton[i] !== liveSkeleton[i]) {
          hydrationDamage.push(`@${i} ssr=${ssrSkeleton[i] ?? '<none>'} dom=${liveSkeleton[i] ?? '<none>'}`);
          if (hydrationDamage.length >= 5) break;
        }
      }
    }

    const domAfterHydration = normalizeDom(await page.content());

    // Exercise the page: scrolling releases `:visible` islands and deferred server islands, then every enabled button
    // that will not navigate away gets clicked.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState('networkidle', { timeout: 1_200 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    const buttons = await page.$$('button:not([disabled]):not([type=submit])');
    for (const button of buttons.slice(0, 8)) {
      await button.click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
      await page.waitForTimeout(100);
    }
    await page.waitForLoadState('networkidle', { timeout: 1_200 }).catch(() => {});

    const mochiWarnings = ((await page.evaluate(() => (window as unknown as { __mochi_warnings?: string[] }).__mochi_warnings ?? [])) as string[]).map(clean);
    const domAfterInteraction = normalizeDom(await page.content());
    // The dev toolbar renders live request timings and the bound port, so it is never pixel-stable across two runs.
    await page.addStyleTag({ content: '#mochi-dev-toolbar{visibility:hidden !important}' }).catch(() => {});
    const screenshot = await page.screenshot({ fullPage: false, animations: 'disabled' });
    // A second shot of the *same* page measures how much this route moves on its own — animated decorations, random
    // placement, anything time-driven. The cross-build comparison is scored against that floor, so a page that is
    // never pixel-stable cannot produce a false positive while a static page stays strictly compared.
    await page.waitForTimeout(250);
    const screenshotSelf = await page.screenshot({ fullPage: false, animations: 'disabled' });

    return {
      route,
      status: response?.status() ?? 0,
      consoleErrors,
      consoleWarnings,
      pageErrors,
      failedRequests,
      mochiWarnings,
      hydrationDamage,
      domAfterHydration,
      domAfterInteraction,
      screenshot,
      screenshotSelf,
    };
  } finally {
    await page.close();
  }
}

const SHOT_DIR = path.join(ROOT, '.minify-regression-shots');
mkdirSync(SHOT_DIR, { recursive: true });

function diffPixels(a: Buffer, b: Buffer): { changed: number; total: number } {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) {
    return { changed: Number.MAX_SAFE_INTEGER, total: 1 };
  }
  const total = left.width * left.height;
  const changed = pixelmatch(left.data, right.data, null, left.width, left.height, { threshold: 0.1 });
  return { changed, total };
}

interface CellResult {
  app: string;
  mode: Mode;
  minifier: Minifier;
  routes: number;
  consoleErrors: number;
  consoleWarnings: number;
  pageErrors: number;
  failedRequests: number;
  hydrationIssues: number;
  domDiffs: number;
  /** Routes where two identical bun builds already disagreed, so the oxc DOM comparison is not meaningful. */
  nondeterministic: number;
  screenshotDiffs: number;
  details: string[];
}

const browser = await chromium.launch();
const harnessFailures: string[] = [];
const cells: CellResult[] = [];
let port = 4700;

for (const app of apps) {
  const appDir = path.join(ROOT, 'packages', app);
  const routes = await routesOf(appDir);
  console.error(`\n=== ${app}: ${routes.length} routes ===`);

  for (const mode of modes) {
    const runs = new Map<RunKey, Map<string, RouteObservation>>();
    // One port for every run of this cell — they never overlap, and a differing port number renders into the dev
    // toolbar and into any absolute URL on the page, which would diff as a false positive.
    const cellPort = port++;
    // `bun` twice, then `oxc`. The repeat run is the baseline for "does this page even render the same twice?" — real
    // pages pick random related links, chart libraries hand out incrementing ids, and clicking things is timing
    // dependent. Without it, that noise is indistinguishable from a minifier bug.
    for (const run of RUNS) {
      const minifier = runMinifier(run);
      let server = await startApp(appDir, mode, minifier, cellPort);
      const observations = new Map<string, RouteObservation>();
      const queue = [...routes];
      try {
        // Routes are visited `concurrency` at a time in separate pages. Each page is fully isolated — its own console,
        // network and DOM — so this only changes wall-clock, not what is observed. The one thing it does affect is
        // screenshot timing noise, which the self-calibrated pixel floor already absorbs.
        await Promise.all(
          Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            for (let route = queue.shift(); route !== undefined; route = queue.shift()) {
              try {
                observations.set(route, await observe(browser, server.origin, route));
              } catch (err) {
                // A route that takes the app down (or times out) is itself a finding, and the remaining routes still
                // need visiting — so record it, bring the server back, and carry on rather than aborting the matrix.
                const message = err instanceof Error ? err.message : String(err);
                harnessFailures.push(`${app}/${mode}/${minifier} ${route} [harness] ${message.split('\n')[0]}`);
                if (!(await server.alive())) {
                  harnessFailures.push(`${app}/${mode}/${minifier} ${route} [server-died] restarting`);
                  await server.stop();
                  server = await startApp(appDir, mode, minifier, cellPort);
                }
              }
            }
          }),
        );
      } finally {
        await server.stop();
      }
      runs.set(run, observations);
      console.error(`  ${mode}/${run}: ${observations.size} routes visited`);
    }

    // Confirmation pass. A page that talks to the outside world — the CI dashboard fetches GitHub — renders whatever
    // that call returned, so a single differing observation proves nothing. Every candidate is re-visited on freshly
    // started bun and oxc servers, and only a difference that reproduces is reported.
    const confirmed = new Set<string>();
    const candidates = [...(runs.get('oxc') ?? new Map())].filter(([route, o]) => {
      const base = runs.get('bun')!.get(route);
      const ctl = runs.get('bun-repeat')!.get(route);
      if (base === undefined || ctl === undefined) {
        return false;
      }
      const dom = (r: RouteObservation) => `${r.domAfterHydration}\u0000${r.domAfterInteraction}`;
      if (dom(base) !== dom(ctl)) {
        return false;
      }
      return dom(base) !== dom(o) || diffPixels(base.screenshot, o.screenshot).changed > Math.max(1152000 * 0.001, diffPixels(base.screenshot, ctl.screenshot).changed * 2);
    });
    if (candidates.length > 0) {
      console.error(`  ${mode}: re-checking ${candidates.length} candidate route(s)`);
      const recheck = new Map<Minifier, Map<string, RouteObservation>>();
      for (const minifier of MINIFIERS) {
        const server = await startApp(appDir, mode, minifier, cellPort);
        const seen = new Map<string, RouteObservation>();
        try {
          for (const [route] of candidates) {
            await observe(browser, server.origin, route).then(
              (o) => seen.set(route, o),
              () => {},
            );
          }
        } finally {
          await server.stop();
        }
        recheck.set(minifier, seen);
      }
      for (const [route] of candidates) {
        const b = recheck.get('bun')?.get(route);
        const o = recheck.get('oxc')?.get(route);
        if (
          b &&
          o &&
          (b.domAfterHydration !== o.domAfterHydration || b.domAfterInteraction !== o.domAfterInteraction || diffPixels(b.screenshot, o.screenshot).changed > 1152000 * 0.001)
        ) {
          confirmed.add(route);
        }
      }
      console.error(`  ${mode}: ${confirmed.size}/${candidates.length} reproduced`);
    }

    for (const minifier of MINIFIERS) {
      const obs = runs.get(minifier)!;
      const baseline = runs.get('bun')!;
      const repeat = runs.get('bun-repeat')!;
      const cell: CellResult = {
        app,
        mode,
        minifier,
        routes: obs.size,
        consoleErrors: 0,
        consoleWarnings: 0,
        pageErrors: 0,
        failedRequests: 0,
        hydrationIssues: 0,
        domDiffs: 0,
        nondeterministic: 0,
        screenshotDiffs: 0,
        details: [],
      };
      cell.details.push(...harnessFailures.filter((f) => f.startsWith(`${app}/${mode}/${minifier} `)));
      for (const [route, o] of obs) {
        cell.consoleErrors += o.consoleErrors.length;
        cell.consoleWarnings += o.consoleWarnings.length;
        cell.pageErrors += o.pageErrors.length;
        cell.failedRequests += o.failedRequests.length;
        cell.hydrationIssues += o.hydrationDamage.length > 0 ? 1 : 0;
        for (const [kind, list] of [
          ['console-error', o.consoleErrors],
          ['page-error', o.pageErrors],
          ['failed-request', o.failedRequests],
          ['hydration', o.hydrationDamage],
          ['mochi-warning', o.mochiWarnings],
        ] as const) {
          for (const item of list.slice(0, 3)) {
            cell.details.push(`${app}/${mode}/${minifier} ${route} [${kind}] ${item.slice(0, 240)}`);
          }
        }
        // Only reported on the oxc row: a difference is a property of the pair, and listing it twice doubles the count.
        if (minifier === 'oxc') {
          const paired = baseline.get(route);
          const control = repeat.get(route);
          if (paired === undefined || control === undefined) {
            // One of the bun runs never got an observation for this route, so there is nothing to compare against;
            // the harness failure is already recorded above.
            continue;
          }
          const domOf = (r: RouteObservation) => `${r.domAfterHydration}\u0000${r.domAfterInteraction}`;
          // bun-vs-bun first: a page that does not render the same twice cannot be judged against oxc at all. Real
          // causes seen here are a "more demos" strip that picks related links at random and chart libraries handing
          // out incrementing element ids.
          if (domOf(paired) !== domOf(control)) {
            cell.nondeterministic += 1;
            cell.details.push(`${app}/${mode} ${route} [nondeterministic] bun differs from bun across two runs; excluded from the oxc DOM comparison`);
          } else if (domOf(paired) !== domOf(o) && confirmed.has(route)) {
            cell.domDiffs += 1;
            const a = paired.domAfterHydration === o.domAfterHydration ? paired.domAfterInteraction : paired.domAfterHydration;
            const b = paired.domAfterHydration === o.domAfterHydration ? o.domAfterInteraction : o.domAfterHydration;
            let at = 0;
            while (at < a.length && a[at] === b[at]) at++;
            cell.details.push(
              `${app}/${mode} ${route} [dom-diff] at ${at}\n      bun: …${a.slice(Math.max(0, at - 60), at + 120)}…\n      oxc: …${b.slice(Math.max(0, at - 60), at + 120)}…`,
            );
          }
          // Pixels, not bytes: two PNGs of the same render can differ in size. The threshold is whichever is largest
          // of a small fixed floor, twice the page's own frame-to-frame noise, and twice how much it moves between
          // two identical builds — so animation and random content are tolerated and a static page stays strict.
          const diff = diffPixels(paired.screenshot, o.screenshot);
          const selfNoise = Math.max(diffPixels(paired.screenshot, paired.screenshotSelf).changed, diffPixels(o.screenshot, o.screenshotSelf).changed);
          const runNoise = diffPixels(paired.screenshot, control.screenshot).changed;
          const floor = Math.max(diff.total * 0.001, selfNoise * 2, runNoise * 2);
          if (diff.changed > floor && confirmed.has(route)) {
            cell.screenshotDiffs += 1;
            const file = path.join(SHOT_DIR, `${app}-${mode}-${route.replace(/\W+/g, '_')}`);
            await Bun.write(`${file}-bun.png`, paired.screenshot);
            await Bun.write(`${file}-oxc.png`, o.screenshot);
            cell.details.push(
              `${app}/${mode} ${route} [screenshot-diff] ${diff.changed}/${diff.total} px (floor ${Math.round(floor)}: self ${selfNoise}, bun-vs-bun ${runNoise}) — saved to ${path.relative(ROOT, file)}-{bun,oxc}.png`,
            );
          }
        }
      }
      cells.push(cell);
    }
  }
}

await browser.close();

const lines: string[] = [];
lines.push(`<!-- generated by \`bun scripts/regress-minify.ts\` on Bun ${Bun.version} -->`);
lines.push('');
lines.push(
  '| App | Mode | Minifier | Routes | Console errors | Console warnings | Page errors | Failed requests | Hydration issues | DOM diffs vs bun | Nondet. routes | Screenshot diffs vs bun |',
);
lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const c of cells) {
  const pair = (n: number) => (n === 0 ? '0' : `**${n}**`);
  const vsBun = c.minifier === 'bun' ? '—' : pair(c.domDiffs);
  const shot = c.minifier === 'bun' ? '—' : pair(c.screenshotDiffs);
  const nondet = c.minifier === 'bun' ? '—' : String(c.nondeterministic);
  lines.push(
    `| ${c.app} | ${c.mode} | \`${c.minifier}\` | ${c.routes} | ${pair(c.consoleErrors)} | ${pair(c.consoleWarnings)} | ${pair(c.pageErrors)} | ${pair(c.failedRequests)} | ${pair(c.hydrationIssues)} | ${vsBun} | ${nondet} | ${shot} |`,
  );
}
const table = lines.join('\n');
console.log(`\n${table}\n`);

const allDetails = cells.flatMap((c) => c.details);
if (allDetails.length > 0) {
  console.error(`\n--- ${allDetails.length} finding(s) ---`);
  for (const d of allDetails.slice(0, 120)) {
    console.error(`  ${d}`);
  }
}
if (values.out) {
  await Bun.write(path.resolve(values.out), `${table}\n\n${allDetails.map((d) => `- ${d}`).join('\n')}\n`);
}

if (hydrationTimedOut.length > 0) {
  console.error(`\n--- ${hydrationTimedOut.length} route(s) where hydration did not settle in 10s ---`);
  for (const r of [...new Set(hydrationTimedOut)]) console.error(`  ${r}`);
}
if (harnessFailures.length > 0) {
  console.error(`\n--- ${harnessFailures.length} harness/route failure(s) ---`);
  for (const f of harnessFailures) console.error(`  ${f}`);
}
const fatal = cells.reduce((n, c) => n + c.pageErrors + c.domDiffs + c.screenshotDiffs, 0);
process.exit(fatal > 0 ? 1 : 0);
