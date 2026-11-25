import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { error } from './utils';
import { escapeControlChars } from './utils/log';

const FORGED = '[mochi] FORGED admin login ok';
const INJECTION = encodeURIComponent(`x\n${FORGED}\r\n`);

describe('request-derived error messages cannot forge log lines', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const lines: string[] = [];
  const real = { error: console.error, warn: console.warn, info: console.info, log: console.log };
  const record = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };

  beforeAll(async () => {
    Object.assign(console, { error: record, warn: record, info: record, log: record });
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-log-injection-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { level: 'log' },
      outDir,
      routes: {
        '/file/:name': Mochi.file((_req, params) => error(404, `No file named "${params.name}"`)),
        '/missing/:name': Mochi.file((_req, params) => `./${params.name}.txt`),
        '/api/:name': Mochi.api(({ params }) => error(404, `No item named "${params.name}"`)),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    Object.assign(console, real);
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  const logLinesFor = async (route: string): Promise<string[]> => {
    lines.length = 0;
    const res = await fetch(`${base}${route}/${INJECTION}`);
    expect(res.status).toBe(404);
    await Bun.sleep(20);
    return lines.flatMap((l) => l.split(/\r\n|\r|\n/));
  };

  for (const route of ['/file', '/missing', '/api']) {
    test(`${route}: the decoded newline stays escaped on one line`, async () => {
      const out = await logLinesFor(route);
      expect(out.some((l) => l.includes(`x\\n${FORGED}\\r\\n`))).toBe(true);
      expect(out.some((l) => l.startsWith(FORGED))).toBe(false);
    });
  }

  test('escapeControlChars escapes terminal escapes and C1 newlines too', () => {
    expect(escapeControlChars('a\x1b[2Jb\u0085c\td')).toBe('a\\u001b[2Jb\\u0085c\\td');
    expect(escapeControlChars('plain → text "quoted"')).toBe('plain → text "quoted"');
  });
});
