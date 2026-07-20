import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

// Signal handling can't be exercised in-process — the handler ends in
// `process.exit()`, which would take the test runner with it. Each case spawns
// `utils/shutdownSignalServer.ts` as a child, connects a WebSocket, and signals it.
const serverScript = path.join(import.meta.dir, 'utils', 'shutdownSignalServer.ts');
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-shutdown-signal-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

async function startChild(shutdownTimeout: number, development = false): Promise<{ proc: Bun.Subprocess; port: number }> {
  const proc = Bun.spawn([process.execPath, serverScript, outDir, String(shutdownTimeout), String(development)], {
    cwd: path.join(import.meta.dir, '..'),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // The child prints `port=<n>` once it is listening. In dev mode it also emits
  // startup warnings first, so scan for the marker rather than taking line one.
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  while (!/port=(\d+)/.test(buffered)) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffered += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
  const port = Number(buffered.match(/port=(\d+)/)?.[1]);
  expect(port).toBeGreaterThan(0);
  return { proc, port };
}

async function connectWebSocket(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('websocket failed to connect'));
  });
  return ws;
}

// The original bug: a dev server with a live-reload WebSocket open logged
// "Received SIGTERM" and then hung indefinitely — a plain `server.stop()` never
// resolves while a WebSocket is open, and the dev watchers keep the loop alive
// past the last socket. Both halves (forced stop + explicit exit) are needed.
test('SIGTERM exits a dev server holding an open WebSocket', async () => {
  const { proc, port } = await startChild(0, true);
  await connectWebSocket(port);

  proc.kill('SIGTERM');
  const exitCode = await Promise.race([proc.exited, Bun.sleep(8_000).then(() => 'timed out' as const)]);

  expect(exitCode).toBe(0);
}, 30_000);

test('SIGTERM exits cleanly with shutdownTimeout: 0 while a WebSocket is open', async () => {
  const { proc, port } = await startChild(0);
  await connectWebSocket(port);

  proc.kill('SIGTERM');
  const exitCode = await Promise.race([proc.exited, Bun.sleep(5_000).then(() => 'timed out' as const)]);

  expect(exitCode).toBe(0);
}, 15_000);

test('SIGTERM still exits once the grace period lapses', async () => {
  const { proc, port } = await startChild(500);
  await connectWebSocket(port);

  const t0 = performance.now();
  proc.kill('SIGTERM');
  const exitCode = await Promise.race([proc.exited, Bun.sleep(5_000).then(() => 'timed out' as const)]);
  const elapsed = performance.now() - t0;

  expect(exitCode).toBe(0);
  // Waited for the grace period rather than cutting the socket immediately.
  expect(elapsed).toBeGreaterThanOrEqual(400);
}, 15_000);
