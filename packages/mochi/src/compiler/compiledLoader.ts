import path from 'node:path';
import { transformCompiled, mayContainCompiled, type CompiledUsage } from './compiledMacro';
import { relForDisplay, toPosixPath } from '../utils/index';

export const COMPILED_MODULE_FILTER = /\.(ts|mts|js|mjs)$/;

const SVELTE_MODULE_FILTER = /\.svelte\.[jt]s$/;

/** The framework's own `src/`, so its implementation of the macro is never itself macro-processed. */
const FRAMEWORK_SRC = toPosixPath(path.join(path.dirname(Bun.fileURLToPath(import.meta.url)), '..'));

/**
 * Dependencies and the framework's own source are excluded because `compiled(` occurs in this package's own prose and
 * error strings, which the transform would then choke on.
 *
 * Compared POSIX-normalized on both sides: the client build gives its synthetic island entrypoints forward-slash paths
 * under this same directory, so a native-separator comparison misses them on Windows.
 */
export function isAppModulePath(filePath: string, frameworkSrc: string = FRAMEWORK_SRC): boolean {
  const posix = toPosixPath(filePath);
  return !posix.includes('/node_modules/') && !posix.startsWith(`${toPosixPath(frameworkSrc)}/`);
}

export interface CompiledContext {
  outDir: string;
  development: boolean;
  /** True once a prebuilt manifest is serving: reaching a `compiled()` on the on-demand path then means the build is stale. */
  isPrebuilt: () => boolean;
  onUsage: (usage: CompiledUsage) => void;
}

export function assertNotPrebuilt(ctx: CompiledContext, filePath: string): void {
  if (ctx.isPrebuilt() && !ctx.development) {
    throw new Error(
      `compiled() in ${relForDisplay(filePath)} was reached at request time, but this server booted from a prebuilt manifest. ` +
        `Build-time values are baked in by \`mochi-framework build\` — this means the manifest is stale. Rebuild and redeploy.`,
    );
  }
}

const MODULE_REF_PATTERN = /\bmoduleRef\b/;

/**
 * In dev the call is left in place for the runtime fallback, so the ordinary reload path keeps its value fresh — except
 * for `moduleRef()`, which has no runtime form and must be inlined even then.
 */
export function needsCompiledTransform(source: string, ctx: Pick<CompiledContext, 'development'>): boolean {
  if (!mayContainCompiled(source)) {
    return false;
  }
  return !ctx.development || MODULE_REF_PATTERN.test(source);
}

export async function applyCompiled(source: string, filePath: string, ctx: CompiledContext, kind: 'svelte' | 'module' = 'svelte'): Promise<string> {
  if (!needsCompiledTransform(source, ctx)) {
    return source;
  }
  assertNotPrebuilt(ctx, filePath);
  return transformCompiled({ source, filePath, outDir: ctx.outDir, kind, onUsage: ctx.onUsage });
}

/** Returns `undefined` for anything the macro leaves alone, so the common case costs one substring scan and stays on Bun's default loader. */
export function createCompiledModuleLoader(ctx: CompiledContext) {
  return async (args: { path: string }): Promise<{ contents: string; loader: 'ts' | 'js' } | undefined> => {
    // Bun stops at the first handler that returns something, so a `.svelte.ts` must fall through to the runes loader registered after this one.
    if (!isAppModulePath(args.path) || SVELTE_MODULE_FILTER.test(args.path)) {
      return undefined;
    }
    // The extension filter also catches modules that exist only in a `Bun.build({ files })` map, with nothing on disk.
    let source: string;
    try {
      source = await Bun.file(args.path).text();
    } catch {
      return undefined;
    }
    const contents = await applyCompiled(source, args.path, ctx, 'module');
    if (contents === source) {
      return undefined;
    }
    const ext = path.extname(args.path);
    return { contents, loader: ext === '.js' || ext === '.mjs' ? 'js' : 'ts' };
  };
}
