import { Glob } from 'bun';

export interface RunTestsOptions {
  /** Package root to glob `src/**\/*.test.ts` from and run each file in. Defaults to the cwd. */
  dir?: string;
  /** Test files (paths relative to `dir`) that must run sequentially, after the parallel batch. */
  sequential?: Iterable<string>;
}

/**
 * Runs each `src/**\/*.test.ts` file in its own `bun test` process, up to
 * `navigator.hardwareConcurrency` in parallel.
 *
 * Per-file isolation is required because `Mochi.serve()` enforces a single
 * instance per process (the `globalThis.__mochi_config__` singleton) — booting
 * two servers in one process throws "Mochi.serve() has already been called."
 * Separate processes also sidestep Bun bundler EISDIR errors and test-global
 * pollution from compiling the same Svelte entry twice.
 *
 * Exits the process with code 1 if any file fails.
 */
export async function runTests(options: RunTestsOptions = {}): Promise<void> {
  const dir = options.dir ?? '.';
  const sequential = new Set(options.sequential ?? []);

  const all = (await Array.fromAsync(new Glob('src/**/*.test.ts').scan(dir))).sort();
  const parallel = all.filter((f) => !sequential.has(f));

  const concurrency = navigator.hardwareConcurrency;
  console.log(`Running ${all.length} test files (${parallel.length} parallel × ${concurrency} workers, ${sequential.size} sequential)`);

  const results: { file: string; ok: boolean }[] = [];

  let idx = 0;
  async function next(): Promise<void> {
    while (idx < parallel.length) {
      const file = parallel[idx++]!;
      const proc = Bun.spawn(['bun', 'test', '--timeout', '30000', file], {
        cwd: dir,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      results.push({ file, ok: exitCode === 0 });
      console.log(`\n${exitCode === 0 ? '✓' : '✗'} ${file}`);
      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(stderr);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => next()));

  for (const file of sequential) {
    console.log(`\n→ ${file} (sequential)`);
    const proc = Bun.spawnSync({
      cmd: ['bun', 'test', '--timeout', '30000', file],
      cwd: dir,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    results.push({ file, ok: proc.exitCode === 0 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${results.length - failed.length}/${results.length} tests passed (concurrency: ${concurrency})`);
  if (failed.length > 0) {
    console.log('Failed:');
    for (const r of failed) {
      console.log(`  ✗ ${r.file}`);
    }
    process.exit(1);
  }
}
