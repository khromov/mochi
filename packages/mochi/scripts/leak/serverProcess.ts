import { spawn, type Subprocess } from 'bun';

export type ServerHandle = {
  pid: number;
  proc: Subprocess<'ignore', 'inherit', 'inherit'>;
  kill: () => Promise<void>;
};

async function isPortInUse(port: number): Promise<boolean> {
  try {
    const sock = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: { data() {}, open() {}, close() {}, error() {} },
    });
    sock.end();
    return true;
  } catch {
    return false;
  }
}

export async function startServer(opts: { cwd: string; port: number; env?: Record<string, string>; bootTimeoutMs?: number }): Promise<ServerHandle> {
  if (await isPortInUse(opts.port)) {
    throw new Error(`Port ${opts.port} is already in use. ` + `Stop the existing process or pass --port=<other> to runLeakTest.`);
  }

  // Invoke `bun src/index.ts` directly rather than `bun run start` so the spawned PID is the
  // actual server process — the `bun run` wrapper would otherwise be the only process we can
  // sample with `ps`, and its RSS is unrelated to the server's.
  const proc = spawn({
    cmd: ['bun', 'src/index.ts'],
    cwd: opts.cwd,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...opts.env },
  });

  const pid = proc.pid;
  if (!pid) {
    throw new Error('Failed to spawn server: no pid');
  }

  const baseUrl = `http://127.0.0.1:${opts.port}`;
  const deadline = Date.now() + (opts.bootTimeoutMs ?? 30_000);
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `Spawned server exited (code=${proc.exitCode}) before becoming reachable. ` +
          `See the inherited stderr above for the underlying error ` +
          `(common causes: stale .mochi/ build artifacts, missing env vars, source errors).`,
      );
    }
    try {
      // Use the probe endpoint as the readiness check — it only exists when MOCHI_MEMORY_PROBE=1,
      // so a 200 confirms we're talking to *our* spawned process, not someone else's server.
      const res = await fetch(`${baseUrl}/__mochi/health/memory`);
      if (res.ok) {
        await res.arrayBuffer();
        return {
          pid,
          proc,
          kill: async () => {
            proc.kill('SIGTERM');
            await Promise.race([proc.exited, Bun.sleep(3000).then(() => proc.kill('SIGKILL'))]);
          },
        };
      }
    } catch (err) {
      lastErr = err;
    }
    await Bun.sleep(250);
  }
  proc.kill('SIGKILL');
  throw new Error(`Server did not become healthy at ${baseUrl}/__mochi/health/memory within ${opts.bootTimeoutMs ?? 30_000}ms (last error: ${lastErr})`);
}
