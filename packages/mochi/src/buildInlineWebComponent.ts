import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(FRAMEWORK_DIR, 'buildInlineWorker.ts');

export async function buildInlineWebComponent(relPath: string): Promise<string> {
  const entry = new URL(relPath, import.meta.url).pathname;
  const proc = Bun.spawn(['bun', 'run', WORKER_PATH, entry], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`buildInlineWebComponent failed for ${entry}:\n${stderr || stdout}`);
  }
  return stdout;
}
