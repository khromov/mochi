// The manifest stores artifact paths out-dir relative so a build output relocates, which means the resource report has
// to resolve them before stat'ing. Getting that wrong doesn't fail the build — every row just prints `0 B`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from './build';
import { Mochi } from '../Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'server-island-endpoint', 'Page.svelte');

describe('build resource report', () => {
  let outDir: string;
  let lines: string[];

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-resource-report-'));
    const captured: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(Bun.stripANSI(args.join(' ')));
    };
    try {
      await build({ routes: { '/': Mochi.page(FIXTURE_PAGE) }, development: false, outDir });
    } finally {
      console.log = original;
    }
    lines = captured.flatMap((l) => l.split('\n'));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the stylesheet section sizes every row from disk', () => {
    const start = lines.findIndex((l) => l.trimStart().startsWith('Stylesheet'));
    expect(start, 'expected a Stylesheet section in the build output').toBeGreaterThan(-1);
    const subtotal = lines.slice(start + 1).find((l) => l.includes(' · '));
    expect(subtotal?.trim()).toMatch(/^\d+ files? · (?!0 B)/);
  });
});
