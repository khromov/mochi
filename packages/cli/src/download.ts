import fs from 'node:fs/promises';
import path from 'node:path';

/** A template's `<owner>/<repo>/<subdir>` URI, optionally suffixed with `#<ref>`. */
export interface TemplateSource {
  owner: string;
  repo: string;
  /** Path inside the repo, forward-slashed, no leading or trailing slash. */
  subdir: string;
  /** Branch, tag, or commit. `HEAD` (the default) resolves to the repo's default branch. */
  ref: string;
}

export function parseTemplateSource(source: string): TemplateSource {
  const [pathPart = '', ref = 'HEAD'] = source.split('#');
  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length < 3) {
    throw new Error(`Invalid template source "${source}": expected "<owner>/<repo>/<subdir>", optionally with "#<ref>".`);
  }
  const [owner, repo, ...rest] = segments;
  return { owner: owner!, repo: repo!, subdir: rest.join('/'), ref };
}

/** codeload, not `api.github.com/…/tarball`: no auth, no per-IP rate limit, ~25x faster here. */
export function tarballUrl({ owner, repo, ref }: TemplateSource): string {
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
}

/**
 * Extract the repo subdirectory from an in-memory tarball into `dir`, stripping GitHub's `<repo>-<ref>/` wrapper.
 * The wrapper is read off the archive, not predicted — a short sha doesn't round-trip to the requested ref.
 */
export async function extractTemplate(tarball: Blob | Uint8Array, source: TemplateSource, dir: string): Promise<number> {
  const files = await new Bun.Archive(tarball).files(`*/${source.subdir}/**`);
  if (files.size === 0) {
    throw new Error(`Template "${source.owner}/${source.repo}/${source.subdir}" is empty or missing at ref "${source.ref}".`);
  }
  let written = 0;
  for (const [entry, file] of files) {
    const root = entry.slice(0, entry.indexOf('/'));
    const relative = entry.slice(`${root}/${source.subdir}/`.length);
    await Bun.write(path.join(dir, relative), file);
    written++;
  }
  return written;
}

export async function downloadTemplate(source: string, opts: { dir: string; force?: boolean }): Promise<void> {
  const parsed = parseTemplateSource(source);
  if (!opts.force) {
    const existing = await fs.readdir(opts.dir).catch(() => [] as string[]);
    if (existing.length > 0) {
      throw new Error(`${opts.dir} is not empty. Pass --force to overwrite conflicting files.`);
    }
  }
  const url = tarballUrl(parsed);
  const response = await fetch(url, { headers: { 'User-Agent': 'create-mochi' } });
  if (!response.ok) {
    throw new Error(`Could not download template from ${url} — HTTP ${response.status}.`);
  }
  await extractTemplate(await response.blob(), parsed, opts.dir);
}
