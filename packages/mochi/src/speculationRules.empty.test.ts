// A speculationRules object with no prefetch/prerender entries must inject nothing (the `specRuleCount > 0` guard).
// Separate file because only one Mochi.serve() is allowed per process (see speculationRules.test.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('speculationRules option: empty', () => {
  let server: Server<undefined>;
  let outDir: string;
  let html: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-spec-empty-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      speculationRules: { prefetch: [] },
      routes: { '/': Mochi.page(FIXTURE_PAGE) },
    });
    html = await (await fetch(`http://localhost:${server.port}/`)).text();
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('injects no speculationrules script', () => {
    expect(html).not.toContain('type="speculationrules"');
  });
});
