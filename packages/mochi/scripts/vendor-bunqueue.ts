/**
 * Regenerates the vendored bunqueue client bundle (`src/vendor/bunqueue-client.js`).
 *
 * `bunqueue` is a devDependency, never a runtime one: bundling it here — with the
 * msgpackr-extract workspace stub inlined via the root `overrides` — is the only
 * way to keep `msgpackr` and its native `msgpackr-extract` accelerator (plus the
 * `@msgpackr-extract/*` prebuilt binaries) out of every consumer's dependency
 * graph. A published package can't suppress a transitive optional dep through
 * `overrides`/`bundledDependencies`/env vars; only making `msgpackr` cease to be
 * an installed package does it. See packages/msgpackr-extract-stub.
 *
 * The companion `bunqueue-client.d.ts` is hand-maintained (self-contained, no
 * reference to the `bunqueue` package) so consumers type-check without it.
 */
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const scriptsDir = import.meta.dir;
const mochiRoot = join(scriptsDir, '..');
const outDir = join(mochiRoot, 'src', 'vendor');
// Inside the package so module resolution finds `bunqueue`; dot-prefixed and
// removed in `finally` so a stray run never leaves a lintable file behind.
const entryPath = join(scriptsDir, '.vendor-entry.ts');

await Bun.write(entryPath, `export { Queue, Worker, shutdownManager } from 'bunqueue/client';\n`);

try {
  await mkdir(outDir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'bun',
    outdir: outDir,
    naming: 'bunqueue-client.[ext]',
  });
  if (!result.success) {
    for (const message of result.logs) {
      console.error(message);
    }
    process.exit(1);
  }
  const out = join(outDir, 'bunqueue-client.js');
  console.log(`Vendored bunqueue client → ${out} (${(await Bun.file(out).bytes()).byteLength / 1024} KiB)`);
} finally {
  await rm(entryPath, { force: true });
}
