import path from 'node:path';
import { DevalueError } from 'devalue';
import { createCompiledRefScope, serializeCompiledValue } from './compiledSerialize';
import { relForDisplay, toPosixPath } from '../utils/index';

export const COMPILED_MODULE_FILTER = /\.compiled\.[jt]s$/;

const COMPONENT_EXTENSIONS = new Set(['.svelte', '.md', '.svx']);
const SCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export class CompiledModuleError extends Error {}

export interface CompiledContext {
  development: boolean;
  /** True once a prebuilt manifest is serving: reaching a build-time module on the on-demand path then means the build is stale. */
  isPrebuilt: () => boolean;
  /** The first-party files the module's evaluation loaded, so the dev watcher can rebuild it when one of them changes. */
  onInputs?: (compiledPath: string, inputs: Set<string>) => void;
}

export function isCompiledModulePath(filePath: string): boolean {
  const posix = toPosixPath(filePath);
  return COMPILED_MODULE_FILTER.test(posix) && !posix.includes('/node_modules/');
}

export function assertNotPrebuilt(ctx: Pick<CompiledContext, 'development' | 'isPrebuilt'>, filePath: string): void {
  if (ctx.isPrebuilt() && !ctx.development) {
    throw new CompiledModuleError(
      `${relForDisplay(filePath)} was compiled at request time, but this server booted from a prebuilt manifest, so the build is stale. Rebuild and redeploy.`,
    );
  }
}

function isFirstParty(filePath: string): boolean {
  return !toPosixPath(filePath).includes('/node_modules/');
}

const scanner = new Bun.Transpiler({ loader: 'ts' });

/**
 * Every first-party module reachable from `entry` through static imports. Bun's module cache is keyed on these paths,
 * and each has to be evicted before a re-evaluation or a helper's module-level memo would survive from the last one.
 */
export async function collectInputs(entry: string): Promise<Set<string>> {
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
      let resolved: string;
      try {
        resolved = Bun.resolveSync(imp.path, dir);
      } catch {
        continue;
      }
      if (!isFirstParty(resolved)) {
        continue;
      }
      const ext = path.extname(resolved);
      if (COMPONENT_EXTENSIONS.has(ext)) {
        throw new CompiledModuleError(
          `${relForDisplay(file)} imports ${JSON.stringify(imp.path)}, but a *.compiled.ts module runs outside the bundler, where components have no loader. ` +
            `Export moduleRef(${JSON.stringify(imp.path)}) instead and import the value where it is used.`,
        );
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

type Namespace = Record<string, unknown>;

/** Evaluated once per path per rebuild: the SSR and client passes must inline an identical value, or SSR and hydration diverge. */
const evaluated = new Map<string, Promise<Namespace>>();

export function resetCompiledEvaluationCache(): void {
  evaluated.clear();
}

export function evaluateCompiledModule(filePath: string, ctx: CompiledContext): Promise<Namespace> {
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

/** Evaluations run one at a time: evicting a shared helper from the module cache while another module's import of it is still in flight is a race Bun does not guard against. */
let chain: Promise<unknown> = Promise.resolve();

function runModule(filePath: string, ctx: CompiledContext): Promise<Namespace> {
  const run = chain.then(() => evaluate(filePath, ctx));
  chain = run.catch(() => {});
  return run;
}

async function evaluate(filePath: string, ctx: CompiledContext): Promise<Namespace> {
  const inputs = await collectInputs(filePath);
  ctx.onInputs?.(filePath, inputs);
  // A one-shot build evaluates each module once, so only a dev rebuild needs fresh instances of what it imports.
  if (ctx.development) {
    for (const input of inputs) {
      delete require.cache[input];
    }
  }
  try {
    return { ...((await import(Bun.pathToFileURL(filePath).href)) as Namespace) };
  } catch (e) {
    if (e instanceof CompiledModuleError) {
      throw e;
    }
    throw new CompiledModuleError(`${relForDisplay(filePath)} threw while evaluating: ${e instanceof Error ? e.message : e}`);
  }
}

export function emitCompiledModule(ns: Namespace, filePath: string): string {
  const scope = createCompiledRefScope();
  const declarations: string[] = [];
  const exports: string[] = [];
  Object.keys(ns).forEach((name, i) => {
    const local = `__mochi_export_${i}__`;
    let expression: string;
    try {
      expression = serializeCompiledValue(ns[name], scope).expression;
    } catch (e) {
      const where = e instanceof DevalueError ? `${name}${e.path}` : name;
      throw new CompiledModuleError(
        `${relForDisplay(filePath)} exports ${JSON.stringify(name)}, which cannot be inlined: ${e instanceof Error ? e.message : e} at ${where}. ` +
          'A *.compiled.ts module may export only data (anything devalue can serialize) or moduleRef() markers.',
      );
    }
    declarations.push(`const ${local} = ${expression};`);
    exports.push(`${local} as ${IDENTIFIER.test(name) ? name : JSON.stringify(name)}`);
  });
  const imports = scope.imports.map((r) => `import ${r.identifier} from ${JSON.stringify(r.specifier)};`);
  return [...imports, ...declarations, `export { ${exports.join(', ')} };`].join('\n') + '\n';
}

/** Returns `undefined` for a dependency's module so it stays on Bun's default loader. */
export function createCompiledModuleLoader(ctx: CompiledContext) {
  return async (args: { path: string }): Promise<{ contents: string; loader: 'js' } | undefined> => {
    if (!isCompiledModulePath(args.path)) {
      return undefined;
    }
    assertNotPrebuilt(ctx, args.path);
    const ns = await evaluateCompiledModule(args.path, ctx);
    return { contents: emitCompiledModule(ns, args.path), loader: 'js' };
  };
}
