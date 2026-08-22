import { readdirSync } from 'node:fs';
import { styleText } from 'node:util';

const VENDOR_DIR = 'packages/mochi/src/vendor';

// Matches the `// Vendored from https://github.com/<owner>/<repo>[/tree/<ref>] <version>`
// comment every vendored file carries — the only place we record the pinned version.
const VENDORED_FROM_RE = /Vendored from https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)(?:\/\S*)? (\S+)/;

async function main() {
  const dirs = readdirSync(VENDOR_DIR);

  const scripts = await Promise.all(
    dirs.map(async (name) => {
      const text = await Bun.file(`${VENDOR_DIR}/${name}/index.ts`).text();
      const match = text.match(VENDORED_FROM_RE);
      if (!match) {
        return { name, error: 'no "Vendored from" comment found' };
      }
      const [, , repo, pinnedVersion] = match;
      return { name, npmPackage: repo, pinnedVersion };
    }),
  );

  for (const script of scripts) {
    if ('error' in script) {
      console.log(`${styleText('bold', script.name)}: ${styleText('red', script.error)}`);
      continue;
    }
    const { name, npmPackage, pinnedVersion } = script;
    try {
      const res = await fetch(`https://registry.npmjs.org/${npmPackage}/latest`);
      if (!res.ok) {
        console.log(`${styleText('bold', name)}: ${styleText('red', `npm lookup failed (${res.status}) for package "${npmPackage}"`)}`);
        continue;
      }
      const { version: latest } = (await res.json()) as { version: string };
      console.log(`${styleText('bold', name)}: ${styleText('green', latest)} ${styleText('dim', `(pinned at ${pinnedVersion})`)}`);
    } catch (err) {
      console.log(`${styleText('bold', name)}: ${styleText('red', String(err))}`);
    }
  }
}

main();
