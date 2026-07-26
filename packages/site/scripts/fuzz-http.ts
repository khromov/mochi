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
 *   bun run fuzz:http              # dev server on :4444
 *   bun run fuzz:http -- --prod    # prebuilt server, strict leak rule
 *   FUZZ_WORDLIST=/path/to/seclists.txt bun run fuzz:http
 */
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..', '..');
const SITE_DIR = path.resolve(import.meta.dir, '..');
const PORT = Number(process.env.FUZZ_PORT ?? 4444);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.FUZZ_OUT ?? path.join(REPO_ROOT, '.mochi-fuzz');
const DEFAULT_WORDLIST = path.join(import.meta.dir, 'fuzz', 'wordlists', 'mochi.txt');
const PROD = process.argv.includes('--prod');

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
  resultfile?: string;
}

interface Finding {
  pass: string;
  word: string;
  status: number;
  reason: string;
  detail?: string;
}

interface Pass {
  name: string;
  /** Only a path pass can meaningfully expose a file, so the sensitive-path
   * rule is scoped to those -- `?.env=1` returning 200 is just the homepage. */
  isPath: boolean;
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
const PASSES: readonly Pass[] = [
  { name: 'path-root', isPath: true, args: ['-u', `${BASE}/FUZZ`] },
  { name: 'path-root-slash', isPath: true, args: ['-u', `${BASE}/FUZZ/`] },
  { name: 'path-mochi', isPath: true, args: ['-u', `${BASE}/_mochi/FUZZ`] },
  { name: 'path-mochi-slash', isPath: true, args: ['-u', `${BASE}/_mochi/FUZZ/`] },
  { name: 'query-island-props', isPath: false, args: ['-u', `${BASE}/_mochi/island/Echo?props=FUZZ`] },
  { name: 'query-image-payload', isPath: false, args: ['-u', `${BASE}/_mochi/image/fuzz.png?p=FUZZ`] },
  { name: 'query-param-name', isPath: false, args: ['-u', `${BASE}/?FUZZ=1`] },
  { name: 'header-cookie', isPath: false, args: ['-u', `${BASE}/`, '-H', 'Cookie: FUZZ'] },
  { name: 'header-forwarded-host', isPath: false, args: ['-u', `${BASE}/`, '-H', 'X-Forwarded-Host: FUZZ'] },
  {
    name: 'header-origin',
    isPath: false,
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

function preflight(): string {
  if (!Bun.which('ffuf')) {
    console.error('ffuf not found on PATH. Install it with:\n\n  brew install ffuf\n\nThen re-run. (Tested against ffuf 2.1.0.)');
    process.exit(1);
  }
  const wordlist = process.env.FUZZ_WORDLIST ?? DEFAULT_WORDLIST;
  if (!existsSync(wordlist)) {
    console.error(`wordlist not found: ${wordlist}`);
    process.exit(1);
  }
  if (PROD && !existsSync(path.join(SITE_DIR, '.mochi'))) {
    console.error('--prod needs a prebuilt site. Run `bun run build` first.');
    process.exit(1);
  }
  return wordlist;
}

// ffuf has no comment syntax, so strip ours into a temp copy it can read.
function materializeWordlist(src: string): string {
  const words = readFileSync(src, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const dest = path.join(OUT, 'wordlist.txt');
  writeFileSync(dest, words.join('\n') + '\n');
  console.log(`  wordlist: ${words.length} entries from ${path.relative(REPO_ROOT, src)}`);
  return dest;
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

function runPass(pass: Pass, wordlist: string): void {
  const jsonOut = path.join(OUT, `${pass.name}.json`);
  const bodyDir = path.join(OUT, `${pass.name}-bodies`);
  mkdirSync(bodyDir, { recursive: true });
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
    '-od',
    bodyDir,
    '-s',
    ...pass.args,
  ];
  const proc = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) {
    console.error(`  ! ffuf pass ${pass.name} exited ${proc.exitCode}: ${proc.stderr.toString().slice(0, 400)}`);
  }
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

function triage(pass: Pass, results: FfufResult[], bodyDir: string): { findings: Finding[]; baseline: Map<number, number> } {
  const findings: Finding[] = [];
  const baseline = new Map<number, number>();
  const durations = results.map((r) => r.duration).sort((a, b) => a - b);
  const p99 = durations.length > 0 ? durations[Math.floor(durations.length * 0.99)]! : 0;
  const name = pass.name;

  for (const r of results) {
    baseline.set(r.status, (baseline.get(r.status) ?? 0) + 1);
    // ffuf 2.x seeds `input` with FFUFHASH before the keyword, so read FUZZ by
    // name -- taking the first value yields the hash and breaks the reflection
    // check below, turning every echoed wordlist entry into a false positive.
    const word = r.input.FUZZ ?? '';

    if (r.status >= 500) {
      findings.push({ pass: name, word, status: r.status, reason: 'server error' });
      continue;
    }

    if (pass.isPath && r.status >= 200 && r.status < 300 && (SENSITIVE.test(word) || (PROD && DEV_GATED.test(word)))) {
      findings.push({ pass: name, word, status: r.status, reason: PROD && DEV_GATED.test(word) ? 'dev-only route reachable in production' : 'sensitive path served' });
      continue;
    }

    const raw = bodyFor(r, bodyDir);
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
  return { findings, baseline };
}

async function main(): Promise<void> {
  const srcWordlist = preflight();

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const wordlist = materializeWordlist(srcWordlist);

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
  try {
    // A cold Svelte compile plus `warmup: true` is genuinely slow here.
    await waitForReady(90_000);
    console.log('Server ready. Running passes...\n');

    for (const pass of PASSES) {
      runPass(pass, wordlist);
      const jsonOut = path.join(OUT, `${pass.name}.json`);
      if (!existsSync(jsonOut)) {
        console.log(`  ${pass.name}: no output`);
        continue;
      }
      const parsed = JSON.parse(readFileSync(jsonOut, 'utf8')) as { results?: FfufResult[] };
      const results = parsed.results ?? [];
      const { findings, baseline } = triage(pass, results, path.join(OUT, `${pass.name}-bodies`));
      allFindings.push(...findings);
      for (const [status, n] of baseline) {
        totals.set(status, (totals.get(status) ?? 0) + n);
      }
      const summary = [...baseline.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}x${n}`)
        .join(' ');
      console.log(`  ${pass.name.padEnd(22)} ${String(results.length).padStart(4)} req   ${summary}${findings.length ? `   <- ${findings.length} finding(s)` : ''}`);
    }
  } finally {
    await teardown();
  }

  console.log('\n--- baseline ---');
  for (const [status, n] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
    const note = status === 301 || status === 308 ? '  (trailingSlash canonicalisation)' : status === 429 ? '  (rate limited)' : '';
    console.log(`  ${status}: ${n}${note}`);
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
