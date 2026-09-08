import path from 'node:path';
import { compile as mdsvexCompile } from 'mdsvex';
import { SITE_ROOT } from './siteRoot';
import { sharedCache } from './sharedCache';

export const BLOG_DIR = path.resolve(SITE_ROOT, 'src/blog');

export interface PostMetadata {
  title: string;
  slug: string;
  description?: string;
  date: string;
  draft?: boolean;
  // Author slug, keyed into `authors.ts`.
  author: string;
}

export interface PostEntry {
  slug: string;
  title: string;
  description?: string;
  date: string;
  draft: boolean;
  // Author slug, keyed into `authors.ts`.
  author: string;
  filename: string;
  raw: string;
}

const cache = sharedCache('__mochi_site_blog_cache__', () => ({
  posts: null as PostEntry[] | null,
  bySlug: null as Map<string, PostEntry> | null,
}));

export function clearBlogCaches(): void {
  cache.posts = null;
  cache.bySlug = null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function parsePostFrontmatter(markdown: string): Promise<Partial<PostMetadata>> {
  const result = await mdsvexCompile(markdown, {
    extensions: ['.md', '.svx'],
    highlight: false,
  });
  return (result?.data?.fm ?? {}) as Partial<PostMetadata>;
}

async function loadAllPosts(): Promise<PostEntry[]> {
  if (cache.posts) {
    return cache.posts;
  }

  const glob = new Bun.Glob('*.md');
  const filenames: string[] = [];
  for await (const file of glob.scan(BLOG_DIR)) {
    filenames.push(file);
  }
  filenames.sort();

  const entries: PostEntry[] = [];
  for (const filename of filenames) {
    const raw = await Bun.file(path.join(BLOG_DIR, filename)).text();
    const metadata = await parsePostFrontmatter(raw);

    if (!metadata.slug) {
      throw new Error(`Post "${filename}" is missing required frontmatter field: slug`);
    }
    if (!metadata.title) {
      throw new Error(`Post "${filename}" is missing required frontmatter field: title`);
    }
    // The date must be a quoted string in frontmatter — an unquoted YAML date
    // parses to a Date object and would fail this shape check.
    if (typeof metadata.date !== 'string' || !DATE_RE.test(metadata.date)) {
      throw new Error(`Post "${filename}" needs a date frontmatter field shaped 'YYYY-MM-DD' (quoted)`);
    }
    if (!metadata.author) {
      throw new Error(`Post "${filename}" is missing required frontmatter field: author`);
    }

    entries.push({
      slug: metadata.slug,
      title: metadata.title,
      description: metadata.description,
      date: metadata.date,
      draft: metadata.draft === true,
      author: metadata.author,
      filename,
      raw,
    });
  }

  // Newest first; filename tiebreak keeps the order reproducible across filesystems.
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.filename.localeCompare(a.filename));

  cache.posts = entries;
  cache.bySlug = new Map(entries.map((e) => [e.slug, e]));
  return entries;
}

export async function loadPosts(opts?: { includeDrafts?: boolean }): Promise<PostEntry[]> {
  const posts = await loadAllPosts();
  return opts?.includeDrafts ? posts : posts.filter((p) => !p.draft);
}

export async function getPost(slug: string, opts?: { includeDrafts?: boolean }): Promise<PostEntry | null> {
  if (!cache.bySlug) {
    await loadAllPosts();
  }
  const post = cache.bySlug?.get(slug) ?? null;
  if (post?.draft && !opts?.includeDrafts) {
    return null;
  }
  return post;
}
