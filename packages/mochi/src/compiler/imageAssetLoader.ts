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
 * Bun `onLoad` handler for local image imports (`import hero from './hero.png'`), registered in BOTH build passes so a
 * component compiles identically on each side. It:
 *
 *   1. probes the image's intrinsic dimensions/format via `Bun.Image`,
 *   2. content-hashes the bytes and writes a copy to `<outDir>/assets/`,
 *   3. records the served URL → disk path in the shared build map and the global
 *      request-time registry,
 *   4. returns a JS module exporting `{ src, width, height, format }`.
 *
 * Returning JS keeps Bun's default binary `file` loader from emitting an asset output, which the client pass would
 * sweep into its text-only `clientFiles` map and corrupt.
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
    // Both build passes run this loader over the same file, so the filters must be deterministic: a varying
    // filename or URL would make SSR and client JS embed divergent `src`s and break the content-addressed disk dedupe.
    const filename = applyFilter('image:localAssetFilename', `${slugForImport(args.path)}-${hash}.${ext}`, {
      sourcePath: args.path,
      hash,
      ext,
      format,
      width: meta.width,
      height: meta.height,
    });
    // The filter renames the asset and stops there: a separator or `..` would push the emitted file outside
    // `<outDir>/assets/` and bake an absolute path into the manifest, making the build non-relocatable.
    if (filename === '' || filename === '.' || filename === '..' || /[\\/]/.test(filename)) {
      throw new Error(
        `The \`image:localAssetFilename\` filter returned ${JSON.stringify(filename)} for "${args.path}", which is not a bare filename. ` +
          `It may only rename the emitted file inside <outDir>/assets/ — path separators and \`..\` are not allowed. ` +
          `To change where the asset is served from, use the \`image:localAssetUrl\` filter instead.`,
      );
    }
    const diskPath = path.resolve(opts.outDir, 'assets', filename);
    const url = applyFilter('image:localAssetUrl', `${opts.assetPrefix}/asset/${filename}`, {
      sourcePath: args.path,
      filename,
      assetPrefix: opts.assetPrefix,
      format,
    });
    // A prebuilt-manifest production server resolves imports at build time, so a component compiling on-demand and
    // importing an image absent from the manifest means a stale build — rejected loudly rather than hashing and serving
    // a source the build never vetted. The membership check keeps legitimately-built re-imports idempotent, since
    // `assets` is repopulated from the manifest.
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

    // Content-addressing makes identical bytes produce this same path, so the write is safe to skip and safe to race
    // between the two build passes. The emitted hook fires alongside the write, once per emitted asset, though
    // concurrent passes can double-fire it — keep uploads idempotent.
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
