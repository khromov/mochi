import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// Regression: a page body that contains the literal text `{{mochi.script}}`
// (docs pages do) used to clobber the real shell placeholder. The shell filled
// placeholders with four sequential `.replace(string, fn)` calls; since the
// body is injected before the script slot, `.replace` matched the in-body copy
// and left the genuine bottom placeholder printed verbatim. The single-pass
// regex fill must instead fill the template placeholder and leave body text be.
describe('shell placeholders do not collide with placeholder-looking body text', () => {
  let server: Server<undefined>;
  let outDir: string;
  let port: number;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-shell-placeholder-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      debugBar: false,
      outDir,
      routes: {
        '/': Mochi.page(path.join(import.meta.dir, '__fixtures__', 'shell-placeholder', 'Page.svelte')),
      },
    });
    if (server.port == null) {
      throw new Error('server.port not set');
    }
    port = server.port;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('literal body text survives and the real placeholder is filled', async () => {
    const html = await (await fetch(`http://localhost:${port}/`)).text();

    // The literal text from the component body is preserved verbatim.
    expect(html).toContain('Use {{mochi.script}} in your shell.');

    // The genuine shell placeholder before </body> is gone (filled, not printed).
    expect(html).not.toMatch(/\{\{mochi\.script\}\}\s*<\/body>/);
  });
});
