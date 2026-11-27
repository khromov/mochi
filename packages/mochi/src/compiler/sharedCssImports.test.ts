// A side-effect `.css` import is stripped to an empty module, and `splitting` hoists an empty module shared by two
// entrypoints into a chunk that emits no import statement — so attributing CSS through the *output* graph silently lost
// every stylesheet more than one page imported, and every page that imported it rendered unstyled with no warning.
// Adding an `errorPage` that shares a stylesheet with the routes is how this first surfaced, so the error page compiles
// in the same cohort here, exactly as `Mochi.serve()` does it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'shared-css');
const HOME = path.join(FIXTURE_DIR, 'Home.svelte');
const ADMIN = path.join(FIXTURE_DIR, 'Admin.svelte');

const ALPHA = path.join(FIXTURE_DIR, 'styles', 'alpha.css');
const BETA = path.join(FIXTURE_DIR, 'styles', 'beta.css');
const THEME = path.join(FIXTURE_DIR, 'styles', 'theme.css');
const ERROR_ONLY = path.join(FIXTURE_DIR, 'styles', 'error-only.css');

const outDirs: string[] = [];

type LinksFor = (entry: string) => Promise<string[]>;

/** Compiles one cohort the way `Mochi.serve()` does — error page first, then the routes. */
async function compileCohort(label: string, errorPage: string | null): Promise<LinksFor> {
  const outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', `.mochi-shared-css-${label}-`));
  outDirs.push(outDir);
  const registry = new ComponentRegistry({ development: true, outDir });
  await registry.compileAll([...(errorPage ? [errorPage] : []), HOME, ADMIN]);

  // The rendered `cssUrls` is what the shell turns into `<link rel="stylesheet">`, so assert on it rather than on the
  // internal map — the bug was invisible in `importedCssUrls`, which stayed complete throughout.
  return async (entry: string) => {
    const ctx = {
      requestId: 'test',
      request: new Request('http://localhost/'),
      url: new URL('http://localhost/'),
      params: {},
      locals: {},
      isWarmup: false,
      cookies: new MochiCookieJar(null),
      islandProps: new Map(),
      getClientAddress: () => null,
    };
    const result = await requestContext.run(ctx, () => registry.renderComponent(entry));
    return result.cssUrls.filter((u) => u.includes('/import-css/'));
  };
}

/** `import-css` URLs are content-hashed, so match on the stylesheet's basename stem instead. */
function linksTo(urls: string[], cssPath: string): boolean {
  const stem = path.basename(cssPath, '.css');
  return urls.some((u) => path.basename(u).startsWith(`${stem}-`));
}

afterAll(() => {
  for (const dir of outDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('shared side-effect CSS imports — no error page', () => {
  let linksFor: LinksFor;

  beforeAll(async () => {
    linksFor = await compileCohort('none', null);
  });

  test('every page links every stylesheet it imports, shared or not', async () => {
    const home = await linksFor(HOME);
    expect(linksTo(home, ALPHA)).toBe(true);
    expect(linksTo(home, BETA)).toBe(true);
    expect(linksTo(home, THEME)).toBe(true);

    const admin = await linksFor(ADMIN);
    expect(linksTo(admin, BETA)).toBe(true);
    expect(linksTo(admin, THEME)).toBe(true);
    expect(linksTo(admin, ALPHA)).toBe(false);
  });
});

describe('shared side-effect CSS imports — error page with its own stylesheet', () => {
  const ERROR_PAGE = path.join(FIXTURE_DIR, 'ErrorOwnCss.svelte');
  let linksFor: LinksFor;

  beforeAll(async () => {
    linksFor = await compileCohort('own', ERROR_PAGE);
  });

  test('the error page links only its own stylesheet', async () => {
    const error = await linksFor(ERROR_PAGE);
    expect(linksTo(error, ERROR_ONLY)).toBe(true);
    expect(linksTo(error, THEME)).toBe(false);
  });

  test('the routes keep their own stylesheets', async () => {
    const home = await linksFor(HOME);
    expect(linksTo(home, ALPHA)).toBe(true);
    expect(linksTo(home, BETA)).toBe(true);
    expect(linksTo(home, THEME)).toBe(true);
    expect(linksTo(home, ERROR_ONLY)).toBe(false);
  });
});

describe('shared side-effect CSS imports — error page shares one stylesheet with the routes', () => {
  const ERROR_PAGE = path.join(FIXTURE_DIR, 'ErrorShared.svelte');
  let linksFor: LinksFor;

  beforeAll(async () => {
    linksFor = await compileCohort('shared', ERROR_PAGE);
  });

  test('the error page links the shared stylesheet', async () => {
    expect(linksTo(await linksFor(ERROR_PAGE), THEME)).toBe(true);
  });

  test('the routes still link the stylesheet the error page shares', async () => {
    const home = await linksFor(HOME);
    expect(linksTo(home, THEME)).toBe(true);
    expect(linksTo(home, ALPHA)).toBe(true);
    expect(linksTo(home, BETA)).toBe(true);

    const admin = await linksFor(ADMIN);
    expect(linksTo(admin, THEME)).toBe(true);
    expect(linksTo(admin, BETA)).toBe(true);
  });
});

describe('shared side-effect CSS imports — error page shares every stylesheet', () => {
  const ERROR_PAGE = path.join(FIXTURE_DIR, 'ErrorAll.svelte');
  let linksFor: LinksFor;

  beforeAll(async () => {
    linksFor = await compileCohort('all', ERROR_PAGE);
  });

  test('the error page links all three', async () => {
    const error = await linksFor(ERROR_PAGE);
    expect(linksTo(error, ALPHA)).toBe(true);
    expect(linksTo(error, BETA)).toBe(true);
    expect(linksTo(error, THEME)).toBe(true);
  });

  // The worst shape of the bug: `Admin.svelte` imports nothing the error page doesn't, and was emptied completely.
  test('the routes are unaffected by what the error page imports', async () => {
    const home = await linksFor(HOME);
    expect(linksTo(home, ALPHA)).toBe(true);
    expect(linksTo(home, BETA)).toBe(true);
    expect(linksTo(home, THEME)).toBe(true);

    const admin = await linksFor(ADMIN);
    expect(linksTo(admin, BETA)).toBe(true);
    expect(linksTo(admin, THEME)).toBe(true);
    expect(linksTo(admin, ALPHA)).toBe(false);
  });
});
