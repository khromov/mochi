import { runBuildInWorker } from './runBuildInWorker';

export async function buildInlineWebComponent(relPath: string): Promise<string> {
  const entry = new URL(relPath, import.meta.url).pathname;
  const response = await runBuildInWorker({
    kind: 'simple',
    buildOptions: {
      entrypoints: [entry],
      target: 'browser',
      minify: true,
    },
  });
  if (!response.success) {
    const lines = response.logs
      .map((l) => {
        const where = l.position ? `${l.position.file}:${l.position.line}:${l.position.column}` : '<unknown>';
        return `  ${where} — ${l.message}`;
      })
      .join('\n');
    throw new Error(`buildInlineWebComponent failed for ${entry}:\n${lines}`);
  }
  return response.outputs[0]!.text;
}
