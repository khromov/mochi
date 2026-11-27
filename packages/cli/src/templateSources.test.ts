import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTemplateSource } from './download.ts';
import { TEMPLATES } from './templates.ts';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const ENV_FILES = ['.env', '.env.local', '.env.production'];

// Root-level names only, where .gitignore and .dockerignore matching agree: the last matching pattern wins and `!` re-includes.
function ignores(ignoreFile: string, name: string): boolean {
  let ignored = false;
  for (const line of readFileSync(ignoreFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const negated = line.startsWith('!');
    if (new Bun.Glob(negated ? line.slice(1) : line).match(name)) {
      ignored = !negated;
    }
  }
  return ignored;
}

describe.each(TEMPLATES.map((t) => [t.id, join(REPO_ROOT, parseTemplateSource(t.source).subdir)]))('template %s', (_id, dir) => {
  const dockerfile = join(dir, 'Dockerfile');

  test('.gitignore keeps .env files out of git', () => {
    for (const name of ENV_FILES) {
      expect(`${name}: ${ignores(join(dir, '.gitignore'), name)}`).toBe(`${name}: true`);
    }
    expect(ignores(join(dir, '.gitignore'), '.env.example')).toBe(false);
  });

  test.if(existsSync(dockerfile))('.dockerignore keeps .env files out of the image', () => {
    for (const name of ENV_FILES) {
      expect(`${name}: ${ignores(join(dir, '.dockerignore'), name)}`).toBe(`${name}: true`);
    }
  });

  test.if(existsSync(dockerfile))('Dockerfile runs the app as a non-root user', () => {
    const users = [...readFileSync(dockerfile, 'utf8').matchAll(/^USER\s+(\S+)/gm)].map((m) => m[1]);
    expect(users.at(-1)).toBeDefined();
    expect(['root', '0']).not.toContain(users.at(-1)!.split(':')[0]!);
  });
});
