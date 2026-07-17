/**
 * Request-time registry for locally-imported image assets (`import hero from
 * './hero.png'`). The build-time loader (`compiler/imageAssetLoader.ts`) records
 * each emitted asset's served URL → on-disk path here so two things can resolve
 * it at request time:
 *
 *   1. The static asset route (`${assetPrefix}/asset/:filename`) streams the
 *      bytes from disk.
 *   2. `fetchImageSource` reads the bytes from disk when `<Image>`/`getImageUrl`
 *      transform a local image (its `src` is a same-origin `/_mochi/asset/…`
 *      URL that the SSRF guard would otherwise reject).
 *
 * Pinned on `globalThis` (like `getImageRuntime`'s `__mochi_image_runtime__`):
 * compiled Svelte components get their own bundled copy of this module, but must
 * share the one Map the loader/manifest populated. Only URLs the build
 * registered are ever readable — request input is used solely as a Map key,
 * never joined to a filesystem path — so there is no arbitrary-file-read.
 */

export interface LocalImageAssetInfo {
  diskPath: string;
  contentType: string;
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
 * Handler for the `${assetPrefix}/asset/:filename` route. Reconstructs the
 * registry key from the request pathname, and serves the bytes from disk on a
 * hit. A miss is a 404 — the request filename is only ever a Map key, so a
 * traversal attempt (`../…`) simply doesn't match and reads nothing. Hashed URLs
 * are immutable, so production sends a long-lived immutable `Cache-Control`; dev
 * omits it so replaced images show up on the next request.
 */
export function createLocalAssetHandler(development: boolean): (req: Request) => Response {
  return (req: Request): Response => {
    const info = getLocalImageAsset(new URL(req.url).pathname);
    if (!info) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const headers: Record<string, string> = {
      'Content-Type': info.contentType,
      'X-Content-Type-Options': 'nosniff',
    };
    if (!development) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    return new Response(Bun.file(info.diskPath), { headers });
  };
}
