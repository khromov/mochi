import { styleText } from 'node:util';

type Args = {
  base: string;
  external: boolean;
  concurrency: number;
};

const usage = `Usage: bun run scripts/check-links.ts [base] [--external] [--concurrency N]

Fetches <base>/llms.json to enumerate every doc and demo page, crawls each
rendered page, extracts its links, and reports any that don't return 200.
Catches broken internal links (e.g. a relative href that resolves to a 404)
and links that 301 via a missing trailing slash (an avoidable redirect hop)
before they ship. Intentional redirects (demo landings, external vanity URLs)
are listed for information but don't fail the run.

Start the site first (e.g. \`PORT=3333 bun run dev:site\` or \`bun run dev\`).

Arguments:
  base             Origin to check (default: http://localhost:3333)
  --external       Also check off-origin (http/https) links (default: skip)
  --concurrency N  Max simultaneous link checks (default: 12)

Exits 1 if any broken link is found, 0 otherwise.`;

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = [];
  let external = false;
  let concurrency = 12;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(usage);
      process.exit(0);
    } else if (a === '--external') {
      external = true;
    } else if (a === '--concurrency') {
      const next = argv[++i];
      if (!next) {
        console.error('Missing value for --concurrency');
        process.exit(2);
      }
      concurrency = Number(next);
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else {
      positional.push(a);
    }
  }
  return {
    base: (positional[0] ?? 'http://localhost:3333').replace(/\/+$/, ''),
    external,
    concurrency,
  };
};

interface LlmsIndexEntry {
  title: string;
  description: string;
  url: string;
}

/** Run thunks with a bounded number in flight at once. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Pull every href/src out of a chunk of server-rendered HTML. Code samples
 * (`<pre>`/`<code>`) are stripped first — syntax highlighting renders the `<` of
 * an example tag as `&lt;` but keeps the attribute quotes literal, so an
 * illustrative `src="..."` would otherwise read as a real (and bogus) link.
 */
function extractLinks(html: string): string[] {
  const stripped = html.replace(/<pre[\s\S]*?<\/pre>/gi, '').replace(/<code[\s\S]*?<\/code>/gi, '');
  const out: string[] = [];
  const re = /(?:href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    out.push(m[2] ?? m[3] ?? '');
  }
  return out;
}

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|#)/i;

/**
 * True when `location` is just `url` with a trailing slash appended to the path —
 * i.e. a link that only differs from the canonical form by the missing `/`, so it
 * costs a needless 301 hop. This is the accidental case worth fixing; a redirect
 * to a genuinely different path (a demo landing redirect, an external vanity URL)
 * is intentional and left alone.
 */
function isTrailingSlashRedirect(url: string, location: string): boolean {
  let target: URL;
  let u: URL;
  try {
    u = new URL(url);
    target = new URL(location, url);
  } catch {
    return false;
  }
  if (target.origin !== u.origin || u.pathname.endsWith('/')) {
    return false;
  }
  const canonical = new URL(u);
  canonical.pathname = `${u.pathname}/`;
  canonical.hash = '';
  target.hash = '';
  return canonical.toString() === target.toString();
}

// Same-origin pathnames the error demo links to on purpose to show off error
// handling — a non-200 here is the demo working, not a broken link.
const IGNORE_PATHS = new Set(['/demos/error/404/', '/demos/error/500/', '/does-not-exist/']);

async function main() {
  const { base, external, concurrency } = parseArgs(process.argv.slice(2));
  const origin = new URL(base).origin;

  let index: { docs: LlmsIndexEntry[]; demos: LlmsIndexEntry[] };
  try {
    const res = await fetch(`${base}/llms.json`);
    if (!res.ok) {
      console.error(styleText('red', `GET ${base}/llms.json → ${res.status}. Is the site running?`));
      process.exit(2);
    }
    index = await res.json();
  } catch (err) {
    console.error(styleText('red', `Could not reach ${base}/llms.json — is the site running?`));
    console.error(String(err));
    process.exit(2);
  }

  // llms.json lists each page's llms.txt source; the rendered page sits one level
  // up. The entry origin is whatever the site reports for itself (its configured
  // proxy origin, not necessarily `base`), so rebuild every URL against `base` —
  // that's what makes the `base` argument actually redirect the crawl.
  const toBase = (u: string) => `${base}${new URL(u).pathname.replace(/llms\.txt$/, '')}`;
  const pages = [`${base}/`, ...[...index.docs, ...index.demos].map((e) => toBase(e.url))];

  console.log(styleText('dim', `Crawling ${pages.length} pages from ${base}/llms.json …`));

  // Map of normalized link → the pages that reference it (deduped, hash stripped).
  const links = new Map<string, Set<string>>();
  // Pages from llms.json that don't even render — counted as failures, not skipped.
  const pageErrors: { url: string; status: string }[] = [];
  await pool(pages, concurrency, async (page) => {
    let html: string;
    try {
      const res = await fetch(page);
      if (!res.ok) {
        pageErrors.push({ url: page, status: String(res.status) });
        return;
      }
      html = await res.text();
    } catch (err) {
      pageErrors.push({ url: page, status: err instanceof Error ? err.message : String(err) });
      return;
    }
    for (const raw of extractLinks(html)) {
      if (!raw || SKIP_SCHEMES.test(raw)) {
        continue;
      }
      let resolved: URL;
      try {
        resolved = new URL(raw, page);
      } catch {
        continue;
      }
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        continue;
      }
      const isExternal = resolved.origin !== origin;
      if (isExternal && !external) {
        continue;
      }
      if (!isExternal && IGNORE_PATHS.has(resolved.pathname)) {
        continue;
      }
      resolved.hash = '';
      const key = resolved.toString();
      (links.get(key) ?? links.set(key, new Set()).get(key)!).add(page);
    }
  });

  const targets = [...links.keys()].sort();
  console.log(styleText('dim', `Checking ${targets.length} unique links …\n`));

  const broken: { url: string; status: string; sources: string[] }[] = [];
  // Trailing-slash redirects are the accidental, fixable case; other redirects
  // (demo landing redirects, external vanity URLs) are intentional — reported but
  // not treated as failures.
  const trailingRedirects: { url: string; location: string; sources: string[] }[] = [];
  const otherRedirects: { url: string; status: string; location: string; sources: string[] }[] = [];
  await pool(targets, concurrency, async (url) => {
    const sources = [...links.get(url)!];
    let res: Response;
    try {
      // Don't follow yet — a followed redirect masks the extra hop we want to flag.
      res = await fetch(url, { redirect: 'manual' });
    } catch (err) {
      broken.push({ url, status: err instanceof Error ? err.message : String(err), sources });
      return;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') ?? '';
      // Confirm the redirect lands somewhere real before classifying it as benign.
      let finalOk = true;
      try {
        const followed = await fetch(url, { redirect: 'follow' });
        finalOk = followed.ok;
        if (!finalOk) {
          broken.push({ url, status: `${res.status} → ${followed.status}`, sources });
        }
      } catch (err) {
        broken.push({ url, status: `${res.status} → ${err instanceof Error ? err.message : String(err)}`, sources });
        return;
      }
      if (finalOk) {
        if (isTrailingSlashRedirect(url, location)) {
          trailingRedirects.push({ url, location, sources });
        } else {
          otherRedirects.push({ url, status: String(res.status), location, sources });
        }
      }
      return;
    }
    if (!res.ok) {
      broken.push({ url, status: String(res.status), sources });
    }
  });

  // Intentional redirects are informational only — print them but don't fail.
  if (otherRedirects.length > 0) {
    console.log(styleText('yellow', `↪ ${otherRedirects.length} intentional redirect(s) (not a failure):\n`));
    for (const r of otherRedirects.sort((a, z) => a.url.localeCompare(z.url))) {
      console.log(styleText('dim', `${r.status}  ${r.url} → ${r.location}`));
    }
    console.log('');
  }

  const failed = broken.length + pageErrors.length + trailingRedirects.length;
  if (failed === 0) {
    console.log(styleText('green', `✓ All ${targets.length} links OK across ${pages.length} pages.`));
    process.exit(0);
  }

  if (pageErrors.length > 0) {
    console.log(styleText('red', `✗ ${pageErrors.length} page(s) from llms.json failed to load:\n`));
    for (const p of pageErrors.sort((a, z) => a.url.localeCompare(z.url))) {
      console.log(`${styleText('red', p.status)}  ${p.url}`);
    }
    console.log('');
  }

  if (trailingRedirects.length > 0) {
    console.log(styleText('red', `✗ ${trailingRedirects.length} link(s) redirect via a missing trailing slash (point them at the canonical URL):\n`));
    for (const r of trailingRedirects.sort((a, z) => a.url.localeCompare(z.url))) {
      console.log(`${styleText('red', '301')}  ${r.url} → ${r.location}`);
      for (const src of r.sources.sort()) {
        console.log(styleText('dim', `      ← ${src}`));
      }
    }
    console.log('');
  }

  if (broken.length > 0) {
    console.log(styleText('red', `✗ ${broken.length} broken link(s):\n`));
    for (const b of broken.sort((a, z) => a.url.localeCompare(z.url))) {
      console.log(`${styleText('red', b.status)}  ${b.url}`);
      for (const src of b.sources.sort()) {
        console.log(styleText('dim', `      ← ${src}`));
      }
    }
  }
  process.exit(1);
}

main();
