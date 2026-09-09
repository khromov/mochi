import path from 'node:path';
import { devalueErrorPath } from '../utils/devalue';
import { prerenderEvaluation, createPrerenderRefScope, serializePrerenderValue } from './prerenderSerialize';
import { relForDisplay, toPosixPath } from '../utils/index';

export const PRERENDER_MODULE_FILTER = /\.prerender\.[jt]s$/;

const COMPONENT_EXTENSIONS = new Set(['.svelte', '.md', '.svx']);
const RUNES_MODULE = /\.svelte\.[cm]?[jt]s$/;
const SCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export class PrerenderModuleError extends Error {}

type Namespace = Record<string, unknown>;

export type PrerenderEvaluationCache = Map<string, Promise<Namespace>>;

export interface PrerenderContext {
  development: boolean;
  /** True once a prebuilt manifest is serving: reaching a prerendered module on the on-demand path then means the build is stale. */
  isPrebuilt: () => boolean;
  /** The first-party files the module's evaluation loaded, so the dev watcher can rebuild it when one of them changes. */
  onInputs?: (prerenderPath: string, inputs: Set<string>) => void;
  /** The memo one compile's SSR and client passes share; a compile captures it at its start so a reset between the passes cannot split their values. */
  evaluations?: PrerenderEvaluationCache;
}

export function isPrerenderModulePath(filePath: string): boolean {
  return PRERENDER_MODULE_FILTER.test(toPosixPath(filePath)) && !isNodeModulesLibrary(filePath);
}

export function assertNotPrebuilt(ctx: Pick<PrerenderContext, 'development' | 'isPrebuilt'>, filePath: string): void {
  if (ctx.isPrebuilt() && !ctx.development) {
    throw new PrerenderModuleError(
      `${relForDisplay(filePath)} was evaluated at request time, but this server booted from a prebuilt manifest, so the build is stale. Rebuild and redeploy.`,
    );
  }
}

function isNodeModulesLibrary(filePath: string): boolean {
  return toPosixPath(filePath).includes('/node_modules/');
}

/** A package import is a library wherever it resolves — in a workspace, `mochi-framework` realpaths to a sibling source tree, not to `node_modules`. */
function isFirstPartySpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || path.isAbsolute(specifier);
}

const scanner = new Bun.Transpiler({ loader: 'ts' });

/**
 * Every first-party module reachable from `entry` through static imports. Bun's module cache is keyed on these paths,
 * and each has to be evicted before a re-evaluation or a helper's module-level memo would survive from the last one.
 * A production build never evicts, so it only scans `entry` itself for imports the module cannot load.
 */
export async function collectInputs(entry: string, opts: { transitive?: boolean } = {}): Promise<Set<string>> {
  const transitive = opts.transitive ?? true;
  const inputs = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (inputs.has(file)) {
      continue;
    }
    inputs.add(file);
    const dir = path.dirname(file);
    for (const imp of scanner.scanImports(await Bun.file(file).text())) {
      if (imp.kind !== 'import-statement' && imp.kind !== 'dynamic-import' && imp.kind !== 'require-call') {
        continue;
      }
      if (!isFirstPartySpecifier(imp.path)) {
        continue;
      }
      let resolved: string;
      try {
        resolved = Bun.resolveSync(imp.path, dir);
      } catch {
        continue;
      }
      const ext = path.extname(resolved);
      if (COMPONENT_EXTENSIONS.has(ext) || RUNES_MODULE.test(toPosixPath(resolved))) {
        throw new PrerenderModuleError(
          `${relForDisplay(file)} imports ${JSON.stringify(imp.path)}, but a *.prerender.ts module runs outside the bundler, where Svelte files have no loader. ` +
            `Export moduleRef(${JSON.stringify(imp.path)}) instead and import the value where it is used.`,
        );
      }
      if (!transitive) {
        continue;
      }
      // Anything else Bun can load (JSON, text) is cached and evicted like a module but has no imports of its own to scan.
      if (SCRIPT_EXTENSIONS.has(ext)) {
        queue.push(resolved);
      } else {
        inputs.add(resolved);
      }
    }
  }
  return inputs;
}

/** Evaluated once per path per rebuild: the SSR and client passes must inline an identical value, or SSR and hydration diverge. */
let current: PrerenderEvaluationCache = new Map();

/** The memo a compile captures at its start; a later reset installs a fresh map without touching in-flight captures. */
export function currentPrerenderEvaluationCache(): PrerenderEvaluationCache {
  return current;
}

export function resetPrerenderEvaluationCache(): void {
  current = new Map();
}

export function evaluatePrerenderModule(filePath: string, ctx: PrerenderContext): Promise<Namespace> {
  const evaluated = ctx.evaluations ?? current;
  const key = toPosixPath(filePath);
  let pending = evaluated.get(key);
  if (!pending) {
    pending = runModule(filePath, ctx);
    evaluated.set(key, pending);
    // A rejected evaluation must not be replayed forever — the next compile should retry.
    void pending.catch(() => {
      if (evaluated.get(key) === pending) {
        evaluated.delete(key);
      }
    });
  }
  return pending;
}

/** Dev evaluations run one at a time: evicting a shared helper from the module cache while another module's import of it is still in flight is a race Bun does not guard against. */
let chain: Promise<unknown> = Promise.resolve();

function runModule(filePath: string, ctx: PrerenderContext): Promise<Namespace> {
  if (!ctx.development) {
    return evaluate(filePath, ctx);
  }
  const run = chain.then(() => evaluate(filePath, ctx));
  chain = run.catch(() => {});
  return run;
}

async function evaluate(filePath: string, ctx: PrerenderContext): Promise<Namespace> {
  // A one-shot build evaluates each module once, so only a dev rebuild needs fresh instances of what it imports.
  const inputs = await collectInputs(filePath, { transitive: ctx.development });
  if (ctx.development) {
    ctx.onInputs?.(filePath, inputs);
    for (const input of inputs) {
      delete require.cache[input];
    }
  }
  prerenderEvaluation.active += 1;
  try {
    return { ...((await import(Bun.pathToFileURL(filePath).href)) as Namespace) };
  } catch (e) {
    if (e instanceof PrerenderModuleError) {
      throw e;
    }
    throw new PrerenderModuleError(`${relForDisplay(filePath)} threw while evaluating: ${e instanceof Error ? e.message : e}`);
  } finally {
    prerenderEvaluation.active -= 1;
  }
}

export function emitPrerenderModule(ns: Namespace, filePath: string): string {
  const scope = createPrerenderRefScope();
  const declarations: string[] = [];
  const exports: string[] = [];
  Object.keys(ns).forEach((name, i) => {
    const local = `__mochi_export_${i}__`;
    let expression: string;
    try {
      expression = serializePrerenderValue(ns[name], scope).expression;
    } catch (e) {
      const errorPath = devalueErrorPath(e);
      const where = errorPath === undefined ? name : `${name}${errorPath}`;
      throw new PrerenderModuleError(
        `${relForDisplay(filePath)} exports ${JSON.stringify(name)}, which cannot be inlined: ${e instanceof Error ? e.message : e} at ${where}. ` +
          'A *.prerender.ts module may export only data (anything devalue can serialize) or moduleRef() markers.',
      );
    }
    declarations.push(`const ${local} = ${expression};`);
    exports.push(`${local} as ${IDENTIFIER.test(name) ? name : JSON.stringify(name)}`);
  });
  const imports = scope.imports.map((r) => `import ${r.identifier} from ${JSON.stringify(r.specifier)};`);
  return [...imports, ...declarations, `export { ${exports.join(', ')} };`].join('\n') + '\n';
}

/** Returns `undefined` for a dependency's module so it stays on Bun's default loader. */
export function createPrerenderModuleLoader(ctx: PrerenderContext) {
  return async (args: { path: string }): Promise<{ contents: string; loader: 'js' } | undefined> => {
    if (!isPrerenderModulePath(args.path)) {
      return undefined;
    }
    assertNotPrebuilt(ctx, args.path);
    const ns = await evaluatePrerenderModule(args.path, ctx);
    return { contents: emitPrerenderModule(ns, args.path), loader: 'js' };
  };
}
