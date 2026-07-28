// An email template is reachable only through `Mochi.email({ component })`, so no import graph leads to it from a
// route and the build can't discover it the way it discovers pages. It walks `src/emails/` instead. Without that, the
// first send in production paid a cold compile and logged a manifest-miss warning.
//
// process.chdir() is safe here because every test file runs in its own process (scripts/run-tests.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { logger } from '../utils/log';
import type { ResolvedEmailMessage } from './types';
import type { MochiManifest } from '../types';

const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const PAGE_SRC = `<h1>page</h1>\n`;

const WELCOME_SRC = `<script>
  let { name } = $props();
</script>
<h1 class="greeting">Hello {name}</h1>
<style>
  .greeting { color: rebeccapurple; }
</style>
`;

const COUNTER_SRC = `<script>
  let n = $state(0);
</script>
<button onclick={() => n++}>{n}</button>
`;

const ISLAND_EMAIL_SRC = `<script>
  import Counter from './Counter.svelte';
</script>
<h1>Hello</h1>
<Counter mochi:hydrate />
`;

const FOOTER_SRC = `<p>footer</p>\n`;

// Behind a branch that never renders, so it emits no placeholder: the send-time guard is post-render and would let
// this through, but the build reads the import graph and must not.
const DEFER_EMAIL_SRC = `<script>
  import Footer from './Footer.svelte';
</script>
<h1>Hello</h1>
{#if false}
  <Footer mochi:defer />
{/if}
`;

function scaffold(prefix: string): string {
  // Inside the package: compiled SSR modules resolve node_modules from the
  // out-dir, so a root outside the project tree has no chain back to the framework.
  const root = mkdtempSync(path.join(import.meta.dir, '..', '..', prefix));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Page.svelte'), PAGE_SRC);
  return root;
}

describe('email templates under src/emails are precompiled into the manifest', () => {
  const originalCwd = process.cwd();
  const roots: string[] = [];
  let manifest: MochiManifest;
  let server: Server<undefined> | undefined;
  let warnings: string[] = [];
  const sends: ResolvedEmailMessage[] = [];
  let noEmailsBuildError: unknown;
  let islandBuildError: unknown;
  let deferBuildError: unknown;

  beforeAll(async () => {
    const root = scaffold('.mochi-email-build-');
    roots.push(root);
    mkdirSync(path.join(root, 'src', 'emails'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'emails', 'Welcome.svelte'), WELCOME_SRC);

    process.chdir(root);
    await build({ routes: { '/': Mochi.page('src/Page.svelte') }, development: false, outDir: 'out' });
    manifest = JSON.parse(await Bun.file(path.join(root, 'out', 'manifest.json')).text());

    // An app with no src/emails/ must be unaffected — the glob just yields nothing.
    const bare = scaffold('.mochi-email-build-bare-');
    roots.push(bare);
    process.chdir(bare);
    try {
      await build({ routes: { '/': Mochi.page('src/Page.svelte') }, development: false, outDir: 'out' });
    } catch (err) {
      noEmailsBuildError = err;
    }

    // Now that the build compiles these, an island would emit client JS no email
    // client can run, so it has to fail the build rather than the first send.
    const island = scaffold('.mochi-email-build-island-');
    roots.push(island);
    mkdirSync(path.join(island, 'src', 'emails'), { recursive: true });
    writeFileSync(path.join(island, 'src', 'emails', 'Counter.svelte'), COUNTER_SRC);
    writeFileSync(path.join(island, 'src', 'emails', 'Bad.svelte'), ISLAND_EMAIL_SRC);
    process.chdir(island);
    try {
      await build({ routes: { '/': Mochi.page('src/Page.svelte') }, development: false, outDir: 'out' });
    } catch (err) {
      islandBuildError = err;
    }

    const defer = scaffold('.mochi-email-build-defer-');
    roots.push(defer);
    mkdirSync(path.join(defer, 'src', 'emails'), { recursive: true });
    writeFileSync(path.join(defer, 'src', 'emails', 'Footer.svelte'), FOOTER_SRC);
    writeFileSync(path.join(defer, 'src', 'emails', 'Deferred.svelte'), DEFER_EMAIL_SRC);
    process.chdir(defer);
    try {
      await build({ routes: { '/': Mochi.page('src/Page.svelte') }, development: false, outDir: 'out' });
    } catch (err) {
      deferBuildError = err;
    }

    process.chdir(root);
    const originalWarn = logger.warn;
    logger.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      server = await Mochi.serve({
        port: 0,
        development: false,
        warmup: false,
        logger: { enabled: false },
        outDir: path.join(root, 'out'),
        routes: { '/': Mochi.page('src/Page.svelte') },
        email: {
          from: 'test@example.com',
          transport: {
            type: 'custom',
            send: (message) => {
              sends.push(message);
            },
          },
        },
      });
      // Warnings from boot aren't what's under test — only what the send logs.
      warnings = [];
      await Mochi.email({ to: 'ada@example.com', subject: 'Hi', component: './src/emails/Welcome.svelte', props: { name: 'Ada' } });
    } finally {
      logger.warn = originalWarn;
    }
  });

  afterAll(() => {
    server?.stop(true);
    process.chdir(originalCwd);
    for (const root of roots) {
      rmSync(root, RM_OPTS);
    }
  });

  test('the template is keyed relative to the project root', () => {
    expect(Object.keys(manifest.components)).toContain('src/emails/Welcome.svelte');
  });

  test('its scoped CSS is emitted alongside it', async () => {
    const cssUrl = manifest.cssFileUrls['src/emails/Welcome.svelte'];
    expect(cssUrl).toBeDefined();
    // renderEmailComponent() resolves the CSS by URL through clientFiles, so the
    // source key alone isn't enough — that mapping has to round-trip too.
    const cssFile = manifest.clientFiles[cssUrl!];
    expect(cssFile).toBeDefined();
    // Minified, so `rebeccapurple` lands as its hex form.
    expect(await Bun.file(path.join(roots[0]!, 'out', cssFile!)).text()).toContain('#639');
  });

  test('sending renders it without recompiling', () => {
    // The positive proof the manifest was hit rather than silently rebuilt: a
    // miss logs, loudly, from compileAll().
    expect(warnings.filter((w) => w.includes('missing from the prebuilt manifest'))).toEqual([]);
  });

  test('the rendered email carries the props and its inlined CSS', () => {
    expect(sends[0]?.html).toContain('Hello Ada');
    // Proves the scoped CSS survived the manifest round-trip and reached
    // css-inline — not merely that the SSR module loaded.
    expect(sends[0]?.html).toMatch(/style="[^"]*#639/);
  });

  test('an app with no src/emails directory still builds', () => {
    expect(noEmailsBuildError).toBeUndefined();
  });

  test('an email template containing an island fails the build', () => {
    expect(islandBuildError).toBeInstanceOf(Error);
    expect((islandBuildError as Error).message).toContain("Email templates can't contain islands");
    expect((islandBuildError as Error).message).toContain('src/emails/Bad.svelte');
  });

  test('an email template referencing a server island fails the build even behind a dead branch', () => {
    expect(deferBuildError).toBeInstanceOf(Error);
    expect((deferBuildError as Error).message).toContain("Email templates can't contain server islands");
    expect((deferBuildError as Error).message).toContain('src/emails/Deferred.svelte');
  });

  test('it sends with the Svelte sources deleted', async () => {
    // Nothing short of this rules out a compile-from-source fallback.
    rmSync(path.join(roots[0]!, 'src', 'emails'), RM_OPTS);
    await Mochi.email({ to: 'ada@example.com', subject: 'Hi', component: './src/emails/Welcome.svelte', props: { name: 'Grace' } });
    expect(sends).toHaveLength(2);
    expect(sends[1]?.html).toContain('Hello Grace');
  });
});
