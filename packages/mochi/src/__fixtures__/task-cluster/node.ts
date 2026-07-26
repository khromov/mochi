/**
 * One node of a simulated multi-process deployment, spawned by
 * `serveTasksFailover.test.ts`. Prints a line per lifecycle event so the parent can
 * see, from the outside, which process is actually doing the scheduled work.
 *
 * argv: <label> <outDir> <leaseUrl> <leaseTtlMs>
 */
import { Mochi } from '../../Mochi';
import { mochiEvents } from '../../events';

const [label, outDir, leaseUrl, ttl] = process.argv.slice(2);
const leaseTtl = Number(ttl);

mochiEvents.on('task:leader', ({ acquired }) => {
  console.log(`${label}:leader:${acquired}`);
});

await Mochi.serve({
  port: 0,
  development: false,
  logger: { enabled: false },
  outDir: outDir!,
  routes: {},
  tasks: {
    beat: Mochi.task({
      cron: '* * * * * *',
      run: () => {
        console.log(`${label}:ran`);
      },
    }),
  },
  scheduler: {
    leader: true,
    startupJitter: 0,
    leaseTtl,
    heartbeatInterval: Math.floor(leaseTtl / 3),
    lease: { url: leaseUrl! },
  },
});

console.log(`${label}:up`);
