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

/**
 * codeload rather than `api.github.com/repos/…/tarball`: it needs no authentication, is not rate-limited per IP, and
 * measured ~25x faster on this repo. `HEAD` resolves to the default branch.
 */
export function tarballUrl({ owner, repo, ref }: TemplateSource): string {
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
}

/**
 * Write a repo subdirectory out of an in-memory tarball, stripping GitHub's `<repo>-<ref>/` wrapper and the subdir
 * prefix so the template lands at the root of `dir`. Returns the number of files written.
 *
 * The wrapper name is read off the archive rather than predicted: GitHub derives it from the ref, and a short commit
 * sha does not round-trip to the string that was requested.
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

/** Fetch a template from GitHub and write it into `dir`. */
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
