import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile as mdsvexCompile } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import type { TocEntry } from './toc';

type MdsvexRehypePlugin = NonNullable<NonNullable<Parameters<typeof mdsvexCompile>[1]>['rehypePlugins']>[number];

export const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs');
const DEMOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../demos');

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
let cachedLlmsTxt: string | null = null;
let cachedLlmsFullTxt: string | null = null;

export function clearDocsCaches(): void {
  cachedDocs = null;
  cachedBySlug = null;
  cachedNav = null;
  cachedLlmsTxt = null;
  cachedLlmsFullTxt = null;
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
  const tsGlob = new Bun.Glob('*/*.ts');
  const svelteGlob = new Bun.Glob('*/*.svelte');
  const files: string[] = [];
  for await (const f of tsGlob.scan(DEMOS_DIR)) {
    files.push(f);
  }
  for await (const f of svelteGlob.scan(DEMOS_DIR)) {
    files.push(f);
  }
  files.sort();

  const demoMap = new Map<string, string[]>();
  for (const file of files) {
    const slash = file.indexOf('/');
    const dir = file.slice(0, slash);
    const filename = file.slice(slash + 1);
    if (!demoMap.has(dir)) {
      demoMap.set(dir, []);
    }
    demoMap.get(dir)!.push(filename);
  }

  const parts: string[] = ['# Demo Source Files\n'];
  for (const [demo, filenames] of demoMap) {
    parts.push(`## Demo: ${demo}\n`);
    for (const filename of filenames) {
      const abs = path.join(DEMOS_DIR, demo, filename);
      const content = await Bun.file(abs).text();
      const lang = filename.endsWith('.svelte') ? 'svelte' : 'ts';
      parts.push(`### ${demo}/${filename}\n\`\`\`${lang}\n${content.trimEnd()}\n\`\`\`\n`);
    }
  }
  return parts.join('\n');
}

export async function buildLlmsTxt(): Promise<string> {
  if (cachedLlmsTxt) {
    return cachedLlmsTxt;
  }
  const docs = await loadDocs();
  cachedLlmsTxt = docs.map((d) => d.raw.trimEnd()).join('\n\n') + '\n';
  return cachedLlmsTxt;
}

export async function buildLlmsFullTxt(): Promise<string> {
  if (cachedLlmsFullTxt) {
    return cachedLlmsFullTxt;
  }
  const [docs, demos] = await Promise.all([loadDocs(), buildDemosTxt()]);
  cachedLlmsFullTxt = docs.map((d) => d.raw.trimEnd()).join('\n\n') + '\n\n' + demos;
  return cachedLlmsFullTxt;
}

export async function getDocLlmsTxt(slug: string): Promise<string | null> {
  const doc = await getDoc(slug);
  return doc ? doc.raw.trimEnd() + '\n' : null;
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
