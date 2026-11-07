// The production half of `sharedCssImports.test.ts`: `mochi-framework build` batches the error page and every route
// into the same `Bun.build`, so a stylesheet two of them import was hoisted into a chunk the output graph could not
// reach and landed in no entry's `entryImportedCss` — a prebuilt deploy then served every one of those pages unstyled.
//
// process.chdir() is safe here because every test file runs in its own process (scripts/run-tests.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';
import { encodeSourcePath } from './manifestPaths';
import type { MochiManifest } from '../types';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'shared-css');
const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const routes = { '/': Mochi.page('app/Home.svelte'), '/admin': Mochi.page('app/Admin.svelte') };

let root: string;
let server: Server<undefined> | undefined;
const originalCwd = process.cwd();

/** One production build per error-page shape, each into its own out-dir so the manifests can be compared side by side. */
async function buildWith(outDir: string, errorPage: string): Promise<MochiManifest> {
  await build({ routes, errorPage: `app/${errorPage}`, development: false, outDir });
  return JSON.parse(await Bun.file(path.join(root, outDir, 'manifest.json')).text());
}

/** Stylesheets the manifest says this entry links, reduced to bare basenames. */
function importedCss(manifest: MochiManifest, entry: string): string[] {
  return (manifest.entryImportedCss?.[encodeSourcePath(path.join(root, 'app', entry))] ?? []).map((p) => path.basename(p)).sort();
}

describe('shared side-effect CSS imports survive a production build', () => {
  let ownCss: MochiManifest;
  let shared: MochiManifest;
  let all: MochiManifest;

  beforeAll(async () => {
    // Inside the package: the build dynamically imports the SSR modules it emits, and those resolve node_modules from
    // the out-dir.
    root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-shared-css-build-'));
    cpSync(FIXTURE_DIR, path.join(root, 'app'), { recursive: true });
    // Present only to keep the build's "no Svelte config" notice out of the output.
    writeFileSync(path.join(root, 'svelte.config.js'), 'export default {};\n');
    process.chdir(root);

    ownCss = await buildWith('out-own', 'ErrorOwnCss.svelte');
    shared = await buildWith('out-shared', 'ErrorShared.svelte');
    all = await buildWith('out-all', 'ErrorAll.svelte');

    server = await Mochi.serve({
      port: 0,
      development: false,
      warmup: false,
      logger: { enabled: false },
      outDir: path.join(root, 'out-all'),
      routes,
      errorPage: 'app/ErrorAll.svelte',
    });
  });

  afterAll(() => {
    server?.stop(true);
    process.chdir(originalCwd);
    rmSync(root, RM_OPTS);
  });

  test('an error page with its own stylesheet leaves the routes alone', () => {
    expect(importedCss(ownCss, 'ErrorOwnCss.svelte')).toEqual(['error-only.css']);
    expect(importedCss(ownCss, 'Home.svelte')).toEqual(['alpha.css', 'beta.css', 'theme.css']);
    expect(importedCss(ownCss, 'Admin.svelte')).toEqual(['beta.css', 'theme.css']);
  });

  test('a stylesheet the error page shares with the routes stays on all three', () => {
    expect(importedCss(shared, 'ErrorShared.svelte')).toEqual(['theme.css']);
    expect(importedCss(shared, 'Home.svelte')).toEqual(['alpha.css', 'beta.css', 'theme.css']);
    expect(importedCss(shared, 'Admin.svelte')).toEqual(['beta.css', 'theme.css']);
  });

  test('an error page sharing every stylesheet still leaves each route with its own', () => {
    expect(importedCss(all, 'ErrorAll.svelte')).toEqual(['alpha.css', 'beta.css', 'theme.css']);
    expect(importedCss(all, 'Home.svelte')).toEqual(['alpha.css', 'beta.css', 'theme.css']);
    expect(importedCss(all, 'Admin.svelte')).toEqual(['beta.css', 'theme.css']);
  });

  test('the served pages carry the <link> tags', async () => {
    const linked = async (url: string) => {
      const res = await fetch(new URL(url, server!.url));
      const html = await res.text();
      return [...html.matchAll(/<link rel="stylesheet" href="([^"]+import-css[^"]+)"/g)].map((m) => path.basename(m[1]!));
    };

    const home = await linked('/');
    expect(home.some((f) => f.startsWith('alpha-'))).toBe(true);
    expect(home.some((f) => f.startsWith('beta-'))).toBe(true);
    expect(home.some((f) => f.startsWith('theme-'))).toBe(true);

    const admin = await linked('/admin');
    expect(admin.some((f) => f.startsWith('beta-'))).toBe(true);
    expect(admin.some((f) => f.startsWith('theme-'))).toBe(true);
    expect(admin.some((f) => f.startsWith('alpha-'))).toBe(false);

    // The error page renders through the same shell, and was the entry that went missing from `entryImportedCss` entirely.
    const notFound = await linked('/nope');
    expect(notFound.some((f) => f.startsWith('alpha-'))).toBe(true);
    expect(notFound.some((f) => f.startsWith('beta-'))).toBe(true);
    expect(notFound.some((f) => f.startsWith('theme-'))).toBe(true);
  });
});
