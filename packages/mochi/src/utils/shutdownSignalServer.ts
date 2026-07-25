// A bare Mochi server with one WebSocket route, spawned by
// `shutdownSignal.test.ts` to exercise the SIGTERM/SIGINT path.
//
// Signal handling can't be tested in-process — the handler ends in
// `process.exit()`, which would take the test runner down with it. The child
// can't live in the test file either: importing `bun:test` outside `bun test`
// throws. So it sits under `utils/` (not a `*.test.ts` file) where the runner
// never picks it up.
import { Mochi } from '../Mochi';

if (import.meta.main) {
  const [outDir, shutdownTimeout, development] = process.argv.slice(2);
  if (!outDir || shutdownTimeout === undefined) {
    console.error('usage: bun run src/utils/shutdownSignalServer.ts <outDir> <shutdownTimeout> [development]');
    process.exit(2);
  }
  const server = await Mochi.serve({
    port: 0,
    // Dev mode is the case that hangs in practice: it starts chokidar watchers
    // that outlive the last socket, on top of the live-reload WebSocket.
    development: development === 'true',
    logger: { enabled: false },
    outDir,
    shutdownTimeout: Number(shutdownTimeout),
    routes: {
      '/ws': Mochi.ws({ message() {} }, { checkOrigin: false }),
    },
  });
  // The parent waits for this line before connecting.
  console.log(`port=${server.port}`);
}
