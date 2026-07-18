import { existsSync } from 'node:fs';
import path from 'node:path';
import { compile as mdsvexCompile } from 'mdsvex';
import { logger, trailingSlashIt } from 'mochi-framework';
import rehypeSlug from 'rehype-slug';
import { SITE_ROOT } from './siteRoot';
import { loadPosts } from './blog';
import { demos, type Demo } from './demos';
import { isDemoIndex, stripTopLevelBlock, type SourceSpec } from '../components/utils.ts';
import type { TocEntry } from './toc';

type MdsvexRehypePlugin = NonNullable<NonNullable<Parameters<typeof mdsvexCompile>[1]>['rehypePlugins']>[number];

export const DOCS_DIR = path.resolve(SITE_ROOT, '../docs');
// Internal demos are keyed by their folder name (`slug`) and carry their own `files`
// list — the single source of truth shared by the demo page, the per-demo llms.txt
// route, and the /llms-full.txt bundle.
type InternalDemo = Demo & { slug: string; files: SourceSpec[] };
// `demos` is a static module import, so the filtered list never changes at
// runtime — compute it once and reuse it across every llms.txt/json request.
let cachedInternalDemos: InternalDemo[] | null = null;
function internalDemos(): InternalDemo[] {
  return (cachedInternalDemos ??= demos.filter((d): d is InternalDemo => d.href.startsWith('/') && !!d.slug && !!d.files));
}
function filesForDemo(slug: string): SourceSpec[] | undefined {
  return internalDemos().find((d) => d.slug === slug)?.files;
}

/** Parses the leading numeric prefix of a filename (e.g. `"01-intro.md"` → `1`). */
function leadingFileNumber(filename: string, fallback = Number.NaN): number {
  const digits = /^(\d+)-/.exec(filename)?.[1];
  return digits === undefined ? fallback : Number.parseInt(digits, 10);
}

export interface DocMetadata {
  title: string;
  slug: string;
  description?: string;
  order?: number;
}

export interface DocEntry {
  slug: string;
  title: string;
  description?: string;
  order: number;
  filename: string;
  toc: TocEntry[];
  raw: string;
}

let cachedDocs: DocEntry[] | null = null;
let cachedBySlug: Map<string, DocEntry> | null = null;
let cachedNav: TocEntry[] | null = null;
let cachedLlmsRecommendedTxt: string | null = null;
let cachedLlmsFullTxt: string | null = null;
let cachedSitemapXml: string | null = null;
const cachedDemoLlmsTxt = new Map<string, string | null>();

export function clearDocsCaches(): void {
  cachedDocs = null;
  cachedBySlug = null;
  cachedNav = null;
  cachedLlmsRecommendedTxt = null;
  cachedLlmsFullTxt = null;
  cachedSitemapXml = null;
  cachedDemoLlmsTxt.clear();
}

export async function loadDocs(): Promise<DocEntry[]> {
  if (cachedDocs) {
    return cachedDocs;
  }

  const glob = new Bun.Glob('*.md');
  const filenames: string[] = [];
  for await (const file of glob.scan(DOCS_DIR)) {
    filenames.push(file);
  }

  filenames.sort((a, b) => {
    const na = leadingFileNumber(a);
    const nb = leadingFileNumber(b);
    // Only let the numeric prefix decide when the two numbers differ. Two docs
    // sharing a prefix must fall back to a total order, else stable-sort
    // preserves Bun.Glob.scan's filesystem order, which differs between the
    // image-build and runtime container filesystems and makes the generated
    // docs barrel non-reproducible.
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
      return na - nb;
    }
    return a.localeCompare(b);
  });

  const entries: DocEntry[] = [];
  for (const filename of filenames) {
    const abs = path.join(DOCS_DIR, filename);
    const raw = await Bun.file(abs).text();
    const { metadata, toc } = await parseDoc(raw);

    if (!metadata.slug) {
      throw new Error(`Doc "${filename}" is missing required frontmatter field: slug`);
    }
    if (!metadata.title) {
      throw new Error(`Doc "${filename}" is missing required frontmatter field: title`);
    }
    const { slug, title } = metadata;
    const order = typeof metadata.order === 'number' ? metadata.order : leadingFileNumber(filename, 0);

    entries.push({
      slug,
      title,
      description: metadata.description,
      order,
      filename,
      toc,
      raw,
    });
  }

  cachedDocs = entries;
  cachedBySlug = new Map(entries.map((e) => [e.slug, e]));
  return entries;
}

export async function getDoc(slug: string): Promise<DocEntry | null> {
  if (!cachedBySlug) {
    await loadDocs();
  }
  return cachedBySlug?.get(slug) ?? null;
}

export interface DocNeighbor {
  slug: string;
  title: string;
}

export async function getDocNeighbors(slug: string): Promise<{ prev: DocNeighbor | null; next: DocNeighbor | null }> {
  const docs = await loadDocs();
  const i = docs.findIndex((d) => d.slug === slug);
  if (i === -1) {
    return { prev: null, next: null };
  }
  const toNeighbor = (d: DocEntry): DocNeighbor => ({ slug: d.slug, title: d.title });
  const prevDoc = docs[i - 1];
  const nextDoc = docs[i + 1];
  return {
    prev: prevDoc ? toNeighbor(prevDoc) : null,
    next: nextDoc ? toNeighbor(nextDoc) : null,
  };
}

export async function buildDocsNav(): Promise<TocEntry[]> {
  if (cachedNav) {
    return cachedNav;
  }
  const docs = await loadDocs();
  const entries: TocEntry[] = [];
  for (const doc of docs) {
    entries.push({ level: 2, text: doc.title, slug: doc.slug });
    for (const sub of doc.toc) {
      if (sub.level === 3) {
        entries.push({
          level: 3,
          text: sub.text,
          slug: `${doc.slug}#${sub.slug}`,
        });
      }
    }
  }
  cachedNav = entries;
  return entries;
}

async function buildDemosTxt(stripStyles = false): Promise<string> {
  const slugs = internalDemos()
    .map((d) => d.slug)
    .sort();
  const parts: string[] = ['# Demo Source Files\n'];
  for (const slug of slugs) {
    // The cached getDemoLlmsTxt serves the per-demo route (styles intact); the
    // /llms-full.txt bundle wants them stripped, so build that variant directly.
    const section = stripStyles ? await buildDemoLlmsTxt(slug, true) : await getDemoLlmsTxt(slug);
    if (section !== null) {
      parts.push(section);
    }
  }
  return parts.join('\n');
}

// Per-demo source bundle built from the demo's declared `files` list — the same list
// the demo page renders via loadSources — so cross-folder files (e.g. shared stores,
// the demoIndex.ts example) are included, not just files in the demo folder.
export async function getDemoLlmsTxt(slug: string): Promise<string | null> {
  if (cachedDemoLlmsTxt.has(slug)) {
    return cachedDemoLlmsTxt.get(slug)!;
  }
  const result = await buildDemoLlmsTxt(slug);
  // Source files never change at runtime, so cache the rendered bundle (including
  // the null "no such demo" result) to avoid re-reading every file on each request.
  cachedDemoLlmsTxt.set(slug, result);
  return result;
}

async function buildDemoLlmsTxt(slug: string, stripStyles = false): Promise<string | null> {
  const specs = filesForDemo(slug);
  if (!specs || specs.length === 0) {
    return null;
  }
  const parts: string[] = [`## Demo: ${slug}\n`];
  for (const { label, path: rel, lang, showImageConfig, showLocalDirs } of specs) {
    const abs = path.resolve(SITE_ROOT, rel);
    if (!existsSync(abs)) {
      // A declared source file that isn't on disk is almost always a typo'd path
      // in the demo's files.ts — surface it instead of silently dropping the file.
      logger.warn(`[llms] demo '${slug}': source file not found, skipping: ${rel}`);
      continue;
    }
    let content = (await Bun.file(abs).text()).trimEnd();
    if (isDemoIndex(rel) && !showImageConfig) {
      content = stripTopLevelBlock(content, /^\s*image:\s*\{/).trimEnd();
    }
    if (isDemoIndex(rel) && !showLocalDirs) {
      content = stripTopLevelBlock(content, /^\s*localDirs:\s*\{/).trimEnd();
    }
    const fence = lang ?? (label.endsWith('.svelte') ? 'svelte' : 'ts');
    // Strip <style> blocks only from Svelte-fenced sources — never from .ts, where a
    // literal "<style>" would just be code/text, not markup to elide.
    if (stripStyles && fence === 'svelte') {
      content = stripSvelteStyleBlocks(content);
    }
    parts.push(`### ${label}\n\`\`\`${fence}\n${content}\n\`\`\`\n`);
  }
  if (parts.length === 1) {
    return null;
  }
  return parts.join('\n').trimEnd() + '\n';
}

export async function buildLlmsRecommendedTxt(): Promise<string> {
  if (cachedLlmsRecommendedTxt) {
    return cachedLlmsRecommendedTxt;
  }
  const docs = await loadDocs();
  cachedLlmsRecommendedTxt = docs.map((d) => d.raw.trimEnd()).join('\n\n') + '\n';
  return cachedLlmsRecommendedTxt;
}

// Component <style> blocks in demo source are presentation noise for an LLM
// consuming /llms-full.txt — replace each with an empty placeholder so the
// component still reads as complete, without shipping the CSS.
const SVELTE_STYLE_BLOCK_RE = /<style\b[^>]*>[\s\S]*?<\/style>/g;
function stripSvelteStyleBlocks(text: string): string {
  return text.replace(SVELTE_STYLE_BLOCK_RE, '<style>\n  /* Styles omitted */\n</style>');
}

export async function buildLlmsFullTxt(): Promise<string> {
  if (cachedLlmsFullTxt) {
    return cachedLlmsFullTxt;
  }
  const [docs, demos] = await Promise.all([loadDocs(), buildDemosTxt(true)]);
  cachedLlmsFullTxt = docs.map((d) => d.raw.trimEnd()).join('\n\n') + '\n\n' + demos;
  return cachedLlmsFullTxt;
}

const SITE_BASE = 'https://mochi.fast';

export async function buildSitemapXml(): Promise<string> {
  if (cachedSitemapXml) {
    return cachedSitemapXml;
  }
  const docs = await loadDocs();
  // Published posts only — loadPosts() without includeDrafts never exposes drafts.
  const posts = await loadPosts();
  const internalDemos = demos.filter((d) => d.href.startsWith('/'));

  const urls: string[] = [
    `  <url><loc>${SITE_BASE}/</loc></url>`,
    ...docs.map((d) => `  <url><loc>${SITE_BASE}/docs/${d.slug}/</loc></url>`),
    `  <url><loc>${SITE_BASE}/blog/</loc></url>`,
    ...posts.map((p) => `  <url><loc>${SITE_BASE}/blog/${p.slug}/</loc></url>`),
    // Demo hrefs already carry a trailing slash; trailingSlashIt normalizes to
    // exactly one rather than appending unconditionally (which produced `…/request-id//`).
    ...internalDemos.map((d) => `  <url><loc>${trailingSlashIt(`${SITE_BASE}${d.href}`)}</loc></url>`),
  ];

  cachedSitemapXml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n');
  return cachedSitemapXml;
}

export async function getDocLlmsTxt(slug: string): Promise<string | null> {
  const doc = await getDoc(slug);
  return doc ? doc.raw.trimEnd() + '\n' : null;
}

export interface LlmsIndexEntry {
  title: string;
  description: string;
  url: string;
}

/** The plain-text source URL for a demo, derived from its page href (which ends in '/'). */
function demoLlmsPath(href: string): string {
  return href.endsWith('/') ? `${href}llms.txt` : `${href}/llms.txt`;
}

export interface DemoLlmsRoute {
  /** Route path, sitting alongside the demo page (e.g. /demos/chat/llms.txt, /cookie-vary-test/llms.txt). */
  path: string;
  /** Demo folder name (the demo's `slug`) used to look up its source. */
  slug: string;
}

/**
 * Demos with local source, each as the static llms.txt route to register and the
 * `slug` (folder name) behind it. The route is static (not a param) so it outranks
 * demo param routes like /demos/data-loading/:id, and its path tracks the demo's own
 * page href so source and page share a prefix.
 */
export function internalDemoLlmsRoutes(): DemoLlmsRoute[] {
  return internalDemos().map((d) => ({ path: demoLlmsPath(d.href), slug: d.slug }));
}

export interface SectionIndexEntry {
  type: 'doc' | 'demo';
  slug: string;
  title: string;
  description: string;
}

export async function buildSectionIndex(): Promise<SectionIndexEntry[]> {
  const docList = await loadDocs();
  const docs: SectionIndexEntry[] = docList.map((d) => ({
    type: 'doc',
    slug: d.slug,
    title: d.title,
    description: d.description ?? '',
  }));
  const demoEntries: SectionIndexEntry[] = internalDemos().map((d) => ({ type: 'demo', slug: d.slug, title: d.title, description: d.hook }));
  return [...docs, ...demoEntries];
}

export async function buildLlmsJson(origin: string): Promise<{ docs: LlmsIndexEntry[]; demos: LlmsIndexEntry[] }> {
  const docList = await loadDocs();
  const docs: LlmsIndexEntry[] = docList.map((d) => ({
    title: d.title,
    description: d.description ?? '',
    url: `${origin}/docs/${d.slug}/llms.txt`,
  }));
  const demoEntries: LlmsIndexEntry[] = internalDemos().map((d) => ({ title: d.title, description: d.hook, url: `${origin}${demoLlmsPath(d.href)}` }));
  return { docs, demos: demoEntries };
}

const SITE_NAME = 'Mochi';
const SITE_SUMMARY = 'Mochi is an SSR-first framework for Svelte 5 on Bun with islands-based selective hydration.';

// Standard llms.txt index: title + summary + linked sections, rendered from the same
// data as /llms.json. Per-request (origin-dependent), so not cached.
export async function buildLlmsIndexTxt(origin: string): Promise<string> {
  const { docs, demos } = await buildLlmsJson(origin);
  const link = (e: LlmsIndexEntry) => `- [${e.title}](${e.url}): ${e.description}`;
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_SUMMARY}`,
    '',
    '## Docs',
    '',
    ...docs.map(link),
    '',
    '## Examples',
    '',
    ...demos.map(link),
    '',
    '## Optional',
    '',
    `- [All docs concatenated](${origin}/llms-recommended.txt): The full documentation in reading order.`,
    `- [Docs + every demo's source](${origin}/llms-full.txt): Everything, for maximum context.`,
    '',
  ];
  return lines.join('\n');
}

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function hastText(node: HastNode): string {
  if (node.type === 'text') {
    return node.value ?? '';
  }
  if (!node.children) {
    return '';
  }
  return node.children.map(hastText).join('');
}

async function parseDoc(markdown: string): Promise<{
  metadata: Partial<DocMetadata>;
  toc: TocEntry[];
}> {
  const toc: TocEntry[] = [];
  const capture = () => (tree: HastNode) => {
    for (const node of tree.children ?? []) {
      if (node.type !== 'element' || !node.tagName) {
        continue;
      }
      const match = /^h([1-6])$/.exec(node.tagName);
      if (!match) {
        continue;
      }
      toc.push({
        level: Number(match[1]),
        text: hastText(node),
        slug: String(node.properties?.id ?? ''),
      });
    }
  };
  const result = await mdsvexCompile(markdown, {
    extensions: ['.md', '.svx'],
    rehypePlugins: [rehypeSlug as unknown as MdsvexRehypePlugin, capture],
    highlight: false,
  });
  const metadata = (result?.data?.fm ?? {}) as Partial<DocMetadata>;
  return { metadata, toc };
}
