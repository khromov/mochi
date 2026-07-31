import { existsSync } from 'node:fs';
import path from 'node:path';
import { compile as mdsvexCompile } from 'mdsvex';
import { logger, trailingSlashIt } from 'mochi-framework';
import rehypeSlug from 'rehype-slug';
import { SITE_ROOT } from './siteRoot';
import { loadPosts, getPost } from './blog';
import { CHANGELOG_SLUG, CHANGELOG_TITLE, CHANGELOG_DESCRIPTION, getChangelogTxt } from './changelog';
import { demos, type Demo } from './demos';
import { isDemoIndex, stripImageConfig, type SourceSpec } from '../components/utils.ts';
import { collectHeadings, type HastNode, type MdsvexRehypePlugin } from './markdown';
import type { TocEntry } from './toc';

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

// Parses the leading numeric prefix of a filename (e.g. `"01-intro.md"` → `1`).
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
// Only the docs + demos + posts portion is a forever memo. The changelog block is
// concatenated per request (getChangelogTxt is itself cached) so its 4h TTL isn't
// frozen into this module-level string.
let cachedLlmsFullBaseTxt: string | null = null;
let cachedSitemapXml: string | null = null;
const cachedDemoLlmsTxt = new Map<string, string | null>();

export function clearDocsCaches(): void {
  cachedDocs = null;
  cachedBySlug = null;
  cachedNav = null;
  cachedLlmsRecommendedTxt = null;
  cachedLlmsFullBaseTxt = null;
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
    // Numeric prefix decides order only when it differs; ties need a total order too, since
    // Bun.Glob.scan's filesystem order differs between the image-build and runtime containers,
    // which would make the generated docs barrel non-reproducible.
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
  for (const { label, path: rel, lang, showImageConfig } of specs) {
    const abs = path.resolve(SITE_ROOT, rel);
    if (!existsSync(abs)) {
      // A declared source file that isn't on disk is almost always a typo'd path
      // in the demo's files.ts — surface it instead of silently dropping the file.
      logger.warn(`[llms] demo '${slug}': source file not found, skipping: ${rel}`);
      continue;
    }
    let content = (await Bun.file(abs).text()).trimEnd();
    if (isDemoIndex(rel) && !showImageConfig) {
      content = stripImageConfig(content).trimEnd();
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

async function buildBlogPostsTxt(): Promise<string> {
  // Published posts only, newest first (loadPosts() already sorts and hides drafts).
  const posts = await loadPosts();
  const parts: string[] = ['# Blog Posts\n'];
  for (const post of posts) {
    parts.push(post.raw.trimEnd());
  }
  return parts.join('\n\n');
}

export async function buildLlmsFullTxt(): Promise<string> {
  if (!cachedLlmsFullBaseTxt) {
    const [docs, demos, posts] = await Promise.all([loadDocs(), buildDemosTxt(true), buildBlogPostsTxt()]);
    cachedLlmsFullBaseTxt = docs.map((d) => d.raw.trimEnd()).join('\n\n') + '\n\n' + demos + '\n\n' + posts;
  }
  // The changelog is fetched (and cached) separately; concatenate it per request so its own
  // 4h TTL isn't frozen into the forever memo, and omit the block on a fetch miss.
  const changelog = await getChangelogTxt();
  if (changelog === null) {
    return cachedLlmsFullBaseTxt;
  }
  return `${cachedLlmsFullBaseTxt}\n\n# Changelog\n\n${changelog.trimEnd()}\n`;
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
    `  <url><loc>${SITE_BASE}/docs/${CHANGELOG_SLUG}/</loc></url>`,
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
  // The changelog is a synthetic doc — not in loadDocs() — fetched from GitHub.
  if (slug === CHANGELOG_SLUG) {
    return getChangelogTxt();
  }
  const doc = await getDoc(slug);
  return doc ? doc.raw.trimEnd() + '\n' : null;
}

// Serves a published blog post's raw markdown (frontmatter and any <script>
// component imports intact, matching getDocLlmsTxt). Drafts stay hidden.
export async function getPostLlmsTxt(slug: string): Promise<string | null> {
  const post = await getPost(slug);
  return post ? post.raw.trimEnd() + '\n' : null;
}

export interface LlmsIndexEntry {
  title: string;
  description: string;
  url: string;
}

// The plain-text source URL for a demo, derived from its page href (which ends in '/').
function demoLlmsPath(href: string): string {
  return href.endsWith('/') ? `${href}llms.txt` : `${href}/llms.txt`;
}

export interface DemoLlmsRoute {
  path: string;
  slug: string;
}

/** Static llms.txt routes for demos with local source, one per `slug` — static (not a param) so it outranks demo param routes like `/demos/data-loading/:id`, and its path tracks the demo's own page href. */
export function internalDemoLlmsRoutes(): DemoLlmsRoute[] {
  return internalDemos().map((d) => ({ path: demoLlmsPath(d.href), slug: d.slug }));
}

export interface SectionIndexEntry {
  type: 'doc' | 'demo' | 'post';
  slug: string;
  title: string;
  description: string;
}

// Prefix a post's description with its date so an agent can judge recency;
// `description` is optional, so fall back to the date alone.
function postSectionDescription(date: string, description?: string): string {
  return description ? `${date} — ${description}` : date;
}

export async function buildSectionIndex(): Promise<SectionIndexEntry[]> {
  const [docList, posts] = await Promise.all([loadDocs(), loadPosts()]);
  const docs: SectionIndexEntry[] = docList.map((d) => ({
    type: 'doc',
    slug: d.slug,
    title: d.title,
    description: d.description ?? '',
  }));
  // The synthetic changelog rounds out the docs — addressed as a doc so
  // get_section({ type: 'doc', slug: 'changelog' }) resolves it.
  docs.push({ type: 'doc', slug: CHANGELOG_SLUG, title: CHANGELOG_TITLE, description: CHANGELOG_DESCRIPTION });
  const postEntries: SectionIndexEntry[] = posts.map((p) => ({
    type: 'post',
    slug: p.slug,
    title: p.title,
    description: postSectionDescription(p.date, p.description),
  }));
  const demoEntries: SectionIndexEntry[] = internalDemos().map((d) => ({ type: 'demo', slug: d.slug, title: d.title, description: d.hook }));
  return [...docs, ...postEntries, ...demoEntries];
}

export async function buildLlmsJson(origin: string): Promise<{ docs: LlmsIndexEntry[]; posts: LlmsIndexEntry[]; demos: LlmsIndexEntry[] }> {
  const [docList, posts] = await Promise.all([loadDocs(), loadPosts()]);
  const docs: LlmsIndexEntry[] = docList.map((d) => ({
    title: d.title,
    description: d.description ?? '',
    url: `${origin}/docs/${d.slug}/llms.txt`,
  }));
  docs.push({ title: CHANGELOG_TITLE, description: CHANGELOG_DESCRIPTION, url: `${origin}/docs/${CHANGELOG_SLUG}/llms.txt` });
  const postEntries: LlmsIndexEntry[] = posts.map((p) => ({
    title: p.title,
    description: postSectionDescription(p.date, p.description),
    url: `${origin}/blog/${p.slug}/llms.txt`,
  }));
  const demoEntries: LlmsIndexEntry[] = internalDemos().map((d) => ({ title: d.title, description: d.hook, url: `${origin}${demoLlmsPath(d.href)}` }));
  return { docs, posts: postEntries, demos: demoEntries };
}

const SITE_NAME = 'Mochi';
const SITE_SUMMARY = 'Mochi is an SSR-first framework for Svelte 5 on Bun with islands-based selective hydration.';

// Standard llms.txt index (title + summary + linked sections) rendered from the same data
// as /llms.json; per-request since it's origin-dependent, so not cached.
export async function buildLlmsIndexTxt(origin: string): Promise<string> {
  const { docs, posts, demos } = await buildLlmsJson(origin);
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
    '## Blog',
    '',
    ...posts.map(link),
    '',
    '## Optional',
    '',
    `- [All docs concatenated](${origin}/llms-recommended.txt): The full documentation in reading order.`,
    `- [Docs + every demo's source](${origin}/llms-full.txt): Everything, for maximum context.`,
    '',
  ];
  return lines.join('\n');
}

async function parseDoc(markdown: string): Promise<{
  metadata: Partial<DocMetadata>;
  toc: TocEntry[];
}> {
  let toc: TocEntry[] = [];
  const capture = () => (tree: HastNode) => {
    toc = collectHeadings(tree);
  };
  const result = await mdsvexCompile(markdown, {
    extensions: ['.md', '.svx'],
    rehypePlugins: [rehypeSlug as unknown as MdsvexRehypePlugin, capture],
    highlight: false,
  });
  const metadata = (result?.data?.fm ?? {}) as Partial<DocMetadata>;
  return { metadata, toc };
}
