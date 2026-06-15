import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import { demos } from './demos';
import { demoFiles } from './demoFiles';
import type { TocEntry } from './toc';

type MdsvexRehypePlugin = NonNullable<NonNullable<Parameters<typeof mdsvexCompile>[1]>['rehypePlugins']>[number];

export const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');
const DEMOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demos');
// Demo source paths in demoFiles are written relative to the site package root (e.g. './src/...').
const SITE_ROOT = path.resolve(DEMOS_DIR, '../..');

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

export function clearDocsCaches(): void {
  cachedDocs = null;
  cachedBySlug = null;
  cachedNav = null;
  cachedLlmsRecommendedTxt = null;
  cachedLlmsFullTxt = null;
  cachedSitemapXml = null;
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
    if (Number.isFinite(na) && Number.isFinite(nb)) {
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

async function buildDemosTxt(): Promise<string> {
  const slugs = Object.keys(demoFiles).sort();
  const parts: string[] = ['# Demo Source Files\n'];
  for (const slug of slugs) {
    const section = await getDemoLlmsTxt(slug);
    if (section !== null) {
      parts.push(section);
    }
  }
  return parts.join('\n');
}

// Per-demo source bundle built from the demo's declared file list (demoFiles) — the
// same list the demo page renders via loadSources — so cross-folder files (e.g. shared
// stores, the demoIndex.ts example) are included, not just files in the demo folder.
export async function getDemoLlmsTxt(slug: string): Promise<string | null> {
  const specs = demoFiles[slug];
  if (!specs || specs.length === 0) {
    return null;
  }
  const parts: string[] = [`## Demo: ${slug}\n`];
  for (const { label, path: rel, lang } of specs) {
    const abs = path.resolve(SITE_ROOT, rel);
    if (!existsSync(abs)) {
      continue;
    }
    const content = await Bun.file(abs).text();
    const fence = lang ?? (label.endsWith('.svelte') ? 'svelte' : 'ts');
    parts.push(`### ${label}\n\`\`\`${fence}\n${content.trimEnd()}\n\`\`\`\n`);
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

export async function buildLlmsFullTxt(): Promise<string> {
  if (cachedLlmsFullTxt) {
    return cachedLlmsFullTxt;
  }
  const [docs, demos] = await Promise.all([loadDocs(), buildDemosTxt()]);
  cachedLlmsFullTxt = docs.map((d) => d.raw.trimEnd()).join('\n\n') + '\n\n' + demos;
  return cachedLlmsFullTxt;
}

const SITE_BASE = 'https://mochi.fast';

export async function buildSitemapXml(): Promise<string> {
  if (cachedSitemapXml) {
    return cachedSitemapXml;
  }
  const docs = await loadDocs();
  const internalDemos = demos.filter((d) => d.href.startsWith('/'));

  const urls: string[] = [
    `  <url><loc>${SITE_BASE}/</loc></url>`,
    ...docs.map((d) => `  <url><loc>${SITE_BASE}/docs/${d.slug}/</loc></url>`),
    ...internalDemos.map((d) => `  <url><loc>${SITE_BASE}${d.href}/</loc></url>`),
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

function lastSegment(href: string): string {
  const segs = href.split('/').filter(Boolean);
  return segs[segs.length - 1] ?? '';
}

/** The plain-text source URL for a demo, derived from its page href (which ends in '/'). */
function demoLlmsPath(href: string): string {
  return href.endsWith('/') ? `${href}llms.txt` : `${href}/llms.txt`;
}

export interface DemoLlmsRoute {
  /** Route path, sitting alongside the demo page (e.g. /demos/chat/llms.txt, /cookie-vary-test/llms.txt). */
  path: string;
  /** demoFiles registry key (the demo folder name) used to look up the source. */
  slug: string;
}

/**
 * Demos with local source (internal hrefs), each as the static llms.txt route to
 * register and the demoFiles key behind it. The route is static (not a param) so it
 * outranks demo param routes like /demos/data-loading/:id, and its path tracks the
 * demo's own page href so source and page share a prefix.
 */
export function internalDemoLlmsRoutes(): DemoLlmsRoute[] {
  return demos.filter((d) => d.href.startsWith('/')).map((d) => ({ path: demoLlmsPath(d.href), slug: lastSegment(d.href) }));
}

export async function buildLlmsJson(origin: string): Promise<{ docs: LlmsIndexEntry[]; demos: LlmsIndexEntry[] }> {
  const docList = await loadDocs();
  const docs: LlmsIndexEntry[] = docList.map((d) => ({
    title: d.title,
    description: d.description ?? '',
    url: `${origin}/docs/${d.slug}/llms.txt`,
  }));
  const demoEntries: LlmsIndexEntry[] = demos.filter((d) => d.href.startsWith('/')).map((d) => ({ title: d.title, description: d.hook, url: `${origin}${demoLlmsPath(d.href)}` }));
  return { docs, demos: demoEntries };
}

const SITE_NAME = 'Mochi';

// Standard llms.txt index: title + summary + linked sections, rendered from the same
// data as /llms.json. Per-request (origin-dependent), so not cached.
export async function buildLlmsIndexTxt(origin: string): Promise<string> {
  const { docs, demos } = await buildLlmsJson(origin);
  const summary = docs[0]?.description || 'An SSR framework for Svelte 5 on Bun with islands-based selective hydration.';
  const link = (e: LlmsIndexEntry) => `- [${e.title}](${e.url}): ${e.description}`;
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${summary}`,
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
