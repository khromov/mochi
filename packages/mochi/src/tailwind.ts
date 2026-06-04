import path from 'node:path';
import { compile, optimize, type Resolver } from '@tailwindcss/node';
import { Scanner, type SourceEntry } from '@tailwindcss/oxide';
import { mochiEvents } from './events';
import { logger } from './log';

export interface TailwindOptions {
  /** Path to the input CSS file (e.g. with `@import "tailwindcss";` and `@source` rules). */
  input: string;
  /** Path where the generated CSS is written. Stable so a Svelte component can `import` it. */
  output: string;
  /** Base directory passed to Tailwind's compiler — anchors `@source` patterns. Defaults to the input file's directory. */
  base?: string;
  /** Minify the optimised output. Default: false. */
  minify?: boolean;
}

/**
 * Bun-backed resolver passed to Tailwind as both `customCssResolver` and
 * `customJsResolver`. enhanced-resolve (Tailwind's default resolver) escapes
 * `#`/`?` in paths as `\0#` and fails to unescape before readFile, so any
 * install path containing those chars crashes; Bun's resolver returns clean
 * paths. Returning `undefined` for ids Bun can't resolve is intentional:
 * Tailwind treats a falsy return as "defer to the default resolver" (it only
 * uses a custom resolver's result when truthy), so this only *replaces* the
 * default for the paths Bun handles and never narrows what's resolvable.
 */
export function createBunResolver(): Resolver {
  return async (id, resolveBase) => {
    try {
      return Bun.resolveSync(id, resolveBase);
    } catch {
      return undefined;
    }
  };
}

/**
 * Run Tailwind once: compile the input CSS, scan configured sources for
 * candidate classes, build the final CSS, and write it to `output` only when
 * the bytes actually differ. The skip-on-equal write avoids ping-ponging the
 * dev CSS watcher when nothing changed.
 */
export async function compileTailwind(opts: TailwindOptions): Promise<void> {
  const inputAbs = path.resolve(opts.input);
  const outputAbs = path.resolve(opts.output);
  const base = opts.base ? path.resolve(opts.base) : path.dirname(inputAbs);
  const inputCss = await Bun.file(inputAbs).text();

  const bunResolver = createBunResolver();

  const compiled = await compile(inputCss, {
    base,
    from: inputAbs,
    onDependency: () => {},
    customCssResolver: bunResolver,
    customJsResolver: bunResolver,
  });

  const scanner = new Scanner({ sources: compiled.sources as SourceEntry[] });
  const candidates = scanner.scan();
  const built = compiled.build(candidates);
  const { code } = optimize(built, { file: outputAbs, minify: opts.minify ?? false });

  const existing = await Bun.file(outputAbs)
    .text()
    .catch(() => null);
  if (existing !== code) {
    await Bun.write(outputAbs, code);
  }
}

/**
 * Run Tailwind at startup, then in development re-run on relevant file
 * changes. Uses `mochiEvents.setHandler` so the subscription replaces itself
 * across module re-imports rather than stacking.
 */
export async function setupTailwind(opts: TailwindOptions): Promise<void> {
  const outputAbs = path.resolve(opts.output);
  await compileTailwind(opts);

  if (process.env.MODE !== 'development') {
    return;
  }

  let pending: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  const schedule = () => {
    if (pending) {
      clearTimeout(pending);
    }
    pending = setTimeout(() => {
      pending = null;
      inFlight = inFlight.then(() =>
        compileTailwind(opts).catch((e) => {
          logger.error('tailwind rebuild failed:', e);
        }),
      );
    }, 50);
  };

  mochiEvents.setHandler('tailwind-rebuild', 'file:change', ({ path: changed }) => {
    if (path.resolve(changed) === outputAbs) {
      return;
    }
    if (!/\.(svelte|ts|js|html|md|svx|css)$/.test(changed)) {
      return;
    }
    schedule();
  });
}
