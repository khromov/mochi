#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from './build';
import { closeAllQueueResources } from '../queue';
import { extractServeOptions } from './extractServeOptions';
import { updateSkill, SKILL_TARGETS, SKILL_DESTS, DEFAULT_SKILL_TARGET, type SkillTarget } from './updateSkill';
import { generateKey } from './generateKey';
import { generateSpeculationRules } from './generateSpeculationRules';
import { relForDisplay } from '../utils';
import { markBuilding } from '../utils/buildFlag';

const TARGET_ALIASES: Record<string, SkillTarget> = { agy: 'antigravity' };

// Inverse of TARGET_ALIASES: maps a canonical target to the aliases pointing at it,
// so help/error text stays in sync with the alias map instead of hardcoding names.
const ALIASES_BY_TARGET: Partial<Record<SkillTarget, string[]>> = {};
for (const [alias, target] of Object.entries(TARGET_ALIASES)) {
  (ALIASES_BY_TARGET[target] ??= []).push(alias);
}

const ALL_ALIASES = Object.keys(TARGET_ALIASES);

const HELP = `Usage: mochi-framework <command> [options]

Commands:
  build                  Produce a production bundle in the output directory.
  update-skill [agent]   Fetch the latest SKILL.md and write it into the current
                         project for the given agent. Default: ${DEFAULT_SKILL_TARGET}.
                         Agents:
${SKILL_TARGETS.map((t) => {
  const aliasNote = ALIASES_BY_TARGET[t]?.length ? ` (alias: ${ALIASES_BY_TARGET[t]!.join(', ')})` : '';
  return `                           ${t.padEnd(12)} -> ${SKILL_DESTS[t]}${aliasNote}`;
}).join('\n')}
  generate-key           Generate a MOCHI_KEY (base64url-encoded 32-byte secret)
                         and write it to .env in the current directory. Prompts
                         before overwriting an existing key.
                         Options:
                           -f, --force  Overwrite an existing MOCHI_KEY without prompting.
  speculation-rules      Generate a starting Speculation Rules config from your
                         page routes and write it into the \`speculationRules\` key
                         of your entry's Mochi.serve({ ... }) call.
                         Options:
                           --entry <path>  Runtime entry. Default: ./src/index.ts
                           --dry-run       Print the rules instead of writing them.

Options for "build":
  --entry <path>           Runtime entry whose \`Mochi.serve()\` call supplies
                           \`routes\`, \`markdown\`, and \`optimize\`.
                           Default: ./src/index.ts
  --out-dir <path>         Build output directory. Default: ./.mochi
  --public-dir <path>      Static assets directory. Default: ./public
  --asset-prefix <path>    URL prefix for framework client assets. Default: /_mochi
  --dev                    Build with development: true.

The build reads its config straight from the entry's \`Mochi.serve()\` call, so
the prebuilt manifest stays single-sourced with the runtime.

Global:
  -h, --help           Show this help.
  -v, --version        Show version.
`;

function resolveTarget(name: string): SkillTarget | null {
  if ((SKILL_TARGETS as string[]).includes(name)) {
    return name as SkillTarget;
  }
  return TARGET_ALIASES[name] ?? null;
}

async function runUpdateSkill(args: string[]) {
  const requested = args[0] ?? DEFAULT_SKILL_TARGET;
  const target = resolveTarget(requested);
  if (!target) {
    const aliasNote = ALL_ALIASES.length ? ` (aliases: ${ALL_ALIASES.join(', ')})` : '';
    process.stderr.write(`[mochi] Unknown agent: ${requested}\n\nValid agents: ${SKILL_TARGETS.join(', ')}${aliasNote}\n`);
    process.exit(1);
  }

  try {
    const { path: dest, created } = await updateSkill({ target });
    const rel = relForDisplay(dest) || dest;
    process.stdout.write(`[mochi] ${created ? 'Created' : 'Updated'} ${rel}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mochi] ${msg}\n`);
    process.exit(1);
  }
}

async function runGenerateKey(force: boolean) {
  try {
    const { path: dest, action } = await generateKey({
      force,
      confirmOverwrite: () => confirm('[mochi] MOCHI_KEY already exists in .env. Overwrite?'),
    });
    const rel = relForDisplay(dest) || dest;
    if (action === 'aborted') {
      process.stdout.write(`[mochi] Aborted. Existing MOCHI_KEY in ${rel} left unchanged.\n`);
      return;
    }
    const verb = action === 'created' ? 'Created' : action === 'appended' ? 'Added MOCHI_KEY to' : 'Replaced MOCHI_KEY in';
    process.stdout.write(`[mochi] ${verb} ${rel}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mochi] ${msg}\n`);
    process.exit(1);
  }
}

async function runSpeculationRules(entryArg: string | undefined, dryRun: boolean) {
  // The whole process reads the app entry for real, so suppress its boot side effects up front.
  markBuilding();

  const entryPath = path.resolve(process.cwd(), entryArg ?? './src/index.ts');
  const entryRel = relForDisplay(entryPath) || entryPath;
  if (!existsSync(entryPath)) {
    process.stderr.write(`[mochi] Entry not found: ${entryRel}\n`);
    process.exit(1);
  }

  let serveOptions: Awaited<ReturnType<typeof extractServeOptions>> = null;
  try {
    serveOptions = await extractServeOptions(entryPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mochi] Could not read ${entryRel}: ${msg}\n`);
    await closeAllQueueResources();
    process.exit(1);
  }

  const routes = serveOptions?.routes;
  if (!routes || typeof routes !== 'object') {
    process.stderr.write(`[mochi] No \`routes\` found. Ensure ${entryRel} calls Mochi.serve({ routes }).\n`);
    await closeAllQueueResources();
    process.exit(1);
  }

  const rules = generateSpeculationRules(routes, { trailingSlash: serveOptions?.trailingSlash });
  if (!rules.prefetch && !rules.prerender) {
    process.stderr.write(`[mochi] No page routes found. Add Mochi.page() routes, then re-run \`mochi-framework speculation-rules\`.\n`);
    await closeAllQueueResources();
    process.exit(1);
  }

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(rules, null, 2)}\n`);
    await closeAllQueueResources();
    process.exit(0);
  }

  // Loaded here rather than at module top so the other commands never pull in its `typescript` peer.
  const { writeSpeculationRules, SpeculationRulesWriteError } = await import('./writeSpeculationRules');
  try {
    const { action, multipleServeCalls } = await writeSpeculationRules(entryPath, rules);
    process.stdout.write(`[mochi] ${action === 'inserted' ? 'Added' : 'Updated'} speculationRules in ${entryRel}. Run your formatter (e.g. \`bun run format\`) to tidy it.\n`);
    if (multipleServeCalls) {
      process.stdout.write(`[mochi] Note: more than one eligible Mochi.serve() call was found — edited the first.\n`);
    }
  } catch (err) {
    if (err instanceof SpeculationRulesWriteError) {
      process.stderr.write(`[mochi] ${err.message}\n\nspeculationRules: ${JSON.stringify(rules, null, 2)}\n`);
      await closeAllQueueResources();
      process.exit(1);
    }
    throw err;
  }

  // Extracting serve options imports the entry for real; if it started the queue runtime, drain it so this one-shot exits.
  await closeAllQueueResources();
  process.exit(0);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      entry: { type: 'string' },
      'out-dir': { type: 'string' },
      'public-dir': { type: 'string' },
      'asset-prefix': { type: 'string' },
      dev: { type: 'boolean' },
      force: { type: 'boolean', short: 'f' },
      'dry-run': { type: 'boolean' },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (values.version) {
    const pkgPath = path.join(import.meta.dir, '..', '..', 'package.json');
    const pkg = (await Bun.file(pkgPath).json()) as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const cmd = positionals[0];
  if (!cmd) {
    process.stderr.write(HELP);
    process.exit(1);
  }

  if (cmd === 'update-skill') {
    await runUpdateSkill(positionals.slice(1));
    return;
  }

  if (cmd === 'generate-key') {
    await runGenerateKey(Boolean(values.force));
    return;
  }

  if (cmd === 'speculation-rules') {
    await runSpeculationRules(values.entry, Boolean(values['dry-run']));
    return;
  }

  if (cmd !== 'build') {
    process.stderr.write(`[mochi] Unknown command: ${cmd}\n\n${HELP}`);
    process.exit(1);
  }

  // Flipped before anything imports the app entry: this whole process is a build, so server-setup code must skip
  // real-boot side effects for its entire lifetime, not just while the entry is being read.
  markBuilding();

  const entryPath = path.resolve(process.cwd(), values.entry ?? './src/index.ts');
  let serveOptions: Awaited<ReturnType<typeof extractServeOptions>> = null;
  if (existsSync(entryPath)) {
    try {
      serveOptions = await extractServeOptions(entryPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mochi] Could not read ${entryPath}: ${msg}\n`);
    }
  }

  const routes = serveOptions?.routes;
  if (!routes || typeof routes !== 'object') {
    process.stderr.write(`[mochi] No \`routes\` found. Ensure ${entryPath} calls Mochi.serve({ routes }).\n`);
    process.exit(1);
  }

  await build({
    routes,
    markdown: serveOptions?.markdown,
    svelteCompiler: serveOptions?.svelteCompiler,
    optimize: serveOptions && 'optimize' in serveOptions ? serveOptions.optimize : undefined,
    barrelWarnings: serveOptions?.barrelWarnings,
    errorPage: serveOptions?.errorPage,
    resources: serveOptions?.build?.resources,
    development: values.dev,
    outDir: values['out-dir'],
    // Fall back to the entry's own `publicDir` so the build validates the same
    // directory the server will scan — an explicit flag still overrides it.
    publicDir: values['public-dir'] ?? serveOptions?.publicDir,
    assetPrefix: values['asset-prefix'],
  });

  // Extracting serve options imports the user's entry for real; if anything started the queue runtime, its
  // maintenance timers keep the event loop alive and hang this one-shot build. Drain and exit.
  await closeAllQueueResources();
  process.exit(0);
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
