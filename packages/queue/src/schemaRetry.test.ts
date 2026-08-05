import { expect, setDefaultTimeout, test } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from './db';
import { createQueue } from './index';
import { startTestPostgres } from './__fixtures__/startTestPostgres';
import { waitFor } from './__fixtures__/testUtil';

// PGlite's first WASM compile can outrun bun's 5s default timeout on a cold container.
setDefaultTimeout(30_000);

test('a failed bootstrap is dropped from the memo and retried, then memoized once it succeeds', async () => {
  let fail = true;
  let attempts = 0;
  const fake = {
    unsafe: async () => {
      attempts++;
      if (fail) {
        throw new Error('connection refused');
      }
    },
  } as unknown as SQL;

  await expect(ensureSchema(fake, 'postgres')).rejects.toThrow('connection refused');
  await Bun.sleep(0);
  fail = false;
  await ensureSchema(fake, 'postgres');
  const succeededAfter = attempts;
  expect(succeededAfter).toBeGreaterThan(1);

  await ensureSchema(fake, 'postgres');
  expect(attempts).toBe(succeededAfter);
});

test('a queue that boots before its database accepts connections recovers once it does', async () => {
  // Reserve a port with nothing listening on it yet — the rolling-deploy shape where the
  // app boots before Postgres is reachable.
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);

  const sql = new SQL(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 });
  const runs: string[] = [];
  const queue = createQueue<null>('late-db', {
    database: sql,
    pollInterval: 0,
    process: (job) => {
      runs.push(job.id);
    },
    on: { error: () => {} },
  });

  await expect(queue.add('j', null)).rejects.toThrow();

  const pg = await startTestPostgres({ port });
  try {
    const ref = await queue.add('j', null);
    expect(ref.deduplicated).toBe(false);
    await waitFor(() => runs.length === 1, 10_000, 'the job to run after the database came up');
    expect(runs).toEqual([ref.id]);
  } finally {
    await queue.close();
    await sql.close();
    await pg.close();
  }
});
