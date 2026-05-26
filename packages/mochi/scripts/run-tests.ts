#!/usr/bin/env bun
import { Glob } from 'bun';

const sequential = new Set(['src/liveReloadFilter.test.ts']);

const all = (await Array.fromAsync(new Glob('src/**/*.test.ts').scan('.'))).sort();
const parallel = all.filter((f) => !sequential.has(f));

const concurrency = 4;
const results: { file: string; ok: boolean }[] = [];
let idx = 0;

async function next(): Promise<void> {
  while (idx < parallel.length) {
    const file = parallel[idx++];
    const proc = Bun.spawn(['bun', 'test', file], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const ok = exitCode === 0;
    results.push({ file, ok });
    console.log(`\n${ok ? '✓' : '✗'} ${file}`);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => next()));

for (const file of sequential) {
  console.log(`\n→ ${file} (sequential)`);
  const proc = Bun.spawnSync({
    cmd: ['bun', 'test', file],
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
