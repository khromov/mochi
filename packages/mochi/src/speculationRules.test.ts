// Boots a real Mochi.serve() with a speculationRules option and asserts the tag is injected into the page <head>.
// Only one Mochi.serve() is allowed per process, so the empty/no-op case lives in speculationRules.empty.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { SpeculationRules } from './runtime/speculationRules';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

// A `</script>` inside a value must be escaped so it can't close the tag early.
const RULES: SpeculationRules = {
  prefetch: [
    {
      where: {
        and: [{ href_matches: '/*' }, { not: { href_matches: '/danger</script>x' } }, { not: { selector_matches: '[rel~=nofollow]' } }],
      },
      eagerness: 'moderate',
    },
  ],
  prerender: [{ urls: ['/', '/about'] }],
};

describe('speculationRules option', () => {
  let server: Server<undefined>;
  let outDir: string;
  let html: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-spec-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      speculationRules: RULES,
      routes: { '/': Mochi.page(FIXTURE_PAGE) },
    });
    html = await (await fetch(`http://localhost:${server.port}/`)).text();
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('injects exactly one speculationrules script', () => {
    expect(html.match(/type="speculationrules"/g)?.length).toBe(1);
  });

  test('the tag renders inside <head>', () => {
    const tagIndex = html.indexOf('type="speculationrules"');
    const headClose = html.indexOf('</head>');
    expect(tagIndex).toBeGreaterThanOrEqual(0);
    expect(tagIndex).toBeLessThan(headClose);
  });

  test('the payload round-trips as the original rules JSON', () => {
    const inner = html.match(/<script type="speculationrules">([\s\S]*?)<\/script>/)?.[1];
    expect(inner).toBeDefined();
    expect(JSON.parse(inner!)).toEqual(RULES);
  });

  test('a </script> in a value is escaped, not emitted literally', () => {
    expect(html).toContain('\\u003c/script>');
  });
});
