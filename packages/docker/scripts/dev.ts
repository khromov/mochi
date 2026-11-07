import { spawn } from 'bun';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

// A bare never-resolving promise pins a CPU core at 100% in Bun; an anchored
// timer parks the event loop instead.
const idleForever = (): Promise<never> => {
  setInterval(() => {}, 60_000);
  return new Promise(() => {});
};

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
  await idleForever();
}

const proc = spawn({
  cmd: ['docker', 'compose', 'up'],
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'ignore',
});

let shuttingDown = false;
let composeRunning = true;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    // While compose runs, forward the signal and let its exit drive ours; once
    // we're idling after a failure, nothing else will exit us, so do it here.
    if (composeRunning) {
      shuttingDown = true;
      proc.kill(sig);
    } else {
      process.exit(0);
    }
  });
}

const code = await proc.exited;
composeRunning = false;
if (shuttingDown) {
  process.exit(code);
}

// Compose exited on its own (failed start, crashed container, daemon died) rather
// than from our shutdown signal: idle instead of exiting so the root dev.ts's
// first-exit-wins teardown can't take the other dev servers down with it.
console.warn(`docker compose exited (code ${code}) — idling so the other dev servers keep running.`);
await idleForever();
