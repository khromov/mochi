import { describe, it, expect } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { demos } from './demos';

const DEMOS_DIR = path.join(import.meta.dir, '..', 'demos');

/**
 * The per-demo llms.txt routes are generated from this registry, so an entry
 * missing `slug`/`files` produces no route at all and the URL 404s — with
 * nothing failing at build time and nothing to test, since every other demo
 * test also iterates the registry. These two checks are the independent witness.
 */
describe('demo registry', () => {
  it('every internal demo declares a slug and a non-empty files list', () => {
    const incomplete = demos.filter((d) => d.href.startsWith('/')).filter((d) => !d.slug || !d.files || d.files.length === 0);
    expect(incomplete.map((d) => d.href)).toEqual([]);
  });

  it("every internal demo's files.ts exists at src/demos/<slug>/files.ts", () => {
    const missing = demos
      .filter((d) => d.href.startsWith('/') && d.slug)
      .map((d) => d.slug!)
      .filter((slug) => !existsSync(path.join(DEMOS_DIR, slug, 'files.ts')));
    expect(missing).toEqual([]);
  });

  it('every demo folder with a files.ts is registered under that folder name', () => {
    const registered = new Set(demos.map((d) => d.slug).filter(Boolean));
    const unregistered = readdirSync(DEMOS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(DEMOS_DIR, e.name, 'files.ts')))
      .map((e) => e.name)
      .filter((name) => !registered.has(name));
    expect(unregistered).toEqual([]);
  });
});
