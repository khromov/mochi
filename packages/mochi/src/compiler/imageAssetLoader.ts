import { existsSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from '../utils';
import { slugForImport } from '../image/slug';
import { registerLocalImageAsset } from '../image/localAssetRegistry';
import type { LocalImageAsset } from '../image/types';

/** Raster image extensions that resolve to an `ImportedImage` object. SVG is excluded (Bun.Image can't decode it). */
export const IMAGE_FILE_FILTER = /\.(png|jpe?g|webp|avif|gif)$/i;

// `Bun.Image#metadata().format` values we accept. Guards against a file whose
// extension lies about its contents (e.g. an SVG renamed to `.png`).
const RASTER_FORMATS = new Set(['png', 'jpeg', 'webp', 'avif', 'gif']);

/**
 * Bun `onLoad` handler for local image imports (`import hero from './hero.png'`).
 * Registered in BOTH the SSR and client build passes so the same component
 * compiles identically on both sides. It:
 *
 *   1. probes the image's intrinsic dimensions/format via `Bun.Image`,
 *   2. content-hashes the bytes and writes a copy to `<outDir>/assets/`,
 *   3. records the served URL → disk path in the shared build map (for the
 *      manifest) and the global request-time registry (for dev, in-process),
 *   4. returns a JS module exporting `{ src, width, height, format }`.
 *
 * Returning JS is deliberate: it stops Bun's default binary `file` loader from
 * emitting an asset output, which the client pass would otherwise sweep into its
 * text-only `clientFiles` map and corrupt.
 */
export function createImageAssetLoader(opts: { outDir: string; assetPrefix: string; assets: Map<string, LocalImageAsset> }) {
  return async (args: { path: string }): Promise<{ contents: string; loader: 'js' }> => {
    const bytes = await Bun.file(args.path).bytes();

    let meta: Bun.Image.Metadata;
    try {
      meta = await new Bun.Image(bytes).metadata();
    } catch {
      throw new Error(
        `Cannot import "${args.path}" as an image: it could not be decoded. ` +
          `Only raster images (png, jpg, jpeg, webp, avif, gif) are supported — ` +
          `for SVG or other assets, put the file in your public/ directory and reference it with a plain <img src>.`,
      );
    }
    if (!RASTER_FORMATS.has(meta.format)) {
      throw new Error(`Cannot import "${args.path}" as an image: unsupported format "${meta.format}". Supported: png, jpg, jpeg, webp, avif, gif.`);
    }

    const hash = Bun.hash(bytes).toString(36);
    const ext = path.extname(args.path).slice(1).toLowerCase();
    const filename = `${slugForImport(args.path)}-${hash}.${ext}`;
    const diskPath = path.resolve(opts.outDir, 'assets', filename);
    // Content-addressed: identical bytes always produce this same path, so the
    // write is safe to skip and safe to race between the two build passes.
    if (!existsSync(diskPath)) {
      await Bun.write(diskPath, bytes);
    }

    const url = `${opts.assetPrefix}/asset/${filename}`;
    const contentType = `image/${meta.format}`;
    const asset: LocalImageAsset = { src: url, width: meta.width, height: meta.height, format: meta.format, diskPath: toPosixPath(diskPath), contentType };
    opts.assets.set(url, asset);
    registerLocalImageAsset(url, { diskPath, contentType });

    return {
      contents: `export default ${JSON.stringify({ src: url, width: meta.width, height: meta.height, format: meta.format })};`,
      loader: 'js',
    };
  };
}
