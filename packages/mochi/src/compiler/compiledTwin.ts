import path from 'node:path';
import { mkdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { toPosixPath, relForDisplay } from '../utils/index';

/** One import declaration from the host module, as source plus the local names it binds. */
export interface HostImport {
  source: string;
  specifier: string;
  names: string[];
  /** Byte range in the host script, so a dead import can be sliced out after inlining. */
  start: number;
  end: number;
}

export interface TwinRequest {
  /** Absolute path of the module the `compiled()` call was written in. */
  hostPath: string;
  /** Source text of the expression passed to `compiled()`. */
  expression: string;
  /** Identifiers the expression references but does not bind. */
  free: Set<string>;
  /** Every import declaration visible to the expression. */
  imports: HostImport[];
  /** Names the host module declares itself. A free reference to one of these is an error even when a same-named build-process global exists. */
  hostLocals: ReadonlySet<string>;
  outDir: string;
}

/** Identifiers that need no import: real globals, plus the keywords a `globalThis` probe misses. */
const KEYWORD_GLOBALS = new Set(['undefined', 'NaN', 'Infinity', 'globalThis', 'arguments']);

function isGlobal(name: string): boolean {
  return KEYWORD_GLOBALS.has(name) || name in (globalThis as unknown as Record<string, unknown>);
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** Rewrite a relative specifier against the host file so the twin, which lives elsewhere, still resolves it. */
function absolutize(specifier: string, hostDir: string): string {
  return isRelative(specifier) ? toPosixPath(path.resolve(hostDir, specifier)) : specifier;
}

export class CompiledExpressionError extends Error {}

const COMPONENT_EXTENSIONS = new Set(['.svelte', '.md', '.svx']);

/**
 * Build the source of a build-time twin: the lifted expression plus only the imports its free identifiers actually
 * need. Sibling component imports the expression never touches are left out on purpose — the Bun runtime has no loader
 * for them, so including them would fail the evaluation.
 */
export function buildTwinSource(req: TwinRequest): { source: string; used: HostImport[] } {
  const hostDir = path.dirname(req.hostPath);
  const providers = new Map<string, HostImport>();
  for (const imp of req.imports) {
    for (const name of imp.names) {
      providers.set(name, imp);
    }
  }

  const used = new Set<HostImport>();
  const missing: string[] = [];
  for (const name of req.free) {
    const provider = providers.get(name);
    if (provider) {
      used.add(provider);
    } else if (req.hostLocals.has(name) || !isGlobal(name)) {
      // A host local is reported even when `globalThis` carries the same name, or the twin silently binds to the
      // build process's `File`/`self`/`process` and inlines a value the user never wrote.
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    const names = missing.map((n) => JSON.stringify(n)).join(', ');
    throw new CompiledExpressionError(
      `compiled() in ${relForDisplay(req.hostPath)} can only reference module-level imports and globals, but this expression references ${names}. ` +
        (missing.length === 1 ? 'Move that value into its own module and import it.' : 'Move those values into their own modules and import them.'),
    );
  }

  const usedList = [...used];
  for (const imp of usedList) {
    if (COMPONENT_EXTENSIONS.has(path.extname(imp.specifier))) {
      throw new CompiledExpressionError(
        `compiled() in ${relForDisplay(req.hostPath)} cannot import ${JSON.stringify(imp.specifier)} — components have no runtime loader during a build. ` +
          `Return moduleRef(${JSON.stringify(imp.specifier)}) from the compiled function instead.`,
      );
    }
  }

  const lines = usedList.map((imp) => imp.source.replace(imp.specifier, absolutize(imp.specifier, hostDir)));
  lines.push(`export const __mochi_compiled__ = ${req.expression};`);
  return { source: lines.join('\n') + '\n', used: usedList };
}

/** Evaluated once per unique twin source: the same expression compiled for the server and client targets must inline an identical value, or SSR and hydration diverge. */
const evaluated = new Map<string, Promise<unknown>>();

export async function evaluateTwin(req: TwinRequest): Promise<{ value: unknown; used: HostImport[] }> {
  const { source, used } = buildTwinSource(req);
  const key = `${req.hostPath}\0${source}`;
  let pending = evaluated.get(key);
  if (!pending) {
    pending = runTwin(source, req.outDir, req.hostPath);
    evaluated.set(key, pending);
    // A rejected evaluation must not be replayed forever — the next compile should retry.
    void pending.catch(() => {
      if (evaluated.get(key) === pending) {
        evaluated.delete(key);
      }
    });
  }
  return { value: await pending, used };
}

async function runTwin(source: string, outDir: string, hostPath: string): Promise<unknown> {
  const dir = path.resolve(outDir, 'compiled');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `twin-${Bun.hash(source).toString(36)}.ts`);
  await Bun.write(file, source);
  // The file only exists so Bun can resolve the expression's imports; once it is loaded it is garbage. Re-importing the
  // same path later returns the module Bun already has, so the thunk re-runs but its helpers keep their module state.
  let mod: { __mochi_compiled__?: unknown };
  try {
    mod = (await import(Bun.pathToFileURL(file).href)) as { __mochi_compiled__?: unknown };
  } finally {
    discardTwin(file, dir);
  }
  const thunk = mod.__mochi_compiled__;
  if (typeof thunk !== 'function') {
    throw new CompiledExpressionError(`compiled() expects a function, e.g. compiled(() => loadData()) — in ${relForDisplay(hostPath)}.`);
  }
  try {
    return await (thunk as () => unknown)();
  } catch (e) {
    // The throw comes from user code running inside a bundler plugin, where nothing else names the file it came from.
    throw new CompiledExpressionError(`compiled() in ${relForDisplay(hostPath)} threw while evaluating: ${e instanceof Error ? e.message : e}`);
  }
}

function discardTwin(file: string, dir: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
  // Fails while a sibling twin is still being evaluated, which is exactly when the directory must stay.
  try {
    rmdirSync(dir);
  } catch {
    /* not empty */
  }
}

export function resetCompiledEvaluationCache(): void {
  evaluated.clear();
}
