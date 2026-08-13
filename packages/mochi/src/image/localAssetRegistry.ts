/**
 * Request-time registry for locally-imported image assets (`import hero from './hero.png'`). The build-time loader in
 * `compiler/imageAssetLoader.ts` records each emitted asset's served URL → on-disk path here, so two callers resolve it
 * at request time:
 *
 *   1. The static asset route (`${assetPrefix}/asset/:filename`) streams the bytes
 *      from disk.
 *   2. `fetchImageSource` reads them when `<Image>`/`getImageUrl` transform a local
 *      image, whose same-origin `/_mochi/asset/…` src the SSRF guard would reject.
 *
 * Pinned on `globalThis` like `getImageRuntime`'s `__mochi_image_runtime__`, since compiled Svelte components each get
 * their own bundled copy of this module yet must share the one Map the loader and manifest populated. Only URLs the
 * build registered are readable: request input serves purely as a Map key, so no arbitrary file read is reachable.
 */

export interface LocalImageAssetInfo {
  diskPath: string;
  contentType: string;
  /** Absolute path of the original imported file. Recorded only by the in-process
   * build loader (dev) for the debug bar — never threaded through the prod manifest,
   * so it stays a dev-only convenience and no build-machine path leaks into artifacts. */
  sourcePath?: string;
}

const GLOBAL_KEY = '__mochi_local_image_assets__';

function registry(): Map<string, LocalImageAssetInfo> {
  const g = globalThis as unknown as Record<string, unknown>;
  let map = g[GLOBAL_KEY] as Map<string, LocalImageAssetInfo> | undefined;
  if (!map) {
    map = new Map();
    g[GLOBAL_KEY] = map;
  }
  return map;
}

export function registerLocalImageAsset(url: string, info: LocalImageAssetInfo): void {
  registry().set(url, info);
}

export function getLocalImageAsset(url: string): LocalImageAssetInfo | undefined {
  return registry().get(url);
}

/**
 * Handler for the `${assetPrefix}/asset/:filename` route: reconstruct the registry key from the request pathname and
 * serve the bytes from disk on a hit. A miss 404s, and since the filename only ever acts as a Map key, a traversal
 * attempt matches nothing and reads nothing. Hashed URLs are immutable, so production sends a long-lived immutable
 * `Cache-Control` while dev omits it and replaced images appear on the next request.
 */
export function createLocalAssetHandler(development: boolean): (req: Request) => Promise<Response> {
  const notFound = (): Response => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return async (req: Request): Promise<Response> => {
    const info = getLocalImageAsset(new URL(req.url).pathname);
    if (!info) {
      return notFound();
    }
    // A registered URL whose file is gone (wiped outDir under a live server, partially copied build) is a 404, not the
    // 500 Bun.file's lazy ENOENT would surface as.
    const file = Bun.file(info.diskPath);
    if (!(await file.exists())) {
      return notFound();
    }
    const headers: Record<string, string> = {
      'Content-Type': info.contentType,
      'X-Content-Type-Options': 'nosniff',
    };
    if (!development) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    return new Response(file, { headers });
  };
}
