#!/usr/bin/env bun
import { Glob } from 'bun';

const all = await Array.fromAsync(new Glob('src/**/*.test.ts').scan('.'));
const isolated = all.filter((p) => p.endsWith('.isolated.test.ts')).sort();
const batch = all.filter((p) => !p.endsWith('.isolated.test.ts')).sort();

const results: { label: string; ok: boolean }[] = [];

function run(label: string, args: string[]): void {
  console.log(`\n→ ${label}`);
  const proc = Bun.spawnSync({
    cmd: ['bun', 'test', ...args],
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  results.push({ label, ok: proc.exitCode === 0 });
}

run(`batch (${batch.length} files)`, batch);
// Sequential — each spawnSync blocks until the previous test finishes.
// Required: isolated files conflict if they share a process (Mochi.serve
// pins on globalThis, Bun bundler EISDIR on repeat .svelte compiles, etc.).
for (const file of isolated) {
  run(file, [file]);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(60)}`);
console.log(`${results.length - failed.length}/${results.length} invocations passed`);
if (failed.length > 0) {
  console.log('Failed:');
  for (const r of failed) {
    console.log(`  ✗ ${r.label}`);
  }
  process.exit(1);
}
