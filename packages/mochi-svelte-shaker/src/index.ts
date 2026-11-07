/**
 * Drives the build-tool-agnostic svelte-shaker engine from Bun. svelte-shaker ships only Vite/Rollup plugins, but those
 * are thin Shells over an env-free engine (`svelteShaker(entries, resolve, readFile)`), so this adapter supplies the Node
 * Shell glue (`svelte-shaker/node`) itself. That subpath is internal and non-plugin on a pre-1.0 package, so it can move
 * between releases, so every bump is treated as potentially breaking.
 *
 * Floor of 0.18.1: earlier releases strip unknown-namespace attributes, so every `mochi:*` directive vanished from the
 * shaken source — islands silently degraded to plain components (covered by a test in index.test.ts). Other regressions
 * still surface only as a shake abort, which the fallback in mochi-framework's ComponentRegistry swallows: the build
 * succeeds while every component quietly stops being slimmed. Verify a bump with a real `bun run build:site` and check
 * the "slimmed N of M" line. mochi-framework imports this package dynamically, so only production builds load it.
 */
import { svelteShaker } from 'svelte-shaker';
import { collectSvelteFiles, fsResolve, fsReadFile } from 'svelte-shaker/node';
import type { ShakeAppResult, SvelteShakerBackend } from 'mochi-framework';

// Resolved relative to this file rather than the app's cwd, so a nested install reports the engine it will actually run.
const enginePackage = (await Bun.file(Bun.resolveSync('svelte-shaker/package.json', import.meta.dir)).json()) as { version: string };

async function shakeApp(appRoot: string): Promise<ShakeAppResult> {
  const entries = collectSvelteFiles(appRoot);
  if (entries.length === 0) {
    return { shaken: new Map(), originals: new Map() };
  }
  // Capture the engine's own reads so callers can diff original→shaken without a
  // second disk pass. `readFile` may return sync or a Promise — record either.
  const originals = new Map<string, string>();
  const recordingReadFile = (id: string): Promise<string> | string => {
    const content = fsReadFile(id);
    if (typeof content === 'string') {
      originals.set(id, content);
      return content;
    }
    return content.then((text) => {
      originals.set(id, text);
      return text;
    });
  };
  const shaken = await svelteShaker(entries, fsResolve, recordingReadFile);
  return { shaken: new Map(Object.entries(shaken)), originals };
}

export const svelteShakerBackend: SvelteShakerBackend = {
  name: 'svelte-shaker',
  version: enginePackage.version,
  shakeApp,
};

export default svelteShakerBackend;
