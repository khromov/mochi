import { spawn } from 'bun';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const dbDir = path.join(root, '.db');

try {
  const down = spawn({ cmd: ['docker', 'compose', 'down'], cwd: root, stdout: 'inherit', stderr: 'inherit', stdin: 'ignore' });
  await down.exited;
} catch {
  console.warn('docker not available — skipping `docker compose down`.');
}

if (!existsSync(dbDir)) {
  console.log('reset done: no ./.db data directory to delete.');
  process.exit(0);
}

try {
  rmSync(dbDir, { recursive: true, force: true });
  console.log('reset done: containers removed, ./.db deleted.');
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || code === 'EPERM') {
    console.error('could not delete ./.db — the postgres container owns it (uid 999). Run: sudo rm -rf packages/docker/.db');
  } else {
    console.error('could not delete ./.db:', err);
  }
  process.exit(1);
}
