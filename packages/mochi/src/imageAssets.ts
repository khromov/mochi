import path from 'node:path';
import type { OnLoadCallback } from 'bun';

/**
 * Image extensions intercepted by {@link createImageAssetLoader}. Bun's default
 * *file* loader would otherwise emit these next to the SSR bundle and return a
 * bare on-disk path that nothing serves.
 */
export const IMAGE_FILE_FILTER = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;

export interface ImageAssetLoaderOptions {
  /** Framework asset URL prefix, e.g. `/_mochi`. */
  assetPrefix: string;
  /** Directory the hashed asset files are written to (served via `Bun.file`). */
  assetOutDir: string;
  /** Shared `urlPath → diskPath` map the server reads to serve `/asset/*`. */
  assetFiles: Map<string, string>;
}

/**
 * Resolve an image import to a served URL instead of an orphaned disk path.
 *
 * Returning the URL as the module's default export — rather than relying on
 * Bun's `publicPath` — keeps the SSR `target: 'bun'` build's chunk imports as
 * relative on-disk paths (so `import()` of `*.server.js` still works) while
 * giving the browser a real URL. Same bytes hash to the same filename, so SSR
 * and the hydrated island reference one shared, content-addressed asset.
 */
export function createImageAssetLoader({ assetPrefix, assetOutDir, assetFiles }: ImageAssetLoaderOptions): OnLoadCallback {
  return async (args) => {
    const bytes = await Bun.file(args.path).arrayBuffer();
    const hash = Bun.hash(bytes).toString(36);
    const ext = path.extname(args.path);
    const fileName = `${path.basename(args.path, ext)}-${hash}${ext}`;
    const urlPath = `${assetPrefix}/asset/${fileName}`;
    const diskPath = path.join(assetOutDir, fileName);
    await Bun.write(diskPath, bytes);
    assetFiles.set(urlPath, diskPath);
    return { contents: `export default ${JSON.stringify(urlPath)};`, loader: 'js' };
  };
}
