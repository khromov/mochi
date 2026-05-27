const entry = process.argv[2];
if (!entry) {
  process.stderr.write('Usage: bun buildInlineWorker.ts <entry-path>\n');
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: [entry],
  target: 'browser',
  minify: true,
  throw: false,
});

if (!result.success) {
  const lines = result.logs
    .map((l) => {
      const p = (l as { position?: { file: string; line: number; column: number } | null }).position;
      const where = p ? `${p.file}:${p.line}:${p.column}` : '<unknown>';
      return `  ${where} — ${l.message}`;
    })
    .join('\n');
  process.stderr.write(lines);
  process.exit(1);
}

process.stdout.write(await result.outputs[0]!.text());
