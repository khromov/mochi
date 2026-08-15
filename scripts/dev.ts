import { spawn, type Subprocess } from 'bun';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';

const packagesDir = path.resolve(import.meta.dir, '..', 'packages');

// Packages that are CI build targets rather than things you'd normally iterate
// on — started only by `bun run dev:full`, so the everyday fanout stays small.
const FULL_ONLY = new Set(['minimal-rsvelte', 'capacitor-ios-android']);
const full = process.argv.includes('--full');

const targets: { name: string; cwd: string }[] = [];
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || (FULL_ONLY.has(entry.name) && !full)) {
    continue;
  }
  const pkgPath = path.join(packagesDir, entry.name, 'package.json');
  const pkg = (await Bun.file(pkgPath)
    .json()
    .catch(() => null)) as { scripts?: Record<string, string> } | null;
  if (pkg?.scripts?.dev) {
    targets.push({ name: entry.name, cwd: path.join('packages', entry.name) });
  }
}

if (targets.length === 0) {
  console.error('[dev] no workspaces with a "dev" script found under packages/');
  process.exit(1);
}

const palette = [
  (s: string) => styleText('cyan', s),
  (s: string) => styleText('magenta', s),
  (s: string) => styleText('yellow', s),
  (s: string) => styleText('green', s),
  (s: string) => styleText('blue', s),
  (s: string) => styleText('red', s),
];

const pipePrefixed = async (src: ReadableStream<Uint8Array>, dst: NodeJS.WriteStream, prefix: string): Promise<void> => {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of src) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      dst.write(prefix + buf.slice(0, nl) + '\n');
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.length > 0) {
    dst.write(prefix + buf + '\n');
  }
};

console.log(`[dev] starting: ${targets.map((t) => t.name).join(', ')}`);

const procs: Subprocess[] = targets.map((t, i) => {
  const color = palette[i % palette.length];
  const prefix = color(`[${t.name}]`) + ' ';
  const proc = spawn({
    cmd: ['bun', 'run', 'dev'],
    cwd: t.cwd,
    env: { ...process.env, MODE: 'development', FORCE_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  void pipePrefixed(proc.stdout as ReadableStream<Uint8Array>, process.stdout, prefix);
  void pipePrefixed(proc.stderr as ReadableStream<Uint8Array>, process.stderr, prefix);
  return proc;
});

let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals, code = 0): Promise<never> => {
  if (shuttingDown) {
    for (const p of procs) {
      p.kill('SIGKILL');
    }
    process.exit(code || 1);
  }
  shuttingDown = true;
  for (const p of procs) {
    p.kill(signal);
  }

  const allExited = Promise.all(procs.map((p) => p.exited));
  const timedOut = await Promise.race([allExited.then(() => false as const), Bun.sleep(3000).then(() => true as const)]);

  if (timedOut) {
    for (const p of procs) {
      if (p.exitCode === null) {
        p.kill('SIGKILL');
      }
    }
    await allExited;
  }

  process.exit(code);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// First child to exit drives the parent's exit code: if a workspace dev
// command crashes, we want CI / shells to see a non-zero status.
const firstExit = await Promise.race(procs.map((p) => p.exited));
await shutdown('SIGTERM', typeof firstExit === 'number' ? firstExit : 1);
