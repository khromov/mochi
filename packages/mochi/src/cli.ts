#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from './build';
import { extractServeOptions } from './extractServeOptions';

const HELP = `Usage: mochi-framework <command> [options]

Commands:
  build    Produce a production bundle in the output directory.

Options for "build":
  --entry <path>           Runtime entry whose \`Mochi.serve()\` call supplies
                           \`routes\`, \`markdown\`, and \`optimizeWithSvelteShaker\`.
                           Default: ./src/index.ts
  --routes <path>          Legacy fallback: a module exporting \`routes\` (+ an
                           optional \`buildOptions\`), used when the entry yields
                           no routes. Default: ./src/routes.ts
  --out-dir <path>         Build output directory. Default: ./.mochi
  --public-dir <path>      Static assets directory. Default: ./public
  --asset-prefix <path>    URL prefix for framework client assets. Default: /_mochi
  --dev                    Build with development: true.

The build reads its config straight from the entry's \`Mochi.serve()\` call, so
the prebuilt manifest stays single-sourced with the runtime. The \`--routes\`
module (with its \`buildOptions\` export) is only consulted as a fallback.

Global:
  -h, --help           Show this help.
  -v, --version        Show version.
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      routes: { type: 'string' },
      entry: { type: 'string' },
      'out-dir': { type: 'string' },
      'public-dir': { type: 'string' },
      'asset-prefix': { type: 'string' },
      dev: { type: 'boolean' },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (values.version) {
    const pkgPath = path.join(import.meta.dir, '..', 'package.json');
    const pkg = (await Bun.file(pkgPath).json()) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const cmd = positionals[0];
  if (!cmd) {
    process.stderr.write(HELP);
    process.exit(1);
  }
  if (cmd !== 'build') {
    process.stderr.write(`[mochi] Unknown command: ${cmd}\n\n${HELP}`);
    process.exit(1);
  }

  type BuildOptions = Parameters<typeof build>[0];

  // Primary source: the runtime entry. Importing it with `Mochi.serve`
  // intercepted yields the exact options object the server would run with —
  // `routes`, `markdown`, and `optimizeWithSvelteShaker` — so the prebuilt
  // manifest can't drift from runtime, and there's nothing to mirror.
  let serveOptions: Awaited<ReturnType<typeof extractServeOptions>> = null;
  const entryPath = path.resolve(process.cwd(), values.entry ?? './src/index.ts');
  if (existsSync(entryPath)) {
    try {
      serveOptions = await extractServeOptions(entryPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mochi] Could not read ${entryPath}: ${msg}\n` + `Falling back to a routes module.\n`);
    }
  }

  // Legacy fallback: a module exporting `routes` (+ optional `buildOptions`).
  // Loaded when the entry yielded no routes, or when --routes is passed.
  let userBuildOptions: Partial<BuildOptions> = {};
  let moduleRoutes: BuildOptions['routes'] | undefined;
  if (values.routes !== undefined || !serveOptions?.routes) {
    const routesPath = path.resolve(process.cwd(), values.routes ?? './src/routes.ts');
    if (existsSync(routesPath)) {
      const mod = (await import(Bun.pathToFileURL(routesPath).href)) as { routes?: unknown; buildOptions?: unknown };
      if (mod.routes && typeof mod.routes === 'object') {
        moduleRoutes = mod.routes as BuildOptions['routes'];
      }
      if (mod.buildOptions && typeof mod.buildOptions === 'object') {
        userBuildOptions = mod.buildOptions as Partial<BuildOptions>;
      }
    } else if (values.routes !== undefined) {
      process.stderr.write(`[mochi] Routes file not found: ${routesPath}\n`);
      process.exit(1);
    }
  }

  const routes = serveOptions?.routes ?? moduleRoutes;
  if (!routes || typeof routes !== 'object') {
    process.stderr.write(`[mochi] No \`routes\` found. Ensure ${entryPath} calls Mochi.serve({ routes }), or pass --routes <path> to a module exporting \`routes\`.\n`);
    process.exit(1);
  }

  await build({
    ...userBuildOptions,
    routes,
    markdown: serveOptions?.markdown ?? userBuildOptions.markdown,
    optimizeWithSvelteShaker: serveOptions && 'optimizeWithSvelteShaker' in serveOptions ? serveOptions.optimizeWithSvelteShaker : userBuildOptions.optimizeWithSvelteShaker,
    development: values.dev,
    outDir: values['out-dir'],
    publicDir: values['public-dir'],
    assetPrefix: values['asset-prefix'],
  });
}

main().catch((err: unknown) => {
  if (err instanceof AggregateError) {
    // Bun.build()'s default-thrown AggregateError has stack=undefined and
    // message="Bundle failed", which the framework normally reroutes via
    // throw:false. This branch catches anything that still escapes (e.g. a
    // dependency that calls Bun.build directly) and prints the inner errors.
    process.stderr.write(`[mochi] ${err.message}\n`);
    for (const inner of err.errors) {
      const innerMsg = inner instanceof Error ? (inner.stack ?? inner.message) : String(inner);
      process.stderr.write(`  - ${innerMsg}\n`);
    }
  } else {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${msg}\n`);
  }
  process.exit(1);
});
