import { describe, expect, test } from 'bun:test';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import { collectHeadings, type HastNode, type MdsvexRehypePlugin } from './markdown';
import type { TocEntry } from './toc';

// Mirrors parseDoc in docs.ts: run the same mdsvex + rehype pipeline the docs build with,
// then extract the first heading the nav/TOC render.
async function firstHeading(markdown: string): Promise<TocEntry> {
  let toc: TocEntry[] = [];
  const capture = () => (tree: HastNode) => {
    toc = collectHeadings(tree);
  };
  await mdsvexCompile(markdown, {
    extensions: ['.md', '.svx'],
    rehypePlugins: [rehypeSlug as unknown as MdsvexRehypePlugin, capture as unknown as MdsvexRehypePlugin],
    highlight: false,
  });
  const [h] = toc;
  if (!h) {
    throw new Error('no headings extracted');
  }
  return h;
}

describe('collectHeadings', () => {
  test('decodes angle brackets escaped inside code spans', async () => {
    const h = await firstHeading('### Component-scoped `<style>` blocks\n');
    expect(h.text).toBe('Component-scoped <style> blocks');
    expect(h.text).not.toContain('&lt;');
    expect(h.text).not.toContain('&gt;');
  });

  test('decodes braces escaped inside code spans (numeric entities)', async () => {
    const h = await firstHeading('### The `{@html}` directive\n');
    expect(h.text).toBe('The {@html} directive');
    expect(h.text).not.toContain('&#123;');
  });

  test('leaves plain headings untouched', async () => {
    const h = await firstHeading('## Getting started\n');
    expect(h.text).toBe('Getting started');
  });

  test('preserves a bare ampersand in prose', async () => {
    const h = await firstHeading('## Docs & demos\n');
    expect(h.text).toBe('Docs & demos');
  });

  test('decodes the display text but leaves the slug matching the page anchor', async () => {
    const h = await firstHeading('### Component-scoped `<style>` blocks\n');
    expect(h.level).toBe(3);
    // The slug comes from rehype-slug run on the still-encoded tree, so it must be left
    // as-is to keep matching the id on the rendered heading — only the text is decoded.
    expect(h.slug).toBe('component-scoped-ltstylegt-blocks');
  });
});
