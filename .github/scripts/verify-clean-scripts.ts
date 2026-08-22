/**
 * Verify every workspace `clean` script removes its target dir, on whatever OS this runs on. The scripts use `rm -rf`,
 * a Bun Shell builtin that is cross-platform only through `bun run`, and the matrix build never runs `clean` — so this
 * is the sole Windows coverage for it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const packagesDir = path.resolve(import.meta.dir, '..', '..', 'packages');

let checked = 0;
let failures = 0;

for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const pkgDir = path.join(packagesDir, entry.name);
  const pkgJson = path.join(pkgDir, 'package.json');
  if (!existsSync(pkgJson)) {
    continue;
  }
  const clean = (JSON.parse(readFileSync(pkgJson, 'utf8')) as { scripts?: Record<string, string> }).scripts?.clean;
  if (!clean) {
    continue;
  }

  const match = /^rm -rf\s+(\S+)$/.exec(clean.trim());
  if (!match) {
    console.error(`✗ ${entry.name}: clean script is not "rm -rf <dir>": ${clean}`);
    failures++;
    continue;
  }
  const target = path.join(pkgDir, match[1]!);

  // Seed the target so a clean that silently no-ops can't pass.
  mkdirSync(path.join(target, 'nested'), { recursive: true });
  writeFileSync(path.join(target, 'nested', 'sentinel.txt'), 'x');

  const result = Bun.spawnSync(['bun', 'run', 'clean'], { cwd: pkgDir, stdout: 'pipe', stderr: 'pipe' });
  checked++;

  if (existsSync(target)) {
    console.error(`✗ ${entry.name}: "${clean}" left ${match[1]} behind`);
    console.error(new TextDecoder().decode(result.stderr).trim());
    failures++;
  } else {
    console.log(`✓ ${entry.name}: ${clean}`);
  }
}

if (checked === 0) {
  console.error('No clean scripts found — did the packages move?');
  process.exit(1);
}
if (failures > 0) {
  console.error(`\n${failures} clean script(s) failed on ${process.platform}.`);
  process.exit(1);
}
console.log(`\nAll ${checked} clean scripts removed their target directory on ${process.platform}.`);
