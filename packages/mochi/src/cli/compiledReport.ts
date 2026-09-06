import { styleText } from 'node:util';
import type { CompiledUsage } from '../compiler/compiledMacro';

/**
 * Report every `compiled()` call the build evaluated and inlined.
 *
 * Worth its own section rather than a log line: a build-time value is invisible in the output bundle by design, so this
 * is the only place the work shows up at all.
 */
export function printCompiledTree(rows: CompiledUsage[]): void {
  if (rows.length === 0) {
    return;
  }

  const labels = rows.map((r) => `${r.count}× compiled() in ${r.file}`);
  const width = Math.max('Build-time values'.length, ...labels.map((l) => l.length));

  console.log('');
  console.log(styleText('dim', `      ${'Build-time values'.padEnd(width)}`));

  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    const char = styleText('dim', n === 1 ? '─' : i === 0 ? '┌' : i === n - 1 ? '└' : '├');
    console.log(`  ${char} ${styleText('magenta', '✦')} ${styleText('dim', `${row.count}×`)} ${styleText('magenta', 'compiled()')} ${styleText('dim', 'in')} ${row.file}`);
  }

  const calls = rows.reduce((sum, r) => sum + r.count, 0);
  console.log(styleText('dim', `\n  ${calls} call${calls === 1 ? '' : 's'} inlined across ${n} module${n === 1 ? '' : 's'}`));
}
