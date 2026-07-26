/**
 * Black-box HTTP sweep of the running site with ffuf.
 *
 * Complements `packages/mochi/src/httpFuzz.fuzz.test.ts`: that suite fuzzes the
 * framework's internals in-process against a slim fixture, this one probes the
 * *real* app -- real shell, real middleware chain, real routes, `trailingSlash:
 * 'always'` -- with a wordlist, which surfaces path shapes a hand-written
 * grammar never invents.
 *
 * Triage lives here rather than in ffuf's matchers on purpose: with
 * `trailingSlash: 'always'` every slashless path 301s, so `-fc 301` would
 * blanket-hide real findings and `-ac` would simply learn that redirects are
 * normal. We match everything and decide what counts as noise ourselves.
 *
 * Three wordlists, each sent only to the passes it suits (see `Pass.lists`):
 * `mochi-paths.txt` and `payloads.txt` are curated and in-repo; the general
 * discovery list is fetched once from SecLists and cached, because macOS
 * packages none and ffuf bundles none.
 *
 *   bun run fuzz:http                   # dev server on :4444, all three lists
 *   bun run fuzz:http -- --prod         # rebuilds, then sweeps the built bundle
 *   FUZZ_DISCOVERY=off bun run fuzz:http            # curated only, seconds not minutes
 *   FUZZ_DISCOVERY=/path/to/list.txt bun run fuzz:http
 */
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..', '..');
const SITE_DIR = path.resolve(import.meta.dir, '..');
const PORT = Number(process.env.FUZZ_PORT ?? 4444);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.FUZZ_OUT ?? path.join(REPO_ROOT, '.mochi-fuzz');
// Deliberately NOT under OUT, which is wiped at the start of every run — a
// 1 MB download should survive between sweeps. Covered by the `.mochi-*` ignore.
const CACHE = path.join(REPO_ROOT, '.mochi-fuzz-cache');
const WORDLIST_DIR = path.join(import.meta.dir, 'fuzz', 'wordlists');
const PROD = process.argv.includes('--prod');

// SecLists is not packaged for macOS (no `seclists` or `dirb` formula) and ffuf
// ships no wordlists, so the general discovery list is fetched once and cached.
// Override with FUZZ_DISCOVERY=<path|url|off>; `off` runs curated-only.
const DISCOVERY_SOURCE =
  process.env.FUZZ_DISCOVERY ?? 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/raft-large-words.txt';

// Kept in sync by hand with the deny-list in httpFuzz.fuzz.test.ts. The
// duplication is deliberate: a shared module under packages/mochi/src would be
// published to npm, and this script lives in a different workspace.
const LEAKS: ReadonlyArray<readonly [string, RegExp]> = [
  ['stack frame', /\n\s+at\s+[\w$.<>[\]/]+\s*[(:]/],
  ['node internals', /\bnode:internal\//],
  ['posix home path', /(?:^|[\s"'(=`])\/(?:Users|home|root|private\/(?:var|tmp)|var\/folders)\//],
  ['node_modules', /node_modules[/\\]/],
  ['file url', /\bfile:\/\//],
  ['repo root', new RegExp(REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
  ['env assignment', /\b(?:MOCHI_KEY|SMTP_PASS|ADMIN_PASSWORD|AWS_SECRET)\b\s*[=:]/],
];

interface FfufResult {
  input: Record<string, string>;
  status: number;
  length: number;
  duration: number;
  url?: string;
  resultfile?: string;
}

interface Finding {
  pass: string;
  word: string;
  status: number;
  reason: string;
  detail?: string;
}

type Wordlist = 'mochi-paths' | 'payloads' | 'discovery';

interface Pass {
  name: string;
  /** Only a path pass can meaningfully expose a file, so the sensitive-path
   * rule is scoped to those -- `?.env=1` returning 200 is just the homepage. */
  isPath: boolean;
  /** Which lists this pass is run against, once each. Path passes get the
   * curated internals plus the general discovery list; value passes get the
   * injection payloads. Sending a discovery list to a header pass, or an
   * injection payload to a path pass, is mostly wasted requests. */
  lists: Wordlist[];
  args: string[];
}

// Both slash forms are swept on purpose. Under `trailingSlash: 'always'` an
// extensionless path 301s and ffuf does not follow redirects, so the bare pass
// alone would only ever exercise the redirect layer and never reach a route --
// the trailing-slash pass is what actually hits handlers. The bare pass still
// earns its place: a path with an extension is exempt from the redirect
// (trailingSlash.ts's HAS_EXTENSION), so `.env` and friends are only tested there.
// Following redirects with `-r` would be the other fix, but it would let the
// fuzzer chase an off-site Location (e.g. /discord -> discord.com) and issue
// requests to third parties, which a local sweep has no business doing.
const PATH_LISTS: Wordlist[] = ['mochi-paths', 'payloads', 'discovery'];

const PASSES: readonly Pass[] = [
  { name: 'path-root', isPath: true, lists: PATH_LISTS, args: ['-u', `${BASE}/FUZZ`] },
  { name: 'path-root-slash', isPath: true, lists: PATH_LISTS, args: ['-u', `${BASE}/FUZZ/`] },
  { name: 'path-mochi', isPath: true, lists: PATH_LISTS, args: ['-u', `${BASE}/_mochi/FUZZ`] },
  { name: 'path-mochi-slash', isPath: true, lists: PATH_LISTS, args: ['-u', `${BASE}/_mochi/FUZZ/`] },
  { name: 'query-island-props', isPath: false, lists: ['payloads'], args: ['-u', `${BASE}/_mochi/island/Echo?props=FUZZ`] },
  { name: 'query-image-payload', isPath: false, lists: ['payloads'], args: ['-u', `${BASE}/_mochi/image/fuzz.png?p=FUZZ`] },
  { name: 'query-param-name', isPath: false, lists: ['payloads'], args: ['-u', `${BASE}/?FUZZ=1`] },
  { name: 'header-cookie', isPath: false, lists: ['payloads'], args: ['-u', `${BASE}/`, '-H', 'Cookie: FUZZ'] },
  { name: 'header-forwarded-host', isPath: false, lists: ['payloads'], args: ['-u', `${BASE}/`, '-H', 'X-Forwarded-Host: FUZZ'] },
  {
    name: 'header-origin',
    isPath: false,
    lists: ['payloads'],
    args: ['-u', `${BASE}/demos/login/`, '-X', 'POST', '-d', 'username=a&password=b', '-H', 'Content-Type: application/x-www-form-urlencoded', '-H', 'Origin: FUZZ'],
  },
];

// A 2xx on any of these is a disclosure, not a route.
const SENSITIVE =
  /^(?:\.env|\.git|\.mochi|\.DS_Store|\.vscode|\.idea|bun\.lock|bunfig|package\.json|tsconfig|svelte\.config|Dockerfile|docker-compose|src|scripts|node_modules|etc\/passwd|proc\/|backup|dump\.sql|actuator)/i;

// Debug routes that packages/site/src/routes.ts registers only under
// `MODE=development`. They are *supposed* to answer on the default dev sweep, so
// flagging them there would just teach everyone to ignore the report -- `--prod`
// is what actually proves the gate holds.
const DEV_GATED = /^_(?:heapsnapshot|profiler)/i;

function preflight(): void {
  if (!Bun.which('ffuf')) {
    console.error('ffuf not found on PATH. Install it with:\n\n  brew install ffuf\n\nThen re-run. (Tested against ffuf 2.1.0.)');
    process.exit(1);
  }
}

// Always rebuild for --prod rather than checking that `.mochi` merely exists:
// that check passes for an arbitrarily stale bundle, so the sweep would report
// on code that is no longer in the tree while looking perfectly healthy. The
// build is a few seconds and makes "what got swept" unambiguous.
function buildForProd(): void {
  console.log('\nBuilding the site (--prod sweeps the built bundle, so it is rebuilt every run)...');
  const started = Date.now();
  const proc = Bun.spawnSync(['bun', 'run', 'build'], { cwd: SITE_DIR, stdout: 'inherit', stderr: 'inherit' });
  if (proc.exitCode !== 0) {
    console.error(`\nbuild failed (exit ${proc.exitCode}) — not sweeping a stale bundle.`);
    process.exit(1);
  }
  console.log(`  built in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// ffuf has no comment syntax, so strip ours into a copy it can read.
function materialize(src: string, name: string): { path: string; count: number } {
  const words = readFileSync(src, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const dest = path.join(OUT, `wordlist-${name}.txt`);
  writeFileSync(dest, words.join('\n') + '\n');
  return { path: dest, count: words.length };
}

async function resolveDiscovery(): Promise<string | null> {
  if (DISCOVERY_SOURCE === 'off') {
    return null;
  }
  if (!DISCOVERY_SOURCE.startsWith('http')) {
    if (!existsSync(DISCOVERY_SOURCE)) {
      console.error(`FUZZ_DISCOVERY path not found: ${DISCOVERY_SOURCE}`);
      process.exit(1);
    }
    return DISCOVERY_SOURCE;
  }
  mkdirSync(CACHE, { recursive: true });
  const cached = path.join(CACHE, path.basename(new URL(DISCOVERY_SOURCE).pathname));
  if (existsSync(cached)) {
    return cached;
  }
  console.log(`  fetching discovery wordlist (once, then cached in ${path.relative(REPO_ROOT, CACHE)}/)\n    ${DISCOVERY_SOURCE}`);
  try {
    const res = await fetch(DISCOVERY_SOURCE, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    writeFileSync(cached, await res.text());
    return cached;
  } catch (err) {
    // Offline is not a reason to abandon the sweep — the curated lists still run.
    console.warn(`  ! could not fetch the discovery wordlist (${String(err)}); continuing with the curated lists only`);
    return null;
  }
}

let serverProc: Bun.Subprocess | undefined;
let tornDown = false;

async function teardown(): Promise<void> {
  if (tornDown) {
    return;
  }
  tornDown = true;
  // `bun run dev:site` fans out into a process tree; killing only the port
  // listener orphans the wrappers, which then pile up across runs.
  Bun.spawnSync(['pkill', '-f', PROD ? 'packages/site run start' : 'dev:site']);
  serverProc?.kill();
  await Bun.sleep(500);
}

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProc?.exitCode !== null && serverProc?.exitCode !== undefined) {
      throw new Error(`server exited early with code ${serverProc.exitCode}`);
    }
    try {
      // `/` is already canonical under trailingSlash:'always', so no redirect.
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) {
        await res.text();
        return;
      }
    } catch {
      // Not up yet.
    }
    await Bun.sleep(500);
  }
  throw new Error(`server did not become ready on ${BASE} within ${timeoutMs}ms`);
}

// Dumping every response body is fine for a 100-entry curated list and ruinous
// for a 120k-entry discovery list (gigabytes, one file per request). Above this
// size we skip -od and re-fetch only the interesting handful during triage.
const DUMP_MAX_WORDS = 2_000;

function runPass(pass: Pass, list: Wordlist, wordlist: string, count: number): { jsonOut: string; bodyDir: string | null } {
  const label = `${pass.name}--${list}`;
  const jsonOut = path.join(OUT, `${label}.json`);
  const dump = count <= DUMP_MAX_WORDS;
  const bodyDir = dump ? path.join(OUT, `${label}-bodies`) : null;
  if (bodyDir) {
    mkdirSync(bodyDir, { recursive: true });
  }
  const args = [
    'ffuf',
    '-w',
    `${wordlist}:FUZZ`,
    // Match everything; the triage below decides what is noise.
    '-mc',
    'all',
    '-t',
    '20', // under ffuf's default 40 so the site's rate limits don't dominate
    '-timeout',
    '10',
    '-of',
    'json',
    '-o',
    jsonOut,
    ...(bodyDir ? ['-od', bodyDir] : []),
    '-s',
    ...pass.args,
  ];
  const proc = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) {
    console.error(`  ! ffuf ${label} exited ${proc.exitCode}: ${proc.stderr.toString().slice(0, 400)}`);
  }
  return { jsonOut, bodyDir };
}

function bodyFor(r: FfufResult, bodyDir: string): string {
  if (!r.resultfile) {
    return '';
  }
  try {
    // ffuf writes the raw response (headers + body) to -od.
    return readFileSync(r.resultfile, 'utf8');
  } catch {
    // Fall back to scanning the dir if the recorded path moved.
    const guess = path.join(bodyDir, path.basename(r.resultfile));
    return existsSync(guess) ? readFileSync(guess, 'utf8') : '';
  }
}

// Statuses a path sweep produces in bulk and that carry no body worth scanning.
// Anything else is "interesting" enough to be worth a re-fetch when the pass ran
// too large to dump bodies wholesale.
const BORING = new Set([301, 308, 404]);
const MAX_REFETCH = 200;
const WIRE_REJECT = new Set([501, 505]);

async function triage(pass: Pass, list: Wordlist, results: FfufResult[], bodyDir: string | null): Promise<{ findings: Finding[]; baseline: Map<number, number>; wireRejected: number }> {
  const findings: Finding[] = [];
  const baseline = new Map<number, number>();
  let wireRejected = 0;
  const durations = results.map((r) => r.duration).sort((a, b) => a - b);
  const p99 = durations.length > 0 ? durations[Math.floor(durations.length * 0.99)]! : 0;
  const name = `${pass.name}--${list}`;

  // Without a body dump, fetch the bodies that matter. Bounded so a pathological
  // run can't turn triage into a second sweep; truncation is reported, never silent.
  const refetched = new Map<string, string>();
  if (!bodyDir) {
    const interesting = results.filter((r) => !BORING.has(r.status) && r.url);
    for (const r of interesting.slice(0, MAX_REFETCH)) {
      try {
        const res = await fetch(r.url!, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        refetched.set(r.url!, [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' + (await res.text()));
      } catch {
        // A body we cannot re-read simply goes unscanned for leaks; the status
        // rules above already ran on it.
      }
    }
    if (interesting.length > MAX_REFETCH) {
      console.log(`    note: ${name} had ${interesting.length} interesting responses; leak-scanned the first ${MAX_REFETCH}`);
    }
  }

  for (const r of results) {
    baseline.set(r.status, (baseline.get(r.status) ?? 0) + 1);
    // ffuf 2.x seeds `input` with FFUFHASH before the keyword, so read FUZZ by
    // name -- taking the first value yields the hash and breaks the reflection
    // check below, turning every echoed wordlist entry into a false positive.
    const word = r.input.FUZZ ?? '';

    // 501/505 come from Bun's HTTP parser rejecting a malformed *request line*
    // before routing — ffuf splices the payload in raw, so any value containing a
    // space turns `GET /?' OR '1'='1 HTTP/1.1` into an unparseable version token.
    // That is upstream behaviour, not a Mochi fault. Counted and reported below
    // rather than dropped silently, since it means those payloads never landed.
    if (WIRE_REJECT.has(r.status)) {
      wireRejected++;
      continue;
    }

    if (r.status >= 500) {
      findings.push({ pass: name, word, status: r.status, reason: 'server error' });
      continue;
    }

    if (pass.isPath && r.status >= 200 && r.status < 300 && (SENSITIVE.test(word) || (PROD && DEV_GATED.test(word)))) {
      findings.push({ pass: name, word, status: r.status, reason: PROD && DEV_GATED.test(word) ? 'dev-only route reachable in production' : 'sensitive path served' });
      continue;
    }

    const raw = bodyDir ? bodyFor(r, bodyDir) : (refetched.get(r.url ?? '') ?? '');
    if (raw) {
      for (const [leakName, re] of LEAKS) {
        const m = re.exec(raw);
        // Skip the caller's own input coming back: a reflected wordlist entry is
        // a different class from disclosing server state.
        if (m && !word.includes(m[0].replace(/[/\\]+$/, ''))) {
          // In dev the framework attaches stacks to 5xx by design, so a leak on
          // an error response is already covered by the 5xx rule above.
          if (!PROD && leakName === 'stack frame' && r.status >= 400) {
            continue;
          }
          findings.push({ pass: name, word, status: r.status, reason: `info leak (${leakName})`, detail: m[0].slice(0, 120) });
          break;
        }
      }
    }

    if (p99 > 0 && r.duration > p99 * 20) {
      findings.push({ pass: name, word, status: r.status, reason: `slow: ${Math.round(r.duration / 1e6)}ms vs p99 ${Math.round(p99 / 1e6)}ms` });
    }
  }
  return { findings, baseline, wireRejected };
}

async function main(): Promise<void> {
  preflight();
  if (PROD) {
    buildForProd();
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const discoverySrc = await resolveDiscovery();
  const lists = new Map<Wordlist, { path: string; count: number }>();
  lists.set('mochi-paths', materialize(path.join(WORDLIST_DIR, 'mochi-paths.txt'), 'mochi-paths'));
  lists.set('payloads', materialize(path.join(WORDLIST_DIR, 'payloads.txt'), 'payloads'));
  if (discoverySrc) {
    lists.set('discovery', materialize(discoverySrc, 'discovery'));
  }
  for (const [name, l] of lists) {
    console.log(`  wordlist ${name.padEnd(12)} ${l.count} entries`);
  }
  if (!discoverySrc) {
    console.log('  (no discovery wordlist — set FUZZ_DISCOVERY=<path|url> or unset it to fetch the default)');
  }
  const planned = PASSES.reduce((n, p) => n + p.lists.reduce((m, l) => m + (lists.get(l)?.count ?? 0), 0), 0);
  console.log(`  ~${planned.toLocaleString()} requests planned`);

  console.log(`\nStarting ${PROD ? 'production' : 'dev'} site on :${PORT} ...`);
  serverProc = Bun.spawn(['bun', 'run', PROD ? 'start' : 'dev:site'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      // packages/site/src/index.ts derives proxy.origin (and therefore the CSRF
      // expected origin) from MOCHI_PORT. Without it every POST 403s and the
      // header-origin pass tests nothing.
      MOCHI_PORT: String(PORT),
      MOCHI_LIVE_RELOAD: 'false',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  });

  process.on('SIGINT', () => {
    void teardown().then(() => process.exit(130));
  });

  const allFindings: Finding[] = [];
  const totals = new Map<number, number>();
  let totalWireRejected = 0;
  try {
    // A cold Svelte compile plus `warmup: true` is genuinely slow here.
    await waitForReady(90_000);
    console.log('Server ready. Running passes...\n');

    for (const pass of PASSES) {
      for (const list of pass.lists) {
        const wl = lists.get(list);
        if (!wl) {
          continue;
        }
        const started = Date.now();
        const { jsonOut, bodyDir } = runPass(pass, list, wl.path, wl.count);
        if (!existsSync(jsonOut)) {
          console.log(`  ${pass.name}--${list}: no output`);
          continue;
        }
        const parsed = JSON.parse(readFileSync(jsonOut, 'utf8')) as { results?: FfufResult[] };
        const results = parsed.results ?? [];
        const { findings, baseline, wireRejected } = await triage(pass, list, results, bodyDir);
        totalWireRejected += wireRejected;
        allFindings.push(...findings);
        for (const [status, n] of baseline) {
          totals.set(status, (totals.get(status) ?? 0) + n);
        }
        const summary = [...baseline.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([s, n]) => `${s}x${n}`)
          .join(' ');
        const secs = ((Date.now() - started) / 1000).toFixed(0);
        console.log(
          `  ${`${pass.name}--${list}`.padEnd(34)} ${String(results.length).padStart(7)} req ${secs.padStart(4)}s   ${summary}${findings.length ? `   <- ${findings.length} finding(s)` : ''}`,
        );
      }
    }
  } finally {
    await teardown();
  }

  console.log('\n--- baseline ---');
  for (const [status, n] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
    const note =
      status === 301 || status === 308
        ? '  (trailingSlash canonicalisation)'
        : status === 429
          ? '  (rate limited)'
          : WIRE_REJECT.has(status)
            ? '  (rejected by Bun\'s HTTP parser — payload never reached the app)'
            : '';
    console.log(`  ${status}: ${n}${note}`);
  }
  if (totalWireRejected > 0) {
    console.log(`\n  ${totalWireRejected} payload(s) contained a space and were rejected at the request line, so they never`);
    console.log('  exercised the app. They still land correctly on the header passes, where spaces are legal.');
  }

  if (allFindings.length === 0) {
    console.log('\nNo findings.');
    console.log(`Raw output: ${path.relative(REPO_ROOT, OUT)}`);
    return;
  }

  console.log(`\n--- ${allFindings.length} finding(s) ---`);
  for (const f of allFindings) {
    console.log(`  [${f.pass}] ${f.status} ${f.reason}\n      word: ${JSON.stringify(f.word)}${f.detail ? `\n      match: ${JSON.stringify(f.detail)}` : ''}`);
  }
  console.log(`\nRaw output: ${path.relative(REPO_ROOT, OUT)}`);
  process.exit(1);
}

await main();
