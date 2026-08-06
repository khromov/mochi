// In-process Postgres for tests: a PGlite (WASM Postgres) instance exposed over the
// Postgres wire protocol by @electric-sql/pglite-socket, so bun:sql connects to it by URL
// exactly as it would to a real server — no external service, no Docker, cross-platform.
// The backend is deliberately hidden behind this handle so it can be swapped without
// touching call sites. Mirrors the port-0 + readback shape of email/fakeSmtpServer.ts.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export interface TestPostgres {
  /** Connection string for bun:sql / `postgresStore({ url })`. */
  url: string;
  port: number;
  /** Run SQL directly against the underlying database (seeding, assertions). */
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export async function startTestPostgres(opts?: { initSql?: string }): Promise<TestPostgres> {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });

  // `PGLiteSocketServer.port` is private; the only way to learn the OS-assigned port from
  // `port: 0` is the `listening` event it fires from inside start().
  const port = await new Promise<number>((resolve, reject) => {
    server.addEventListener('listening', (event) => {
      resolve((event as CustomEvent<{ port: number; host: string }>).detail.port);
    });
    server.addEventListener('error', (event) => reject((event as CustomEvent<Error>).detail));
    server.start().catch(reject);
  });

  if (opts?.initSql) {
    await db.exec(opts.initSql);
  }

  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    port,
    query: (sql) => db.query(sql) as Promise<{ rows: never[] }>,
    close: async () => {
      await server.stop();
      await db.close();
    },
  };
}
