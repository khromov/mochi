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
  --routes <path>          Path to the file exporting \`routes\`. Default: ./src/routes.ts
  --entry <path>           Runtime entry whose \`Mochi.serve()\` call is read for
                           \`optimizeWithSvelteShaker\`. Default: ./src/index.ts
  --out-dir <path>         Build output directory. Default: ./.mochi
  --public-dir <path>      Static assets directory. Default: ./public
  --asset-prefix <path>    URL prefix for framework client assets. Default: /_mochi
  --dev                    Build with development: true.

The routes file may also export \`buildOptions\` (a \`MochiBuildOptions\`
object) for options that can't be expressed as flags, e.g. \`markdown\`.
\`optimizeWithSvelteShaker\` is read from the entry's \`Mochi.serve()\` call
instead, so it stays single-sourced with the runtime.

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

  const routesPath = path.resolve(process.cwd(), values.routes ?? './src/routes.ts');
  if (!existsSync(routesPath)) {
    process.stderr.write(`[mochi] Routes file not found: ${routesPath}\n` + `Pass --routes <path> or create ./src/routes.ts with a \`routes\` named export.\n`);
    process.exit(1);
  }

  const mod = (await import(Bun.pathToFileURL(routesPath).href)) as { routes?: unknown; buildOptions?: unknown };
  if (!mod.routes || typeof mod.routes !== 'object') {
    process.stderr.write(`[mochi] ${routesPath} does not export a \`routes\` object.\n` + `Add: export const routes = { ... };\n`);
    process.exit(1);
  }

  const userBuildOptions = (mod.buildOptions && typeof mod.buildOptions === 'object' ? mod.buildOptions : {}) as Partial<Parameters<typeof build>[0]>;

  // `optimizeWithSvelteShaker` is authored once, in the runtime entry's
  // `Mochi.serve()` call. Read it from there so the prebuilt manifest can't
  // drift from runtime. Falls back to `buildOptions` if the entry is missing or
  // never calls serve().
  let shaker = userBuildOptions.optimizeWithSvelteShaker;
  const entryPath = path.resolve(process.cwd(), values.entry ?? './src/index.ts');
  if (existsSync(entryPath)) {
    try {
      const serveOptions = await extractServeOptions(entryPath);
      if (serveOptions && 'optimizeWithSvelteShaker' in serveOptions) {
        shaker = serveOptions.optimizeWithSvelteShaker;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mochi] Could not read optimizeWithSvelteShaker from ${entryPath}: ${msg}\n` + `Falling back to buildOptions.optimizeWithSvelteShaker.\n`);
    }
  } else {
    process.stderr.write(`[mochi] Entry not found: ${entryPath}; using buildOptions.optimizeWithSvelteShaker (if any). Pass --entry <path> to override.\n`);
  }

  await build({
    ...userBuildOptions,
    optimizeWithSvelteShaker: shaker,
    routes: mod.routes as Parameters<typeof build>[0]['routes'],
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
