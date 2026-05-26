#!/usr/bin/env bun
import { Glob } from 'bun';

const files = (await Array.fromAsync(new Glob('src/**/*.test.ts').scan('.'))).sort();
const results: { file: string; ok: boolean }[] = [];

for (const file of files) {
  console.log(`\n→ ${file}`);
  const proc = Bun.spawnSync({
    cmd: ['bun', 'test', file],
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  results.push({ file, ok: proc.exitCode === 0 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(60)}`);
console.log(`${results.length - failed.length}/${results.length} tests passed`);
if (failed.length > 0) {
  console.log('Failed:');
  for (const r of failed) {
    console.log(`  ✗ ${r.file}`);
  }
  process.exit(1);
}
