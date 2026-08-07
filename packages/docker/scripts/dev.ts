import { spawn } from 'bun';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

const dockerAvailable = async (): Promise<boolean> => {
  try {
    const probe = spawn({ cmd: ['docker', 'info'], stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
    return (await probe.exited) === 0;
  } catch {
    return false;
  }
};

if (!(await dockerAvailable())) {
  console.warn('Docker is not available — skipping Postgres + Adminer.');
  // Idle instead of exiting: the root dev.ts tears down every dev server as
  // soon as the first child exits, even with code 0.
  await new Promise(() => {});
}

const proc = spawn({
  cmd: ['docker', 'compose', 'up'],
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'ignore',
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => proc.kill(sig));
}

process.exit(await proc.exited);
