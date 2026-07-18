import { existsSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from '../utils';
import { slugForImport } from '../image/slug';
import { registerLocalImageAsset } from '../image/localAssetRegistry';
import { IMAGE_MIME, IMPORTED_IMAGE_FORMATS } from '../image/types';
import type { ImportedImageFormat, LocalImageAsset } from '../image/types';
import { applyFilter, runHook } from '../extensions';

export { IMAGE_FILE_FILTER } from '../image/types';

// `Bun.Image#metadata().format` values we accept. Guards against a file whose
// extension lies about its contents (e.g. an SVG renamed to `.png`).
const RASTER_FORMATS: ReadonlySet<string> = new Set(IMPORTED_IMAGE_FORMATS);

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
export function createImageAssetLoader(opts: { outDir: string; assetPrefix: string; assets: Map<string, LocalImageAsset>; rejectUnknown?: boolean }) {
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
    const format = meta.format as ImportedImageFormat;

    const hash = Bun.hash(bytes).toString(36);
    const ext = path.extname(args.path).slice(1).toLowerCase();
    // Both build passes run this loader over the same file, so the filters must be
    // deterministic — a non-deterministic filename/URL would make SSR and client
    // JS embed divergent `src`s and break the content-addressed disk dedupe.
    const filename = applyFilter('image:localAssetFilename', `${slugForImport(args.path)}-${hash}.${ext}`, {
      sourcePath: args.path,
      hash,
      ext,
      format,
      width: meta.width,
      height: meta.height,
    });
    const diskPath = path.resolve(opts.outDir, 'assets', filename);
    const url = applyFilter('image:localAssetUrl', `${opts.assetPrefix}/asset/${filename}`, {
      sourcePath: args.path,
      filename,
      assetPrefix: opts.assetPrefix,
      format,
    });
    // In a prebuilt-manifest production server, imports are meant to be fully
    // resolved at build time. If a component compiles on-demand at request time
    // (a manifest miss) and imports an image absent from the manifest, that's a
    // stale/broken build — reject it loudly instead of silently hashing and
    // serving a source the build never vetted. The membership check keeps
    // legitimately-built re-imports (SSR + client passes, on-demand island
    // recompiles) idempotent, since `assets` is repopulated from the manifest.
    if (opts.rejectUnknown && !opts.assets.has(url)) {
      throw new Error(
        `Cannot import "${args.path}" at runtime in production: local image imports are resolved at build time, ` +
          `and this file is not part of the prebuilt manifest (its URL "${url}" was not registered by the build). ` +
          `Rebuild to include it.`,
      );
    }

    const contentType = IMAGE_MIME[format];
    const asset: LocalImageAsset = { src: url, width: meta.width, height: meta.height, format, diskPath: toPosixPath(diskPath), contentType };
    opts.assets.set(url, asset);
    registerLocalImageAsset(url, { diskPath, contentType, sourcePath: args.path });

    // Content-addressed: identical bytes always produce this same path, so the
    // write is safe to skip and safe to race between the two build passes. The
    // emitted hook fires alongside the write, so it runs once per emitted asset
    // (uploads should stay idempotent — concurrent passes could double-fire).
    if (!existsSync(diskPath)) {
      await Bun.write(diskPath, bytes);
      await runHook('image:localAssetEmitted', { sourcePath: args.path, diskPath, url, width: meta.width, height: meta.height, format, contentType });
    }

    return {
      contents: `export default ${JSON.stringify({ src: url, width: meta.width, height: meta.height, format })};`,
      loader: 'js',
    };
  };
}
