import { relForDisplay } from '../utils';

/**
 * Format a `Bun.build()` failure's `logs` array as `file:line:column — message` per entry. Bun 1.2+ throws a generic
 * `AggregateError("Bundle failed")` with `stack === undefined`, losing the positions, so every call passes
 * `throw: false` to recover the structured logs for this helper.
 */
export function formatBuildMessages(
  logs: ReadonlyArray<{
    message: string;
    position?: { file: string; line: number; column: number } | null;
  }>,
): string {
  if (logs.length === 0) {
    return '  <no diagnostic messages>';
  }
  const formatted = logs
    .map((l) => {
      const p = l.position;
      const where = p ? `${relForDisplay(p.file)}:${p.line}:${p.column}` : '<unknown>';
      return `  ${where} — ${l.message}`;
    })
    .join('\n');

  // A read failure on a file inside the isolated linker's node_modules/.bun
  // symlink store is the signature of a known Bun bug (a second Bun.build in a
  // `bun test` / --hot / --watch process fails reading deps the runtime loader
  // already imported). Without this hint the error looks like a broken dep and
  // costs hours; with it the fix is a two-line bunfig change.
  if (/reading file/.test(formatted) && /node_modules[\\/]\.bun[\\/]/.test(formatted)) {
    return (
      `${formatted}\n` +
      `  hint: this matches a known Bun bug — a second Bun.build() inside \`bun test\` (or --hot/--watch)\n` +
      `  fails reading node_modules files resolved through the isolated linker's symlinked\n` +
      `  node_modules/.bun store. Fix: add \`linker = "hoisted"\` under \`[install]\` in bunfig.toml,\n` +
      `  delete node_modules, and reinstall. See https://github.com/khromov/bun-second-build-eisdir-repro`
    );
  }
  return formatted;
}
