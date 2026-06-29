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
before they ship.

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

/** Pull every href/src out of a chunk of server-rendered HTML. */
function extractLinks(html: string): string[] {
  const out: string[] = [];
  const re = /(?:href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[2] ?? m[3] ?? '');
  }
  return out;
}

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|#)/i;

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

  // llms.json lists each page's llms.txt source; the rendered page sits one level up.
  const pages = [`${base}/`, ...[...index.docs, ...index.demos].map((e) => e.url.replace(/llms\.txt$/, ''))];

  console.log(styleText('dim', `Crawling ${pages.length} pages from ${base}/llms.json …`));

  // Map of normalized link → the pages that reference it (deduped, hash stripped).
  const links = new Map<string, Set<string>>();
  await pool(pages, concurrency, async (page) => {
    let html: string;
    try {
      const res = await fetch(page);
      if (!res.ok) {
        console.error(styleText('red', `  page ${page} → ${res.status}`));
        return;
      }
      html = await res.text();
    } catch (err) {
      console.error(styleText('red', `  page ${page} → ${String(err)}`));
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
      resolved.hash = '';
      const key = resolved.toString();
      (links.get(key) ?? links.set(key, new Set()).get(key)!).add(page);
    }
  });

  const targets = [...links.keys()].sort();
  console.log(styleText('dim', `Checking ${targets.length} unique links …\n`));

  const broken: { url: string; status: string; sources: string[] }[] = [];
  await pool(targets, concurrency, async (url) => {
    let status: string;
    let ok = false;
    try {
      // Some hosts reject HEAD; GET is the reliable signal.
      const res = await fetch(url, { redirect: 'follow' });
      status = String(res.status);
      ok = res.ok;
    } catch (err) {
      status = err instanceof Error ? err.message : String(err);
    }
    if (!ok) {
      broken.push({ url, status, sources: [...links.get(url)!] });
    }
  });

  if (broken.length === 0) {
    console.log(styleText('green', `✓ All ${targets.length} links OK across ${pages.length} pages.`));
    process.exit(0);
  }

  console.log(styleText('red', `✗ ${broken.length} broken link(s):\n`));
  for (const b of broken.sort((a, z) => a.url.localeCompare(z.url))) {
    console.log(`${styleText('red', b.status)}  ${b.url}`);
    for (const src of b.sources.sort()) {
      console.log(styleText('dim', `      ← ${src}`));
    }
  }
  process.exit(1);
}

main();
