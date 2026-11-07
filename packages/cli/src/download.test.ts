import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractTemplate, parseTemplateSource, tarballUrl } from './download.ts';

describe('parseTemplateSource', () => {
  test('splits owner, repo and subdir, defaulting the ref to HEAD', () => {
    expect(parseTemplateSource('khromov/mochi/packages/minimal')).toEqual({
      owner: 'khromov',
      repo: 'mochi',
      subdir: 'packages/minimal',
      ref: 'HEAD',
    });
  });

  test('reads an explicit ref after #', () => {
    expect(parseTemplateSource('khromov/mochi/packages/demos#v1.2.3')).toMatchObject({ subdir: 'packages/demos', ref: 'v1.2.3' });
  });

  test('rejects a source without a subdir', () => {
    expect(() => parseTemplateSource('khromov/mochi')).toThrow('expected "<owner>/<repo>/<subdir>"');
  });
});

test('tarballUrl targets codeload at the requested ref', () => {
  expect(tarballUrl(parseTemplateSource('khromov/mochi/packages/minimal'))).toBe('https://codeload.github.com/khromov/mochi/tar.gz/HEAD');
});

describe('extractTemplate', () => {
  // GitHub wraps the repo in a `<repo>-<ref>/` directory; the template lives under it.
  const fixture = (root = 'mochi-HEAD') =>
    new Bun.Archive(
      {
        [`${root}/packages/minimal/package.json`]: '{"name":"mochi-minimal"}',
        [`${root}/packages/minimal/src/index.ts`]: 'export const port = 3333;',
        [`${root}/packages/minimal/.gitignore`]: '.mochi\n',
        [`${root}/packages/demos/package.json`]: '{"name":"mochi-demos"}',
        [`${root}/README.md`]: '# repo root',
      },
      { compress: 'gzip' },
    );

  const withTempDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-download-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('strips the wrapper and subdir so the template lands at the root of dir', async () => {
    await withTempDir(async (dir) => {
      const written = await extractTemplate(await fixture().bytes(), parseTemplateSource('khromov/mochi/packages/minimal'), dir);

      expect(written).toBe(3);
      expect((await readdir(dir)).sort()).toEqual(['.gitignore', 'package.json', 'src']);
      expect(await readFile(path.join(dir, 'package.json'), 'utf8')).toBe('{"name":"mochi-minimal"}');
      expect(await readFile(path.join(dir, 'src', 'index.ts'), 'utf8')).toBe('export const port = 3333;');
    });
  });

  test('takes only the requested subdir, not its siblings or the repo root', async () => {
    await withTempDir(async (dir) => {
      await extractTemplate(await fixture().bytes(), parseTemplateSource('khromov/mochi/packages/minimal'), dir);

      const entries = await readdir(dir);
      expect(entries).not.toContain('README.md');
      expect(entries).not.toContain('packages');
    });
  });

  // GitHub names the wrapper after the ref, and a short sha does not round-trip to the requested string, so the
  // prefix has to be read off the archive rather than reconstructed.
  test('handles a wrapper directory named after a commit sha', async () => {
    await withTempDir(async (dir) => {
      const written = await extractTemplate(await fixture('mochi-e76579b').bytes(), parseTemplateSource('khromov/mochi/packages/minimal#e76579b'), dir);

      expect(written).toBe(3);
      expect(await readFile(path.join(dir, 'package.json'), 'utf8')).toBe('{"name":"mochi-minimal"}');
    });
  });

  test('reports a template that matches nothing rather than writing an empty directory', async () => {
    await withTempDir(async (dir) => {
      await expect(extractTemplate(await fixture().bytes(), parseTemplateSource('khromov/mochi/packages/nope'), dir)).rejects.toThrow('is empty or missing');
    });
  });
});
