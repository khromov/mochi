import path from 'node:path';
import { transformCompiled, mayContainCompiled, type CompiledUsage } from './compiledMacro';
import type { CompiledSerializer } from './compiledSerialize';
import { relForDisplay, toPosixPath } from '../utils/index';

export const COMPILED_MODULE_FILTER = /\.(ts|mts|js|mjs)$/;

/** The framework's own `src/`, so its implementation of the macro is never itself macro-processed. */
const FRAMEWORK_SRC = toPosixPath(path.join(path.dirname(Bun.fileURLToPath(import.meta.url)), '..'));

/**
 * Whether a module is eligible for build-time evaluation.
 *
 * Dependencies and the framework's own source are excluded: `compiled(` occurs in this package's error strings and
 * documentation comments, and processing those would both waste work and, because the transform parses a module by
 * wrapping it in a Svelte script block, choke on any comment that mentions markup.
 *
 * Compared POSIX-normalized on both sides. The client build's synthetic island entrypoints are deliberately given
 * forward-slash paths under this same directory (see `buildClientBundle`), so a native-separator comparison misses them
 * on Windows and they fall through to the disk read below — which they have no file for.
 */
export function isAppModulePath(filePath: string, frameworkSrc: string = FRAMEWORK_SRC): boolean {
  const posix = toPosixPath(filePath);
  return !posix.includes('/node_modules/') && !posix.startsWith(`${toPosixPath(frameworkSrc)}/`);
}

function isAppModule(filePath: string): boolean {
  return isAppModulePath(filePath);
}

export interface CompiledContext {
  outDir: string;
  development: boolean;
  serializer?: CompiledSerializer;
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

/** Run the macro over a component or markdown source that the caller has already read. */
export async function applyCompiled(source: string, filePath: string, ctx: CompiledContext): Promise<string> {
  if (!mayContainCompiled(source)) {
    return source;
  }
  assertNotPrebuilt(ctx, filePath);
  return transformCompiled({ source, filePath, outDir: ctx.outDir, kind: 'svelte', serializer: ctx.serializer, onUsage: ctx.onUsage });
}

/**
 * `onLoad` handler for plain modules.
 *
 * Returns `undefined` for anything without a `compiled(` in it, which hands the file back to Bun's default loader —
 * so the overwhelmingly common case costs one substring scan and nothing else.
 */
export function createCompiledModuleLoader(ctx: CompiledContext) {
  return async (args: { path: string }): Promise<{ contents: string; loader: 'ts' | 'js' } | undefined> => {
    if (!isAppModule(args.path)) {
      return undefined;
    }
    // The filter matches by extension, which also catches modules that exist only in a `Bun.build({ files })` map and
    // have nothing on disk. Hand those back to the bundler untouched rather than failing the build on a missing file.
    const file = Bun.file(args.path);
    if (!(await file.exists())) {
      return undefined;
    }
    const source = await file.text();
    if (!mayContainCompiled(source)) {
      return undefined;
    }
    assertNotPrebuilt(ctx, args.path);
    const contents = await transformCompiled({
      source,
      filePath: args.path,
      outDir: ctx.outDir,
      kind: 'module',
      serializer: ctx.serializer,
      onUsage: ctx.onUsage,
    });
    const ext = path.extname(args.path);
    return { contents, loader: ext === '.js' || ext === '.mjs' ? 'js' : 'ts' };
  };
}
